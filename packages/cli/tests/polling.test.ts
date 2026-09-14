import { describe, expect, it, vi } from 'vitest';

import { runEvaluation } from '../src/actions/runs.js';
import type { RunStatus } from '../src/domain/types.js';
import type { CreateRunInput } from '../src/api/api.js';
import { ApiError } from '../src/api/errors.js';
import { waitForResult } from '../src/polling/wait-for-result.js';
import { waitForRun } from '../src/polling/wait-for-run.js';
import { createApi, FakeClock, IDS, versionResponse } from './helpers.js';

function status(state: string): RunStatus {
  return { evaluationId: IDS.evaluation, runId: IDS.run, state, raw: {} };
}

describe('bounded polling', () => {
  it('polls through pending to completion', async () => {
    const getRunStatus = vi
      .fn()
      .mockResolvedValueOnce(status('PENDING'))
      .mockResolvedValueOnce(status('COMPLETED'));
    const result = await waitForRun({
      api: createApi({ getRunStatus }),
      clock: new FakeClock(),
      evaluationId: IDS.evaluation,
      runId: IDS.run,
      intervalMs: 10,
      timeoutMs: 100,
    });
    expect(result.status.state).toBe('COMPLETED');
    expect(result.elapsedMs).toBe(10);
  });

  it('returns a terminal failure to the run action, which reports a run failure', async () => {
    const api = createApi({
      getEvaluationVersions: vi.fn(() => Promise.resolve(versionResponse())),
      createRun: vi.fn(() =>
        Promise.resolve({
          runId: IDS.run,
          status: 'PENDING',
          using: { methodologyVersionId: IDS.methodology, configVersionId: IDS.config },
        }),
      ),
      getRunStatus: vi.fn(() =>
        Promise.resolve({ ...status('FAILED'), failureCode: 'MODEL_ERROR' }),
      ),
    });

    await expect(
      runEvaluation(
        { api },
        {
          evaluationId: IDS.evaluation,
          clock: new FakeClock(),
          pollIntervalMs: 10,
          pollTimeoutMs: 100,
        },
      ),
    ).rejects.toMatchObject({ kind: 'run_failed', code: 'MODEL_ERROR' });
  });

  it('treats RUN_NOT_READY as pending for status and result readers', async () => {
    const notReady = new ApiError({ status: 409, code: 'RUN_NOT_READY' });
    const getRunStatus = vi
      .fn()
      .mockRejectedValueOnce(notReady)
      .mockResolvedValueOnce(status('COMPLETED'));
    await expect(
      waitForRun({
        api: createApi({ getRunStatus }),
        clock: new FakeClock(),
        evaluationId: IDS.evaluation,
        runId: IDS.run,
        intervalMs: 10,
        timeoutMs: 100,
      }),
    ).resolves.toMatchObject({ status: { state: 'COMPLETED' } });

    const load = vi.fn().mockRejectedValueOnce(notReady).mockResolvedValueOnce({ ready: true });
    await expect(
      waitForResult({ load, clock: new FakeClock(), intervalMs: 10, timeoutMs: 100 }),
    ).resolves.toEqual({ ready: true });
  });

  it('fails at the bounded polling timeout', async () => {
    const getRunStatus = vi.fn(() => Promise.resolve(status('RUNNING')));
    await expect(
      waitForRun({
        api: createApi({ getRunStatus }),
        clock: new FakeClock(),
        evaluationId: IDS.evaluation,
        runId: IDS.run,
        intervalMs: 10,
        timeoutMs: 20,
      }),
    ).rejects.toMatchObject({ code: 'RUN_POLL_TIMEOUT' });
    expect(getRunStatus).toHaveBeenCalledTimes(3);
  });

  it('does not create another run when polling fails', async () => {
    const createRun = vi.fn((input: CreateRunInput) => {
      void input;
      return Promise.resolve({
        runId: IDS.run,
        status: 'PENDING',
        using: { methodologyVersionId: IDS.methodology, configVersionId: IDS.config },
      });
    });
    const api = createApi({
      getEvaluationVersions: vi.fn(() => Promise.resolve(versionResponse())),
      createRun,
      getRunStatus: vi.fn(() => Promise.reject(new Error('connection lost'))),
    });

    await expect(
      runEvaluation(
        { api },
        {
          evaluationId: IDS.evaluation,
          clock: new FakeClock(),
          pollIntervalMs: 10,
          pollTimeoutMs: 100,
        },
      ),
    ).rejects.toThrow('connection lost');
    expect(createRun).toHaveBeenCalledOnce();
    expect(createRun.mock.calls[0]?.[0].idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });
});
