import type { JsonObject } from '../domain/common.js';
import type { EvaluationContextType, EvaluationResults, RunStatus } from '../domain/types.js';
import {
  applyModelOverrides,
  requireModelOverridesForPublicPlaceholders,
  type ConfiguredRunModelOverrides,
  type ParsedConfiguredRunInput,
} from '../configured-run/validation.js';
import type { PollClock } from '../polling/clock.js';
import { runTwoPlaneSuite, type SuiteEvalRecord, type SuiteItem } from '../suite/execution.js';
import { runConfiguredEvaluation, validateConfiguredEvaluation } from './configured-runs.js';
import type { ActionContext } from './context.js';
import { createEvaluation } from './evaluations.js';
import { getResults } from './results.js';

/** Per-eval identity and terminal execution state, preserved for the summary. */
export type SuiteEvalExecution = {
  evaluationId: string;
  evaluationName: string;
  contextType: EvaluationContextType;
  runId: string;
  state: string;
  elapsedMs: number;
  /** Terminal run-status payload, kept for the gate plane. */
  statusRaw: JsonObject;
};

export type SuiteEvalEntry = SuiteEvalRecord<SuiteEvalExecution, EvaluationResults>;

export type SuiteSummary = {
  workspaceId: string;
  total: number;
  completed: number;
  failed: number;
  evals: SuiteEvalEntry[];
};

export type RunSuiteInput = {
  workspaceId: string;
  inputFiles: readonly string[];
  /** Reads and parses one eval file. Injected so file IO stays in the command layer. */
  loadEvalFile: (inputFile: string) => Promise<ParsedConfiguredRunInput>;
  clock: PollClock;
  pollIntervalMs: number;
  pollTimeoutMs: number;
  resultReadyIntervalMs: number;
  resultReadyTimeoutMs: number;
  concurrency: number;
  staggerMs: number;
  resultConcurrency?: number;
  signal?: AbortSignal;
  onStatus?: (item: SuiteItem, status: RunStatus) => void;
  modelOverrides?: ConfiguredRunModelOverrides;
};

/**
 * Runs a suite in two planes: execution (bounded concurrency) and result
 * fetching (off-plane). Both planes reuse the existing create/run/poll and
 * result-fetching actions; nothing is re-implemented here.
 */
export async function runSuite(
  context: ActionContext,
  input: RunSuiteInput,
): Promise<SuiteSummary> {
  const evals = await runTwoPlaneSuite<SuiteEvalExecution, EvaluationResults>({
    inputFiles: input.inputFiles,
    executionConcurrency: input.concurrency,
    staggerMs: input.staggerMs,
    clock: input.clock,
    ...(input.resultConcurrency === undefined
      ? {}
      : { resultConcurrency: input.resultConcurrency }),
    ...(input.signal ? { signal: input.signal } : {}),
    execute: async (item) => {
      const parsedConfiguredRun = await input.loadEvalFile(item.inputFile);
      const configuredRun = applyModelOverrides(parsedConfiguredRun, input.modelOverrides ?? {});
      requireModelOverridesForPublicPlaceholders(configuredRun);
      await validateConfiguredEvaluation(context, configuredRun, input.signal);
      const evaluationName =
        configuredRun.evaluationName ?? configuredRun.configuration.contextName;
      const evaluation = await createEvaluation(
        context,
        { workspaceId: input.workspaceId, evaluationName },
        input.signal,
      );
      const execution = await runConfiguredEvaluation(context, {
        evaluationId: evaluation.evaluationId,
        configuredRun,
        clock: input.clock,
        pollIntervalMs: input.pollIntervalMs,
        pollTimeoutMs: input.pollTimeoutMs,
        prevalidated: true,
        ...(input.signal ? { signal: input.signal } : {}),
        ...(input.onStatus
          ? { onStatus: (status: RunStatus) => input.onStatus?.(item, status) }
          : {}),
      });
      return {
        evaluationId: evaluation.evaluationId,
        evaluationName,
        contextType: configuredRun.configuration.contextType,
        runId: execution.run.runId,
        state: execution.outcome.status.state,
        elapsedMs: execution.outcome.elapsedMs,
        statusRaw: execution.outcome.status.raw,
      };
    },
    fetchResults: (execution) =>
      getResults(context, {
        evaluationId: execution.evaluationId,
        runId: execution.runId,
        clock: input.clock,
        resultReadyIntervalMs: input.resultReadyIntervalMs,
        resultReadyTimeoutMs: input.resultReadyTimeoutMs,
        ...(input.signal ? { signal: input.signal } : {}),
      }),
  });

  const completed = evals.filter((entry) => entry.status === 'completed').length;
  return {
    workspaceId: input.workspaceId,
    total: evals.length,
    completed,
    failed: evals.length - completed,
    evals,
  };
}
