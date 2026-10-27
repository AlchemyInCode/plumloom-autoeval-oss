import type { CallToolResult, McpServer, ToolAnnotations } from '@modelcontextprotocol/server';
import { z } from 'zod';

import {
  submitConfiguredEvaluation,
  validateConfiguredEvaluation,
} from '../actions/configured-runs.js';
import {
  createEvaluation,
  getEvaluation,
  listEvaluations,
  updateEvaluationTitleAndRefreshList,
} from '../actions/evaluations.js';
import { whoAmI } from '../actions/identity.js';
import { getModels } from '../actions/models.js';
import {
  assignQualityStandardToWorkspace,
  createQualityStandard,
  getQualityStandard,
} from '../actions/quality-standards.js';
import { executeImport } from '../actions/imports.js';
import { getResults } from '../actions/results.js';
import { getRunStatus, submitEvaluation } from '../actions/runs.js';
import { createWorkspace, listWorkspaces } from '../actions/workspaces.js';
import { redactText, redactUnknown } from '../auth/redact.js';
import { parseConfiguredRunInput } from '../configured-run/validation.js';
import { asAutoevalError } from '../errors/autoeval-error.js';
import type { AutoevalMcpContext } from './context.js';
import {
  assignQualityStandardInputSchema,
  createEvaluationInputSchema,
  createWorkspaceInputSchema,
  emptyInputSchema,
  evaluationInputSchema,
  importConnectInputSchema,
  importEvaluationDetailInputSchema,
  importEvaluationsInputSchema,
  importRemoveEvaluationInputSchema,
  importReviewInputSchema,
  importWorkspaceEvaluationsInputSchema,
  importWorkspaceIdInputSchema,
  listEvaluationsInputSchema,
  listWorkspacesInputSchema,
  mcpToolOutputSchema,
  qualityStandardIdInputSchema,
  qualityStandardInputSchema,
  runConfiguredEvaluationInputSchema,
  runInputSchema,
  runReferenceInputSchema,
  updateEvaluationTitleInputSchema,
  validateConfiguredEvaluationInputSchema,
} from './schemas.js';

export type McpToolAccess = 'readOnly' | 'stateChanging';

export type AutoevalMcpActions = {
  whoAmI: typeof whoAmI;
  listWorkspaces: typeof listWorkspaces;
  createWorkspace: typeof createWorkspace;
  listEvaluations: typeof listEvaluations;
  createEvaluation: typeof createEvaluation;
  getEvaluation: typeof getEvaluation;
  updateEvaluationTitle: typeof updateEvaluationTitleAndRefreshList;
  getModels: typeof getModels;
  createQualityStandard: typeof createQualityStandard;
  getQualityStandard: typeof getQualityStandard;
  assignQualityStandard: typeof assignQualityStandardToWorkspace;
  validateConfiguredEvaluation: typeof validateConfiguredEvaluation;
  submitConfiguredEvaluation: typeof submitConfiguredEvaluation;
  submitEvaluation: typeof submitEvaluation;
  getRunStatus: typeof getRunStatus;
  getResults: typeof getResults;
  executeImport: typeof executeImport;
};

export const sharedAutoevalActions: AutoevalMcpActions = {
  whoAmI,
  listWorkspaces,
  createWorkspace,
  listEvaluations,
  createEvaluation,
  getEvaluation,
  updateEvaluationTitle: updateEvaluationTitleAndRefreshList,
  getModels,
  createQualityStandard,
  getQualityStandard,
  assignQualityStandard: assignQualityStandardToWorkspace,
  validateConfiguredEvaluation,
  submitConfiguredEvaluation,
  submitEvaluation,
  getRunStatus,
  getResults,
  executeImport,
};

export type AutoevalMcpTool = {
  name: string;
  title: string;
  description: string;
  access: McpToolAccess;
  inputSchema: z.ZodType;
  invoke(input: unknown): Promise<CallToolResult>;
};

type ToolDefinitionInput<Schema extends z.ZodType> = {
  name: string;
  title: string;
  description: string;
  access: McpToolAccess;
  inputSchema: Schema;
  execute(input: z.output<Schema>): Promise<unknown>;
};

function successResult(data: unknown): CallToolResult {
  const safeData = z.json().parse(redactUnknown(data));
  const payload = mcpToolOutputSchema.parse({
    ok: true,
    data: safeData,
  });

  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function failureResult(error: unknown): CallToolResult {
  if (error instanceof z.ZodError) {
    const payload = mcpToolOutputSchema.parse({
      ok: false,
      error: {
        kind: 'usage',
        code: 'INVALID_TOOL_ARGUMENTS',
        message: 'Tool arguments are invalid.',
      },
    });
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  }

  const normalized = asAutoevalError(error);
  const payload = mcpToolOutputSchema.parse({
    ok: false,
    error: {
      kind: normalized.kind,
      code: redactText(normalized.code ?? 'AUTOEVAL_ERROR'),
      message: redactText(normalized.message),
    },
  });
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function defineTool<Schema extends z.ZodType>(
  definition: ToolDefinitionInput<Schema>,
): AutoevalMcpTool {
  return {
    name: definition.name,
    title: definition.title,
    description: definition.description,
    access: definition.access,
    inputSchema: definition.inputSchema,
    invoke: async (untrustedInput) => {
      try {
        const input = definition.inputSchema.parse(untrustedInput);
        return successResult(await definition.execute(input));
      } catch (error) {
        return failureResult(error);
      }
    },
  };
}

function actionSignal(context: AutoevalMcpContext): { signal?: AbortSignal } {
  return context.signal ? { signal: context.signal } : {};
}

export function createAutoevalMcpTools(
  context: AutoevalMcpContext,
  actions: AutoevalMcpActions = sharedAutoevalActions,
): AutoevalMcpTool[] {
  return [
    defineTool({
      name: 'get_current_user',
      title: 'Get current user',
      description: 'Returns the identity associated with the configured Plumloom CLI key.',
      access: 'readOnly',
      inputSchema: emptyInputSchema,
      execute: () => actions.whoAmI(context.actions, context.signal),
    }),
    defineTool({
      name: 'list_workspaces',
      title: 'List workspaces',
      description: 'Lists workspaces accessible to the authenticated account.',
      access: 'readOnly',
      inputSchema: listWorkspacesInputSchema,
      execute: (input) =>
        actions.listWorkspaces(
          context.actions,
          {
            ...(input.page !== undefined ? { page: input.page } : {}),
            ...(input.size !== undefined ? { size: input.size } : {}),
          },
          context.signal,
        ),
    }),
    defineTool({
      name: 'create_workspace',
      title: 'Create workspace',
      description: 'Creates a workspace. This changes account state.',
      access: 'stateChanging',
      inputSchema: createWorkspaceInputSchema,
      execute: (input) =>
        actions.createWorkspace(
          context.actions,
          {
            name: input.name,
            ...(input.description !== undefined ? { description: input.description } : {}),
          },
          context.signal,
        ),
    }),
    defineTool({
      name: 'list_evaluations',
      title: 'List evaluations',
      description: 'Lists evaluations in the workspace identified by workspaceId.',
      access: 'readOnly',
      inputSchema: listEvaluationsInputSchema,
      execute: (input) =>
        actions.listEvaluations(
          context.actions,
          {
            workspaceId: input.workspaceId,
            ...(input.page !== undefined ? { page: input.page } : {}),
            ...(input.size !== undefined ? { size: input.size } : {}),
          },
          context.signal,
        ),
    }),
    defineTool({
      name: 'create_evaluation',
      title: 'Create evaluation',
      description: 'Creates an evaluation draft in workspaceId. This changes account state.',
      access: 'stateChanging',
      inputSchema: createEvaluationInputSchema,
      execute: (input) =>
        actions.createEvaluation(
          context.actions,
          {
            workspaceId: input.workspaceId,
            ...(input.evaluationName !== undefined ? { evaluationName: input.evaluationName } : {}),
          },
          context.signal,
        ),
    }),
    defineTool({
      name: 'get_evaluation',
      title: 'Get evaluation',
      description: 'Returns the current configured version of evaluationId.',
      access: 'readOnly',
      inputSchema: evaluationInputSchema,
      execute: ({ evaluationId }) =>
        actions.getEvaluation(context.actions, evaluationId, undefined, context.signal),
    }),
    defineTool({
      name: 'update_evaluation_title',
      title: 'Update evaluation title',
      description:
        'Updates evaluationId in workspaceId and refreshes its workspace listing. This changes account state.',
      access: 'stateChanging',
      inputSchema: updateEvaluationTitleInputSchema,
      execute: (input) =>
        actions.updateEvaluationTitle(
          context.actions,
          {
            workspaceId: input.workspaceId,
            evaluationId: input.evaluationId,
            evaluationName: input.evaluationName,
            userSystemId: input.userSystemId,
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.page !== undefined ? { page: input.page } : {}),
            ...(input.size !== undefined ? { size: input.size } : {}),
          },
          context.signal,
        ),
    }),
    defineTool({
      name: 'list_models',
      title: 'List enabled models',
      description: 'Lists evaluation models enabled for the authenticated account.',
      access: 'readOnly',
      inputSchema: emptyInputSchema,
      execute: () => actions.getModels(context.actions, context.signal),
    }),
    defineTool({
      name: 'create_quality_standard',
      title: 'Create quality standard',
      description:
        'Creates a quality standard from a rubric and scored anchors. This changes state.',
      access: 'stateChanging',
      inputSchema: qualityStandardInputSchema,
      execute: (input) => actions.createQualityStandard(context.actions, input, context.signal),
    }),
    defineTool({
      name: 'get_quality_standard',
      title: 'Get quality standard',
      description: 'Returns the quality standard identified by qualityStandardId.',
      access: 'readOnly',
      inputSchema: qualityStandardIdInputSchema,
      execute: ({ qualityStandardId }) =>
        actions.getQualityStandard(context.actions, qualityStandardId, context.signal),
    }),
    defineTool({
      name: 'assign_quality_standard',
      title: 'Assign quality standard',
      description:
        'Associates qualityStandardId with workspaceId. This changes the workspace configuration.',
      access: 'stateChanging',
      inputSchema: assignQualityStandardInputSchema,
      execute: (input) => actions.assignQualityStandard(context.actions, input, context.signal),
    }),
    defineTool({
      name: 'validate_configured_evaluation',
      title: 'Validate configured evaluation',
      description:
        'Validates scenario, conversation, or agent-trace input against account-enabled models without creating versions or a run.',
      access: 'readOnly',
      inputSchema: validateConfiguredEvaluationInputSchema,
      execute: ({ input }) =>
        actions.validateConfiguredEvaluation(
          context.actions,
          parseConfiguredRunInput(input),
          context.signal,
        ),
    }),
    defineTool({
      name: 'run_configured_evaluation',
      title: 'Configure and run evaluation',
      description:
        'Validates input, creates methodology and configuration versions for evaluationId, submits one evaluation run, and returns its identifiers and initial status without waiting for completion. Poll with get_run_status, then call get_results. This changes state and may incur evaluation usage.',
      access: 'stateChanging',
      inputSchema: runConfiguredEvaluationInputSchema,
      execute: ({ evaluationId, input }) =>
        actions.submitConfiguredEvaluation(context.actions, {
          evaluationId,
          configuredRun: parseConfiguredRunInput(input),
          ...actionSignal(context),
        }),
    }),
    defineTool({
      name: 'run_evaluation',
      title: 'Run configured evaluation',
      description:
        'Submits a run for the current saved configuration of evaluationId and returns its identifiers and initial status without waiting for completion. Poll with get_run_status, then call get_results. This changes state and may incur evaluation usage.',
      access: 'stateChanging',
      inputSchema: runInputSchema,
      execute: ({ evaluationId }) =>
        actions.submitEvaluation(context.actions, {
          evaluationId,
          ...actionSignal(context),
        }),
    }),
    defineTool({
      name: 'get_run_status',
      title: 'Get run status',
      description: 'Returns the current status of runId for evaluationId.',
      access: 'readOnly',
      inputSchema: runReferenceInputSchema,
      execute: (input) => actions.getRunStatus(context.actions, input, context.signal),
    }),
    defineTool({
      name: 'get_results',
      title: 'Get evaluation results',
      description:
        'Returns context-specific results for runId and evaluationId, waiting briefly when result readers are not ready.',
      access: 'readOnly',
      inputSchema: runReferenceInputSchema,
      execute: ({ evaluationId, runId }) =>
        actions.getResults(context.actions, {
          evaluationId,
          runId,
          clock: context.clock,
          resultReadyIntervalMs: context.configuration.resultReadyIntervalMs,
          resultReadyTimeoutMs: context.configuration.resultReadyTimeoutMs,
          ...actionSignal(context),
        }),
    }),
    defineTool({
      name: 'import_status',
      title: 'Get external import status',
      description:
        'Checks server-side external provider key presence, access readiness, and discovery cache status.',
      access: 'readOnly',
      inputSchema: emptyInputSchema,
      execute: () =>
        actions.executeImport(context.actions, { operation: 'status' }, actionSignal(context)),
    }),
    defineTool({
      name: 'import_connect',
      title: 'Connect external import',
      description:
        'Validates external provider access, discovers evaluations, and updates the discovery cache. This changes cache state.',
      access: 'stateChanging',
      inputSchema: importConnectInputSchema,
      execute: ({ refresh }) =>
        actions.executeImport(
          context.actions,
          { operation: 'connect', refresh },
          actionSignal(context),
        ),
    }),
    defineTool({
      name: 'import_disconnect',
      title: 'Disconnect external import',
      description:
        'Clears the external evaluation discovery cache without deleting the configured provider key or imported evaluations. This changes cache state.',
      access: 'stateChanging',
      inputSchema: emptyInputSchema,
      execute: () =>
        actions.executeImport(context.actions, { operation: 'disconnect' }, actionSignal(context)),
    }),
    defineTool({
      name: 'import_review',
      title: 'Review external evaluations',
      description:
        'Returns cached discoverable evaluations from the external provider without importing them.',
      access: 'readOnly',
      inputSchema: importReviewInputSchema,
      execute: (input) =>
        actions.executeImport(
          context.actions,
          {
            operation: 'review',
            all: input.all,
            ...(input.page !== undefined ? { page: input.page } : {}),
            ...(input.size !== undefined ? { size: input.size } : {}),
            ...(input.search !== undefined ? { search: input.search } : {}),
          },
          actionSignal(context),
        ),
    }),
    defineTool({
      name: 'import_run',
      title: 'Import evaluations',
      description:
        'Imports specified external evaluation IDs or all new unimported evaluations into the import workspace in batches. This changes state.',
      access: 'stateChanging',
      inputSchema: importEvaluationsInputSchema,

      execute: (input) =>
        actions.executeImport(
          context.actions,
          {
            operation: 'run',
            allNew: input.all_new ?? false,
            ...(input.eval_ids !== undefined ? { evalIds: input.eval_ids } : {}),
          },
          actionSignal(context),
        ),
    }),
    defineTool({
      name: 'import_list_workspaces',
      title: 'List import workspaces',
      description: 'Lists workspaces dedicated to imported external evaluations and their counts.',
      access: 'readOnly',
      inputSchema: emptyInputSchema,
      execute: () =>
        actions.executeImport(context.actions, { operation: 'list' }, actionSignal(context)),
    }),
    defineTool({
      name: 'import_list_evals',
      title: 'List evaluations in import workspace',
      description:
        'Lists evaluations already imported into workspaceId with source and internal identifiers.',
      access: 'readOnly',
      inputSchema: importWorkspaceEvaluationsInputSchema,
      execute: (input) => {
        const workspaceId = input.workspace_id;
        return actions.executeImport(
          context.actions,
          {
            operation: 'evals',
            workspaceId,
            ...(input.page !== undefined ? { page: input.page } : {}),
            ...(input.size !== undefined ? { size: input.size } : {}),
            ...(input.search !== undefined ? { search: input.search } : {}),
          },
          actionSignal(context),
        );
      },
    }),
    defineTool({
      name: 'import_show_eval',
      title: 'Get imported evaluation detail',
      description:
        'Returns detail, graders, run history, and test results for an imported evaluationId.',
      access: 'readOnly',
      inputSchema: importEvaluationDetailInputSchema,
      execute: (input) => {
        const evaluationId = input.eval_id;
        const run = input.run_id;
        return actions.executeImport(
          context.actions,
          {
            operation: 'show',
            evaluationId,
            ...(run !== undefined ? { run } : {}),
            ...(input.page !== undefined ? { page: input.page } : {}),
            ...(input.size !== undefined ? { size: input.size } : {}),
          },
          actionSignal(context),
        );
      },
    }),
    defineTool({
      name: 'import_insights',
      title: 'Get import workspace insights',
      description:
        'Returns migration readiness, totals, pass-rate trends, and grader reliability insights for workspaceId.',
      access: 'readOnly',
      inputSchema: importWorkspaceIdInputSchema,
      execute: (input) => {
        const workspaceId = input.workspace_id;
        return actions.executeImport(
          context.actions,
          { operation: 'insights', workspaceId },
          actionSignal(context),
        );
      },
    }),
    defineTool({
      name: 'import_remove_eval',
      title: 'Remove imported evaluation',
      description:
        'Deletes the imported evaluation and its runs from the local workspace. Requires explicit confirmation (yes: true). This changes state.',
      access: 'stateChanging',
      inputSchema: importRemoveEvaluationInputSchema,
      execute: (input) => {
        const evaluationId = input.eval_id;
        return actions.executeImport(
          context.actions,
          { operation: 'remove', evaluationId, yes: input.yes },
          actionSignal(context),
        );
      },
    }),
  ];
}

function toolAnnotations(tool: Pick<AutoevalMcpTool, 'access' | 'name'>): ToolAnnotations {
  const isReadOnly = tool.access === 'readOnly';
  const isDestructive = tool.name === 'import_remove_eval';
  const isIdempotent = isReadOnly || tool.name === 'import_disconnect';

  return {
    readOnlyHint: isReadOnly,
    destructiveHint: isDestructive,
    idempotentHint: isIdempotent,
    openWorldHint: true,
  };
}

export function registerAutoevalMcpTools(
  server: McpServer,
  tools: readonly AutoevalMcpTool[],
): void {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: mcpToolOutputSchema,
        annotations: toolAnnotations(tool),
      },
      (input) => tool.invoke(input),
    );
  }
}
