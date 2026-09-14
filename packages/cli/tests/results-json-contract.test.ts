import { describe, expect, it, vi } from 'vitest';

import { getResults } from '../src/actions/results.js';
import { redactUnknown } from '../src/auth/redact.js';
import { RuntimeCommandExecutor } from '../src/commands/executor.js';
import { loadConfiguration } from '../src/config.js';
import type { JsonObject } from '../src/domain/common.js';
import { renderResults } from '../src/output/human.js';
import {
  fullModelPerformance,
  fullModelResponses,
  fullScenarioComparison,
  preservedSentinelKeys,
} from './fixtures/scenario-full-payload.js';
import { createApi, FakeClock, IDS, VALID_KEY, versionResponse } from './helpers.js';

/**
 * `results --json` is the machine contract for downstream tooling: it must
 * expose the complete response of each scenario reader call, reduced only by
 * the credential redaction that applies to every command.
 */

class MemoryStream {
  value = '';
  isTTY = false;

  write(chunk: string): boolean {
    this.value += chunk;
    return true;
  }
}

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

function scenarioFetch(): typeof fetch {
  return vi.fn<typeof fetch>((inputArg, init) => {
    const url = requestUrl(inputArg);
    const method = init?.method ?? 'GET';

    if (method === 'GET' && url.pathname.endsWith('/versions_v2')) {
      return Promise.resolve(jsonResponse(versionResponse('scenario')));
    }
    if (method === 'GET' && url.pathname.endsWith('/model-performance')) {
      return Promise.resolve(jsonResponse(fullModelPerformance));
    }
    if (method === 'GET' && url.pathname.endsWith('/scenario-comparison')) {
      return Promise.resolve(jsonResponse(fullScenarioComparison));
    }
    if (method === 'GET' && url.pathname.endsWith('/model-responses')) {
      return Promise.resolve(jsonResponse(fullModelResponses));
    }
    throw new Error(`Unexpected mocked request: ${method} ${url.pathname}`);
  });
}

async function runResultsJson(): Promise<{ stdout: string; payload: JsonObject }> {
  const stdout = new MemoryStream();
  const executor = new RuntimeCommandExecutor({
    configuration: loadConfiguration({ AUTOEVAL_API_BASE_URL: 'https://api.example.test' }),
    environment: { AUTOEVAL_API_KEY: VALID_KEY },
    fetchImplementation: scenarioFetch(),
    stdout,
    stderr: new MemoryStream(),
    stdin: { isTTY: false },
  });

  await executor.execute(
    { kind: 'results', evaluationId: IDS.evaluation, runId: IDS.run },
    { json: true, debug: false },
  );

  return { stdout: stdout.value, payload: JSON.parse(stdout.value) as JsonObject };
}

describe('scenario results --json preserves the complete backend responses', () => {
  it('returns each reader response as the backend sent it, apart from credential masking', async () => {
    const { payload } = await runResultsJson();

    // `provider_key` matches the shared credential heuristic, so it is masked
    // rather than dropped. Every other field is reported verbatim.
    expect(payload.modelPerformance).toEqual(redactUnknown(fullModelPerformance));
    expect(payload.scenarioComparison).toEqual(redactUnknown(fullScenarioComparison));
    expect(payload.modelResponses).toEqual(redactUnknown(fullModelResponses));
    expect(payload.contextType).toBe('scenario');
    expect(payload).not.toHaveProperty('status');

    const models = (payload.modelPerformance as { models: Record<string, unknown>[] }).models;
    expect(models[0]).toMatchObject({
      model_name: 'llama-3.3-70b',
      consistency_level: 'low',
      provider: 'Other',
      provider_key: '[REDACTED]',
    });
  });

  it('keeps every backend field that no renderer reads', async () => {
    const { stdout } = await runResultsJson();

    for (const key of preservedSentinelKeys) {
      expect(stdout).toContain(`"${key}"`);
    }
  });

  it('keeps usage counters intact because they are not credentials', async () => {
    const { payload } = await runResultsJson();

    const outputs = payload.modelResponses as { outputs: Record<string, unknown>[] };
    const best = (
      outputs.outputs[0]?.model_responses as {
        best_run: { metadata: Record<string, unknown>; execution_id: string };
      }[]
    )[0];

    expect(best?.best_run.metadata).toEqual({
      cost: 0.0123,
      input_tokens: 412,
      output_tokens: 268,
      tokens: 680,
      total_tokens: 680,
      latency_ms: 1840,
    });
    expect(best?.best_run.execution_id).toBe('88888888-8888-4888-8888-888888888881');
  });

  it('still masks credentials found inside a result payload', () => {
    const redacted = redactUnknown({
      outputs: [
        {
          best_run: {
            api_key: 'pl_sk_examplecredential123',
            metadata: { tokens: 680, latency_ms: 1840 },
            response: `leaked ${VALID_KEY}`,
          },
        },
      ],
    }) as Record<string, Record<string, Record<string, Record<string, unknown>>>[]>;

    const bestRun = redacted.outputs?.[0]?.best_run;
    expect(bestRun?.api_key).toBe('[REDACTED]');
    expect(bestRun?.metadata).toEqual({ tokens: 680, latency_ms: 1840 });
    expect(bestRun?.response).toBe('leaked pl_sk_[REDACTED]');
  });

  it('leaves the human scorecard unchanged for the same payload', async () => {
    const api = createApi({
      getEvaluationVersions: vi.fn(() => Promise.resolve(versionResponse('scenario'))),
      getModelPerformance: vi.fn(() => Promise.resolve(fullModelPerformance)),
      getScenarioComparison: vi.fn(() => Promise.resolve(fullScenarioComparison)),
      getModelResponses: vi.fn(() => Promise.resolve(fullModelResponses)),
    });

    const results = await getResults(
      { api },
      {
        evaluationId: IDS.evaluation,
        runId: IDS.run,
        clock: new FakeClock(),
        resultReadyIntervalMs: 10,
        resultReadyTimeoutMs: 100,
      },
    );

    const before = renderResults(results);
    // Rendering must not consume or mutate the payload it reads.
    expect(renderResults(results)).toBe(before);
    expect(results).toMatchObject({ modelResponses: fullModelResponses });
    expect(before).toContain('4.14');
  });
});
