import { describe, expect, it, vi } from 'vitest';

import { loadConfiguration, parseApiBaseUrl } from '../src/config.js';
import { AutoevalApiClient } from '../src/api/api.js';
import { ApiClient } from '../src/api/client.js';
import { apiEndpoints } from '../src/api/endpoints.js';
import { IDS, VALID_KEY } from './helpers.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function apiWith(fetchImplementation: typeof fetch): AutoevalApiClient {
  return new AutoevalApiClient(
    new ApiClient({
      baseUrl: new URL('https://api.example.test/'),
      apiKey: VALID_KEY,
      requestTimeoutMs: 1_000,
      maxResponseBytes: 100_000,
      fetchImplementation,
      maxGetAttempts: 1,
    }),
  );
}

function requestDetails(fetchMock: ReturnType<typeof vi.fn>): { url: URL; init: RequestInit } {
  const call = fetchMock.mock.calls.at(-1) as [URL, RequestInit] | undefined;
  if (!call) throw new Error('Expected a fetch call.');
  return { url: call[0], init: call[1] };
}

describe('API endpoint contracts', () => {
  it('maps every approved endpoint exactly', () => {
    expect(apiEndpoints.currentUser()).toBe('/api/v1/auth/me');
    expect(apiEndpoints.workspaces()).toBe('/api/v1/workspaces');
    expect(apiEndpoints.workspaceCreate()).toBe('/api/v1/workspaces/create');
    expect(apiEndpoints.workspace(IDS.workspace)).toBe(`/api/v1/workspaces/${IDS.workspace}`);
    expect(apiEndpoints.evaluations()).toBe('/api/v1/evaltools');
    expect(apiEndpoints.evaluationMetadata(IDS.workspace)).toBe(
      `/api/v1/evaltools/${IDS.workspace}`,
    );
    expect(apiEndpoints.evaluationDraft()).toBe('/api/v1/evaluations/draft');
    expect(apiEndpoints.evaluationCreate()).toBe('/api/v1/evaltools/create');
    expect(apiEndpoints.methodologyVersions(IDS.evaluation)).toBe(
      `/api/v1/evaluations/${IDS.evaluation}/methodology-versions`,
    );
    expect(apiEndpoints.configVersions(IDS.evaluation)).toBe(
      `/api/v1/evaluations/${IDS.evaluation}/config-versions`,
    );
    expect(apiEndpoints.evaluationVersions(IDS.evaluation)).toBe(
      `/api/v1/evaluations/${IDS.evaluation}/versions_v2`,
    );
    expect(apiEndpoints.evaluationConfiguration(IDS.evaluation)).toBe(
      `/api/v1/evaluations/${IDS.evaluation}`,
    );
    expect(apiEndpoints.evaluationUpdate(IDS.evaluation)).toBe(
      `/api/v1/evaluations/${IDS.evaluation}`,
    );
    expect(apiEndpoints.evaltoolUpdate(IDS.workspace)).toBe(`/api/v1/evaltools/${IDS.workspace}`);
    expect(apiEndpoints.syncEvalsList()).toBe('/api/v1/evaltools/sync_evals_list');
    expect(apiEndpoints.qualityStandards()).toBe('/api/v1/quality-standards');
    expect(apiEndpoints.qualityStandardsWorkspace(IDS.workspace)).toBe(
      `/api/v1/quality-standards/workspaces/${IDS.workspace}`,
    );
    expect(apiEndpoints.qualityStandard(IDS.methodology)).toBe(
      `/api/v1/quality-standards/${IDS.methodology}`,
    );
    expect(apiEndpoints.models()).toBe('/api/v1/byok/models/enabled');
    expect(apiEndpoints.runs(IDS.evaluation)).toBe(`/api/v1/evaluations/${IDS.evaluation}/runs`);
    expect(apiEndpoints.runStatus(IDS.evaluation, IDS.run)).toBe(
      `/api/v1/evaluations/${IDS.evaluation}/runs/${IDS.run}/status`,
    );
    expect(apiEndpoints.runStatusStream(IDS.evaluation, IDS.run)).toBe(
      `/api/v1/evaluations/${IDS.evaluation}/runs/${IDS.run}/status/stream`,
    );
    expect(apiEndpoints.modelPerformance(IDS.evaluation, IDS.run)).toMatch(/model-performance$/u);
    expect(apiEndpoints.scenarioComparison(IDS.evaluation, IDS.run)).toMatch(
      /scenario-comparison$/u,
    );
    expect(apiEndpoints.modelResponses(IDS.evaluation, IDS.run)).toMatch(/model-responses$/u);
    expect(apiEndpoints.conversationResults(IDS.evaluation, IDS.run)).toMatch(
      /conversation_results$/u,
    );
    expect(apiEndpoints.agentTraceResults(IDS.evaluation, IDS.run)).toMatch(
      /agent_trace_results$/u,
    );
    expect(apiEndpoints.trajectory(IDS.evaluation, IDS.run)).toMatch(/trajectory$/u);
  });

  it('sends the bearer key only in the authorization header and rejects redirects', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ id: 'user-1', user_sys_id: 'sys-1', email: 'user@example.com' }),
      );
    await apiWith(fetchMock).getCurrentUser();

    const { url, init } = requestDetails(fetchMock);
    expect(url.href).toBe('https://api.example.test/api/v1/auth/me');
    expect(init).toMatchObject({ method: 'GET', redirect: 'error' });
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${VALID_KEY}`);
    expect(url.href).not.toContain(VALID_KEY);
    expect(init.body).toBeUndefined();
  });

  it('parses BYOK enabled models response shape', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        models: [
          {
            supported_model_id: IDS.model,
            provider_model_id: 'gpt-5',
            provider: 'openai',
            display_name: 'GPT-5',
            is_deprecated: false,
          },
        ],
      }),
    );

    const result = await apiWith(fetchMock).getModels();

    expect(result).toEqual([
      {
        id: IDS.model,
        provider: 'openai',
        displayName: 'GPT-5',
        apiModelId: 'gpt-5',
        isDeprecated: false,
        isLocked: false,
      },
    ]);
  });

  it('uses exact list, version, and configuration query parameters', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ items: [], total: 0, page: 1, size: 100, total_pages: 0 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ evaluationId: IDS.evaluation, methodologies: [], evaluationVersions: null }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          evaluation_id: IDS.evaluation,
          methodology_version_id: IDS.methodology,
          config_version_id: IDS.config,
        }),
      );
    const api = apiWith(fetchMock);

    await api.listEvaluations(IDS.workspace);
    expect(requestDetails(fetchMock).url.searchParams).toEqual(
      new URLSearchParams({ workspace_id: IDS.workspace, page: '1', size: '100' }),
    );
    await api.getEvaluationVersions(IDS.evaluation);
    expect(requestDetails(fetchMock).url.searchParams).toEqual(
      new URLSearchParams({ enhanced: 'true' }),
    );
    await api.getEvaluationConfiguration(IDS.evaluation, IDS.methodology, IDS.config);
    expect(requestDetails(fetchMock).url.searchParams).toEqual(
      new URLSearchParams({
        methodology_version_id: IDS.methodology,
        config_version_id: IDS.config,
      }),
    );
  });

  it('creates a workspace using the approved endpoint and body', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        workspace_id: IDS.workspace,
        name: 'Product launch v2',
        description: 'r',
        eval_count: 0,
      }),
    );

    const result = await apiWith(fetchMock).createWorkspace({
      name: 'Product launch v2',
      description: 'r',
    });

    const { url, init } = requestDetails(fetchMock);
    expect(url.pathname).toBe('/api/v1/workspaces/create');
    expect(init.method).toBe('POST');
    expect(typeof init.body).toBe('string');
    expect(JSON.parse(init.body as string)).toEqual({
      name: 'Product launch v2',
      description: 'r',
    });
    expect(result).toEqual({
      id: IDS.workspace,
      name: 'Product launch v2',
      description: 'r',
      evaluationCount: 0,
    });
  });

  it('maps quality_standard_id on listed workspaces', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        items: [
          {
            workspace_id: IDS.workspace,
            name: 'QS pro',
            eval_count: 5,
            quality_standard_id: IDS.methodology,
          },
        ],
        total: 1,
        page: 1,
        size: 100,
        total_pages: 1,
      }),
    );

    const result = await apiWith(fetchMock).listWorkspaces();

    expect(result.items[0]).toMatchObject({
      id: IDS.workspace,
      name: 'QS pro',
      qualityStandardId: IDS.methodology,
    });
  });

  it('creates an evaluation by calling draft body then evaltool-create query', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ evaluation_id: IDS.evaluation }))
      .mockResolvedValueOnce(
        jsonResponse({
          eval_id: IDS.evaluation,
          eval_name: 'Untitled',
          workspace_id: IDS.workspace,
        }),
      );
    const api = apiWith(fetchMock);

    const draft = await api.createEvaluationDraft(IDS.workspace);
    const created = await api.createEvaluation({
      workspaceId: IDS.workspace,
      evaluationId: IDS.evaluation,
      evaluationName: 'Untitled',
    });

    const firstCall = fetchMock.mock.calls[0] as [URL, RequestInit];
    const secondCall = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect(firstCall[0].pathname).toBe('/api/v1/evaluations/draft');
    expect(firstCall[1].method).toBe('POST');
    expect(JSON.parse(firstCall[1].body as string)).toEqual({ workspace_id: IDS.workspace });

    expect(secondCall[0].pathname).toBe('/api/v1/evaltools/create');
    expect(secondCall[1].method).toBe('POST');
    expect(secondCall[0].searchParams).toEqual(
      new URLSearchParams({
        eval_name: 'Untitled',
        workspace_id: IDS.workspace,
        evaluation_id: IDS.evaluation,
      }),
    );

    expect(draft.evaluation_id).toBe(IDS.evaluation);
    expect(created.eval_id).toBe(IDS.evaluation);
  });

  it('creates methodology and config versions with exact payload keys', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ methodology_version_id: IDS.methodology }))
      .mockResolvedValueOnce(jsonResponse({ config_version_id: IDS.config }));
    const api = apiWith(fetchMock);

    await api.createMethodologyVersion(IDS.evaluation, {
      user_sys_id: 'USR-3B98B101F7D2',
      judge_model: 'GPT-5',
      judge_model_id: IDS.model,
      evaluator_instructions: 'Evaluate safely',
      change_log: '',
      runs_per_scenario: 1,
    });
    await api.createConfigVersion(IDS.evaluation, {
      context_name: 'Cancellation Chat Eval',
      context_type: 'conversation',
      methodology_version_id: IDS.methodology,
      artifact: { messages: [] },
      expected: 'Expected answer',
      reference_documents: [{ filename: 'doc.md', content: 'policy' }],
      selected_metrics: ['helpfulness'],
      temperature_context: 0,
    });

    const firstCall = fetchMock.mock.calls[0] as [URL, RequestInit];
    const secondCall = fetchMock.mock.calls[1] as [URL, RequestInit];

    expect(firstCall[0].pathname).toBe(
      `/api/v1/evaluations/${IDS.evaluation}/methodology-versions`,
    );
    expect(firstCall[1].method).toBe('POST');
    expect(JSON.parse(firstCall[1].body as string)).toEqual({
      user_sys_id: 'USR-3B98B101F7D2',
      judge_model: 'GPT-5',
      judge_model_id: IDS.model,
      evaluator_instructions: 'Evaluate safely',
      change_log: '',
      runs_per_scenario: 1,
    });

    expect(secondCall[0].pathname).toBe(`/api/v1/evaluations/${IDS.evaluation}/config-versions`);
    expect(secondCall[1].method).toBe('POST');
    expect(JSON.parse(secondCall[1].body as string)).toEqual({
      context_name: 'Cancellation Chat Eval',
      context_type: 'conversation',
      methodology_version_id: IDS.methodology,
      artifact: { messages: [] },
      expected: 'Expected answer',
      reference_documents: [{ filename: 'doc.md', content: 'policy' }],
      selected_metrics: ['helpfulness'],
      temperature_context: 0,
    });
  });

  it('uses scenario-native config payload keys', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ config_version_id: IDS.config }));
    const api = apiWith(fetchMock);

    await api.createConfigVersion(IDS.evaluation, {
      methodology_version_id: IDS.methodology,
      primary_model_id: IDS.model,
      comparison_model_ids: [],
      scenarios: [[{ id: 'tc-1', name: 'Case 1', prompt: 'Review this code.' }]],
      prompt_text: 'Review this PR',
      selected_metrics: ['helpfulness'],
    });

    const call = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(call[0].pathname).toBe(`/api/v1/evaluations/${IDS.evaluation}/config-versions`);
    expect(call[1].method).toBe('POST');

    const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      methodology_version_id: IDS.methodology,
      primary_model_id: IDS.model,
      comparison_model_ids: [],
      scenarios: [[{ id: 'tc-1', name: 'Case 1', prompt: 'Review this code.' }]],
      prompt_text: 'Review this PR',
    });
    expect(body).not.toHaveProperty('context_type');
    expect(body).not.toHaveProperty('context_name');
    expect(body).not.toHaveProperty('expected');
  });

  it('creates, updates, associates, and retrieves quality standards with exact contracts', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ quality_standard_id: IDS.methodology }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ quality_standard_id: IDS.methodology }))
      .mockResolvedValueOnce(jsonResponse({ quality_standard_id: IDS.methodology, name: 'QS' }))
      .mockResolvedValueOnce(jsonResponse({ quality_standard_id: IDS.methodology, name: 'QS' }));
    const api = apiWith(fetchMock);

    await api.createQualityStandard({
      name: 'Customer Support — Return Intake 1',
      judge_model: IDS.model,
      rubric: 'rubric',
      anchors: [
        {
          input: 'question',
          response: 'response',
          reference: 'reference',
          score: 5,
          reasoning: 'reasoning',
        },
      ],
    });
    await api.assignQualityStandardToWorkspace(IDS.workspace, {
      quality_standard_id: IDS.methodology,
    });
    await api.updateQualityStandard(IDS.methodology, {
      name: 'Customer Support — Return Intake 2',
      judge_model: IDS.model,
      rubric: 'rubric v2',
      anchors: [
        {
          input: 'question2',
          response: 'response2',
          reference: 'reference2',
          score: 5,
          reasoning: 'reasoning2',
        },
      ],
    });
    await api.getWorkspaceQualityStandard(IDS.workspace);
    await api.getQualityStandard(IDS.methodology);

    const createCall = fetchMock.mock.calls[0] as [URL, RequestInit];
    const associateCall = fetchMock.mock.calls[1] as [URL, RequestInit];
    const updateCall = fetchMock.mock.calls[2] as [URL, RequestInit];
    const getWorkspaceCall = fetchMock.mock.calls[3] as [URL, RequestInit];
    const getCall = fetchMock.mock.calls[4] as [URL, RequestInit];

    expect(createCall[0].pathname).toBe('/api/v1/quality-standards');
    expect(createCall[1].method).toBe('POST');
    expect(JSON.parse(createCall[1].body as string)).toEqual({
      name: 'Customer Support — Return Intake 1',
      judge_model: IDS.model,
      rubric: 'rubric',
      anchors: [
        {
          input: 'question',
          response: 'response',
          reference: 'reference',
          score: 5,
          reasoning: 'reasoning',
        },
      ],
    });

    expect(associateCall[0].pathname).toBe(`/api/v1/quality-standards/workspaces/${IDS.workspace}`);
    expect(associateCall[1].method).toBe('PUT');
    expect(JSON.parse(associateCall[1].body as string)).toEqual({
      quality_standard_id: IDS.methodology,
    });

    expect(updateCall[0].pathname).toBe(`/api/v1/quality-standards/${IDS.methodology}`);
    expect(updateCall[1].method).toBe('PATCH');
    expect(JSON.parse(updateCall[1].body as string)).toEqual({
      name: 'Customer Support — Return Intake 2',
      judge_model: IDS.model,
      rubric: 'rubric v2',
      anchors: [
        {
          input: 'question2',
          response: 'response2',
          reference: 'reference2',
          score: 5,
          reasoning: 'reasoning2',
        },
      ],
    });

    expect(getWorkspaceCall[0].pathname).toBe(
      `/api/v1/quality-standards/workspaces/${IDS.workspace}`,
    );
    expect(getWorkspaceCall[1].method).toBe('GET');

    expect(getCall[0].pathname).toBe(`/api/v1/quality-standards/${IDS.methodology}`);
    expect(getCall[1].method).toBe('GET');
  });

  it('accepts null workspace quality-standard payload as an unassigned state', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(null));
    const api = apiWith(fetchMock);

    await expect(api.getWorkspaceQualityStandard(IDS.workspace)).resolves.toBeNull();

    const call = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(call[0].pathname).toBe(`/api/v1/quality-standards/workspaces/${IDS.workspace}`);
    expect(call[1].method).toBe('GET');
  });

  it('updates evaluation title, updates evaltool title, syncs list, and fetches sorted list', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(
        jsonResponse({ items: [], total: 0, page: 1, size: 50, total_pages: 0 }),
      );
    const api = apiWith(fetchMock);

    await api.patchEvaluationTitle(IDS.evaluation, {
      name: 'Untitled123',
      user_sys_id: 'USR-3B98B101F7D2',
      description: '',
    });
    await api.putEvaltoolTitle(IDS.workspace, IDS.evaluation, { eval_name: 'Untitled123' });
    await api.syncEvalsList({ workspaceId: IDS.workspace, limit: 25, offset: 0 });
    await api.listEvaluationsSorted(IDS.workspace, {
      page: 1,
      size: 50,
      sortBy: 'created_at',
      sortOrder: 'desc',
    });

    const patchCall = fetchMock.mock.calls[0] as [URL, RequestInit];
    const putCall = fetchMock.mock.calls[1] as [URL, RequestInit];
    const syncCall = fetchMock.mock.calls[2] as [URL, RequestInit];
    const listCall = fetchMock.mock.calls[3] as [URL, RequestInit];

    expect(patchCall[1].method).toBe('PATCH');
    expect(patchCall[0].pathname).toBe(`/api/v1/evaluations/${IDS.evaluation}`);
    expect(JSON.parse(patchCall[1].body as string)).toEqual({
      name: 'Untitled123',
      user_sys_id: 'USR-3B98B101F7D2',
      description: '',
    });

    expect(putCall[1].method).toBe('PUT');
    expect(putCall[0].pathname).toBe(`/api/v1/evaltools/${IDS.workspace}`);
    expect(putCall[0].searchParams).toEqual(new URLSearchParams({ evaltool_id: IDS.evaluation }));
    expect(JSON.parse(putCall[1].body as string)).toEqual({ eval_name: 'Untitled123' });

    expect(syncCall[1].method).toBe('POST');
    expect(syncCall[0].pathname).toBe('/api/v1/evaltools/sync_evals_list');
    expect(JSON.parse(syncCall[1].body as string)).toEqual({
      limit: 25,
      offset: 0,
      workspace_id: IDS.workspace,
    });

    expect(listCall[1].method).toBe('GET');
    expect(listCall[0].pathname).toBe('/api/v1/evaltools');
    expect(listCall[0].searchParams).toEqual(
      new URLSearchParams({
        page: '1',
        size: '50',
        sort_by: 'created_at',
        sort_order: 'desc',
        workspace_id: IDS.workspace,
      }),
    );
  });

  it('submits one run with the approved body and idempotency header', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        runId: IDS.run,
        status: 'PENDING',
        using: { methodologyVersionId: IDS.methodology, configVersionId: IDS.config },
      }),
    );
    await apiWith(fetchMock).createRun({
      evaluationId: IDS.evaluation,
      configVersionId: IDS.config,
      idempotencyKey: IDS.run,
    });

    const { url, init } = requestDetails(fetchMock);
    expect(url.pathname).toBe(`/api/v1/evaluations/${IDS.evaluation}/runs`);
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('idempotency-key')).toBe(IDS.run);
    expect(typeof init.body).toBe('string');
    expect(JSON.parse(init.body as string)).toEqual({
      selector: { configVersionId: IDS.config },
    });
  });

  it('never retries POST automatically and preserves upstream error codes', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ code: 'UPSTREAM_BUSY', message: 'Try later' }, 503));

    await expect(
      apiWith(fetchMock).createRun({
        evaluationId: IDS.evaluation,
        configVersionId: IDS.config,
        idempotencyKey: IDS.run,
      }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_BUSY', status: 503 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('rejects oversized and identifier-mismatched API responses', async () => {
    const oversizedFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('x'.repeat(101), {
        status: 200,
        headers: { 'content-length': '101' },
      }),
    );
    const smallClient = new AutoevalApiClient(
      new ApiClient({
        baseUrl: new URL('https://api.example.test/'),
        apiKey: VALID_KEY,
        requestTimeoutMs: 1_000,
        maxResponseBytes: 100,
        fetchImplementation: oversizedFetch,
        maxGetAttempts: 1,
      }),
    );
    await expect(smallClient.getCurrentUser()).rejects.toMatchObject({
      code: 'RESPONSE_TOO_LARGE',
    });

    const mismatchedFetch = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        run_id: IDS.workspace,
        evaluation_id: IDS.evaluation,
        evaluationState: 'COMPLETED',
      }),
    );
    await expect(
      apiWith(mismatchedFetch).getRunStatus(IDS.evaluation, IDS.run),
    ).rejects.toMatchObject({
      code: 'MISMATCHED_RUN_ID',
    });
  });

  it('requires a configured Autoeval API origin', () => {
    expect(() => loadConfiguration({})).toThrow(
      'AUTOEVAL_API_BASE_URL is not defined. Set it to the Autoeval API origin to continue.',
    );
    expect(() => loadConfiguration({ AUTOEVAL_API_BASE_URL: '   ' })).toThrow(
      'AUTOEVAL_API_BASE_URL is not defined. Set it to the Autoeval API origin to continue.',
    );
  });

  it('rejects insecure and non-origin Autoeval API base URLs', () => {
    expect(() => parseApiBaseUrl('http://api.example.test')).toThrow('HTTPS');
    expect(() => parseApiBaseUrl('https://api.example.test/path')).toThrow('origin');
    expect(parseApiBaseUrl('http://localhost:8000').origin).toBe('http://localhost:8000');
  });
});
