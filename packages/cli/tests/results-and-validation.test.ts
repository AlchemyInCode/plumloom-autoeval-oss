import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import {
  createConfiguredRun,
  createEvaluation,
  getEvaluation,
  listEvaluations,
  listEvaluationVersions,
} from '../src/actions/evaluations.js';
import { getResults } from '../src/actions/results.js';
import { getRunStatus } from '../src/actions/runs.js';
import { ApiError } from '../src/api/errors.js';
import type {
  EvaluationConfigurationResponse,
  EvaluationVersionsResponse,
} from '../src/api/schemas.js';
import { createApi, FakeClock, IDENTITY, IDS, versionResponse } from './helpers.js';

describe('input validation and result routing', () => {
  it('rejects invalid UUID input before calling the API', async () => {
    const api = createApi();

    expect(() => listEvaluations({ api }, { workspaceId: '../not-a-uuid' })).toThrow(
      expect.objectContaining({ code: 'INVALID_UUID' }),
    );
    expect(() => getRunStatus({ api }, { evaluationId: IDS.evaluation, runId: 'bad' })).toThrow(
      expect.objectContaining({ code: 'INVALID_UUID' }),
    );
    await expect(createEvaluation({ api }, { workspaceId: 'bad' })).rejects.toMatchObject({
      code: 'INVALID_UUID',
    });
    expect(api.listEvaluations).not.toHaveBeenCalled();
    expect(api.getRunStatus).not.toHaveBeenCalled();
    expect(api.createEvaluationDraft).not.toHaveBeenCalled();
  });

  it('creates evaluation by calling draft first and create second', async () => {
    const api = createApi({
      createEvaluationDraft: vi.fn(() => Promise.resolve({ evaluation_id: IDS.evaluation })),
      createEvaluation: vi.fn(() => Promise.resolve({ eval_id: IDS.evaluation })),
    });

    const result = await createEvaluation(
      { api },
      { workspaceId: IDS.workspace, evaluationName: 'Untitled' },
    );

    expect(api.createEvaluationDraft).toHaveBeenCalledWith(IDS.workspace, undefined);
    expect(api.createEvaluation).toHaveBeenCalledWith(
      {
        workspaceId: IDS.workspace,
        evaluationId: IDS.evaluation,
        evaluationName: 'Untitled',
      },
      undefined,
    );
    expect(result).toEqual({
      evaluationId: IDS.evaluation,
      workspaceId: IDS.workspace,
      evaluationName: 'Untitled',
    });
  });

  it('calls methodology then config then run and stream once', async () => {
    const getCurrentUser = vi.fn(() => Promise.resolve(IDENTITY));
    const createMethodologyVersion = vi.fn(() =>
      Promise.resolve({ methodology_version_id: IDS.methodology }),
    );
    const createConfigVersion = vi.fn(() => Promise.resolve({ config_version_id: IDS.config }));
    const createRun = vi.fn(() =>
      Promise.resolve({
        runId: IDS.run,
        status: 'PENDING',
        using: {
          methodologyVersionId: IDS.methodology,
          configVersionId: IDS.config,
        },
      }),
    );
    const startRunStatusStream = vi.fn(() => Promise.resolve());
    const getRunStatus = vi.fn(() =>
      Promise.resolve({
        evaluationId: IDS.evaluation,
        runId: IDS.run,
        state: 'COMPLETED',
        raw: {},
      }),
    );

    const api = createApi({
      getCurrentUser,
      createMethodologyVersion,
      createConfigVersion,
      createRun,
      startRunStatusStream,
      getRunStatus,
    });

    const result = await createConfiguredRun(
      { api },
      {
        evaluationId: IDS.evaluation,
        methodology: {
          judgeModel: 'GPT-5',
          judgeModelId: IDS.model,
          evaluatorInstructions: 'Evaluate safely',
          changeLog: '',
        },
        configuration: {
          contextName: 'Cancellation Chat Eval',
          contextType: 'conversation',
          artifact: { messages: [] },
          expected: 'Expected answer',
          referenceDocuments: [{ filename: 'doc.md', content: 'policy' }],
          selectedMetrics: ['helpfulness'],
          temperatureContext: 0,
        },
        clock: new FakeClock(),
        pollIntervalMs: 10,
        pollTimeoutMs: 100,
        idempotencyKeyFactory: () => IDS.run,
      },
    );

    expect(createMethodologyVersion).toHaveBeenCalledOnce();
    expect(getCurrentUser).toHaveBeenCalledWith(undefined);
    const methodologyPayload = vi.mocked(api.createMethodologyVersion).mock.calls[0]?.[1];
    if (!methodologyPayload) throw new Error('Expected a methodology-version payload.');
    expect(methodologyPayload.runs_per_scenario).toBe(1);
    expect(createMethodologyVersion).toHaveBeenCalledWith(
      IDS.evaluation,
      expect.objectContaining({ user_sys_id: IDENTITY.userSystemId }),
      undefined,
    );
    expect(createConfigVersion).toHaveBeenCalledOnce();
    const configurationPayload = vi.mocked(api.createConfigVersion).mock.calls[0]?.[1];
    if (!configurationPayload) throw new Error('Expected a config-version payload.');
    expect(configurationPayload).not.toHaveProperty('auto_stop_enabled');
    expect(createRun).toHaveBeenCalledOnce();
    expect(createRun).toHaveBeenCalledWith({
      evaluationId: IDS.evaluation,
      configVersionId: IDS.config,
      idempotencyKey: IDS.run,
    });
    expect(startRunStatusStream).toHaveBeenCalledWith(IDS.evaluation, IDS.run, undefined);
    expect(result.run.configVersionId).toBe(IDS.config);
    expect(result.outcome.status.state).toBe('COMPLETED');
  });

  it('omits context_type when creating scenario config versions', async () => {
    const createMethodologyVersion = vi.fn(() =>
      Promise.resolve({ methodology_version_id: IDS.methodology }),
    );
    const createConfigVersion = vi.fn(() => Promise.resolve({ config_version_id: IDS.config }));
    const createRun = vi.fn(() =>
      Promise.resolve({
        runId: IDS.run,
        status: 'PENDING',
        using: {
          methodologyVersionId: IDS.methodology,
          configVersionId: IDS.config,
        },
      }),
    );
    const startRunStatusStream = vi.fn(() => Promise.resolve());
    const getRunStatus = vi.fn(() =>
      Promise.resolve({
        evaluationId: IDS.evaluation,
        runId: IDS.run,
        state: 'COMPLETED',
        raw: {},
      }),
    );

    const api = createApi({
      createMethodologyVersion,
      createConfigVersion,
      createRun,
      startRunStatusStream,
      getRunStatus,
    });

    await createConfiguredRun(
      { api },
      {
        evaluationId: IDS.evaluation,
        methodology: {
          userSystemId: 'USR-3B98B101F7D2',
          judgeModel: 'DeepSeek V4 Pro',
          judgeModelId: IDS.model,
          evaluatorInstructions: 'Evaluate code reviews',
        },
        configuration: {
          contextName: 'Code Review Scenario Eval',
          contextType: 'scenario',
          artifact: {
            primaryModelId: IDS.model,
            comparisonModelIds: [],
            promptText: 'Review this PR',
            scenarios: [[{ id: 'tc-1', name: 'Case 1', prompt: 'Review this code.' }]],
          },
          expected: 'Should report real issues',
          referenceDocuments: [],
          selectedMetrics: ['helpfulness'],
        },
        clock: new FakeClock(),
        pollIntervalMs: 10,
        pollTimeoutMs: 100,
        idempotencyKeyFactory: () => IDS.run,
      },
    );

    expect(createConfigVersion).toHaveBeenCalledOnce();
    expect(createMethodologyVersion).toHaveBeenCalledWith(
      IDS.evaluation,
      expect.objectContaining({ change_log: '' }),
      undefined,
    );
    const configPayload = vi.mocked(api.createConfigVersion).mock.calls[0]?.[1];
    if (!configPayload) throw new Error('Expected a config-version payload.');
    expect(configPayload).not.toHaveProperty('context_type');
    expect(configPayload).not.toHaveProperty('context_name');
    expect(configPayload).not.toHaveProperty('expected');
    expect(configPayload).toHaveProperty('primary_model_id', IDS.model);
    expect(configPayload).toHaveProperty('prompt_text', 'Review this PR');
    expect(configPayload).toHaveProperty('scenarios');
    if (!('scenarios' in configPayload)) throw new Error('Expected scenario configuration.');
    const scenarios = configPayload.scenarios;
    expect(Array.isArray(scenarios)).toBe(true);
    expect(Array.isArray(scenarios[0])).toBe(false);
  });

  it('routes scenario results to all three scenario readers', async () => {
    const api = createApi({
      getEvaluationVersions: vi.fn(() => Promise.resolve(versionResponse('scenario'))),
      getModelPerformance: vi.fn(() => Promise.resolve({ models: [{ metric: 1 }] })),
      getScenarioComparison: vi.fn(() =>
        Promise.resolve({ comparison: true, evaluation_summary: { total_evaluations: 1 } }),
      ),
      getModelResponses: vi.fn(() => Promise.resolve({ items: [] })),
    });
    const result = await getResults(
      { api },
      {
        evaluationId: IDS.evaluation,
        runId: IDS.run,
        clock: new FakeClock(),
        resultReadyIntervalMs: 10,
        resultReadyTimeoutMs: 100,
      },
    );

    expect(result.contextType).toBe('scenario');
    expect(api.getModelPerformance).toHaveBeenCalledOnce();
    expect(api.getScenarioComparison).toHaveBeenCalledOnce();
    expect(api.getModelResponses).toHaveBeenCalledOnce();
    expect(api.getConversationResults).not.toHaveBeenCalled();
  });

  it('keeps polling scenario results until the judged scores appear', async () => {
    let performanceCalls = 0;
    const api = createApi({
      getEvaluationVersions: vi.fn(() => Promise.resolve(versionResponse('scenario'))),
      getModelPerformance: vi.fn(() => {
        performanceCalls += 1;
        return Promise.resolve(performanceCalls < 3 ? { models: [] } : { models: [{ metric: 1 }] });
      }),
      getScenarioComparison: vi.fn(() =>
        Promise.resolve({ evaluation_summary: { total_evaluations: 1 } }),
      ),
      getModelResponses: vi.fn(() => Promise.resolve({ items: [] })),
    });

    const result = await getResults(
      { api },
      {
        evaluationId: IDS.evaluation,
        runId: IDS.run,
        clock: new FakeClock(),
        resultReadyIntervalMs: 10,
        resultReadyTimeoutMs: 1000,
      },
    );

    expect(performanceCalls).toBe(3);
    expect(result).toMatchObject({ modelPerformance: { models: [{ metric: 1 }] } });
  });

  it('returns the last scenario payload when scores never arrive before the timeout', async () => {
    const api = createApi({
      getEvaluationVersions: vi.fn(() => Promise.resolve(versionResponse('scenario'))),
      getModelPerformance: vi.fn(() => Promise.resolve({ models: [] })),
      getScenarioComparison: vi.fn(() => Promise.resolve({})),
      getModelResponses: vi.fn(() => Promise.resolve({ items: [] })),
    });

    const result = await getResults(
      { api },
      {
        evaluationId: IDS.evaluation,
        runId: IDS.run,
        clock: new FakeClock(),
        resultReadyIntervalMs: 10,
        resultReadyTimeoutMs: 30,
      },
    );

    expect(result).toMatchObject({ contextType: 'scenario', modelPerformance: { models: [] } });
  });

  it('routes conversation results only to conversation_results', async () => {
    const api = createApi({
      getEvaluationVersions: vi.fn(() => Promise.resolve(versionResponse('conversation'))),
      getConversationResults: vi.fn(() => Promise.resolve({ conversations: [] })),
    });
    const result = await getResults(
      { api },
      {
        evaluationId: IDS.evaluation,
        runId: IDS.run,
        clock: new FakeClock(),
        resultReadyIntervalMs: 10,
        resultReadyTimeoutMs: 100,
      },
    );

    expect(result.contextType).toBe('conversation');
    expect(api.getConversationResults).toHaveBeenCalledOnce();
    expect(api.getModelPerformance).not.toHaveBeenCalled();
  });

  it('routes agent trace results and tolerates unavailable trajectory data', async () => {
    const api = createApi({
      getEvaluationVersions: vi.fn(() => Promise.resolve(versionResponse('agent_trace'))),
      getAgentTraceResults: vi.fn(() => Promise.resolve({ traces: [] })),
      getTrajectory: vi.fn(() => Promise.reject(new ApiError({ status: 404, code: 'NOT_FOUND' }))),
    });
    const result = await getResults(
      { api },
      {
        evaluationId: IDS.evaluation,
        runId: IDS.run,
        clock: new FakeClock(),
        resultReadyIntervalMs: 10,
        resultReadyTimeoutMs: 100,
      },
    );

    expect(result).toEqual({ contextType: 'agent_trace', agentTrace: { traces: [] } });
    expect(api.getAgentTraceResults).toHaveBeenCalledOnce();
    expect(api.getTrajectory).toHaveBeenCalledOnce();
  });

  it('lists evaluation versions and marks the current one', async () => {
    const versionsResponse: EvaluationVersionsResponse = {
      evaluationId: IDS.evaluation,
      context_type: 'scenario',
      evaluationVersions: {
        currentVersion: 3,
        items: [
          {
            version: 1,
            methodologyId: '77777777-7777-4777-8777-777777777777',
            configId: '88888888-8888-4888-8888-888888888888',
            isCurrent: false,
            created_at: '2026-09-01T12:00:00Z',
          },
          {
            version: 3,
            methodologyId: IDS.methodology,
            configId: IDS.config,
            isCurrent: true,
            created_at: '2026-09-02T08:00:00Z',
          },
        ],
      },
    };
    const api = createApi({
      getEvaluationVersions: vi.fn(() => Promise.resolve(versionsResponse)),
    });

    const result = await listEvaluationVersions({ api }, IDS.evaluation);

    expect(result.currentVersion).toBe(3);
    expect(result.versions).toEqual([
      {
        version: 1,
        methodologyVersionId: '77777777-7777-4777-8777-777777777777',
        configVersionId: '88888888-8888-4888-8888-888888888888',
        isCurrent: false,
        createdAt: '2026-09-01T12:00:00Z',
      },
      {
        version: 3,
        methodologyVersionId: IDS.methodology,
        configVersionId: IDS.config,
        isCurrent: true,
        createdAt: '2026-09-02T08:00:00Z',
      },
    ]);
  });

  it('loads an explicit evaluation version for eval show', async () => {
    const versionsResponse: EvaluationVersionsResponse = {
      evaluationId: IDS.evaluation,
      context_type: 'scenario',
      evaluationVersions: {
        currentVersion: 3,
        items: [
          {
            version: 2,
            methodologyId: '77777777-7777-4777-8777-777777777777',
            configId: '88888888-8888-4888-8888-888888888888',
            isCurrent: false,
          },
          {
            version: 3,
            methodologyId: IDS.methodology,
            configId: IDS.config,
            isCurrent: true,
          },
        ],
      },
    };
    const configurationResponse: EvaluationConfigurationResponse = {
      evaluation_id: IDS.evaluation,
      methodology_version_id: '77777777-7777-4777-8777-777777777777',
      config_version_id: '88888888-8888-4888-8888-888888888888',
      context_type: 'scenario',
    };
    const api = createApi({
      getEvaluationVersions: vi.fn(() => Promise.resolve(versionsResponse)),
      getEvaluationConfiguration: vi.fn(() => Promise.resolve(configurationResponse)),
    });

    const result = await getEvaluation({ api }, IDS.evaluation, 2);

    expect(result.version).toBe(2);
    expect(result.isCurrent).toBe(false);
    expect(api.getEvaluationConfiguration).toHaveBeenCalledWith(
      IDS.evaluation,
      '77777777-7777-4777-8777-777777777777',
      '88888888-8888-4888-8888-888888888888',
      undefined,
    );
  });

  it('fails when the requested evaluation version does not exist', async () => {
    const api = createApi({
      getEvaluationVersions: vi.fn(() => Promise.resolve(versionResponse('scenario'))),
    });

    await expect(getEvaluation({ api }, IDS.evaluation, 2)).rejects.toMatchObject({
      code: 'EVALUATION_VERSION_NOT_FOUND',
    });
  });

  it('fails closed when timeline data is unavailable for version listing', async () => {
    const api = createApi({
      getEvaluationVersions: vi.fn(() =>
        Promise.resolve({
          evaluationId: IDS.evaluation,
          context_type: 'scenario' as const,
          methodologies: [
            {
              methodologyId: IDS.methodology,
              versionNumber: 7,
              configs: [{ configId: IDS.config, versionNumber: 2 }],
            },
          ],
          evaluationVersions: null,
        }),
      ),
    });

    await expect(listEvaluationVersions({ api }, IDS.evaluation)).rejects.toMatchObject({
      code: 'EVALUATION_VERSION_TIMELINE_UNAVAILABLE',
    });
  });

  it('fails closed when timeline data is unavailable for evaluation resolution', async () => {
    const api = createApi({
      getEvaluationVersions: vi.fn(() =>
        Promise.resolve({
          evaluationId: IDS.evaluation,
          context_type: 'scenario' as const,
          methodologies: [
            {
              methodologyId: '77777777-7777-4777-8777-777777777777',
              versionNumber: 1,
              configs: [{ configId: '88888888-8888-4888-8888-888888888888', versionNumber: 1 }],
            },
            {
              methodologyId: IDS.methodology,
              versionNumber: 2,
              configs: [{ configId: IDS.config, versionNumber: 2 }],
            },
          ],
          evaluationVersions: null,
        }),
      ),
    });

    await expect(getEvaluation({ api }, IDS.evaluation)).rejects.toMatchObject({
      code: 'EVALUATION_VERSION_TIMELINE_UNAVAILABLE',
    });
  });

  it('fails closed when currentVersion has no matching timeline item', async () => {
    const api = createApi({
      getEvaluationVersions: vi.fn(() =>
        Promise.resolve({
          evaluationId: IDS.evaluation,
          context_type: 'scenario' as const,
          evaluationVersions: {
            currentVersion: 3,
            items: [
              {
                version: 1,
                methodologyId: IDS.methodology,
                configId: IDS.config,
                isCurrent: false,
              },
            ],
          },
        }),
      ),
    });

    await expect(getEvaluation({ api }, IDS.evaluation)).rejects.toMatchObject({
      code: 'EVALUATION_VERSION_TIMELINE_INVALID',
    });
  });

  it('ignores stale isCurrent flags and resolves current by currentVersion only', async () => {
    const api = createApi({
      getEvaluationVersions: vi.fn(() =>
        Promise.resolve({
          evaluationId: IDS.evaluation,
          context_type: 'scenario' as const,
          evaluationVersions: {
            currentVersion: 2,
            items: [
              {
                version: 1,
                methodologyId: '77777777-7777-4777-8777-777777777777',
                configId: '88888888-8888-4888-8888-888888888888',
                isCurrent: false,
              },
              {
                version: 2,
                methodologyId: IDS.methodology,
                configId: IDS.config,
                isCurrent: true,
              },
            ],
          },
        }),
      ),
      getEvaluationConfiguration: vi.fn(() =>
        Promise.resolve({
          evaluation_id: IDS.evaluation,
          methodology_version_id: IDS.methodology,
          config_version_id: IDS.config,
          context_type: 'scenario' as const,
        }),
      ),
    });

    const result = await getEvaluation({ api }, IDS.evaluation);
    expect(result.version).toBe(2);
    expect(result.isCurrent).toBe(true);
    expect(result.methodologyVersionId).toBe(IDS.methodology);
    expect(result.configVersionId).toBe(IDS.config);
  });
});

describe('runtime boundary guard', () => {
  it('contains no direct evaluation-service or service-key client usage', async () => {
    const sourceFiles = [
      'src/api/api.ts',
      'src/api/client.ts',
      'src/api/endpoints.ts',
      'src/commands/executor.ts',
    ];
    const sources = await Promise.all(sourceFiles.map((path) => readFile(path, 'utf8')));
    const joined = sources.join('\n');

    expect(joined).not.toMatch(/eval[-_ ]?engine/iu);
    expect(joined).not.toMatch(/service[-_ ]?(api[-_ ]?)?key/iu);
    expect(joined).not.toContain('/api/v2');
    expect(joined).not.toContain('X-Service-API-Key');
    expect(joined).not.toMatch(/api\.openai\.com|anthropic\.com|litellm/iu);
  });
});
