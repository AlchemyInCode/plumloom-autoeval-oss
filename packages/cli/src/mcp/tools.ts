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
  const payload = mcpToolOutputSchema.parse({
    ok: true,
    data: z.json().parse(redactUnknown(data)),
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
  ];
}

function toolAnnotations(access: McpToolAccess): ToolAnnotations {
  return access === 'readOnly'
    ? {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      }
    : {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
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
        annotations: toolAnnotations(tool.access),
      },
      (input) => tool.invoke(input),
    );
  }
}
