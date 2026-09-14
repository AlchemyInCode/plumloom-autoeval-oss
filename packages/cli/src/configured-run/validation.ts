import { z } from 'zod';

import type { EvaluationConfigInput } from '../actions/evaluations.js';
import type { SupportedModel } from '../domain/types.js';
import { AutoevalError } from '../errors/autoeval-error.js';

const referenceDocumentSchema = z
  .object({
    filename: z.string().trim().min(1),
    content: z.string(),
  })
  .strict();

const configuredRunNormalizedConfigurationSchema = z.discriminatedUnion('contextType', [
  z
    .object({
      evaluationName: z.string().trim().min(1).max(120).optional(),
      contextName: z.string().trim().min(1),
      contextType: z.literal('scenario'),
      artifact: z.record(z.string(), z.json()),
      expected: z.string().min(1),
      referenceDocuments: z.array(referenceDocumentSchema).optional(),
      selectedMetrics: z.array(z.string().trim().min(1)).min(1),
      temperatureContext: z.number().optional(),
      // Ignored: run planning is controlled by the evaluation service; retained for compatibility.
      autoStopEnabled: z.boolean().optional(),
      scenarioGeneration: z.record(z.string(), z.json()).optional(),
    })
    .strict(),
  z
    .object({
      evaluationName: z.string().trim().min(1).max(120).optional(),
      contextName: z.string().trim().min(1),
      contextType: z.literal('conversation'),
      artifact: z.record(z.string(), z.json()),
      expected: z.string().min(1),
      referenceDocuments: z.array(referenceDocumentSchema).optional(),
      selectedMetrics: z.array(z.string().trim().min(1)).min(1),
      temperatureContext: z.number().optional(),
      // Ignored: run planning is controlled by the evaluation service; retained for compatibility.
      autoStopEnabled: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      evaluationName: z.string().trim().min(1).max(120).optional(),
      contextName: z.string().trim().min(1),
      contextType: z.literal('agent_trace'),
      artifact: z.record(z.string(), z.json()),
      expected: z.string().min(1),
      referenceDocuments: z.array(referenceDocumentSchema).optional(),
      selectedMetrics: z.array(z.string().trim().min(1)).min(1),
      temperatureContext: z.number().optional(),
      // Ignored: run planning is controlled by the evaluation service; retained for compatibility.
      autoStopEnabled: z.boolean().optional(),
    })
    .strict(),
]);

const configuredRunLegacyScenarioConfigurationSchema = z
  .object({
    evaluationName: z.string().trim().min(1).max(120).optional(),
    contextName: z.string().trim().min(1).optional(),
    primaryModelId: z.uuid(),
    comparisonModelIds: z.array(z.uuid()).default([]),
    promptText: z.string().min(1),
    scenarios: z.union([
      z.array(z.array(z.record(z.string(), z.json())).min(1)).min(1),
      z.array(z.record(z.string(), z.json())).min(1),
    ]),
    referenceDocuments: z.array(referenceDocumentSchema).optional(),
    selectedMetrics: z.array(z.string().trim().min(1)).min(1),
    expected: z.string().min(1).optional(),
    temperatureContext: z.number().optional(),
    // Ignored: run planning is controlled by the evaluation service; retained for compatibility.
    autoStopEnabled: z.boolean().optional(),
  })
  .strict();

export const configuredRunFileSchema = z
  .object({
    methodology: z
      .object({
        userSystemId: z.string().trim().min(1).optional(),
        judgeModel: z.string().trim().min(1),
        judgeModelId: z.uuid(),
        runsPerScenario: z.number().int().min(1).max(10).optional(),
        evaluatorInstructions: z.string().min(1),
        changeLog: z.string().optional(),
      })
      .strict(),
    configuration: z.union([
      configuredRunNormalizedConfigurationSchema,
      configuredRunLegacyScenarioConfigurationSchema,
    ]),
  })
  .strict();

export type ConfiguredRunFileInput = z.input<typeof configuredRunFileSchema>;

const scenarioArtifactSchema = z
  .object({
    primaryModelId: z.uuid(),
    comparisonModelIds: z.array(z.uuid()),
    promptText: z.string().min(1),
    scenarios: z.union([
      z.array(z.array(z.record(z.string(), z.json())).min(1)).min(1),
      z.array(z.record(z.string(), z.json())).min(1),
    ]),
  })
  .loose();

const conversationArtifactSchema = z
  .object({
    messages: z
      .array(
        z
          .object({
            role: z.string().trim().min(1),
            content: z.string(),
          })
          .loose(),
      )
      .min(1),
  })
  .loose();

const agentTraceArtifactSchema = z
  .object({
    trace: z
      .object({
        resourceSpans: z.array(z.record(z.string(), z.json())).min(1),
      })
      .loose(),
  })
  .loose();

export type ParsedConfiguredRunInput = {
  methodology: {
    userSystemId?: string;
    judgeModel: string;
    judgeModelId: string;
    runsPerScenario?: number;
    evaluatorInstructions: string;
    changeLog?: string;
  };
  evaluationName?: string;
  configuration: EvaluationConfigInput;
};

export type ConfiguredRunValidationResult = {
  valid: true;
  contextType: EvaluationConfigInput['contextType'];
  artifactCount: number;
  models: {
    judge: SupportedModel;
    primary?: SupportedModel;
    comparisons: SupportedModel[];
  };
};

export type ConfiguredRunModelOverrides = {
  judgeModelId?: string;
  primaryModelId?: string;
};

const PUBLIC_JUDGE_MODEL_PLACEHOLDER = '11111111-1111-4111-8111-111111111111';
const PUBLIC_PRIMARY_MODEL_PLACEHOLDER = '22222222-2222-4222-8222-222222222222';

function issuePath(path: PropertyKey[]): string {
  return path.length === 0 ? 'input' : path.map(String).join('.');
}

function invalidInput(error: z.ZodError): AutoevalError {
  const details = error.issues
    .slice(0, 8)
    .map((issue) => `${issuePath(issue.path)}: ${issue.message}`)
    .join('; ');
  return new AutoevalError(
    `Configured run input is invalid: ${details}. Fix the listed fields and run "autoeval eval validate --input <file>" again`,
    {
      kind: 'validation',
      code: 'INVALID_CONFIGURED_RUN_SCHEMA',
      cause: error,
    },
  );
}

export function parseConfiguredRunInput(parsedJson: unknown): ParsedConfiguredRunInput {
  const parsed = configuredRunFileSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw invalidInput(parsed.error);
  }
  const parsedInput = parsed.data;

  const methodology = {
    ...(parsedInput.methodology.userSystemId !== undefined
      ? { userSystemId: parsedInput.methodology.userSystemId }
      : {}),
    judgeModel: parsedInput.methodology.judgeModel,
    judgeModelId: parsedInput.methodology.judgeModelId,
    ...(parsedInput.methodology.runsPerScenario !== undefined
      ? { runsPerScenario: parsedInput.methodology.runsPerScenario }
      : {}),
    evaluatorInstructions: parsedInput.methodology.evaluatorInstructions,
    ...(parsedInput.methodology.changeLog !== undefined
      ? { changeLog: parsedInput.methodology.changeLog }
      : {}),
  };

  let evaluationName: string | undefined;
  let configuration: EvaluationConfigInput;
  if ('contextType' in parsedInput.configuration) {
    evaluationName = parsedInput.configuration.evaluationName;
    const common = {
      contextName: parsedInput.configuration.contextName,
      artifact: parsedInput.configuration.artifact,
      expected: parsedInput.configuration.expected,
      referenceDocuments: parsedInput.configuration.referenceDocuments ?? [],
      selectedMetrics: parsedInput.configuration.selectedMetrics,
      ...(parsedInput.configuration.temperatureContext !== undefined
        ? { temperatureContext: parsedInput.configuration.temperatureContext }
        : {}),
    };
    if (parsedInput.configuration.contextType === 'scenario') {
      configuration = {
        ...common,
        contextType: 'scenario',
        ...(parsedInput.configuration.scenarioGeneration !== undefined
          ? { scenarioGeneration: parsedInput.configuration.scenarioGeneration }
          : {}),
      };
    } else if (parsedInput.configuration.contextType === 'conversation') {
      configuration = { ...common, contextType: 'conversation' };
    } else {
      configuration = { ...common, contextType: 'agent_trace' };
    }
  } else {
    evaluationName = parsedInput.configuration.evaluationName;
    const scenarioArtifact = {
      primaryModelId: parsedInput.configuration.primaryModelId,
      comparisonModelIds: parsedInput.configuration.comparisonModelIds,
      promptText: parsedInput.configuration.promptText,
      scenarios: parsedInput.configuration.scenarios,
    } satisfies Record<string, z.infer<typeof z.json>>;

    configuration = {
      contextName: parsedInput.configuration.contextName ?? 'Scenario Evaluation',
      contextType: 'scenario',
      artifact: scenarioArtifact,
      expected: parsedInput.configuration.expected ?? parsedInput.configuration.promptText,
      referenceDocuments: parsedInput.configuration.referenceDocuments ?? [],
      selectedMetrics: parsedInput.configuration.selectedMetrics,
      ...(parsedInput.configuration.temperatureContext !== undefined
        ? { temperatureContext: parsedInput.configuration.temperatureContext }
        : {}),
    };
  }

  return {
    methodology,
    ...(evaluationName !== undefined ? { evaluationName } : {}),
    configuration,
  };
}

function availableModelById(models: readonly SupportedModel[]): Map<string, SupportedModel> {
  return new Map(
    models
      .filter((model) => !model.isDeprecated && !model.isLocked)
      .map((model) => [model.id.toLowerCase(), model]),
  );
}

function requireEnabledModel(
  modelId: string,
  role: string,
  modelsById: ReadonlyMap<string, SupportedModel>,
): SupportedModel {
  const parsedId = z.uuid().safeParse(modelId);
  if (!parsedId.success) {
    throw new AutoevalError(
      `${role} model ID "${modelId}" must be a UUID. Replace it with an ID from "autoeval models"`,
      { kind: 'validation', code: 'INVALID_MODEL_ID', cause: parsedId.error },
    );
  }
  const model = modelsById.get(parsedId.data.toLowerCase());
  if (!model) {
    throw new AutoevalError(
      `${role} model ID ${parsedId.data} is not enabled for this account. Run "autoeval models" and choose an enabled model ID`,
      { kind: 'validation', code: 'MODEL_NOT_ENABLED' },
    );
  }
  return model;
}

function modelRoleError(message: string): never {
  throw new AutoevalError(`${message}. Choose a different model ID for that role`, {
    kind: 'validation',
    code: 'MODEL_ROLE_CONFLICT',
  });
}

export function validateConfiguredRunInput(
  input: ParsedConfiguredRunInput,
  enabledModels: readonly SupportedModel[],
): ConfiguredRunValidationResult {
  const modelsById = availableModelById(enabledModels);
  const judge = requireEnabledModel(input.methodology.judgeModelId, 'Judge', modelsById);
  const judgeId = judge.id.toLowerCase();

  if (input.configuration.contextType === 'conversation') {
    const artifact = conversationArtifactSchema.safeParse(input.configuration.artifact);
    if (!artifact.success) throw invalidInput(artifact.error);
    return {
      valid: true,
      contextType: 'conversation',
      artifactCount: artifact.data.messages.length,
      models: { judge, comparisons: [] },
    };
  }

  if (input.configuration.contextType === 'agent_trace') {
    const artifact = agentTraceArtifactSchema.safeParse(input.configuration.artifact);
    if (!artifact.success) throw invalidInput(artifact.error);
    return {
      valid: true,
      contextType: 'agent_trace',
      artifactCount: artifact.data.trace.resourceSpans.length,
      models: { judge, comparisons: [] },
    };
  }

  const artifact = scenarioArtifactSchema.safeParse(input.configuration.artifact);
  if (!artifact.success) throw invalidInput(artifact.error);

  const primary = requireEnabledModel(artifact.data.primaryModelId, 'Primary', modelsById);
  const primaryId = primary.id.toLowerCase();
  if (primaryId === judgeId) {
    modelRoleError('The judge model cannot also be the primary model');
  }

  const seenComparisonIds = new Set<string>();
  const comparisons = artifact.data.comparisonModelIds.map((modelId, index) => {
    const comparison = requireEnabledModel(modelId, `Comparison ${index + 1}`, modelsById);
    const comparisonId = comparison.id.toLowerCase();
    if (comparisonId === judgeId) {
      modelRoleError('The judge model cannot also be a comparison model');
    }
    if (comparisonId === primaryId) {
      modelRoleError('The primary model cannot also be a comparison model');
    }
    if (seenComparisonIds.has(comparisonId)) {
      throw new AutoevalError(
        `Comparison model ID ${comparison.id} is duplicated. Remove duplicate comparison models and validate again`,
        { kind: 'validation', code: 'DUPLICATE_COMPARISON_MODEL' },
      );
    }
    seenComparisonIds.add(comparisonId);
    return comparison;
  });

  const scenarios = artifact.data.scenarios;
  const artifactCount = Array.isArray(scenarios[0]) ? scenarios[0].length : scenarios.length;
  return {
    valid: true,
    contextType: 'scenario',
    artifactCount,
    models: { judge, primary, comparisons },
  };
}

/** Applies explicit CLI model UUIDs without mutating the parsed file input. */
export function applyModelOverrides(
  input: ParsedConfiguredRunInput,
  overrides: ConfiguredRunModelOverrides,
): ParsedConfiguredRunInput {
  const methodology = {
    ...input.methodology,
    ...(overrides.judgeModelId === undefined ? {} : { judgeModelId: overrides.judgeModelId }),
  };

  if (input.configuration.contextType !== 'scenario' || overrides.primaryModelId === undefined) {
    return { ...input, methodology };
  }

  return {
    ...input,
    methodology,
    configuration: {
      ...input.configuration,
      artifact: {
        ...input.configuration.artifact,
        primaryModelId: overrides.primaryModelId,
      },
    },
  };
}

/** Fails fast when a sanitized public fixture was not given account model UUIDs. */
export function requireModelOverridesForPublicPlaceholders(input: ParsedConfiguredRunInput): void {
  if (input.methodology.judgeModelId === PUBLIC_JUDGE_MODEL_PLACEHOLDER) {
    throw new AutoevalError(
      'This eval file contains a synthetic judge model UUID. Run "autoeval models" and pass --judge-model-id <uuid>',
      { kind: 'validation', code: 'MODEL_OVERRIDE_REQUIRED' },
    );
  }

  if (
    input.configuration.contextType === 'scenario' &&
    input.configuration.artifact.primaryModelId === PUBLIC_PRIMARY_MODEL_PLACEHOLDER
  ) {
    throw new AutoevalError(
      'This eval file contains a synthetic primary model UUID. Run "autoeval models" and pass --primary-model-id <uuid>',
      { kind: 'validation', code: 'MODEL_OVERRIDE_REQUIRED' },
    );
  }
}
