import type { PollClock } from '../polling/clock.js';

/**
 * Two-plane suite execution.
 *
 * Plane 1 (execution) runs evals with bounded concurrency and an optional
 * start stagger. A slot is occupied only while an eval is executing: the moment
 * an eval reaches a terminal execution state the slot is released and the next
 * queued eval starts.
 *
 * Plane 2 (results) fetches and normalizes results for evals that already
 * finished, concurrently with evals that are still executing. It has its own
 * concurrency budget and never occupies an execution slot.
 *
 * A failure in either plane is recorded against that eval only; the remaining
 * evals keep going.
 */

export type SuiteEvalStatus = 'completed' | 'execution_failed' | 'result_failed';

export type SuiteItem = {
  index: number;
  inputFile: string;
};

export type SuiteEvalRecord<TExecution, TResults> = {
  index: number;
  inputFile: string;
  status: SuiteEvalStatus;
  execution?: TExecution;
  results?: TResults;
  error?: string;
};

export type TwoPlaneSuiteInput<TExecution, TResults> = {
  inputFiles: readonly string[];
  /** Maximum evals executing at the same time. */
  executionConcurrency: number;
  /** Maximum result fetches at the same time. Defaults to the execution budget. */
  resultConcurrency?: number;
  /** Delay applied between successive execution starts. */
  staggerMs: number;
  clock: PollClock;
  signal?: AbortSignal;
  /** Create + run + poll one eval to a terminal execution state. */
  execute: (item: SuiteItem) => Promise<TExecution>;
  /** Fetch and normalize results for a terminal eval. */
  fetchResults: (execution: TExecution, item: SuiteItem) => Promise<TResults>;
};

function describeError(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return String(error);
}

/** Bounded worker pool over a shared queue of tasks. */
async function drain(taskCount: number, workers: number, run: (index: number) => Promise<void>) {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = next;
      if (index >= taskCount) return;
      next += 1;
      await run(index);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(workers, taskCount)) }, worker));
}

export async function runTwoPlaneSuite<TExecution, TResults>(
  input: TwoPlaneSuiteInput<TExecution, TResults>,
): Promise<SuiteEvalRecord<TExecution, TResults>[]> {
  const items: SuiteItem[] = input.inputFiles.map((inputFile, index) => ({ index, inputFile }));
  const records = items.map<SuiteEvalRecord<TExecution, TResults>>((item) => ({
    index: item.index,
    inputFile: item.inputFile,
    status: 'execution_failed',
    error: 'Eval did not start.',
  }));

  // Results plane: its own bounded pool, fed as evals reach terminal state.
  const resultBudget = Math.max(1, input.resultConcurrency ?? input.executionConcurrency);
  let activeResultFetches = 0;
  const resultWaiters: (() => void)[] = [];
  const resultFetches: Promise<void>[] = [];

  const acquireResultSlot = async (): Promise<void> => {
    if (activeResultFetches < resultBudget) {
      activeResultFetches += 1;
      return;
    }
    await new Promise<void>((resolveWaiter) => resultWaiters.push(resolveWaiter));
    activeResultFetches += 1;
  };
  const releaseResultSlot = (): void => {
    activeResultFetches -= 1;
    resultWaiters.shift()?.();
  };

  const enqueueResultFetch = (item: SuiteItem, execution: TExecution): void => {
    const record = records[item.index];
    if (record === undefined) return;
    resultFetches.push(
      (async () => {
        await acquireResultSlot();
        try {
          record.results = await input.fetchResults(execution, item);
          record.status = 'completed';
          delete record.error;
        } catch (error) {
          record.status = 'result_failed';
          record.error = describeError(error);
        } finally {
          releaseResultSlot();
        }
      })(),
    );
  };

  // Execution plane.
  let nextStartAtMs = input.clock.now();
  const executionWorkers = Math.max(1, input.executionConcurrency);

  await drain(items.length, executionWorkers, async (index) => {
    const item = items[index];
    if (item === undefined) return;
    const record = records[index];
    if (record === undefined) return;

    const scheduledStartMs = nextStartAtMs;
    nextStartAtMs += input.staggerMs;
    const delayMs = Math.max(0, scheduledStartMs - input.clock.now());
    if (delayMs > 0) {
      await input.clock.sleep(delayMs, input.signal);
    }

    try {
      const execution = await input.execute(item);
      record.execution = execution;
      record.status = 'result_failed';
      record.error = 'Results were not fetched.';
      // Slot is released as soon as this returns; result fetching runs off-plane.
      enqueueResultFetch(item, execution);
    } catch (error) {
      record.status = 'execution_failed';
      record.error = describeError(error);
    }
  });

  await Promise.all(resultFetches);
  return records;
}
