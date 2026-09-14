import type { JsonObject } from '../domain/common.js';
import type { EvaluationResults } from '../domain/types.js';
import type { PollClock } from '../polling/clock.js';
import { waitForResult } from '../polling/wait-for-result.js';
import { ApiError } from '../api/errors.js';
import type { ActionContext } from './context.js';
import { resolveEvaluationVersion } from './evaluations.js';
import { requireUuid } from './validation.js';

function loadWhenReady(
  load: () => Promise<JsonObject>,
  input: { clock: PollClock; intervalMs: number; timeoutMs: number; signal?: AbortSignal },
  isReady?: (value: JsonObject) => boolean,
): Promise<JsonObject> {
  return waitForResult({ load, ...input, ...(isReady ? { isReady } : {}) });
}

function valueAt(payload: JsonObject, ...path: readonly string[]): unknown {
  let current: unknown = payload;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function nonEmptyArrayAt(payload: JsonObject, ...path: readonly string[]): boolean {
  const value = valueAt(payload, ...path);
  return Array.isArray(value) && value.length > 0;
}

/** Zero while judging is still running, even though the request answers 200. */
function countedEvaluations(payload: JsonObject): number {
  const value = valueAt(payload, 'evaluation_summary', 'total_evaluations');
  return typeof value === 'number' ? value : 0;
}

export async function getResults(
  context: ActionContext,
  input: {
    evaluationId: string;
    runId: string;
    clock: PollClock;
    resultReadyIntervalMs: number;
    resultReadyTimeoutMs: number;
    signal?: AbortSignal;
  },
): Promise<EvaluationResults> {
  const evaluationId = requireUuid(input.evaluationId, 'Evaluation ID');
  const runId = requireUuid(input.runId, 'Run ID');
  const version = await resolveEvaluationVersion(context, evaluationId, undefined, input.signal);
  const readiness = {
    clock: input.clock,
    intervalMs: input.resultReadyIntervalMs,
    timeoutMs: input.resultReadyTimeoutMs,
    ...(input.signal ? { signal: input.signal } : {}),
  };

  if (version.contextType === 'scenario') {
    const [modelPerformance, scenarioComparison, modelResponses] = await Promise.all([
      // Scored models appear only once judging finishes; until then the
      // endpoint answers 200 with an empty list.
      loadWhenReady(
        () => context.api.getModelPerformance(evaluationId, runId, input.signal),
        readiness,
        (payload) => nonEmptyArrayAt(payload, 'models'),
      ),
      loadWhenReady(
        () => context.api.getScenarioComparison(evaluationId, runId, input.signal),
        readiness,
        (payload) => countedEvaluations(payload) > 0,
      ),
      loadWhenReady(
        () => context.api.getModelResponses(evaluationId, runId, input.signal),
        readiness,
      ),
    ]);
    return { contextType: 'scenario', modelPerformance, scenarioComparison, modelResponses };
  }

  if (version.contextType === 'conversation') {
    const conversation = await loadWhenReady(
      () => context.api.getConversationResults(evaluationId, runId, input.signal),
      readiness,
    );
    return { contextType: 'conversation', conversation };
  }

  const agentTrace = await loadWhenReady(
    () => context.api.getAgentTraceResults(evaluationId, runId, input.signal),
    readiness,
  );
  let trajectory: JsonObject | undefined;
  try {
    trajectory = await loadWhenReady(
      () => context.api.getTrajectory(evaluationId, runId, input.signal),
      readiness,
    );
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
  }
  return {
    contextType: 'agent_trace',
    agentTrace,
    ...(trajectory ? { trajectory } : {}),
  };
}
