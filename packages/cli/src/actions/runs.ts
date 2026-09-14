import { randomUUID } from 'node:crypto';

import type { RunExecution, RunHandle, RunStatus } from '../domain/types.js';
import { AutoevalError } from '../errors/autoeval-error.js';
import type { PollClock } from '../polling/clock.js';
import { waitForRun } from '../polling/wait-for-run.js';
import type { ActionContext } from './context.js';
import { resolveEvaluationVersion } from './evaluations.js';
import { requireUuid } from './validation.js';

export function getRunStatus(
  context: ActionContext,
  input: { evaluationId: string; runId: string },
  signal?: AbortSignal,
): Promise<RunStatus> {
  return context.api.getRunStatus(
    requireUuid(input.evaluationId, 'Evaluation ID'),
    requireUuid(input.runId, 'Run ID'),
    signal,
  );
}

export async function submitEvaluation(
  context: ActionContext,
  input: {
    evaluationId: string;
    signal?: AbortSignal;
    idempotencyKeyFactory?: () => string;
  },
): Promise<RunHandle> {
  const version = await resolveEvaluationVersion(
    context,
    input.evaluationId,
    undefined,
    input.signal,
  );
  const idempotencyKey = (input.idempotencyKeyFactory ?? randomUUID)();
  const runResponse = await context.api.createRun({
    evaluationId: version.evaluationId,
    configVersionId: version.configVersionId,
    idempotencyKey,
    ...(input.signal ? { signal: input.signal } : {}),
  });

  if (
    runResponse.using.configVersionId !== version.configVersionId ||
    runResponse.using.methodologyVersionId !== version.methodologyVersionId
  ) {
    throw new AutoevalError('Autoeval API created the run with unexpected version identifiers.', {
      kind: 'upstream',
      code: 'MISMATCHED_RUN_VERSION_ID',
    });
  }

  return {
    evaluationId: version.evaluationId,
    runId: runResponse.runId,
    status: runResponse.status,
    configVersionId: runResponse.using.configVersionId,
    methodologyVersionId: runResponse.using.methodologyVersionId,
  };
}

export async function runEvaluation(
  context: ActionContext,
  input: {
    evaluationId: string;
    clock: PollClock;
    pollIntervalMs: number;
    pollTimeoutMs: number;
    signal?: AbortSignal;
    onStatus?: (status: RunStatus) => void;
    idempotencyKeyFactory?: () => string;
  },
): Promise<RunExecution> {
  const run = await submitEvaluation(context, {
    evaluationId: input.evaluationId,
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.idempotencyKeyFactory ? { idempotencyKeyFactory: input.idempotencyKeyFactory } : {}),
  });
  const outcome = await waitForRun({
    api: context.api,
    clock: input.clock,
    evaluationId: run.evaluationId,
    runId: run.runId,
    intervalMs: input.pollIntervalMs,
    timeoutMs: input.pollTimeoutMs,
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.onStatus ? { onStatus: input.onStatus } : {}),
  });
  if (outcome.status.state !== 'COMPLETED') {
    const failureCode = outcome.status.failureCode ? ` (${outcome.status.failureCode})` : '';
    throw new AutoevalError(
      `Run ${run.runId} ended in state ${outcome.status.state}${failureCode}.`,
      {
        kind: 'run_failed',
        code: outcome.status.failureCode ?? 'RUN_FAILED',
        cause: outcome.status,
      },
    );
  }
  return { run, outcome };
}
