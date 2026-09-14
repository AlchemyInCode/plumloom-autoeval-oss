import { describe, expect, it } from 'vitest';

import { runTwoPlaneSuite } from '../src/suite/execution.js';

const clock = {
  now: () => Date.now(),
  sleep: async (milliseconds: number) => {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
  },
};

function deferred(): { promise: Promise<null>; resolve: () => void } {
  let resolveInner!: (value: null) => void;
  const promise = new Promise<null>((innerResolve) => {
    resolveInner = innerResolve;
  });
  return { promise, resolve: () => resolveInner(null) };
}

describe('two-plane suite execution', () => {
  it('frees an execution slot as soon as an eval reaches terminal state', async () => {
    const gates = [deferred(), deferred(), deferred()];
    let executing = 0;
    let peakExecuting = 0;
    const started: number[] = [];

    const suite = runTwoPlaneSuite<{ index: number }, string>({
      inputFiles: ['a', 'b', 'c'],
      executionConcurrency: 2,
      staggerMs: 0,
      clock,
      execute: async (item) => {
        started.push(item.index);
        executing += 1;
        peakExecuting = Math.max(peakExecuting, executing);
        await gates[item.index]?.promise;
        executing -= 1;
        return { index: item.index };
      },
      fetchResults: async (execution) => {
        // Result fetching must not gate the execution plane.
        await new Promise((resolve) => setTimeout(resolve, 5));
        return `results-${execution.index}`;
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(started).toEqual([0, 1]);

    gates[0]?.resolve();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(started).toEqual([0, 1, 2]);

    gates[1]?.resolve();
    gates[2]?.resolve();
    const records = await suite;

    expect(peakExecuting).toBe(2);
    expect(records.map((record) => record.status)).toEqual(['completed', 'completed', 'completed']);
    expect(records.map((record) => record.results)).toEqual([
      'results-0',
      'results-1',
      'results-2',
    ]);
  });

  it('fetches results while other evals are still executing', async () => {
    const slowGate = deferred();
    let resultsFetchedWhileExecuting = false;
    let secondStillExecuting = false;

    const records = await runTwoPlaneSuite<{ index: number }, string>({
      inputFiles: ['fast', 'slow'],
      executionConcurrency: 2,
      staggerMs: 0,
      clock,
      execute: async (item) => {
        if (item.index === 1) {
          secondStillExecuting = true;
          await slowGate.promise;
          secondStillExecuting = false;
        }
        return { index: item.index };
      },
      fetchResults: (execution) => {
        if (execution.index === 0 && secondStillExecuting) {
          resultsFetchedWhileExecuting = true;
          slowGate.resolve();
        }
        return Promise.resolve(`results-${execution.index}`);
      },
    });

    expect(resultsFetchedWhileExecuting).toBe(true);
    expect(records.every((record) => record.status === 'completed')).toBe(true);
  });

  it('records per-eval failures and keeps processing the rest', async () => {
    const records = await runTwoPlaneSuite<{ index: number }, string>({
      inputFiles: ['ok', 'exec-fail', 'result-fail'],
      executionConcurrency: 2,
      staggerMs: 0,
      clock,
      execute: (item) => {
        if (item.index === 1) return Promise.reject(new Error('run failed'));
        return Promise.resolve({ index: item.index });
      },
      fetchResults: (execution) => {
        if (execution.index === 2) return Promise.reject(new Error('results failed'));
        return Promise.resolve(`results-${execution.index}`);
      },
    });

    expect(records[0]).toMatchObject({ status: 'completed', results: 'results-0' });
    expect(records[1]).toMatchObject({ status: 'execution_failed', error: 'run failed' });
    expect(records[1]?.execution).toBeUndefined();
    expect(records[2]).toMatchObject({ status: 'result_failed', error: 'results failed' });
    // Identity of a failed result fetch is preserved.
    expect(records[2]?.execution).toEqual({ index: 2 });
  });
});
