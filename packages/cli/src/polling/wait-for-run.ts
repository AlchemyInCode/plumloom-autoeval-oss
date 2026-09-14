import type { PollOutcome, RunStatus } from '../domain/types.js';
import { AutoevalError } from '../errors/autoeval-error.js';
import type { AutoevalApi } from '../api/api.js';
import { isRunNotReady } from '../api/errors.js';
import type { PollClock } from './clock.js';

const TERMINAL_STATES = new Set(['COMPLETED', 'FAILED', 'CANCELED', 'CANCELLED', 'TERMINATED']);

export async function waitForRun(input: {
  api: AutoevalApi;
  clock: PollClock;
  evaluationId: string;
  runId: string;
  intervalMs: number;
  timeoutMs: number;
  signal?: AbortSignal;
  onStatus?: (status: RunStatus) => void;
}): Promise<PollOutcome> {
  const startedAt = input.clock.now();
  let lastStatus: RunStatus | undefined;

  while (true) {
    if (input.signal?.aborted) {
      throw new AutoevalError('Run polling was canceled.', {
        kind: 'network',
        code: 'REQUEST_ABORTED',
      });
    }

    try {
      lastStatus = await input.api.getRunStatus(input.evaluationId, input.runId, input.signal);
      input.onStatus?.(lastStatus);
      if (TERMINAL_STATES.has(lastStatus.state)) {
        return { status: lastStatus, elapsedMs: input.clock.now() - startedAt };
      }
    } catch (error) {
      if (!isRunNotReady(error)) throw error;
    }

    const elapsedMs = input.clock.now() - startedAt;
    if (elapsedMs >= input.timeoutMs) {
      throw new AutoevalError(
        `Run did not reach a terminal state within ${Math.ceil(input.timeoutMs / 1_000)} seconds.`,
        {
          kind: 'timeout',
          code: 'RUN_POLL_TIMEOUT',
          cause: lastStatus,
        },
      );
    }
    await input.clock.sleep(Math.min(input.intervalMs, input.timeoutMs - elapsedMs), input.signal);
  }
}
