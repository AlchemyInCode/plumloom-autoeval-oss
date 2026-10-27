import { readFile, readdir } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import { AutoevalError } from '../src/errors/autoeval-error.js';
import type { ImportCommand } from '../src/actions/imports.js';
import type { AutoevalMcpContext } from '../src/mcp/context.js';
import { mcpToolOutputSchema } from '../src/mcp/schemas.js';
import { createAutoevalMcpServer } from '../src/mcp/server.js';
import {
  type AutoevalMcpActions,
  type AutoevalMcpTool,
  createAutoevalMcpTools,
  sharedAutoevalActions,
} from '../src/mcp/tools.js';
import { loadConfiguration } from '../src/config.js';
import type { SupportedModel } from '../src/domain/types.js';
import { createApi, FakeClock, IDS, versionResponse } from './helpers.js';

const JUDGE_MODEL_ID = '11111111-1111-4111-8111-111111111111';
const PRIMARY_MODEL_ID = '22222222-2222-4222-8222-222222222222';

function model(id: string, displayName: string): SupportedModel {
  return {
    id,
    provider: 'example',
    displayName,
    apiModelId: displayName.toLowerCase(),
    isDeprecated: false,
    isLocked: false,
  };
}

function mcpContext(api = createApi(), contextTypeSignal?: AbortSignal): AutoevalMcpContext {
  return {
    actions: { api },
    configuration: loadConfiguration(),
    clock: new FakeClock(),
    ...(contextTypeSignal ? { signal: contextTypeSignal } : {}),
  };
}

function actions(overrides: Partial<AutoevalMcpActions> = {}): AutoevalMcpActions {
  return { ...sharedAutoevalActions, ...overrides };
}

function toolByName(tools: readonly AutoevalMcpTool[], name: string): AutoevalMcpTool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing MCP tool ${name}`);
  return tool;
}

function outputOf(result: Awaited<ReturnType<AutoevalMcpTool['invoke']>>) {
  return mcpToolOutputSchema.parse(result.structuredContent);
}

function conversationInput(runsPerScenario?: number): unknown {
  return {
    methodology: {
      userSystemId: 'USR-REPLACE-ME',
      judgeModel: 'Example judge',
      judgeModelId: JUDGE_MODEL_ID,
      ...(runsPerScenario === undefined ? {} : { runsPerScenario }),
      evaluatorInstructions: 'Evaluate the frozen conversation.',
    },
    configuration: {
      contextName: 'Example conversation',
      contextType: 'conversation',
      artifact: { messages: [{ role: 'user', content: 'Hello' }] },
      expected: 'A helpful reply',
      selectedMetrics: ['helpfulness'],
    },
  };
}

function agentTraceInput(runsPerScenario?: number): unknown {
  return {
    methodology: {
      userSystemId: 'USR-REPLACE-ME',
      judgeModel: 'Example judge',
      judgeModelId: JUDGE_MODEL_ID,
      ...(runsPerScenario === undefined ? {} : { runsPerScenario }),
      evaluatorInstructions: 'Evaluate the frozen trajectory.',
    },
    configuration: {
      contextName: 'Example agent trace',
      contextType: 'agent_trace',
      artifact: { trace: { resourceSpans: [{ resource: {}, scopeSpans: [] }] } },
      expected: 'A grounded trajectory',
      selectedMetrics: ['factuality'],
    },
  };
}

describe('Autoeval MCP tools', () => {
  it('registers the intended action-backed inventory and classifies writes', () => {
    const tools = createAutoevalMcpTools(mcpContext());

    expect(tools.map((tool) => tool.name)).toEqual([
      'get_current_user',
      'list_workspaces',
      'create_workspace',
      'list_evaluations',
      'create_evaluation',
      'get_evaluation',
      'update_evaluation_title',
      'list_models',
      'create_quality_standard',
      'get_quality_standard',
      'assign_quality_standard',
      'validate_configured_evaluation',
      'run_configured_evaluation',
      'run_evaluation',
      'get_run_status',
      'get_results',
      'import_status',
      'import_connect',
      'import_disconnect',
      'import_review',
      'import_run',
      'import_list_workspaces',
      'import_list_evals',
      'import_show_eval',
      'import_insights',
      'import_remove_eval',
    ]);
    expect(
      tools.filter((tool) => tool.access === 'stateChanging').map((tool) => tool.name),
    ).toEqual([
      'create_workspace',
      'create_evaluation',
      'update_evaluation_title',
      'create_quality_standard',
      'assign_quality_standard',
      'run_configured_evaluation',
      'run_evaluation',
      'import_connect',
      'import_disconnect',
      'import_run',
      'import_remove_eval',
    ]);
  });

  it('calls an injected shared action and returns structured data', async () => {
    const listWorkspaces = vi.fn<AutoevalMcpActions['listWorkspaces']>().mockResolvedValue({
      items: [],
      total: 0,
      page: 2,
      size: 25,
      totalPages: 0,
    });
    const context = mcpContext();
    const tool = toolByName(
      createAutoevalMcpTools(context, actions({ listWorkspaces })),
      'list_workspaces',
    );

    const result = await tool.invoke({ page: 2, size: 25 });

    expect(listWorkspaces).toHaveBeenCalledWith(context.actions, { page: 2, size: 25 }, undefined);
    expect(outputOf(result)).toEqual({
      ok: true,
      data: { items: [], total: 0, page: 2, size: 25, totalPages: 0 },
    });
    expect(result.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify({
          ok: true,
          data: { items: [], total: 0, page: 2, size: 25, totalPages: 0 },
        }),
      },
    ]);
  });

  it('advertises concrete JSON schemas and rejects invalid UUID arguments', async () => {
    const getRunStatus = vi.fn<AutoevalMcpActions['getRunStatus']>();
    const context = mcpContext();
    const tools = createAutoevalMcpTools(context, actions({ getRunStatus }));
    const server = createAutoevalMcpServer(context, actions({ getRunStatus }));

    expect(server.toolInputSchemaJson('get_run_status')).toMatchObject({
      type: 'object',
      required: ['evaluationId', 'runId'],
      additionalProperties: false,
    });

    const result = await toolByName(tools, 'get_run_status').invoke({
      evaluationId: 'not-a-uuid',
      runId: IDS.run,
    });
    expect(result.isError).toBe(true);
    expect(outputOf(result)).toEqual({
      ok: false,
      error: {
        kind: 'usage',
        code: 'INVALID_TOOL_ARGUMENTS',
        message: 'Tool arguments are invalid.',
      },
    });
    expect(getRunStatus).not.toHaveBeenCalled();
  });

  it('sanitizes action failures and never surfaces CLI keys', async () => {
    const secret = 'pl_sk_syntheticSecret12345';
    const getModels = vi.fn<AutoevalMcpActions['getModels']>().mockRejectedValue(
      new AutoevalError(`Upstream rejected ${secret}`, {
        kind: 'authentication',
        code: 'AUTHENTICATION_FAILED',
      }),
    );
    const result = await toolByName(
      createAutoevalMcpTools(mcpContext(), actions({ getModels })),
      'list_models',
    ).invoke({});

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(outputOf(result)).toEqual({
      ok: false,
      error: {
        kind: 'authentication',
        code: 'AUTHENTICATION_FAILED',
        message: 'Upstream rejected pl_sk_[REDACTED]',
      },
    });
  });

  it('redacts untrusted machine-readable action error codes', async () => {
    const secret = 'pl_sk_syntheticCodeSecret12345';
    const getModels = vi.fn<AutoevalMcpActions['getModels']>().mockRejectedValue(
      new AutoevalError('The request failed.', {
        kind: 'upstream',
        code: `UPSTREAM_${secret}`,
      }),
    );
    const result = await toolByName(
      createAutoevalMcpTools(mcpContext(), actions({ getModels })),
      'list_models',
    ).invoke({});

    expect(JSON.stringify(result)).not.toContain(secret);
    expect(outputOf(result)).toEqual({
      ok: false,
      error: {
        kind: 'upstream',
        code: 'UPSTREAM_pl_sk_[REDACTED]',
        message: 'The request failed.',
      },
    });
  });

  it('redacts sensitive fields in successful action data', async () => {
    const getQualityStandard = vi
      .fn<AutoevalMcpActions['getQualityStandard']>()
      .mockResolvedValue({ authorization: 'Bearer secret-value', name: 'Synthetic standard' });
    const result = await toolByName(
      createAutoevalMcpTools(mcpContext(), actions({ getQualityStandard })),
      'get_quality_standard',
    ).invoke({ qualityStandardId: IDS.methodology });

    expect(outputOf(result)).toEqual({
      ok: true,
      data: { authorization: '[REDACTED]', name: 'Synthetic standard' },
    });
  });

  it('uses the existing configured-run validation for scenario input', async () => {
    const parsed = JSON.parse(
      await readFile(
        new URL('../../../examples/evals/scenario-basic.json', import.meta.url),
        'utf8',
      ),
    ) as unknown;
    const api = createApi({
      getModels: vi.fn(() =>
        Promise.resolve([
          model(JUDGE_MODEL_ID, 'Example judge'),
          model(PRIMARY_MODEL_ID, 'Example primary'),
        ]),
      ),
    });
    const result = await toolByName(
      createAutoevalMcpTools(mcpContext(api)),
      'validate_configured_evaluation',
    ).invoke({ input: parsed });

    expect(outputOf(result)).toMatchObject({
      ok: true,
      data: {
        valid: true,
        contextType: 'scenario',
        artifactCount: 1,
      },
    });
  });

  it('submits a configured evaluation without polling for terminal completion', async () => {
    const getRunStatus = vi.fn(() => Promise.reject(new Error('MCP must not poll')));
    const startRunStatusStream = vi.fn(() => Promise.resolve());
    const api = createApi({
      getModels: vi.fn(() => Promise.resolve([model(JUDGE_MODEL_ID, 'Example judge')])),
      createMethodologyVersion: vi.fn(() =>
        Promise.resolve({ methodology_version_id: IDS.methodology }),
      ),
      createConfigVersion: vi.fn(() => Promise.resolve({ config_version_id: IDS.config })),
      createRun: vi.fn(() =>
        Promise.resolve({
          runId: IDS.run,
          status: 'PENDING',
          using: {
            methodologyVersionId: IDS.methodology,
            configVersionId: IDS.config,
          },
        }),
      ),
      startRunStatusStream,
      getRunStatus,
    });

    const result = await toolByName(
      createAutoevalMcpTools(mcpContext(api)),
      'run_configured_evaluation',
    ).invoke({ evaluationId: IDS.evaluation, input: conversationInput() });

    expect(result.isError).not.toBe(true);
    expect(outputOf(result)).toEqual({
      ok: true,
      data: {
        evaluationId: IDS.evaluation,
        runId: IDS.run,
        methodologyVersionId: IDS.methodology,
        configVersionId: IDS.config,
        status: 'PENDING',
      },
    });
    expect(startRunStatusStream).not.toHaveBeenCalled();
    expect(getRunStatus).not.toHaveBeenCalled();
  });

  it('submits a saved evaluation without polling for terminal completion', async () => {
    const getRunStatus = vi.fn(() => Promise.reject(new Error('MCP must not poll')));
    const api = createApi({
      getEvaluationVersions: vi.fn(() => Promise.resolve(versionResponse())),
      createRun: vi.fn(() =>
        Promise.resolve({
          runId: IDS.run,
          status: 'PENDING',
          using: {
            methodologyVersionId: IDS.methodology,
            configVersionId: IDS.config,
          },
        }),
      ),
      getRunStatus,
    });

    const result = await toolByName(
      createAutoevalMcpTools(mcpContext(api)),
      'run_evaluation',
    ).invoke({ evaluationId: IDS.evaluation });

    expect(result.isError).not.toBe(true);
    expect(outputOf(result)).toEqual({
      ok: true,
      data: {
        evaluationId: IDS.evaluation,
        runId: IDS.run,
        methodologyVersionId: IDS.methodology,
        configVersionId: IDS.config,
        status: 'PENDING',
      },
    });
    expect(getRunStatus).not.toHaveBeenCalled();
  });

  it.each([
    ['conversation', conversationInput(2)],
    ['agent_trace', agentTraceInput(2)],
  ])('accepts but ignores legacy run counts for %s input', async (_contextType, input) => {
    const api = createApi({
      getModels: vi.fn(() => Promise.resolve([model(JUDGE_MODEL_ID, 'Example judge')])),
    });
    const result = await toolByName(
      createAutoevalMcpTools(mcpContext(api)),
      'validate_configured_evaluation',
    ).invoke({ input });

    expect(result.isError).not.toBe(true);
    expect(outputOf(result)).toMatchObject({
      ok: true,
      data: { valid: true },
    });
  });

  it('preserves session and trajectory structures in agent-trace results', async () => {
    const getResults = vi.fn<AutoevalMcpActions['getResults']>().mockResolvedValue({
      contextType: 'agent_trace',
      agentTrace: { session: { outcome: 'pass', score: 0.9 } },
      trajectory: { score: 0.8, dimensions: { toolUse: 1 } },
    });
    const result = await toolByName(
      createAutoevalMcpTools(mcpContext(), actions({ getResults })),
      'get_results',
    ).invoke({ evaluationId: IDS.evaluation, runId: IDS.run });

    expect(outputOf(result)).toEqual({
      ok: true,
      data: {
        contextType: 'agent_trace',
        agentTrace: { session: { outcome: 'pass', score: 0.9 } },
        trajectory: { score: 0.8, dimensions: { toolUse: 1 } },
      },
    });
  });

  it('keeps MCP source independent of CLI handlers, shells, providers, and evaluation services', async () => {
    const mcpDirectory = new URL('../src/mcp/', import.meta.url);
    const filenames = await readdir(mcpDirectory);
    const sources = await Promise.all(
      [
        new URL('../src/mcp.ts', import.meta.url),
        ...filenames.map((name) => new URL(name, mcpDirectory)),
      ]
        .filter((url) => url.pathname.endsWith('.ts'))
        .map((url) => readFile(url, 'utf8')),
    );
    const source = sources.join('\n');

    expect(source).not.toMatch(/\.\.\/commands\//u);
    expect(source).not.toMatch(/node:child_process|\bspawn\s*\(|\bexec(File)?\s*\(/u);
    expect(source).not.toMatch(/eval[-_ ]?engine/iu);
    expect(source).not.toMatch(/OpenAI|Anthropic|LiteLLM/iu);
  });

  it('keeps tool descriptions free of endpoint and credential details', () => {
    const descriptions = createAutoevalMcpTools(mcpContext())
      .map((tool) => tool.description)
      .join('\n');

    expect(descriptions).not.toMatch(/\/api\/|pl_sk_|authorization|evalengine/iu);
  });

  it('delegates import tools to executeImport with valid inputs and signals', async () => {
    const executeImport = vi.fn<AutoevalMcpActions['executeImport']>().mockResolvedValue({
      key_present: true,
      cache_status: 'warm',
    });
    const abortController = new AbortController();
    const context = mcpContext(createApi(), abortController.signal);
    const tools = createAutoevalMcpTools(context, actions({ executeImport }));

    const statusResult = await toolByName(tools, 'import_status').invoke({});
    expect(outputOf(statusResult)).toEqual({
      ok: true,
      data: { key_present: true, cache_status: 'warm' },
    });
    expect(executeImport).toHaveBeenCalledWith(
      context.actions,
      { operation: 'status' },
      { signal: abortController.signal },
    );

    executeImport.mockResolvedValueOnce({ total: 10 });
    const connectResult = await toolByName(tools, 'import_connect').invoke({ refresh: true });
    expect(outputOf(connectResult)).toEqual({
      ok: true,
      data: { total: 10 },
    });
    expect(executeImport).toHaveBeenCalledWith(
      context.actions,
      { operation: 'connect', refresh: true },
      { signal: abortController.signal },
    );

    executeImport.mockResolvedValueOnce({ disconnected: true });
    const disconnectResult = await toolByName(tools, 'import_disconnect').invoke({});
    expect(outputOf(disconnectResult)).toEqual({
      ok: true,
      data: { disconnected: true },
    });
    expect(executeImport).toHaveBeenCalledWith(
      context.actions,
      { operation: 'disconnect' },
      { signal: abortController.signal },
    );

    executeImport.mockResolvedValueOnce({ evals: [], total: 0, page: 1, size: 50 });
    const reviewResult = await toolByName(tools, 'import_review').invoke({
      page: 1,
      size: 50,
      search: 'classifier',
      all: false,
    });
    expect(outputOf(reviewResult)).toEqual({
      ok: true,
      data: { evals: [], total: 0, page: 1, size: 50 },
    });
    expect(executeImport).toHaveBeenCalledWith(
      context.actions,
      { operation: 'review', page: 1, size: 50, search: 'classifier', all: false },
      { signal: abortController.signal },
    );

    executeImport.mockResolvedValueOnce({ imported: ['eval_1'], skipped: [], failed: [] });
    const runResult = await toolByName(tools, 'import_run').invoke({
      eval_ids: ['eval_1'],
      all_new: false,
    });
    expect(outputOf(runResult)).toEqual({
      ok: true,
      data: { imported: ['eval_1'], skipped: [], failed: [] },
    });
    expect(executeImport).toHaveBeenCalledWith(
      context.actions,
      { operation: 'run', evalIds: ['eval_1'], allNew: false },
      { signal: abortController.signal },
    );

    executeImport.mockResolvedValueOnce([{ workspace_id: IDS.workspace }]);
    const listResult = await toolByName(tools, 'import_list_workspaces').invoke({});
    expect(outputOf(listResult)).toEqual({
      ok: true,
      data: [{ workspace_id: IDS.workspace }],
    });
    expect(executeImport).toHaveBeenCalledWith(
      context.actions,
      { operation: 'list' },
      { signal: abortController.signal },
    );

    executeImport.mockResolvedValueOnce({ items: [], total: 0, page: 1, page_size: 50 });
    const evalsResult = await toolByName(tools, 'import_list_evals').invoke({
      workspace_id: IDS.workspace,
      page: 1,
      size: 50,
    });
    expect(outputOf(evalsResult)).toEqual({
      ok: true,
      data: { items: [], total: 0, page: 1, page_size: 50 },
    });
    expect(executeImport).toHaveBeenCalledWith(
      context.actions,
      { operation: 'evals', workspaceId: IDS.workspace, page: 1, size: 50 },
      { signal: abortController.signal },
    );

    executeImport.mockResolvedValueOnce({ eval: { name: 'Eval 1' } });
    const showResult = await toolByName(tools, 'import_show_eval').invoke({
      eval_id: IDS.evaluation,
    });
    expect(outputOf(showResult)).toEqual({
      ok: true,
      data: { eval: { name: 'Eval 1' } },
    });
    expect(executeImport).toHaveBeenCalledWith(
      context.actions,
      {
        operation: 'show',
        evaluationId: IDS.evaluation,
      },
      { signal: abortController.signal },
    );

    executeImport.mockResolvedValueOnce({ derived_by: 'Plumloom' });
    const insightsResult = await toolByName(tools, 'import_insights').invoke({
      workspace_id: IDS.workspace,
    });
    expect(outputOf(insightsResult)).toEqual({
      ok: true,
      data: { derived_by: 'Plumloom' },
    });
    expect(executeImport).toHaveBeenCalledWith(
      context.actions,
      { operation: 'insights', workspaceId: IDS.workspace },
      { signal: abortController.signal },
    );

    executeImport.mockResolvedValueOnce({ deleted: true });
    const removeResult = await toolByName(tools, 'import_remove_eval').invoke({
      eval_id: IDS.evaluation,
      yes: true,
    });
    expect(outputOf(removeResult)).toEqual({
      ok: true,
      data: { deleted: true },
    });
    expect(executeImport).toHaveBeenCalledWith(
      context.actions,
      { operation: 'remove', evaluationId: IDS.evaluation, yes: true },
      { signal: abortController.signal },
    );
  });

  it('validates import tool inputs and handles execution errors', async () => {
    const executeImport = vi.fn<AutoevalMcpActions['executeImport']>().mockRejectedValue(
      new AutoevalError('Removal requires explicit confirmation (--yes).', {
        kind: 'usage',
        code: 'IMPORT_CONFIRMATION_REQUIRED',
      }),
    );
    const context = mcpContext();
    const tools = createAutoevalMcpTools(context, actions({ executeImport }));

    // Rejects invalid eval ID format in schema
    const invalidEvalIdResult = await toolByName(tools, 'import_run').invoke({
      eval_ids: ['invalid-id-without-eval-prefix'],
    });
    expect(invalidEvalIdResult.isError).toBe(true);
    expect(outputOf(invalidEvalIdResult)).toEqual({
      ok: false,
      error: {
        kind: 'usage',
        code: 'INVALID_TOOL_ARGUMENTS',
        message: 'Tool arguments are invalid.',
      },
    });

    // Rejects invalid UUID for workspaceId
    const invalidWorkspaceResult = await toolByName(tools, 'import_list_evals').invoke({
      workspace_id: 'not-a-uuid',
    });
    expect(invalidWorkspaceResult.isError).toBe(true);
    expect(outputOf(invalidWorkspaceResult)).toEqual({
      ok: false,
      error: {
        kind: 'usage',
        code: 'INVALID_TOOL_ARGUMENTS',
        message: 'Tool arguments are invalid.',
      },
    });

    // Normalizes AutoevalError from shared action
    const removeFailResult = await toolByName(tools, 'import_remove_eval').invoke({
      eval_id: IDS.evaluation,
      yes: true,
    });
    expect(removeFailResult.isError).toBe(true);
    expect(outputOf(removeFailResult)).toEqual({
      ok: false,
      error: {
        kind: 'usage',
        code: 'IMPORT_CONFIRMATION_REQUIRED',
        message: 'Removal requires explicit confirmation (--yes).',
      },
    });
    // Rejects external run IDs that are not Plumloom UUIDs
    const invalidRunIdResult = await toolByName(tools, 'import_show_eval').invoke({
      eval_id: IDS.evaluation,
      run_id: 'run_abc123',
    });

    expect(invalidRunIdResult.isError).toBe(true);
    expect(outputOf(invalidRunIdResult)).toMatchObject({
      ok: false,
      error: {
        kind: 'usage',
        code: 'INVALID_TOOL_ARGUMENTS',
      },
    });
  });

  it('exposes partial import mixed outcomes and contract in import_run without masking failures', async () => {
    const executeImport = vi.fn<AutoevalMcpActions['executeImport']>().mockResolvedValue({
      workspace_id: IDS.workspace,
      imported: ['eval_success1', 'eval_success2'],
      skipped: ['eval_already_imported'],
      failed: [
        {
          eval_id: 'eval_failed_upstream',
          reason: 'Upstream rate limit',
          error_code: 'UPSTREAM_ERROR',
        },
      ],
      eval_ids_imported: ['eval_success1', 'eval_success2'],
      batches: [
        {
          workspace_id: IDS.workspace,
          imported: ['eval_success1', 'eval_success2'],
          skipped: ['eval_already_imported'],
          failed: [
            {
              eval_id: 'eval_failed_upstream',
              reason: 'Upstream rate limit',
              error_code: 'UPSTREAM_ERROR',
            },
          ],
        },
      ],
    });

    const context = mcpContext();
    const tools = createAutoevalMcpTools(context, actions({ executeImport }));

    const runResult = await toolByName(tools, 'import_run').invoke({
      eval_ids: ['eval_success1', 'eval_success2', 'eval_already_imported', 'eval_failed_upstream'],
    });

    expect(runResult.isError).toBeUndefined();
    const output = outputOf(runResult);
    expect(output.ok).toBe(true);
    if (!output.ok) throw new Error('Expected ok');
    expect(output.data).toMatchObject({
      workspace_id: IDS.workspace,
      imported: ['eval_success1', 'eval_success2'],
      skipped: ['eval_already_imported'],
      failed: [
        {
          eval_id: 'eval_failed_upstream',
          reason: 'Upstream rate limit',
          error_code: 'UPSTREAM_ERROR',
        },
      ],
      eval_ids_imported: ['eval_success1', 'eval_success2'],
    });
  });

  it('delegates requests exceeding 25 IDs through executeImport which splits them into valid backend batches', async () => {
    const batch1Ids = Array.from({ length: 25 }, (_, i) => `eval_batch1_${i}`);
    const batch2Ids = Array.from({ length: 5 }, (_, i) => `eval_batch2_${i}`);
    const total30Ids = [...batch1Ids, ...batch2Ids];

    let capturedCommand: ImportCommand | undefined;
    const fakeApi = createApi({
      externalImport: vi
        .fn()
        .mockResolvedValueOnce({
          workspace_id: IDS.workspace,
          imported: batch1Ids,
          skipped: [],
          failed: [],
        })
        .mockResolvedValueOnce({
          workspace_id: IDS.workspace,
          imported: [],
          skipped: ['eval_batch2_0'],
          failed: [{ eval_id: 'eval_batch2_1', reason: 'Failed fetching runs' }],
        }),
    });

    const executeImport = vi
      .fn<AutoevalMcpActions['executeImport']>()
      .mockImplementation(async (_actionCtx, command, options) => {
        capturedCommand = command;
        return sharedAutoevalActions.executeImport({ api: fakeApi }, command, options);
      });

    const context = mcpContext();
    const tools = createAutoevalMcpTools(context, actions({ executeImport }));

    const runResult = await toolByName(tools, 'import_run').invoke({
      eval_ids: total30Ids,
    });

    expect(capturedCommand).toEqual({
      operation: 'run',
      allNew: false,
      evalIds: total30Ids,
    });

    expect(fakeApi.externalImport).toHaveBeenCalledTimes(2);
    expect(fakeApi.externalImport).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: 'POST',
        path: '/run',
        body: { eval_ids: batch1Ids },
      }),
    );
    expect(fakeApi.externalImport).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: 'POST',
        path: '/run',
        body: { eval_ids: batch2Ids },
      }),
    );

    const output = outputOf(runResult);
    expect(output.ok).toBe(true);
    if (!output.ok) throw new Error('Expected ok');
    expect(output.data).toMatchObject({
      workspace_id: IDS.workspace,
      imported: batch1Ids,
      skipped: ['eval_batch2_0'],
      failed: [{ eval_id: 'eval_batch2_1', reason: 'Failed fetching runs' }],
    });
  });
  it('aggregates imported IDs across batches', async () => {
    const batch1Ids = Array.from({ length: 25 }, (_, i) => `eval_batch1_${i}`);
    const batch2Ids = Array.from({ length: 5 }, (_, i) => `eval_batch2_${i}`);

    const fakeApi = createApi({
      externalImport: vi
        .fn()
        .mockResolvedValueOnce({
          workspace_id: IDS.workspace,
          imported: batch1Ids,
          skipped: [],
          failed: [],
          eval_ids_imported: batch1Ids,
        })
        .mockResolvedValueOnce({
          workspace_id: IDS.workspace,
          imported: batch2Ids.slice(0, 2),
          skipped: [batch2Ids[2]],
          failed: [
            {
              eval_id: batch2Ids[3],
              reason: 'Failed fetching runs',
              error_code: 'RUN_FETCH_FAILED',
            },
            {
              eval_id: batch2Ids[4],
              reason: 'Failed fetching output items',
              error_code: 'OUTPUT_FETCH_FAILED',
            },
          ],
          eval_ids_imported: batch2Ids.slice(0, 2),
        }),
    });

    const result = await sharedAutoevalActions.executeImport(
      { api: fakeApi },
      {
        operation: 'run',
        evalIds: [...batch1Ids, ...batch2Ids],
        allNew: false,
      },
    );

    expect(result).toMatchObject({
      workspace_id: IDS.workspace,
      imported: [...batch1Ids, ...batch2Ids.slice(0, 2)],
      skipped: [batch2Ids[2]],
      failed: [
        {
          eval_id: batch2Ids[3],
          reason: 'Failed fetching runs',
          error_code: 'RUN_FETCH_FAILED',
        },
        {
          eval_id: batch2Ids[4],
          reason: 'Failed fetching output items',
          error_code: 'OUTPUT_FETCH_FAILED',
        },
      ],
      eval_ids_imported: [...batch1Ids, ...batch2Ids.slice(0, 2)],
    });

    expect(fakeApi.externalImport).toHaveBeenCalledTimes(2);
  });

  it('rejects boundary cases like empty eval_ids or both eval_ids and all_new in MCP', async () => {
    const executeImport = vi.fn<AutoevalMcpActions['executeImport']>();
    const context = mcpContext();
    const tools = createAutoevalMcpTools(context, actions({ executeImport }));

    const emptyResult = await toolByName(tools, 'import_run').invoke({
      eval_ids: [],
    });
    expect(emptyResult.isError).toBe(true);
    expect(outputOf(emptyResult)).toEqual({
      ok: false,
      error: {
        kind: 'usage',
        code: 'INVALID_TOOL_ARGUMENTS',
        message: 'Tool arguments are invalid.',
      },
    });

    const bothResult = await toolByName(tools, 'import_run').invoke({
      eval_ids: ['eval_valid_1'],
      all_new: true,
    });
    expect(bothResult.isError).toBe(true);
    expect(outputOf(bothResult)).toEqual({
      ok: false,
      error: {
        kind: 'usage',
        code: 'INVALID_TOOL_ARGUMENTS',
        message: 'Tool arguments are invalid.',
      },
    });

    expect(executeImport).not.toHaveBeenCalled();
  });
});
