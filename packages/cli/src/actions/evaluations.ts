import { randomUUID } from 'node:crypto';

import type { JsonObject } from '../domain/common.js';
import type {
  Evaluation,
  EvaluationContextType,
  EvaluationPage,
  EvaluationVersionHistory,
  EvaluationVersionSummary,
  RunExecution,
  RunHandle,
  RunStatus,
  EvaluationVersion,
} from '../domain/types.js';
import { AutoevalError } from '../errors/autoeval-error.js';
import type { PollClock } from '../polling/clock.js';
import { waitForRun } from '../polling/wait-for-run.js';
import {
  type ConfigVersionCreateResponse,
  jsonObjectSchema,
  type EvaluationCreateResponse,
  type EvaluationDraftResponse,
  type MethodologyVersionCreateResponse,
  type EvaluationVersionsResponse,
} from '../api/schemas.js';
import type { ActionContext } from './context.js';
import { requirePageSize, requireUuid } from './validation.js';
import { z } from 'zod';

const evaluationNameSchema = z.string().trim().min(1).max(120);

function extractEvaluationId(
  response: EvaluationDraftResponse | EvaluationCreateResponse,
): string | undefined {
  return response.evaluation_id ?? response.evaluationId ?? response.eval_id ?? response.id;
}

export type CreatedEvaluation = {
  evaluationId: string;
  workspaceId: string;
  evaluationName: string;
};

export type UpdatedEvaluationTitle = {
  evaluationId: string;
  workspaceId: string;
  evaluationName: string;
  page: EvaluationPage;
};

/** Single run per scenario unless the eval file asks for multi-run evaluation. */
const DEFAULT_RUNS_PER_SCENARIO = 1;

export type MethodologyVersionInput = {
  /** Optional in eval files: resolved from the authenticated identity when omitted. */
  userSystemId?: string;
  judgeModel: string;
  judgeModelId: string;
  /** Runs per scenario for multi-run evaluation. The API requires it; defaults to 1. */
  runsPerScenario?: number;
  evaluatorInstructions: string;
  changeLog?: string;
};

type ReferenceDocument = {
  filename: string;
  content: string;
};

type EvaluationConfigCommon = {
  contextName: string;
  artifact: JsonObject;
  expected: string;
  referenceDocuments?: readonly ReferenceDocument[];
  selectedMetrics: readonly string[];
  temperatureContext?: number;
};

export type ScenarioConfigInput = EvaluationConfigCommon & {
  contextType: 'scenario';
  scenarioGeneration?: JsonObject;
};

export type ConversationConfigInput = EvaluationConfigCommon & {
  contextType: 'conversation';
  scenarioGeneration?: never;
};

export type AgentTraceConfigInput = EvaluationConfigCommon & {
  contextType: 'agent_trace';
  scenarioGeneration?: never;
};

export type EvaluationConfigInput =
  ScenarioConfigInput | ConversationConfigInput | AgentTraceConfigInput;

export type CreateConfiguredRunInput = {
  evaluationId: string;
  methodology: MethodologyVersionInput;
  configuration: EvaluationConfigInput;
  clock: PollClock;
  pollIntervalMs: number;
  pollTimeoutMs: number;
  signal?: AbortSignal;
  onStatus?: (status: RunStatus) => void;
  idempotencyKeyFactory?: () => string;
};

export type CreateConfiguredRunSubmissionInput = Omit<
  CreateConfiguredRunInput,
  'clock' | 'pollIntervalMs' | 'pollTimeoutMs' | 'onStatus'
>;

function extractMethodologyVersionId(
  response: MethodologyVersionCreateResponse,
): string | undefined {
  return (
    response.methodology_version_id ??
    response.methodologyVersionId ??
    response.methodology_id ??
    response.methodologyId ??
    response.id
  );
}

function extractConfigVersionId(response: ConfigVersionCreateResponse): string | undefined {
  return (
    response.config_version_id ??
    response.configVersionId ??
    response.config_id ??
    response.configId ??
    response.id
  );
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function extractCreatedAt(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  return (
    asNonEmptyString(record.created_at) ??
    asNonEmptyString(record.createdAt) ??
    asNonEmptyString(record.created)
  );
}

type VersionTimeline = NonNullable<EvaluationVersionsResponse['evaluationVersions']>;

function requireVersionTimeline(
  response: EvaluationVersionsResponse,
  evaluationId: string,
): VersionTimeline {
  const timeline = response.evaluationVersions;
  if (!timeline || timeline.items.length === 0) {
    throw new AutoevalError(`Evaluation version timeline is unavailable for ${evaluationId}.`, {
      kind: 'validation',
      code: 'EVALUATION_VERSION_TIMELINE_UNAVAILABLE',
    });
  }

  const currentMatches = timeline.items.filter((item) => item.version === timeline.currentVersion);
  if (currentMatches.length !== 1) {
    throw new AutoevalError(`Evaluation version timeline is inconsistent for ${evaluationId}.`, {
      kind: 'validation',
      code: 'EVALUATION_VERSION_TIMELINE_INVALID',
    });
  }

  const mismatchedCurrentFlags = timeline.items.some(
    (item) => item.isCurrent && item.version !== timeline.currentVersion,
  );
  if (mismatchedCurrentFlags) {
    throw new AutoevalError(`Evaluation version timeline is inconsistent for ${evaluationId}.`, {
      kind: 'validation',
      code: 'EVALUATION_VERSION_TIMELINE_INVALID',
    });
  }

  return timeline;
}

function buildVersionHistory(timeline: VersionTimeline): EvaluationVersionSummary[] {
  return [...timeline.items]
    .sort((left, right) => left.version - right.version)
    .map((item) => {
      const createdAt = extractCreatedAt(item);
      return {
        version: item.version,
        methodologyVersionId: item.methodologyId,
        configVersionId: item.configId,
        isCurrent: item.version === timeline.currentVersion,
        ...(createdAt ? { createdAt } : {}),
      };
    });
}

function selectVersion(
  timeline: VersionTimeline,
  requestedVersion?: number,
): EvaluationVersionSummary | undefined {
  const history = buildVersionHistory(timeline);

  if (requestedVersion !== undefined) {
    return history.find((item) => item.version === requestedVersion);
  }

  return history.find((item) => item.version === timeline.currentVersion);
}

export async function resolveEvaluationVersion(
  context: ActionContext,
  evaluationIdInput: string,
  requestedVersion?: number,
  signal?: AbortSignal,
): Promise<EvaluationVersion> {
  const evaluationId = requireUuid(evaluationIdInput, 'Evaluation ID');
  const response = await context.api.getEvaluationVersions(evaluationId, signal);
  if (response.evaluationId !== evaluationId) {
    throw new AutoevalError('Autoeval API returned a mismatched evaluation identifier.', {
      kind: 'upstream',
      code: 'MISMATCHED_EVALUATION_ID',
    });
  }
  const contextType: EvaluationContextType = response.context_type ?? 'scenario';
  const timeline = requireVersionTimeline(response, evaluationId);
  const selected = selectVersion(timeline, requestedVersion);
  if (selected) {
    return {
      version: selected.version,
      evaluationId,
      methodologyVersionId: selected.methodologyVersionId,
      configVersionId: selected.configVersionId,
      isCurrent: selected.isCurrent,
      ...(selected.createdAt ? { createdAt: selected.createdAt } : {}),
      contextType,
      raw: jsonObjectSchema.parse(response),
    };
  }

  throw new AutoevalError(
    `Evaluation version ${requestedVersion} was not found for ${evaluationId}.`,
    {
      kind: 'validation',
      code: 'EVALUATION_VERSION_NOT_FOUND',
    },
  );
}

export async function listEvaluationVersions(
  context: ActionContext,
  evaluationIdInput: string,
  signal?: AbortSignal,
): Promise<EvaluationVersionHistory> {
  const evaluationId = requireUuid(evaluationIdInput, 'Evaluation ID');
  const response = await context.api.getEvaluationVersions(evaluationId, signal);
  if (response.evaluationId !== evaluationId) {
    throw new AutoevalError('Autoeval API returned a mismatched evaluation identifier.', {
      kind: 'upstream',
      code: 'MISMATCHED_EVALUATION_ID',
    });
  }
  const timeline = requireVersionTimeline(response, evaluationId);

  return {
    evaluationId,
    contextType: response.context_type ?? 'scenario',
    currentVersion: timeline.currentVersion,
    versions: buildVersionHistory(timeline),
    raw: jsonObjectSchema.parse(response),
  };
}

export function listEvaluations(
  context: ActionContext,
  input: { workspaceId: string; page?: number; size?: number },
  signal?: AbortSignal,
): Promise<EvaluationPage> {
  const workspaceId = requireUuid(input.workspaceId, 'Workspace ID');
  const size = requirePageSize(input.size ?? 100);
  return context.api.listEvaluations(workspaceId, { page: input.page ?? 1, size }, signal);
}

export async function getEvaluation(
  context: ActionContext,
  evaluationId: string,
  requestedVersion?: number,
  signal?: AbortSignal,
): Promise<Evaluation> {
  const version = await resolveEvaluationVersion(context, evaluationId, requestedVersion, signal);
  const response = await context.api.getEvaluationConfiguration(
    version.evaluationId,
    version.methodologyVersionId,
    version.configVersionId,
    signal,
  );

  if (
    response.evaluation_id !== version.evaluationId ||
    response.methodology_version_id !== version.methodologyVersionId ||
    response.config_version_id !== version.configVersionId
  ) {
    throw new AutoevalError('Autoeval API returned mismatched evaluation version identifiers.', {
      kind: 'upstream',
      code: 'MISMATCHED_VERSION_ID',
    });
  }

  return {
    ...version,
    configuration: jsonObjectSchema.parse(response),
  };
}

export async function createEvaluation(
  context: ActionContext,
  input: { workspaceId: string; evaluationName?: string },
  signal?: AbortSignal,
): Promise<CreatedEvaluation> {
  const workspaceId = requireUuid(input.workspaceId, 'Workspace ID');
  const evaluationName = evaluationNameSchema.parse(input.evaluationName ?? 'Untitled');

  const draftResponse = await context.api.createEvaluationDraft(workspaceId, signal);
  const draftEvaluationId = extractEvaluationId(draftResponse);
  if (!draftEvaluationId) {
    throw new AutoevalError('Autoeval API draft response did not include an evaluation ID.', {
      kind: 'upstream',
      code: 'MISSING_EVALUATION_ID',
    });
  }

  const evaluationId = requireUuid(draftEvaluationId, 'Evaluation ID');
  const createResponse = await context.api.createEvaluation(
    { workspaceId, evaluationId, evaluationName },
    signal,
  );
  const createEvaluationId = extractEvaluationId(createResponse);
  if (createEvaluationId && createEvaluationId !== evaluationId) {
    throw new AutoevalError('Autoeval API create response returned a mismatched evaluation ID.', {
      kind: 'upstream',
      code: 'MISMATCHED_EVALUATION_ID',
    });
  }

  return { evaluationId, workspaceId, evaluationName };
}

export async function createConfiguredRunSubmission(
  context: ActionContext,
  input: CreateConfiguredRunSubmissionInput,
): Promise<RunHandle> {
  const evaluationId = requireUuid(input.evaluationId, 'Evaluation ID');
  const methodology = input.methodology;
  const configuration = input.configuration;

  // Public eval files must not embed account identity. Resolve it through the
  // authenticated API session unless an explicit caller supplied one.
  const userSystemId =
    methodology.userSystemId ?? (await context.api.getCurrentUser(input.signal)).userSystemId;

  const methodologyResponse = await context.api.createMethodologyVersion(
    evaluationId,
    {
      user_sys_id: userSystemId,
      judge_model:
        configuration.contextType === 'scenario'
          ? requireUuid(methodology.judgeModelId, 'Judge model ID')
          : methodology.judgeModel,
      judge_model_id: requireUuid(methodology.judgeModelId, 'Judge model ID'),
      evaluator_instructions: methodology.evaluatorInstructions,
      change_log: methodology.changeLog ?? '',
      runs_per_scenario: methodology.runsPerScenario ?? DEFAULT_RUNS_PER_SCENARIO,
    },
    input.signal,
  );

  const rawMethodologyVersionId = extractMethodologyVersionId(methodologyResponse);
  if (!rawMethodologyVersionId) {
    throw new AutoevalError(
      'Autoeval API methodology response did not include a methodology version ID.',
      {
        kind: 'upstream',
        code: 'MISSING_METHODOLOGY_VERSION_ID',
      },
    );
  }
  const methodologyVersionId = requireUuid(rawMethodologyVersionId, 'Methodology version ID');

  const configResponse = await context.api.createConfigVersion(
    evaluationId,
    configuration.contextType === 'scenario'
      ? {
          // Legacy scenario fixtures may provide scenarios as [[...]].
          // The API expects a flat scenarios list, so flatten one level when needed.
          methodology_version_id: methodologyVersionId,
          primary_model_id: z.uuid().parse(configuration.artifact.primaryModelId),
          comparison_model_ids: z.array(z.uuid()).parse(configuration.artifact.comparisonModelIds),
          scenarios: (() => {
            const parsedScenarios = z
              .array(z.json())
              .min(1)
              .parse(configuration.artifact.scenarios);
            return Array.isArray(parsedScenarios[0])
              ? z.array(z.json()).min(1).parse(parsedScenarios[0])
              : parsedScenarios;
          })(),
          prompt_text: z.string().min(1).parse(configuration.artifact.promptText),
          selected_metrics: configuration.selectedMetrics,
          ...(configuration.referenceDocuments && configuration.referenceDocuments.length > 0
            ? { reference_documents: configuration.referenceDocuments }
            : {}),
          ...(configuration.temperatureContext !== undefined
            ? { temperature_context: configuration.temperatureContext }
            : {}),
        }
      : {
          context_name: configuration.contextName,
          context_type: configuration.contextType,
          methodology_version_id: methodologyVersionId,
          artifact: configuration.artifact,
          expected: configuration.expected,
          selected_metrics: configuration.selectedMetrics,
          ...(configuration.referenceDocuments && configuration.referenceDocuments.length > 0
            ? { reference_documents: configuration.referenceDocuments }
            : {}),
          ...(configuration.temperatureContext !== undefined
            ? { temperature_context: configuration.temperatureContext }
            : {}),
        },
    input.signal,
  );

  const rawConfigVersionId = extractConfigVersionId(configResponse);
  if (!rawConfigVersionId) {
    throw new AutoevalError('Autoeval API config response did not include a config version ID.', {
      kind: 'upstream',
      code: 'MISSING_CONFIG_VERSION_ID',
    });
  }
  const configVersionId = requireUuid(rawConfigVersionId, 'Config version ID');

  const idempotencyKey = (input.idempotencyKeyFactory ?? randomUUID)();
  const runResponse = await context.api.createRun({
    evaluationId,
    configVersionId,
    idempotencyKey,
    ...(input.signal ? { signal: input.signal } : {}),
  });

  if (
    runResponse.using.configVersionId !== configVersionId ||
    runResponse.using.methodologyVersionId !== methodologyVersionId
  ) {
    throw new AutoevalError('Autoeval API created the run with unexpected version identifiers.', {
      kind: 'upstream',
      code: 'MISMATCHED_RUN_VERSION_ID',
    });
  }

  const run = {
    evaluationId,
    runId: runResponse.runId,
    status: runResponse.status,
    configVersionId: runResponse.using.configVersionId,
    methodologyVersionId: runResponse.using.methodologyVersionId,
  };

  return run;
}

export async function createConfiguredRun(
  context: ActionContext,
  input: CreateConfiguredRunInput,
): Promise<RunExecution> {
  const run = await createConfiguredRunSubmission(context, input);

  await context.api.startRunStatusStream(run.evaluationId, run.runId, input.signal);

  const outcome = await waitForRun({
    api: context.api,
    clock: input.clock,
    evaluationId: run.evaluationId,
    runId: run.runId,
    intervalMs: input.pollIntervalMs,
    timeoutMs: input.pollTimeoutMs,
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.onStatus ? { onStatus: input.onStatus } : {}),
  });

  if (outcome.status.state !== 'COMPLETED') {
    const failureCode = outcome.status.failureCode ? ` (${outcome.status.failureCode})` : '';
    throw new AutoevalError(
      `Run ${run.runId} ended in state ${outcome.status.state}${failureCode}.`,
      {
        kind: 'run_failed',
        code: outcome.status.failureCode ?? 'RUN_FAILED',
        cause: outcome.status,
      },
    );
  }

  return { run, outcome };
}

export async function updateEvaluationTitleAndRefreshList(
  context: ActionContext,
  input: {
    workspaceId: string;
    evaluationId: string;
    evaluationName: string;
    userSystemId: string;
    description?: string;
    page?: number;
    size?: number;
  },
  signal?: AbortSignal,
): Promise<UpdatedEvaluationTitle> {
  const workspaceId = requireUuid(input.workspaceId, 'Workspace ID');
  const evaluationId = requireUuid(input.evaluationId, 'Evaluation ID');
  const evaluationName = evaluationNameSchema.parse(input.evaluationName);
  const size = requirePageSize(input.size ?? 50);
  const page = Math.max(1, input.page ?? 1);

  await context.api.patchEvaluationTitle(
    evaluationId,
    {
      name: evaluationName,
      user_sys_id: input.userSystemId,
      ...(input.description !== undefined ? { description: input.description } : {}),
    },
    signal,
  );

  await context.api.putEvaltoolTitle(
    workspaceId,
    evaluationId,
    { eval_name: evaluationName },
    signal,
  );

  await context.api.syncEvalsList({ workspaceId, limit: 25, offset: 0 }, signal);

  const listPage = await context.api.listEvaluationsSorted(
    workspaceId,
    { page, size, sortBy: 'created_at', sortOrder: 'desc' },
    signal,
  );

  return { evaluationId, workspaceId, evaluationName, page: listPage };
}
