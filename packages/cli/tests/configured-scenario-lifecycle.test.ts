import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';

import { createConfiguredRun } from '../src/actions/evaluations.js';
import { getResults } from '../src/actions/results.js';
import { AutoevalApiClient } from '../src/api/api.js';
import { ApiClient } from '../src/api/client.js';
import {
  configVersionCreateResponseSchema,
  evaluationVersionsResponseSchema,
  jsonObjectSchema,
  methodologyVersionCreateResponseSchema,
  runCreateResponseSchema,
  runStatusResponseSchema,
} from '../src/api/schemas.js';
import { FakeClock, IDS, VALID_KEY } from './helpers.js';

const LIVE_RUN_ID = IDS.config;

function loadFixture<T>(filename: string, schema: ZodType<T>): T {
  const content = readFileSync(new URL(`fixtures/api/${filename}`, import.meta.url), 'utf8');
  return schema.parse(JSON.parse(content) as unknown);
}

const fixtures = {
  methodology: loadFixture(
    'scenario-methodology-created.json',
    methodologyVersionCreateResponseSchema,
  ),
  configuration: loadFixture('scenario-config-created.json', configVersionCreateResponseSchema),
  run: loadFixture('scenario-run-created.json', runCreateResponseSchema),
  running: loadFixture('scenario-run-status-running.json', runStatusResponseSchema),
  completed: loadFixture('scenario-run-status-completed.json', runStatusResponseSchema),
  versions: loadFixture('scenario-evaluation-versions.json', evaluationVersionsResponseSchema),
  modelPerformance: loadFixture('scenario-model-performance.json', jsonObjectSchema),
  scenarioComparison: loadFixture('scenario-comparison.json', jsonObjectSchema),
  modelResponses: loadFixture('scenario-model-responses.json', jsonObjectSchema),
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function requestUrl(input: Parameters<typeof fetch>[0]): URL {
  if (input instanceof URL) return input;
  if (typeof input === 'string') return new URL(input);
  return new URL(input.url);
}

function requestBody(
  calls: ReturnType<typeof vi.fn<typeof fetch>>['mock']['calls'],
  index: number,
): Record<string, unknown> {
  const body = calls[index]?.[1]?.body;
  if (typeof body !== 'string') throw new Error(`Expected JSON request body at index ${index}.`);
  return jsonObjectSchema.parse(JSON.parse(body) as unknown);
}

describe('sanitized live scenario lifecycle', () => {
  it('runs methodology through results with one run and three test-case scenarios', async () => {
    const statuses = [fixtures.running, fixtures.completed];
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';
      const path = url.pathname;

      if (method === 'POST' && path.endsWith('/methodology-versions')) {
        return Promise.resolve(jsonResponse(fixtures.methodology));
      }
      if (method === 'POST' && path.endsWith('/config-versions')) {
        return Promise.resolve(jsonResponse(fixtures.configuration));
      }
      if (method === 'POST' && path.endsWith('/runs')) {
        return Promise.resolve(jsonResponse(fixtures.run));
      }
      if (method === 'GET' && path.endsWith('/status/stream')) {
        return Promise.resolve(
          new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } }),
        );
      }
      if (method === 'GET' && path.endsWith('/status')) {
        const status = statuses.shift();
        if (!status) throw new Error('Unexpected extra status request.');
        return Promise.resolve(jsonResponse(status));
      }
      if (method === 'GET' && path.endsWith('/versions_v2')) {
        return Promise.resolve(jsonResponse(fixtures.versions));
      }
      if (method === 'GET' && path.endsWith('/model-performance')) {
        return Promise.resolve(jsonResponse(fixtures.modelPerformance));
      }
      if (method === 'GET' && path.endsWith('/scenario-comparison')) {
        return Promise.resolve(jsonResponse(fixtures.scenarioComparison));
      }
      if (method === 'GET' && path.endsWith('/model-responses')) {
        return Promise.resolve(jsonResponse(fixtures.modelResponses));
      }

      throw new Error(`Unexpected mocked API request: ${method} ${path}`);
    });
    const api = new AutoevalApiClient(
      new ApiClient({
        baseUrl: new URL('https://api.example.test/'),
        apiKey: VALID_KEY,
        requestTimeoutMs: 1_000,
        maxResponseBytes: 100_000,
        fetchImplementation: fetchMock,
        maxGetAttempts: 1,
      }),
    );

    const execution = await createConfiguredRun(
      { api },
      {
        evaluationId: IDS.evaluation,
        methodology: {
          userSystemId: 'USR-SANITIZED-TEST',
          judgeModel: 'GPT-5-mini',
          judgeModelId: IDS.model,
          runsPerScenario: 3,
          evaluatorInstructions: 'Evaluate code review quality.',
        },
        configuration: {
          contextName: 'Scenario Evaluation',
          contextType: 'scenario',
          artifact: {
            primaryModelId: '88888888-8888-4888-8888-888888888888',
            comparisonModelIds: ['99999999-9999-4999-8999-999999999999'],
            promptText: 'Review the code accurately.',
            scenarios: [
              { id: 'case-1', name: 'Optional array reduce', prompt: 'Review case 1.' },
              { id: 'case-2', name: 'Cosmetic rename PR', prompt: 'Review case 2.' },
              { id: 'case-3', name: 'Swallowed error in route', prompt: 'Review case 3.' },
            ],
          },
          expected: 'Accurate, prioritized, actionable feedback.',
          referenceDocuments: [],
          selectedMetrics: ['helpfulness'],
          temperatureContext: 0,
        },
        clock: new FakeClock(),
        pollIntervalMs: 10,
        pollTimeoutMs: 100,
        idempotencyKeyFactory: () => IDS.run,
      },
    );

    expect(execution.run.runId).toBe(LIVE_RUN_ID);
    expect(execution.run.configVersionId).toBe(LIVE_RUN_ID);
    expect(execution.outcome.status).toMatchObject({
      state: 'COMPLETED',
      progress: { percentage: 100, runsCompleted: 1, totalRuns: 1 },
    });

    const postRequests = fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST');
    expect(postRequests).toHaveLength(3);
    const methodologyBody = requestBody(postRequests, 0);
    const configurationBody = requestBody(postRequests, 1);
    const runBody = requestBody(postRequests, 2);
    expect(methodologyBody).toEqual({
      user_sys_id: 'USR-SANITIZED-TEST',
      judge_model: IDS.model,
      judge_model_id: IDS.model,
      evaluator_instructions: 'Evaluate code review quality.',
      change_log: '',
      runs_per_scenario: 3,
    });
    expect(configurationBody.methodology_version_id).toBe(IDS.methodology);
    expect(configurationBody).not.toHaveProperty('auto_stop_enabled');
    expect(configurationBody.scenarios).toEqual([
      { id: 'case-1', name: 'Optional array reduce', prompt: 'Review case 1.' },
      { id: 'case-2', name: 'Cosmetic rename PR', prompt: 'Review case 2.' },
      { id: 'case-3', name: 'Swallowed error in route', prompt: 'Review case 3.' },
    ]);
    expect(runBody).toEqual({
      selector: { configVersionId: LIVE_RUN_ID },
    });

    const results = await getResults(
      { api },
      {
        evaluationId: IDS.evaluation,
        runId: LIVE_RUN_ID,
        clock: new FakeClock(),
        resultReadyIntervalMs: 10,
        resultReadyTimeoutMs: 100,
      },
    );

    expect(results).toEqual({
      contextType: 'scenario',
      modelPerformance: fixtures.modelPerformance,
      scenarioComparison: fixtures.scenarioComparison,
      modelResponses: fixtures.modelResponses,
    });
    expect(fixtures.scenarioComparison.evaluation_summary).toEqual(
      expect.objectContaining({ model_count: 2, test_case_count: 3, total_evaluations: 6 }),
    );
    expect(fixtures.modelResponses.outputs).toHaveLength(3);
    expect(fetchMock.mock.calls).toHaveLength(10);
    expect(statuses).toHaveLength(0);
  });
});
