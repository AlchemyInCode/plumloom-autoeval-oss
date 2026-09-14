import type { JsonObject } from '../domain/common.js';
import type {
  EvaluationPage,
  EvaluationSummary,
  RunStatus,
  SupportedModel,
  UserIdentity,
  Workspace,
  WorkspacePage,
} from '../domain/types.js';
import { AutoevalError } from '../errors/autoeval-error.js';
import { apiEndpoints } from './endpoints.js';
import type { ApiClient } from './client.js';
import {
  configVersionCreateResponseSchema,
  evaluationCreateResponseSchema,
  evaluationConfigurationResponseSchema,
  evaluationDraftResponseSchema,
  evaluationPageResponseSchema,
  evaluationSummaryResponseSchema,
  evaluationVersionsResponseSchema,
  jsonObjectSchema,
  nullableJsonObjectSchema,
  methodologyVersionCreateResponseSchema,
  modelsResponseSchema,
  runCreateResponseSchema,
  runStatusResponseSchema,
  userIdentityResponseSchema,
  workspacePageResponseSchema,
  workspaceResponseSchema,
  type ConfigVersionCreateResponse,
  type EvaluationCreateResponse,
  type EvaluationConfigurationResponse,
  type EvaluationDraftResponse,
  type EvaluationVersionsResponse,
  type MethodologyVersionCreateResponse,
  type RunCreateResponse,
} from './schemas.js';

export type PageInput = {
  page?: number;
  size?: number;
};

export type CreateRunInput = {
  evaluationId: string;
  configVersionId: string;
  idempotencyKey: string;
  signal?: AbortSignal;
};

type ByokModel = {
  supported_model_id: string;
  provider_model_id: string;
  provider: string;
  display_name: string;
  is_deprecated?: boolean;
  locked?: boolean;
  model_key?: string;
};

type LegacyModel = {
  id: string;
  display_name: string;
  api_model_id: string;
  is_deprecated: boolean;
  locked: boolean;
  model_key?: string;
};

type LegacyModelsResponse = {
  providers: Record<string, { models: LegacyModel[] }>;
};

function isByokModelsResponse(value: unknown): value is { models: ByokModel[] } {
  if (typeof value !== 'object' || value === null || !('models' in value)) {
    return false;
  }
  const models = (value as { models?: unknown }).models;
  return Array.isArray(models);
}

function isLegacyModelsResponse(value: unknown): value is LegacyModelsResponse {
  if (typeof value !== 'object' || value === null || !('providers' in value)) {
    return false;
  }
  const providers = (value as { providers?: unknown }).providers;
  return typeof providers === 'object' && providers !== null;
}

export interface AutoevalApi {
  getCurrentUser(signal?: AbortSignal): Promise<UserIdentity>;
  listWorkspaces(input?: PageInput, signal?: AbortSignal): Promise<WorkspacePage>;
  createWorkspace(
    input: { name: string; description?: string },
    signal?: AbortSignal,
  ): Promise<Workspace>;
  getWorkspace(workspaceId: string, signal?: AbortSignal): Promise<Workspace>;
  listEvaluations(
    workspaceId: string,
    input?: PageInput,
    signal?: AbortSignal,
  ): Promise<EvaluationPage>;
  getEvaluationMetadata(
    workspaceId: string,
    evaluationId: string,
    signal?: AbortSignal,
  ): Promise<EvaluationSummary>;
  createEvaluationDraft(
    workspaceId: string,
    signal?: AbortSignal,
  ): Promise<EvaluationDraftResponse>;
  createEvaluation(
    input: { workspaceId: string; evaluationId: string; evaluationName: string },
    signal?: AbortSignal,
  ): Promise<EvaluationCreateResponse>;
  patchEvaluationTitle(
    evaluationId: string,
    input: { name: string; user_sys_id: string; description?: string },
    signal?: AbortSignal,
  ): Promise<JsonObject>;
  putEvaltoolTitle(
    workspaceId: string,
    evaluationId: string,
    input: { eval_name: string },
    signal?: AbortSignal,
  ): Promise<JsonObject>;
  syncEvalsList(
    input: { workspaceId: string; limit: number; offset: number },
    signal?: AbortSignal,
  ): Promise<JsonObject>;
  listEvaluationsSorted(
    workspaceId: string,
    input: {
      page: number;
      size: number;
      sortBy: 'created_at';
      sortOrder: 'asc' | 'desc';
    },
    signal?: AbortSignal,
  ): Promise<EvaluationPage>;
  createQualityStandard(
    input: {
      name: string;
      judge_model: string;
      rubric: string;
      anchors: readonly {
        input: string;
        response: string;
        reference: string;
        score: number;
        reasoning: string;
      }[];
    },
    signal?: AbortSignal,
  ): Promise<JsonObject>;
  updateQualityStandard(
    qualityStandardId: string,
    input: {
      name: string;
      judge_model: string;
      rubric: string;
      anchors: readonly {
        input: string;
        response: string;
        reference: string;
        score: number;
        reasoning: string;
      }[];
    },
    signal?: AbortSignal,
  ): Promise<JsonObject>;
  assignQualityStandardToWorkspace(
    workspaceId: string,
    input: { quality_standard_id: string },
    signal?: AbortSignal,
  ): Promise<JsonObject>;
  getQualityStandard(qualityStandardId: string, signal?: AbortSignal): Promise<JsonObject>;
  getWorkspaceQualityStandard(
    workspaceId: string,
    signal?: AbortSignal,
  ): Promise<JsonObject | null>;
  createMethodologyVersion(
    evaluationId: string,
    input: {
      user_sys_id: string;
      judge_model: string;
      judge_model_id: string;
      evaluator_instructions: string;
      change_log: string;
      runs_per_scenario: number;
    },
    signal?: AbortSignal,
  ): Promise<MethodologyVersionCreateResponse>;
  createConfigVersion(
    evaluationId: string,
    input:
      | {
          methodology_version_id: string;
          primary_model_id: string;
          comparison_model_ids: readonly string[];
          scenarios: readonly unknown[];
          prompt_text: string;
          selected_metrics: readonly string[];
          temperature_context?: number;
          reference_documents?: readonly { filename: string; content: string }[];
        }
      | {
          context_name: string;
          context_type: 'conversation' | 'agent_trace';
          methodology_version_id: string;
          artifact: JsonObject;
          expected: string;
          reference_documents?: readonly { filename: string; content: string }[];
          selected_metrics: readonly string[];
          temperature_context?: number;
        },
    signal?: AbortSignal,
  ): Promise<ConfigVersionCreateResponse>;
  startRunStatusStream(evaluationId: string, runId: string, signal?: AbortSignal): Promise<void>;
  getEvaluationVersions(
    evaluationId: string,
    signal?: AbortSignal,
  ): Promise<EvaluationVersionsResponse>;
  getEvaluationConfiguration(
    evaluationId: string,
    methodologyVersionId: string,
    configVersionId: string,
    signal?: AbortSignal,
  ): Promise<EvaluationConfigurationResponse>;
  getModels(signal?: AbortSignal): Promise<SupportedModel[]>;
  createRun(input: CreateRunInput): Promise<RunCreateResponse>;
  getRunStatus(evaluationId: string, runId: string, signal?: AbortSignal): Promise<RunStatus>;
  getModelPerformance(
    evaluationId: string,
    runId: string,
    signal?: AbortSignal,
  ): Promise<JsonObject>;
  getScenarioComparison(
    evaluationId: string,
    runId: string,
    signal?: AbortSignal,
  ): Promise<JsonObject>;
  getModelResponses(evaluationId: string, runId: string, signal?: AbortSignal): Promise<JsonObject>;
  getConversationResults(
    evaluationId: string,
    runId: string,
    signal?: AbortSignal,
  ): Promise<JsonObject>;
  getAgentTraceResults(
    evaluationId: string,
    runId: string,
    signal?: AbortSignal,
  ): Promise<JsonObject>;
  getTrajectory(evaluationId: string, runId: string, signal?: AbortSignal): Promise<JsonObject>;
}

function mapWorkspace(response: {
  workspace_id: string;
  name: string;
  description?: string | null | undefined;
  eval_count?: number | undefined;
  updated_at?: string | undefined;
  quality_standard_id?: string | null | undefined;
  qualityStandardId?: string | null | undefined;
  quality_standard?: { id?: string | null | undefined } | null | undefined;
}): Workspace {
  const qualityStandardId =
    response.quality_standard_id ?? response.qualityStandardId ?? response.quality_standard?.id;
  return {
    id: response.workspace_id,
    name: response.name,
    evaluationCount: response.eval_count ?? 0,
    ...(response.description ? { description: response.description } : {}),
    ...(response.updated_at ? { updatedAt: response.updated_at } : {}),
    ...(qualityStandardId ? { qualityStandardId } : {}),
  };
}

function mapEvaluation(
  response: {
    eval_id: string;
    eval_name: string;
    workspace_id?: string | undefined;
    updated_at?: string | undefined;
  },
  fallbackWorkspaceId?: string,
): EvaluationSummary {
  const workspaceId = response.workspace_id ?? fallbackWorkspaceId;
  return {
    id: response.eval_id,
    name: response.eval_name,
    ...(workspaceId ? { workspaceId } : {}),
    ...(response.updated_at ? { updatedAt: response.updated_at } : {}),
  };
}

export class AutoevalApiClient implements AutoevalApi {
  readonly #client: ApiClient;

  constructor(client: ApiClient) {
    this.#client = client;
  }

  async getCurrentUser(signal?: AbortSignal): Promise<UserIdentity> {
    const response = await this.#client.request({
      method: 'GET',
      path: apiEndpoints.currentUser(),
      schema: userIdentityResponseSchema,
      ...(signal ? { signal } : {}),
    });
    return {
      id: response.id,
      userSystemId: response.user_sys_id,
      email: response.email,
      ...(response.name ? { name: response.name } : {}),
    };
  }

  async listWorkspaces(input: PageInput = {}, signal?: AbortSignal): Promise<WorkspacePage> {
    const response = await this.#client.request({
      method: 'GET',
      path: apiEndpoints.workspaces(),
      schema: workspacePageResponseSchema,
      query: { page: input.page ?? 1, size: input.size ?? 100 },
      ...(signal ? { signal } : {}),
    });
    return {
      items: response.items.map(mapWorkspace),
      total: response.total,
      page: response.page,
      size: response.size,
      totalPages: response.total_pages,
    };
  }

  async createWorkspace(
    input: { name: string; description?: string },
    signal?: AbortSignal,
  ): Promise<Workspace> {
    const response = await this.#client.request({
      method: 'POST',
      path: apiEndpoints.workspaceCreate(),
      schema: workspaceResponseSchema,
      body: input,
      ...(signal ? { signal } : {}),
    });
    return mapWorkspace(response);
  }

  async getWorkspace(workspaceId: string, signal?: AbortSignal): Promise<Workspace> {
    const response = await this.#client.request({
      method: 'GET',
      path: apiEndpoints.workspace(workspaceId),
      schema: workspaceResponseSchema,
      ...(signal ? { signal } : {}),
    });
    return mapWorkspace(response);
  }

  async listEvaluations(
    workspaceId: string,
    input: PageInput = {},
    signal?: AbortSignal,
  ): Promise<EvaluationPage> {
    const response = await this.#client.request({
      method: 'GET',
      path: apiEndpoints.evaluations(),
      schema: evaluationPageResponseSchema,
      query: { workspace_id: workspaceId, page: input.page ?? 1, size: input.size ?? 100 },
      ...(signal ? { signal } : {}),
    });
    return {
      items: response.items.map((item) => mapEvaluation(item, workspaceId)),
      total: response.total,
      page: response.page,
      size: response.size,
      totalPages: response.total_pages,
    };
  }

  async getEvaluationMetadata(
    workspaceId: string,
    evaluationId: string,
    signal?: AbortSignal,
  ): Promise<EvaluationSummary> {
    const response = await this.#client.request({
      method: 'GET',
      path: apiEndpoints.evaluationMetadata(workspaceId),
      schema: evaluationSummaryResponseSchema,
      query: { evaltool_id: evaluationId },
      ...(signal ? { signal } : {}),
    });
    return mapEvaluation(response, workspaceId);
  }

  createEvaluationDraft(
    workspaceId: string,
    signal?: AbortSignal,
  ): Promise<EvaluationDraftResponse> {
    return this.#client.request<EvaluationDraftResponse>({
      method: 'POST',
      path: apiEndpoints.evaluationDraft(),
      schema: evaluationDraftResponseSchema,
      body: { workspace_id: workspaceId },
      ...(signal ? { signal } : {}),
    });
  }

  createEvaluation(
    input: { workspaceId: string; evaluationId: string; evaluationName: string },
    signal?: AbortSignal,
  ): Promise<EvaluationCreateResponse> {
    return this.#client.request<EvaluationCreateResponse>({
      method: 'POST',
      path: apiEndpoints.evaluationCreate(),
      schema: evaluationCreateResponseSchema,
      query: {
        eval_name: input.evaluationName,
        workspace_id: input.workspaceId,
        evaluation_id: input.evaluationId,
      },
      ...(signal ? { signal } : {}),
    });
  }

  patchEvaluationTitle(
    evaluationId: string,
    input: { name: string; user_sys_id: string; description?: string },
    signal?: AbortSignal,
  ): Promise<JsonObject> {
    return this.#client.request({
      method: 'PATCH',
      path: apiEndpoints.evaluationUpdate(evaluationId),
      schema: jsonObjectSchema,
      body: input,
      ...(signal ? { signal } : {}),
    });
  }

  putEvaltoolTitle(
    workspaceId: string,
    evaluationId: string,
    input: { eval_name: string },
    signal?: AbortSignal,
  ): Promise<JsonObject> {
    return this.#client.request({
      method: 'PUT',
      path: apiEndpoints.evaltoolUpdate(workspaceId),
      schema: jsonObjectSchema,
      query: { evaltool_id: evaluationId },
      body: input,
      ...(signal ? { signal } : {}),
    });
  }

  syncEvalsList(
    input: { workspaceId: string; limit: number; offset: number },
    signal?: AbortSignal,
  ): Promise<JsonObject> {
    return this.#client.request({
      method: 'POST',
      path: apiEndpoints.syncEvalsList(),
      schema: jsonObjectSchema,
      body: {
        limit: input.limit,
        offset: input.offset,
        workspace_id: input.workspaceId,
      },
      ...(signal ? { signal } : {}),
    });
  }

  async listEvaluationsSorted(
    workspaceId: string,
    input: {
      page: number;
      size: number;
      sortBy: 'created_at';
      sortOrder: 'asc' | 'desc';
    },
    signal?: AbortSignal,
  ): Promise<EvaluationPage> {
    const response = await this.#client.request({
      method: 'GET',
      path: apiEndpoints.evaluations(),
      schema: evaluationPageResponseSchema,
      query: {
        page: input.page,
        size: input.size,
        sort_by: input.sortBy,
        sort_order: input.sortOrder,
        workspace_id: workspaceId,
      },
      ...(signal ? { signal } : {}),
    });

    return {
      items: response.items.map((item) => mapEvaluation(item, workspaceId)),
      total: response.total,
      page: response.page,
      size: response.size,
      totalPages: response.total_pages,
    };
  }

  createQualityStandard(
    input: {
      name: string;
      judge_model: string;
      rubric: string;
      anchors: readonly {
        input: string;
        response: string;
        reference: string;
        score: number;
        reasoning: string;
      }[];
    },
    signal?: AbortSignal,
  ): Promise<JsonObject> {
    return this.#client.request({
      method: 'POST',
      path: apiEndpoints.qualityStandards(),
      schema: jsonObjectSchema,
      body: input,
      ...(signal ? { signal } : {}),
    });
  }

  updateQualityStandard(
    qualityStandardId: string,
    input: {
      name: string;
      judge_model: string;
      rubric: string;
      anchors: readonly {
        input: string;
        response: string;
        reference: string;
        score: number;
        reasoning: string;
      }[];
    },
    signal?: AbortSignal,
  ): Promise<JsonObject> {
    return this.#client.request({
      method: 'PATCH',
      path: apiEndpoints.qualityStandard(qualityStandardId),
      schema: jsonObjectSchema,
      body: input,
      ...(signal ? { signal } : {}),
    });
  }

  assignQualityStandardToWorkspace(
    workspaceId: string,
    input: { quality_standard_id: string },
    signal?: AbortSignal,
  ): Promise<JsonObject> {
    return this.#client.request({
      method: 'PUT',
      path: apiEndpoints.qualityStandardsWorkspace(workspaceId),
      schema: jsonObjectSchema,
      body: input,
      ...(signal ? { signal } : {}),
    });
  }

  getQualityStandard(qualityStandardId: string, signal?: AbortSignal): Promise<JsonObject> {
    return this.#client.request({
      method: 'GET',
      path: apiEndpoints.qualityStandard(qualityStandardId),
      schema: jsonObjectSchema,
      ...(signal ? { signal } : {}),
    });
  }

  getWorkspaceQualityStandard(
    workspaceId: string,
    signal?: AbortSignal,
  ): Promise<JsonObject | null> {
    return this.#client.request({
      method: 'GET',
      path: apiEndpoints.qualityStandardsWorkspace(workspaceId),
      schema: nullableJsonObjectSchema,
      ...(signal ? { signal } : {}),
    });
  }

  createMethodologyVersion(
    evaluationId: string,
    input: {
      user_sys_id: string;
      judge_model: string;
      judge_model_id: string;
      evaluator_instructions: string;
      change_log: string;
      runs_per_scenario: number;
    },
    signal?: AbortSignal,
  ): Promise<MethodologyVersionCreateResponse> {
    return this.#client.request<MethodologyVersionCreateResponse>({
      method: 'POST',
      path: apiEndpoints.methodologyVersions(evaluationId),
      schema: methodologyVersionCreateResponseSchema,
      body: input,
      ...(signal ? { signal } : {}),
    });
  }

  createConfigVersion(
    evaluationId: string,
    input:
      | {
          methodology_version_id: string;
          primary_model_id: string;
          comparison_model_ids: readonly string[];
          scenarios: readonly unknown[];
          prompt_text: string;
          selected_metrics: readonly string[];
          temperature_context?: number;
          reference_documents?: readonly { filename: string; content: string }[];
        }
      | {
          context_name: string;
          context_type: 'conversation' | 'agent_trace';
          methodology_version_id: string;
          artifact: JsonObject;
          expected: string;
          reference_documents?: readonly { filename: string; content: string }[];
          selected_metrics: readonly string[];
          temperature_context?: number;
        },
    signal?: AbortSignal,
  ): Promise<ConfigVersionCreateResponse> {
    return this.#client.request<ConfigVersionCreateResponse>({
      method: 'POST',
      path: apiEndpoints.configVersions(evaluationId),
      schema: configVersionCreateResponseSchema,
      body: input,
      ...(signal ? { signal } : {}),
    });
  }

  async startRunStatusStream(
    evaluationId: string,
    runId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const streamClient = this.#client as unknown as {
      openEventStream: (path: string, inputSignal?: AbortSignal) => Promise<void>;
    };
    await streamClient.openEventStream(apiEndpoints.runStatusStream(evaluationId, runId), signal);
  }

  async getEvaluationVersions(
    evaluationId: string,
    signal?: AbortSignal,
  ): Promise<EvaluationVersionsResponse> {
    return this.#client.request({
      method: 'GET',
      path: apiEndpoints.evaluationVersions(evaluationId),
      schema: evaluationVersionsResponseSchema,
      query: { enhanced: true },
      ...(signal ? { signal } : {}),
    });
  }

  async getEvaluationConfiguration(
    evaluationId: string,
    methodologyVersionId: string,
    configVersionId: string,
    signal?: AbortSignal,
  ): Promise<EvaluationConfigurationResponse> {
    return this.#client.request({
      method: 'GET',
      path: apiEndpoints.evaluationConfiguration(evaluationId),
      schema: evaluationConfigurationResponseSchema,
      query: {
        methodology_version_id: methodologyVersionId,
        config_version_id: configVersionId,
      },
      ...(signal ? { signal } : {}),
    });
  }

  async getModels(signal?: AbortSignal): Promise<SupportedModel[]> {
    const response = await this.#client.request({
      method: 'GET',
      path: apiEndpoints.models(),
      schema: modelsResponseSchema,
      ...(signal ? { signal } : {}),
    });

    if (isByokModelsResponse(response)) {
      return response.models.map((model) => ({
        id: model.supported_model_id,
        provider: model.provider,
        displayName: model.display_name,
        apiModelId: model.provider_model_id,
        isDeprecated: model.is_deprecated ?? false,
        isLocked: model.locked ?? false,
        ...(model.model_key ? { modelKey: model.model_key } : {}),
      }));
    }

    if (isLegacyModelsResponse(response)) {
      return Object.entries(response.providers).flatMap(([provider, group]) =>
        group.models.map((model) => ({
          id: model.id,
          provider,
          displayName: model.display_name,
          apiModelId: model.api_model_id,
          isDeprecated: model.is_deprecated,
          isLocked: model.locked,
          ...(model.model_key ? { modelKey: model.model_key } : {}),
        })),
      );
    }

    throw new AutoevalError('Autoeval API returned an unsupported models response shape.', {
      kind: 'upstream',
      code: 'INVALID_API_RESPONSE',
    });
  }

  async createRun(input: CreateRunInput): Promise<RunCreateResponse> {
    return this.#client.request({
      method: 'POST',
      path: apiEndpoints.runs(input.evaluationId),
      schema: runCreateResponseSchema,
      headers: { 'Idempotency-Key': input.idempotencyKey },
      body: {
        selector: { configVersionId: input.configVersionId },
      },
      ...(input.signal ? { signal: input.signal } : {}),
    });
  }

  async getRunStatus(
    evaluationId: string,
    runId: string,
    signal?: AbortSignal,
  ): Promise<RunStatus> {
    const response = await this.#client.request({
      method: 'GET',
      path: apiEndpoints.runStatus(evaluationId, runId),
      schema: runStatusResponseSchema,
      ...(signal ? { signal } : {}),
    });
    if (response.evaluation_id !== evaluationId || response.run_id !== runId) {
      throw new AutoevalError('Autoeval API returned mismatched run status identifiers.', {
        kind: 'upstream',
        code: 'MISMATCHED_RUN_ID',
      });
    }
    return {
      evaluationId: response.evaluation_id,
      runId: response.run_id,
      state: response.evaluationState.trim().toUpperCase(),
      raw: jsonObjectSchema.parse(response),
      ...(response.progress
        ? {
            progress: {
              ...(response.progress.percentage !== undefined
                ? { percentage: response.progress.percentage }
                : {}),
              ...(response.progress.runsCompleted !== undefined
                ? { runsCompleted: response.progress.runsCompleted }
                : {}),
              ...(response.progress.totalRuns !== undefined
                ? { totalRuns: response.progress.totalRuns }
                : {}),
            },
          }
        : {}),
      ...(response.error_message ? { errorMessage: response.error_message } : {}),
      ...(response.failure_code ? { failureCode: response.failure_code } : {}),
    };
  }

  getModelPerformance(
    evaluationId: string,
    runId: string,
    signal?: AbortSignal,
  ): Promise<JsonObject> {
    return this.#getJsonObject(apiEndpoints.modelPerformance(evaluationId, runId), signal);
  }

  getScenarioComparison(
    evaluationId: string,
    runId: string,
    signal?: AbortSignal,
  ): Promise<JsonObject> {
    return this.#getJsonObject(apiEndpoints.scenarioComparison(evaluationId, runId), signal);
  }

  getModelResponses(
    evaluationId: string,
    runId: string,
    signal?: AbortSignal,
  ): Promise<JsonObject> {
    return this.#client.request({
      method: 'GET',
      path: apiEndpoints.modelResponses(evaluationId, runId),
      schema: jsonObjectSchema,
      query: { page: 1, limit: 50 },
      ...(signal ? { signal } : {}),
    });
  }

  getConversationResults(
    evaluationId: string,
    runId: string,
    signal?: AbortSignal,
  ): Promise<JsonObject> {
    return this.#getJsonObject(apiEndpoints.conversationResults(evaluationId, runId), signal);
  }

  getAgentTraceResults(
    evaluationId: string,
    runId: string,
    signal?: AbortSignal,
  ): Promise<JsonObject> {
    return this.#getJsonObject(apiEndpoints.agentTraceResults(evaluationId, runId), signal);
  }

  getTrajectory(evaluationId: string, runId: string, signal?: AbortSignal): Promise<JsonObject> {
    return this.#getJsonObject(apiEndpoints.trajectory(evaluationId, runId), signal);
  }

  #getJsonObject(path: string, signal?: AbortSignal): Promise<JsonObject> {
    return this.#client.request({
      method: 'GET',
      path,
      schema: jsonObjectSchema,
      ...(signal ? { signal } : {}),
    });
  }
}
