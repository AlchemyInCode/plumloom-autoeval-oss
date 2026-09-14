import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { RuntimeCommandExecutor } from '../src/commands/executor.js';
import { loadConfiguration } from '../src/config.js';
import { IDS, VALID_KEY } from './helpers.js';
import { FakeClock } from './helpers.js';

class MemoryStream {
  value = '';

  constructor(readonly isTTY = false) {}

  write(chunk: string): boolean {
    this.value += chunk;
    return true;
  }

  cursorTo(): boolean {
    this.value += '\r';
    return true;
  }

  moveCursor(): boolean {
    return true;
  }

  clearLine(): boolean {
    return true;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function requestUrl(input: Parameters<typeof fetch>[0]): URL {
  if (input instanceof URL) return input;
  if (typeof input === 'string') return new URL(input);
  return new URL(input.url);
}

async function writeTempJson(
  filename: string,
  body: unknown,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'autoeval-run-'));
  const path = join(dir, filename);
  await writeFile(path, JSON.stringify(body), 'utf8');
  return {
    path,
    cleanup: async () => rm(dir, { recursive: true, force: true }),
  };
}

function createExecutor(fetchImplementation: typeof fetch): RuntimeCommandExecutor {
  return createExecutorWithOutput(fetchImplementation, new MemoryStream());
}

function createExecutorWithOutput(
  fetchImplementation: typeof fetch,
  stdout: MemoryStream,
  clock?: FakeClock,
  stderr = new MemoryStream(),
): RuntimeCommandExecutor {
  return new RuntimeCommandExecutor({
    configuration: loadConfiguration({ AUTOEVAL_API_BASE_URL: 'https://api.example.test' }),
    environment: { AUTOEVAL_API_KEY: VALID_KEY },
    ...(clock === undefined ? {} : { clock }),
    fetchImplementation,
    stdout,
    stderr,
    stdin: { isTTY: false },
  });
}

class TrackingClock extends FakeClock {
  readonly sleeps: number[] = [];

  override sleep(milliseconds: number): Promise<void> {
    this.sleeps.push(milliseconds);
    return super.sleep(milliseconds);
  }
}

async function writeTempSuiteFiles(
  files: Record<string, string>,
): Promise<{ dir: string; paths: Record<string, string>; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'autoeval-suite-'));
  const paths: Record<string, string> = {};
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    await writeFile(path, content, 'utf8');
    paths[name] = path;
  }
  return {
    dir,
    paths,
    cleanup: async () => rm(dir, { recursive: true, force: true }),
  };
}

describe('deterministic command workflows', () => {
  it('sends the backend-compatible methodology payload for agent-trace quickstart', async () => {
    const fetchMock = vi.fn<typeof fetch>((inputArg, init) => {
      const url = requestUrl(inputArg);
      const method = init?.method ?? 'GET';
      const path = url.pathname;

      if (method === 'GET' && path === '/api/v1/workspaces') {
        return Promise.resolve(
          jsonResponse({
            items: [
              {
                workspace_id: IDS.workspace,
                name: 'Quickstart workspace',
                eval_count: 0,
              },
            ],
            total: 1,
            page: 1,
            size: 100,
            total_pages: 1,
          }),
        );
      }
      if (method === 'GET' && path.endsWith('/byok/models/enabled')) {
        return Promise.resolve(
          jsonResponse({
            models: [
              {
                supported_model_id: IDS.model,
                provider_model_id: 'quickstart-judge',
                model_key: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
                provider: 'test',
                display_name: 'Quickstart Judge',
              },
            ],
          }),
        );
      }
      if (method === 'POST' && path.endsWith('/evaluations/draft')) {
        return Promise.resolve(jsonResponse({ evaluation_id: IDS.evaluation }));
      }
      if (method === 'POST' && path.endsWith('/evaltools/create')) {
        return Promise.resolve(
          jsonResponse({
            eval_id: IDS.evaluation,
            eval_name: 'Quickstart Baseline',
            workspace_id: IDS.workspace,
          }),
        );
      }
      if (method === 'GET' && path.endsWith('/auth/me')) {
        return Promise.resolve(
          jsonResponse({ id: 'user-1', user_sys_id: 'system-1', email: 'user@example.test' }),
        );
      }
      if (method === 'POST' && path.endsWith('/methodology-versions')) {
        return Promise.resolve(jsonResponse({ methodology_version_id: IDS.methodology }));
      }
      if (method === 'POST' && path.endsWith('/config-versions')) {
        return Promise.resolve(jsonResponse({ config_version_id: IDS.config }));
      }
      if (method === 'POST' && path.endsWith('/runs')) {
        return Promise.resolve(
          jsonResponse({
            runId: IDS.run,
            status: 'PENDING',
            using: {
              methodologyVersionId: IDS.methodology,
              configVersionId: IDS.config,
            },
          }),
        );
      }
      if (method === 'GET' && path.endsWith('/status/stream')) {
        return Promise.resolve(
          new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } }),
        );
      }
      if (method === 'GET' && path.endsWith('/status')) {
        return Promise.resolve(
          jsonResponse({
            run_id: IDS.run,
            evaluation_id: IDS.evaluation,
            evaluationState: 'COMPLETED',
            progress: { percentage: 100, runsCompleted: 1, totalRuns: 1 },
          }),
        );
      }
      if (method === 'GET' && path.endsWith('/versions_v2')) {
        return Promise.resolve(
          jsonResponse({
            evaluationId: IDS.evaluation,
            context_type: 'agent_trace',
            evaluationVersions: {
              currentVersion: 1,
              items: [
                {
                  version: 1,
                  methodologyId: IDS.methodology,
                  configId: IDS.config,
                  isCurrent: true,
                },
              ],
            },
          }),
        );
      }
      if (method === 'GET' && path.endsWith('/agent_trace_results')) {
        return Promise.resolve(jsonResponse({ outcome: { achieved: true }, overall: 5 }));
      }
      if (method === 'GET' && path.endsWith('/trajectory')) {
        return Promise.resolve(jsonResponse({ trace: { resourceSpans: [] } }));
      }
      throw new Error(`Unexpected mocked request: ${method} ${path}`);
    });

    const executor = createExecutor(fetchMock);
    await executor.execute(
      { kind: 'quickstart', sample: 'trace', assumeYes: true },
      { json: false, debug: false },
    );

    const methodologyCall = fetchMock.mock.calls.find((call) =>
      requestUrl(call[0]).pathname.endsWith('/methodology-versions'),
    );
    expect(methodologyCall).toBeDefined();
    expect(JSON.parse(methodologyCall?.[1]?.body as string)).toEqual({
      user_sys_id: 'system-1',
      judge_model: IDS.model,
      judge_model_id: IDS.model,
      evaluator_instructions:
        'Evaluate whether the agent plans a relevant lookup, uses the returned value, and answers without unnecessary steps.',
      change_log: '',
      runs_per_scenario: 1,
    });
  });

  it('uses configuration.evaluationName when creating from a configured file', async () => {
    const input = await writeTempJson('configured.json', {
      methodology: {
        userSystemId: 'USR-3B98B101F7D2',
        judgeModel: 'GPT-5',
        judgeModelId: IDS.model,
        runsPerScenario: 1,
        evaluatorInstructions: 'Evaluate safely',
      },
      configuration: {
        evaluationName: 'Checkout support title',
        contextName: 'Purchasing context',
        contextType: 'scenario',
        artifact: {
          primaryModelId: '77777777-7777-4777-8777-777777777777',
          comparisonModelIds: [],
          promptText: 'Help with checkout issues',
          scenarios: [{ id: 'tc-1', prompt: 'Can I checkout as guest?' }],
        },
        expected: 'The answer explains guest checkout trade-offs.',
        selectedMetrics: ['helpfulness'],
      },
    });

    try {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse({ evaluation_id: IDS.evaluation }))
        .mockResolvedValueOnce(
          jsonResponse({
            eval_id: IDS.evaluation,
            eval_name: 'Checkout support title',
            workspace_id: IDS.workspace,
          }),
        );

      const executor = createExecutor(fetchMock);
      await executor.execute(
        {
          kind: 'evaluation-create-from',
          workspaceId: IDS.workspace,
          inputFiles: [input.path],
          run: false,
        },
        { json: false, debug: false },
      );

      const createCall = fetchMock.mock.calls[1] as [URL, RequestInit];
      expect(createCall[0].pathname).toBe('/api/v1/evaltools/create');
      expect(createCall[0].searchParams.get('eval_name')).toBe('Checkout support title');
    } finally {
      await input.cleanup();
    }
  });

  it('runs eval run-configured with legacy scenario input and flattened scenarios', async () => {
    const primaryModelId = '77777777-7777-4777-8777-777777777777';
    const input = await writeTempJson('configured.json', {
      methodology: {
        userSystemId: 'USR-3B98B101F7D2',
        judgeModel: 'GPT-5',
        judgeModelId: IDS.model,
        runsPerScenario: 1,
        evaluatorInstructions: 'Evaluate safely',
      },
      configuration: {
        primaryModelId,
        comparisonModelIds: [],
        promptText: 'Review this code',
        scenarios: [[{ id: 'tc-1', prompt: 'Case 1' }]],
        selectedMetrics: ['helpfulness'],
      },
    });

    try {
      const fetchMock = vi.fn<typeof fetch>((inputArg, init) => {
        const url = requestUrl(inputArg);
        const method = init?.method ?? 'GET';
        if (method === 'GET' && url.pathname.endsWith('/byok/models/enabled')) {
          return Promise.resolve(
            jsonResponse({
              models: [
                {
                  supported_model_id: IDS.model,
                  provider_model_id: 'judge-model',
                  provider: 'test',
                  display_name: 'Judge model',
                },
                {
                  supported_model_id: primaryModelId,
                  provider_model_id: 'primary-model',
                  provider: 'test',
                  display_name: 'Primary model',
                },
              ],
            }),
          );
        }
        if (method === 'POST' && url.pathname.endsWith('/methodology-versions')) {
          return Promise.resolve(jsonResponse({ methodology_version_id: IDS.methodology }));
        }
        if (method === 'POST' && url.pathname.endsWith('/config-versions')) {
          return Promise.resolve(jsonResponse({ config_version_id: IDS.config }));
        }
        if (method === 'POST' && url.pathname.endsWith('/runs')) {
          return Promise.resolve(
            jsonResponse({
              runId: IDS.run,
              status: 'PENDING',
              using: {
                methodologyVersionId: IDS.methodology,
                configVersionId: IDS.config,
              },
            }),
          );
        }
        if (method === 'GET' && url.pathname.endsWith('/status/stream')) {
          return Promise.resolve(
            new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } }),
          );
        }
        if (method === 'GET' && url.pathname.endsWith('/status')) {
          return Promise.resolve(
            jsonResponse({
              run_id: IDS.run,
              evaluation_id: IDS.evaluation,
              evaluationState: 'COMPLETED',
              progress: { percentage: 100, runsCompleted: 1, totalRuns: 1 },
            }),
          );
        }
        throw new Error(`Unexpected mocked request: ${method} ${url.pathname}`);
      });

      const executor = createExecutor(fetchMock);
      await executor.execute(
        {
          kind: 'evaluation-run-configured',
          evaluationId: IDS.evaluation,
          inputFile: input.path,
        },
        { json: false, debug: false },
      );

      const configCall = fetchMock.mock.calls.find((call) =>
        requestUrl(call[0]).pathname.endsWith('/config-versions'),
      );
      expect(configCall).toBeDefined();
      const body = JSON.parse((configCall?.[1]?.body as string | undefined) ?? '{}') as Record<
        string,
        unknown
      >;
      expect(body.scenarios).toEqual([{ id: 'tc-1', prompt: 'Case 1' }]);
      expect(body).not.toHaveProperty('context_type');
    } finally {
      await input.cleanup();
    }
  });

  it('validates configured input with JSON output and makes no write request', async () => {
    const primaryModelId = '77777777-7777-4777-8777-777777777777';
    const input = await writeTempJson('configured.json', {
      methodology: {
        userSystemId: 'USR-3B98B101F7D2',
        judgeModel: 'Judge model',
        judgeModelId: IDS.model,
        runsPerScenario: 1,
        evaluatorInstructions: 'Evaluate safely',
      },
      configuration: {
        primaryModelId,
        comparisonModelIds: [],
        promptText: 'Review this response',
        scenarios: [{ id: 'tc-1', prompt: 'Case 1' }],
        selectedMetrics: ['helpfulness'],
      },
    });

    try {
      const fetchMock = vi.fn<typeof fetch>((inputArg, init) => {
        const url = requestUrl(inputArg);
        expect(init?.method).toBe('GET');
        expect(url.pathname).toBe('/api/v1/byok/models/enabled');
        return Promise.resolve(
          jsonResponse({
            models: [
              {
                supported_model_id: IDS.model,
                provider_model_id: 'judge-model',
                provider: 'test',
                display_name: 'Judge model',
              },
              {
                supported_model_id: primaryModelId,
                provider_model_id: 'primary-model',
                provider: 'test',
                display_name: 'Primary model',
              },
            ],
          }),
        );
      });
      const stdout = new MemoryStream();
      const executor = createExecutorWithOutput(fetchMock, stdout);

      await executor.execute(
        { kind: 'evaluation-validate', inputFile: input.path },
        { json: true, debug: false },
      );

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(JSON.parse(stdout.value)).toMatchObject({
        valid: true,
        contextType: 'scenario',
        artifactCount: 1,
        models: { judge: { id: IDS.model }, primary: { id: primaryModelId } },
      });
    } finally {
      await input.cleanup();
    }
  });

  it('rejects preflight model conflicts before creating methodology or configuration', async () => {
    const input = await writeTempJson('configured.json', {
      methodology: {
        userSystemId: 'USR-3B98B101F7D2',
        judgeModel: 'Judge model',
        judgeModelId: IDS.model,
        runsPerScenario: 1,
        evaluatorInstructions: 'Evaluate safely',
      },
      configuration: {
        primaryModelId: IDS.model,
        comparisonModelIds: [],
        promptText: 'Review this response',
        scenarios: [{ id: 'tc-1', prompt: 'Case 1' }],
        selectedMetrics: ['helpfulness'],
      },
    });

    try {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          models: [
            {
              supported_model_id: IDS.model,
              provider_model_id: 'judge-model',
              provider: 'test',
              display_name: 'Judge model',
            },
          ],
        }),
      );
      const executor = createExecutor(fetchMock);

      await expect(
        executor.execute(
          {
            kind: 'evaluation-run-configured',
            evaluationId: IDS.evaluation,
            inputFile: input.path,
          },
          { json: false, debug: false },
        ),
      ).rejects.toMatchObject({ code: 'MODEL_ROLE_CONFLICT' });
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock.mock.calls.every((call) => call[1]?.method === 'GET')).toBe(true);
    } finally {
      await input.cleanup();
    }
  });

  it('returns usage errors for missing and invalid run-configured input files', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const executor = createExecutor(fetchMock);

    await expect(
      executor.execute(
        {
          kind: 'evaluation-run-configured',
          evaluationId: IDS.evaluation,
          inputFile: 'missing-configured.json',
        },
        { json: false, debug: false },
      ),
    ).rejects.toMatchObject({ code: 'CONFIGURED_RUN_INPUT_READ_FAILED' });

    const invalid = await writeTempJson('invalid.json', {});
    try {
      await writeFile(invalid.path, '{not-json', 'utf8');
      await expect(
        executor.execute(
          {
            kind: 'evaluation-run-configured',
            evaluationId: IDS.evaluation,
            inputFile: invalid.path,
          },
          { json: false, debug: false },
        ),
      ).rejects.toMatchObject({ code: 'INVALID_CONFIGURED_RUN_JSON' });
    } finally {
      await invalid.cleanup();
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('runs evaluation using current saved versions, then supports status and results retrieval', async () => {
    const fetchMock = vi.fn<typeof fetch>((inputArg, init) => {
      const url = requestUrl(inputArg);
      const method = init?.method ?? 'GET';

      if (method === 'GET' && url.pathname.endsWith('/versions_v2')) {
        return Promise.resolve(
          jsonResponse({
            evaluationId: IDS.evaluation,
            context_type: 'scenario',
            methodologies: [
              {
                methodologyId: IDS.methodology,
                versionNumber: 1,
                configs: [{ configId: IDS.config, versionNumber: 1 }],
              },
            ],
            evaluationVersions: {
              currentVersion: 1,
              items: [
                {
                  version: 1,
                  methodologyId: IDS.methodology,
                  configId: IDS.config,
                  isCurrent: true,
                },
              ],
            },
          }),
        );
      }

      if (method === 'POST' && url.pathname.endsWith('/runs')) {
        return Promise.resolve(
          jsonResponse({
            runId: IDS.run,
            status: 'PENDING',
            using: { methodologyVersionId: IDS.methodology, configVersionId: IDS.config },
          }),
        );
      }

      if (method === 'GET' && url.pathname.endsWith('/status')) {
        return Promise.resolve(
          jsonResponse({
            run_id: IDS.run,
            evaluation_id: IDS.evaluation,
            evaluationState: 'COMPLETED',
            progress: { percentage: 100, runsCompleted: 1, totalRuns: 1 },
          }),
        );
      }

      if (method === 'GET' && url.pathname.endsWith('/model-performance')) {
        return Promise.resolve(jsonResponse({ models: [{ score: 1 }] }));
      }
      if (method === 'GET' && url.pathname.endsWith('/scenario-comparison')) {
        return Promise.resolve(
          jsonResponse({ items: [], evaluation_summary: { total_evaluations: 1 } }),
        );
      }
      if (method === 'GET' && url.pathname.endsWith('/model-responses')) {
        return Promise.resolve(jsonResponse({ items: [] }));
      }

      throw new Error(`Unexpected mocked request: ${method} ${url.pathname}`);
    });

    const executor = createExecutor(fetchMock);

    await executor.execute(
      { kind: 'run', evaluationId: IDS.evaluation },
      { json: false, debug: false },
    );
    await executor.execute(
      { kind: 'status', evaluationId: IDS.evaluation, runId: IDS.run },
      { json: false, debug: false },
    );
    await executor.execute(
      { kind: 'results', evaluationId: IDS.evaluation, runId: IDS.run },
      { json: false, debug: false },
    );

    expect(
      fetchMock.mock.calls.some((call) => requestUrl(call[0]).pathname.endsWith('/runs')),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some((call) => requestUrl(call[0]).pathname.endsWith('/status')),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some((call) =>
        requestUrl(call[0]).pathname.endsWith('/model-performance'),
      ),
    ).toBe(true);
  });

  it('hides null statistics in human output but preserves them in JSON output', async () => {
    const fetchMock = vi.fn<typeof fetch>((inputArg, init) => {
      const url = requestUrl(inputArg);
      const method = init?.method ?? 'GET';

      if (method === 'GET' && url.pathname.endsWith('/versions_v2')) {
        return Promise.resolve(
          jsonResponse({
            evaluationId: IDS.evaluation,
            context_type: 'scenario',
            methodologies: [
              {
                methodologyId: IDS.methodology,
                versionNumber: 1,
                configs: [{ configId: IDS.config, versionNumber: 1 }],
              },
            ],
            evaluationVersions: {
              currentVersion: 1,
              items: [
                {
                  version: 1,
                  methodologyId: IDS.methodology,
                  configId: IDS.config,
                  isCurrent: true,
                },
              ],
            },
          }),
        );
      }
      if (method === 'GET' && url.pathname.endsWith('/model-performance')) {
        return Promise.resolve(
          jsonResponse({
            models: [
              {
                display_name: 'Llama 3.3 70B',
                scores: {
                  overall: {
                    mean: 4.52,
                    ci95: null,
                    ci95_lower: null,
                    ci95_upper: null,
                    std_dev: null,
                  },
                  helpfulness: {
                    mean: 4.43,
                    ci95: 0.2,
                    ci95_lower: 4.2,
                    ci95_upper: 4.6,
                    std_dev: 0.1,
                  },
                },
              },
            ],
          }),
        );
      }
      if (method === 'GET' && url.pathname.endsWith('/scenario-comparison')) {
        return Promise.resolve(
          jsonResponse({
            evaluation_summary: {
              model_count: 1,
              overall_mean: 4.52,
              overall_ci: null,
              overall_ci_lower: null,
              overall_ci_upper: null,
              total_evaluations: 1,
            },
            scenarios: [
              {
                scenario_name: 'Ungrounded refund on a shipped order',
                model_scores: [
                  {
                    display_name: 'Llama 3.3 70B',
                    score: {
                      mean: 4.52,
                      ci95: null,
                      ci95_lower: 4.3,
                      ci95_upper: null,
                      std_dev: null,
                    },
                  },
                ],
              },
            ],
          }),
        );
      }
      if (method === 'GET' && url.pathname.endsWith('/model-responses')) {
        return Promise.resolve(jsonResponse({ items: [] }));
      }

      throw new Error(`Unexpected mocked request: ${method} ${url.pathname}`);
    });

    const humanStdout = new MemoryStream();
    const humanExecutor = createExecutorWithOutput(fetchMock, humanStdout);
    await humanExecutor.execute(
      { kind: 'results', evaluationId: IDS.evaluation, runId: IDS.run },
      { json: false, debug: false },
    );

    const humanOutput = humanStdout.value;
    expect(humanOutput).not.toContain('"ci95": null');
    expect(humanOutput).not.toContain('"ci95_lower": null');
    expect(humanOutput).not.toContain('"ci95_upper": null');
    expect(humanOutput).not.toContain('"std_dev": null');
    expect(humanOutput).not.toContain('"overall_ci": null');
    expect(humanOutput).not.toContain('"overall_ci_lower": null');
    expect(humanOutput).not.toContain('"overall_ci_upper": null');

    const jsonStdout = new MemoryStream();
    const jsonExecutor = createExecutorWithOutput(fetchMock, jsonStdout);
    await jsonExecutor.execute(
      { kind: 'results', evaluationId: IDS.evaluation, runId: IDS.run },
      { json: true, debug: false },
    );

    const output = jsonStdout.value;
    expect(output).toContain('"ci95": null');
    expect(output).toContain('"ci95_lower": null');
    expect(output).toContain('"ci95_upper": null');
    expect(output).toContain('"std_dev": null');
    expect(output).toContain('"overall_ci": null');
    expect(output).toContain('"overall_ci_lower": null');
    expect(output).toContain('"overall_ci_upper": null');

    const payload = JSON.parse(output) as {
      modelPerformance: {
        models: {
          scores: {
            overall: Record<string, unknown>;
            helpfulness: Record<string, unknown>;
          };
        }[];
      };
      scenarioComparison: {
        evaluation_summary: Record<string, unknown>;
        scenarios: { model_scores: { score: Record<string, unknown> }[] }[];
      };
    };

    expect(payload).not.toHaveProperty('status');

    const overallScore = payload.modelPerformance.models[0]?.scores.overall;
    const helpfulnessScore = payload.modelPerformance.models[0]?.scores.helpfulness;
    const summary = payload.scenarioComparison.evaluation_summary;
    const scenarioScore = payload.scenarioComparison.scenarios[0]?.model_scores[0]?.score;

    expect(overallScore).toEqual({
      mean: 4.52,
      ci95: null,
      ci95_lower: null,
      ci95_upper: null,
      std_dev: null,
    });
    expect(helpfulnessScore).toMatchObject({
      mean: 4.43,
      ci95: 0.2,
      ci95_lower: 4.2,
      ci95_upper: 4.6,
      std_dev: 0.1,
    });
    expect(summary).toEqual({
      model_count: 1,
      overall_mean: 4.52,
      overall_ci: null,
      overall_ci_lower: null,
      overall_ci_upper: null,
      total_evaluations: 1,
    });
    expect(scenarioScore).toEqual({
      mean: 4.52,
      ci95: null,
      ci95_lower: 4.3,
      ci95_upper: null,
      std_dev: null,
    });
  });

  it('reports the final polled run status in gate JSON output', async () => {
    const fetchMock = vi.fn<typeof fetch>((inputArg, init) => {
      const url = requestUrl(inputArg);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.pathname.endsWith('/versions_v2')) {
        return Promise.resolve(
          jsonResponse({
            evaluationId: IDS.evaluation,
            context_type: 'scenario',
            methodologies: [
              {
                methodologyId: IDS.methodology,
                versionNumber: 1,
                configs: [{ configId: IDS.config, versionNumber: 1 }],
              },
            ],
            evaluationVersions: {
              currentVersion: 1,
              items: [
                {
                  version: 1,
                  methodologyId: IDS.methodology,
                  configId: IDS.config,
                  isCurrent: true,
                },
              ],
            },
          }),
        );
      }
      if (method === 'POST' && url.pathname.endsWith('/runs')) {
        return Promise.resolve(
          jsonResponse({
            runId: IDS.run,
            status: 'PENDING',
            using: { methodologyVersionId: IDS.methodology, configVersionId: IDS.config },
          }),
        );
      }
      if (method === 'GET' && url.pathname.endsWith('/status')) {
        return Promise.resolve(
          jsonResponse({
            run_id: IDS.run,
            evaluation_id: IDS.evaluation,
            evaluationState: 'COMPLETED',
            progress: { percentage: 100, runsCompleted: 1, totalRuns: 1 },
          }),
        );
      }
      if (method === 'GET' && url.pathname.endsWith('/model-performance')) {
        return Promise.resolve(
          jsonResponse({ models: [{ is_primary: true, scores: { overall: { mean: 4.5 } } }] }),
        );
      }
      if (method === 'GET' && url.pathname.endsWith('/scenario-comparison')) {
        return Promise.resolve(
          jsonResponse({ scenarios: [], evaluation_summary: { total_evaluations: 1 } }),
        );
      }
      if (method === 'GET' && url.pathname.endsWith('/model-responses')) {
        return Promise.resolve(jsonResponse({ items: [] }));
      }
      throw new Error(`Unexpected mocked request: ${method} ${url.pathname}`);
    });

    const stdout = new MemoryStream();
    const executor = createExecutorWithOutput(fetchMock, stdout);
    await executor.execute(
      { kind: 'gate', evaluationId: IDS.evaluation, thresholds: { minOverall: 4 } },
      { json: true, debug: false },
    );

    const payload = JSON.parse(stdout.value) as {
      run: { status: string };
      report: { passed: boolean };
    };
    expect(payload.run.status).toBe('COMPLETED');
    expect(payload.report.passed).toBe(true);
  });
});

describe('eval create-from --run output', () => {
  it('renders the final completed progress before the completion output', async () => {
    const primaryModelId = '77777777-7777-4777-8777-777777777777';
    const input = await writeTempJson('configured.json', {
      methodology: {
        userSystemId: 'USR-3B98B101F7D2',
        judgeModel: 'Judge model',
        judgeModelId: IDS.model,
        runsPerScenario: 3,
        evaluatorInstructions: 'Evaluate safely',
      },
      configuration: {
        contextName: 'Purchasing context',
        contextType: 'scenario',
        artifact: {
          primaryModelId,
          comparisonModelIds: [],
          promptText: 'Help with checkout issues',
          scenarios: [{ id: 'tc-1', prompt: 'Can I checkout as guest?' }],
        },
        expected: 'The answer explains guest checkout trade-offs.',
        selectedMetrics: ['helpfulness'],
      },
    });

    try {
      const statuses = [
        {
          evaluationState: 'IN_PROGRESS',
          progress: { percentage: 33, runsCompleted: 1, totalRuns: 3 },
        },
        {
          evaluationState: 'IN_PROGRESS',
          progress: { percentage: 67, runsCompleted: 2, totalRuns: 3 },
        },
        {
          evaluationState: 'COMPLETED',
          progress: { percentage: 100, runsCompleted: 3, totalRuns: 3 },
        },
      ];
      const fetchMock = vi.fn<typeof fetch>((inputArg, init) => {
        const url = requestUrl(inputArg);
        const method = init?.method ?? 'GET';
        const path = url.pathname;
        if (method === 'GET' && path.endsWith('/byok/models/enabled')) {
          return Promise.resolve(
            jsonResponse({
              models: [
                {
                  supported_model_id: IDS.model,
                  provider_model_id: 'judge-model',
                  provider: 'test',
                  display_name: 'Judge model',
                },
                {
                  supported_model_id: primaryModelId,
                  provider_model_id: 'primary-model',
                  provider: 'test',
                  display_name: 'Primary model',
                },
              ],
            }),
          );
        }
        if (method === 'POST' && path.endsWith('/evaluations/draft')) {
          return Promise.resolve(jsonResponse({ evaluation_id: IDS.evaluation }));
        }
        if (method === 'POST' && path.endsWith('/evaltools/create')) {
          return Promise.resolve(
            jsonResponse({
              eval_id: IDS.evaluation,
              eval_name: 'Purchasing context',
              workspace_id: IDS.workspace,
            }),
          );
        }
        if (method === 'POST' && path.endsWith('/methodology-versions')) {
          return Promise.resolve(jsonResponse({ methodology_version_id: IDS.methodology }));
        }
        if (method === 'POST' && path.endsWith('/config-versions')) {
          return Promise.resolve(jsonResponse({ config_version_id: IDS.config }));
        }
        if (method === 'POST' && path.endsWith('/runs')) {
          return Promise.resolve(
            jsonResponse({
              runId: IDS.run,
              status: 'PENDING',
              using: {
                methodologyVersionId: IDS.methodology,
                configVersionId: IDS.config,
              },
            }),
          );
        }
        if (method === 'GET' && path.endsWith('/status/stream')) {
          return Promise.resolve(
            new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } }),
          );
        }
        if (method === 'GET' && path.endsWith('/status')) {
          const status = statuses.shift();
          if (!status) throw new Error('Unexpected extra status request.');
          return Promise.resolve(
            jsonResponse({
              run_id: IDS.run,
              evaluation_id: IDS.evaluation,
              ...status,
            }),
          );
        }
        if (method === 'GET' && path.endsWith('/versions_v2')) {
          return Promise.resolve(
            jsonResponse({
              evaluationId: IDS.evaluation,
              context_type: 'scenario',
              evaluationVersions: {
                currentVersion: 1,
                items: [
                  {
                    version: 1,
                    methodologyId: IDS.methodology,
                    configId: IDS.config,
                    isCurrent: true,
                  },
                ],
              },
            }),
          );
        }
        if (method === 'GET' && path.endsWith('/model-performance')) {
          return Promise.resolve(jsonResponse({ models: [{ overall_score: 4.2 }] }));
        }
        if (method === 'GET' && path.endsWith('/scenario-comparison')) {
          return Promise.resolve(
            jsonResponse({ scenarios: [], evaluation_summary: { total_evaluations: 1 } }),
          );
        }
        if (method === 'GET' && path.endsWith('/model-responses')) {
          return Promise.resolve(jsonResponse({ items: [] }));
        }
        throw new Error(`Unexpected mocked request: ${method} ${path}`);
      });

      const terminal = new MemoryStream(true);
      const executor = createExecutorWithOutput(fetchMock, terminal, new FakeClock(), terminal);
      await executor.execute(
        {
          kind: 'evaluation-create-from',
          workspaceId: IDS.workspace,
          inputFiles: [input.path],
          run: true,
        },
        { json: false, debug: true },
      );

      expect(terminal.value).not.toContain('[y/N]');
      expect(terminal.value).not.toContain('Do you want to know');
      expect(terminal.value).toContain(`autoeval results ${IDS.evaluation} ${IDS.run}`);

      const partialProgress = terminal.value.lastIndexOf('1/3 runs · IN_PROGRESS');
      const completedProgress = terminal.value.lastIndexOf('3/3 runs · COMPLETED');
      const completionOutput = terminal.value.indexOf(`Run ${IDS.run} finished in`);
      expect(partialProgress).toBeGreaterThanOrEqual(0);
      expect(completedProgress).toBeGreaterThan(partialProgress);
      expect(completionOutput).toBeGreaterThan(completedProgress);
      expect(statuses).toHaveLength(0);
      // The run command reports completion only; results stay an explicit command.
      expect(
        fetchMock.mock.calls.some((call) =>
          requestUrl(call[0]).pathname.endsWith('/model-performance'),
        ),
      ).toBe(false);
    } finally {
      await input.cleanup();
    }
  });
});

describe('suite run execution', () => {
  it('runs every eval through create-from with staggered scheduling', async () => {
    const primaryModelId = '77777777-7777-4777-8777-777777777777';
    const mkId = (prefix: string, n: number): string =>
      `${prefix}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
    const suiteFiles = await writeTempSuiteFiles({
      'one.autoeval.json': JSON.stringify({
        methodology: {
          userSystemId: 'USR-3B98B101F7D2',
          judgeModel: 'Judge model',
          judgeModelId: IDS.model,
          runsPerScenario: 1,
          evaluatorInstructions: 'Evaluate safely',
        },
        configuration: {
          contextName: 'Suite one',
          contextType: 'scenario',
          artifact: {
            primaryModelId,
            comparisonModelIds: [],
            promptText: 'Prompt one',
            scenarios: [{ id: 'tc-1', prompt: 'Case one' }],
          },
          expected: 'Expected one',
          selectedMetrics: ['helpfulness'],
        },
      }),
      'two.autoeval.json': JSON.stringify({
        methodology: {
          userSystemId: 'USR-3B98B101F7D2',
          judgeModel: 'Judge model',
          judgeModelId: IDS.model,
          runsPerScenario: 1,
          evaluatorInstructions: 'Evaluate safely',
        },
        configuration: {
          contextName: 'Suite two',
          contextType: 'scenario',
          artifact: {
            primaryModelId,
            comparisonModelIds: [],
            promptText: 'Prompt two',
            scenarios: [{ id: 'tc-2', prompt: 'Case two' }],
          },
          expected: 'Expected two',
          selectedMetrics: ['helpfulness'],
        },
      }),
      'three.autoeval.json': JSON.stringify({
        methodology: {
          userSystemId: 'USR-3B98B101F7D2',
          judgeModel: 'Judge model',
          judgeModelId: IDS.model,
          runsPerScenario: 1,
          evaluatorInstructions: 'Evaluate safely',
        },
        configuration: {
          contextName: 'Suite three',
          contextType: 'scenario',
          artifact: {
            primaryModelId,
            comparisonModelIds: [],
            promptText: 'Prompt three',
            scenarios: [{ id: 'tc-3', prompt: 'Case three' }],
          },
          expected: 'Expected three',
          selectedMetrics: ['helpfulness'],
        },
      }),
      'autoeval.suite.yaml': [
        `workspace: ${IDS.workspace}`,
        'evals:',
        '  - ./one.autoeval.json',
        '  - ./two.autoeval.json',
        '  - ./three.autoeval.json',
        '',
      ].join('\n'),
    });

    try {
      let evalSequence = 0;
      let runSequence = 0;
      const runByEvaluationId = new Map<string, string>();
      const fetchMock = vi.fn<typeof fetch>((inputArg, init) => {
        const url = requestUrl(inputArg);
        const method = init?.method ?? 'GET';
        const path = url.pathname;
        if (method === 'GET' && path.endsWith('/byok/models/enabled')) {
          return Promise.resolve(
            jsonResponse({
              models: [
                {
                  supported_model_id: IDS.model,
                  provider_model_id: 'judge-model',
                  provider: 'test',
                  display_name: 'Judge model',
                },
                {
                  supported_model_id: primaryModelId,
                  provider_model_id: 'primary-model',
                  provider: 'test',
                  display_name: 'Primary model',
                },
              ],
            }),
          );
        }
        if (method === 'POST' && path.endsWith('/evaluations/draft')) {
          evalSequence += 1;
          return Promise.resolve(jsonResponse({ evaluation_id: mkId('11111111', evalSequence) }));
        }
        if (method === 'POST' && path.endsWith('/evaltools/create')) {
          const evaluationId = url.searchParams.get('evaluation_id') ?? IDS.evaluation;
          return Promise.resolve(
            jsonResponse({
              eval_id: evaluationId,
              eval_name: 'Suite eval',
              workspace_id: IDS.workspace,
            }),
          );
        }
        if (method === 'POST' && path.endsWith('/methodology-versions')) {
          return Promise.resolve(jsonResponse({ methodology_version_id: IDS.methodology }));
        }
        if (method === 'POST' && path.endsWith('/config-versions')) {
          return Promise.resolve(jsonResponse({ config_version_id: IDS.config }));
        }
        if (method === 'POST' && path.endsWith('/runs')) {
          const evaluationId = path.split('/').at(-2) ?? IDS.evaluation;
          runSequence += 1;
          const runId = mkId('22222222', runSequence);
          runByEvaluationId.set(evaluationId, runId);
          return Promise.resolve(
            jsonResponse({
              runId,
              status: 'PENDING',
              using: {
                methodologyVersionId: IDS.methodology,
                configVersionId: IDS.config,
              },
            }),
          );
        }
        if (method === 'GET' && path.endsWith('/status/stream')) {
          return Promise.resolve(
            new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } }),
          );
        }
        if (method === 'GET' && path.endsWith('/status')) {
          const evaluationId = path.split('/').at(-4) ?? IDS.evaluation;
          return Promise.resolve(
            jsonResponse({
              run_id: runByEvaluationId.get(evaluationId) ?? IDS.run,
              evaluation_id: evaluationId,
              evaluationState: 'COMPLETED',
              progress: { percentage: 100, runsCompleted: 1, totalRuns: 1 },
            }),
          );
        }
        if (method === 'GET' && path.endsWith('/versions_v2')) {
          const evaluationId = path.split('/').at(-2) ?? IDS.evaluation;
          return Promise.resolve(
            jsonResponse({
              evaluationId,
              context_type: 'scenario',
              evaluationVersions: {
                currentVersion: 1,
                items: [
                  {
                    version: 1,
                    methodologyId: IDS.methodology,
                    configId: IDS.config,
                    isCurrent: true,
                  },
                ],
              },
            }),
          );
        }
        if (method === 'GET' && path.endsWith('/model-performance')) {
          return Promise.resolve(jsonResponse({ models: [{ overall_score: 4.2 }] }));
        }
        if (method === 'GET' && path.endsWith('/scenario-comparison')) {
          return Promise.resolve(
            jsonResponse({ scenarios: [], evaluation_summary: { total_evaluations: 1 } }),
          );
        }
        if (method === 'GET' && path.endsWith('/model-responses')) {
          return Promise.resolve(jsonResponse({ items: [] }));
        }
        throw new Error(`Unexpected mocked request: ${method} ${path}`);
      });

      const stdout = new MemoryStream();
      const clock = new TrackingClock();
      const executor = createExecutorWithOutput(fetchMock, stdout, clock);
      const manifestPath = suiteFiles.paths['autoeval.suite.yaml'];
      if (manifestPath === undefined) {
        throw new Error('suite manifest path missing in test setup');
      }
      await executor.execute(
        {
          kind: 'suite-run',
          manifestFile: manifestPath,
          concurrency: 2,
          staggerMs: 50,
        },
        { json: false, debug: false },
      );

      expect(runSequence).toBe(3);
      expect(
        fetchMock.mock.calls.filter((call) => requestUrl(call[0]).pathname.endsWith('/runs')),
      ).toHaveLength(3);
      expect(clock.sleeps.some((sleepMs) => sleepMs >= 50)).toBe(true);
      expect(
        fetchMock.mock.calls.filter((call) =>
          requestUrl(call[0]).pathname.endsWith('/model-performance'),
        ),
      ).toHaveLength(3);
      expect(stdout.value).toContain('Suite summary');
      expect(stdout.value).toContain('3 total, 3 with results, 0 failed');
    } finally {
      await suiteFiles.cleanup();
    }
  });
});
