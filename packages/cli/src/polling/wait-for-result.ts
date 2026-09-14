import { AutoevalError } from '../errors/autoeval-error.js';
import { isRunNotReady } from '../api/errors.js';
import type { PollClock } from './clock.js';

export async function waitForResult<T>(input: {
  load: () => Promise<T>;
  clock: PollClock;
  intervalMs: number;
  timeoutMs: number;
  /**
   * Some endpoints answer 200 with an empty payload while scoring is still in
   * flight. When this returns false the payload is polled again; the last one
   * loaded is returned if the timeout arrives first, so a genuinely empty
   * result is still shown rather than raised as a timeout.
   */
  isReady?: (value: T) => boolean;
  signal?: AbortSignal;
}): Promise<T> {
  const startedAt = input.clock.now();
  let last: { value: T } | undefined;

  while (true) {
    try {
      const value = await input.load();
      if (input.isReady === undefined || input.isReady(value)) return value;
      last = { value };
    } catch (error) {
      if (!isRunNotReady(error)) throw error;
    }

    const elapsedMs = input.clock.now() - startedAt;
    if (elapsedMs >= input.timeoutMs) {
      if (last) return last.value;
      throw new AutoevalError('Evaluation results were not ready before the timeout.', {
        kind: 'timeout',
        code: 'RESULT_POLL_TIMEOUT',
      });
    }
    await input.clock.sleep(Math.min(input.intervalMs, input.timeoutMs - elapsedMs), input.signal);
  }
}
