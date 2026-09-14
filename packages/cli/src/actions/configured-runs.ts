import type { RunExecution, RunHandle, RunStatus } from '../domain/types.js';
import type { PollClock } from '../polling/clock.js';
import {
  type ConfiguredRunValidationResult,
  type ConfiguredRunModelOverrides,
  type ParsedConfiguredRunInput,
  applyModelOverrides,
  validateConfiguredRunInput,
} from '../configured-run/validation.js';
import type { ActionContext } from './context.js';
import { createConfiguredRun, createConfiguredRunSubmission } from './evaluations.js';
import { getModels } from './models.js';

export async function validateConfiguredEvaluation(
  context: ActionContext,
  input: ParsedConfiguredRunInput,
  signal?: AbortSignal,
): Promise<ConfiguredRunValidationResult> {
  const models = await getModels(context, signal);
  return validateConfiguredRunInput(input, models);
}

export async function runConfiguredEvaluation(
  context: ActionContext,
  input: {
    evaluationId: string;
    configuredRun: ParsedConfiguredRunInput;
    clock: PollClock;
    pollIntervalMs: number;
    pollTimeoutMs: number;
    signal?: AbortSignal;
    onStatus?: (status: RunStatus) => void;
    modelOverrides?: ConfiguredRunModelOverrides;
    /** The caller already completed model preflight before creating the evaluation. */
    prevalidated?: boolean;
  },
): Promise<RunExecution> {
  const configuredRun = applyModelOverrides(input.configuredRun, input.modelOverrides ?? {});
  if (!input.prevalidated) {
    await validateConfiguredEvaluation(context, configuredRun, input.signal);
  }
  return createConfiguredRun(context, {
    evaluationId: input.evaluationId,
    methodology: configuredRun.methodology,
    configuration: configuredRun.configuration,
    clock: input.clock,
    pollIntervalMs: input.pollIntervalMs,
    pollTimeoutMs: input.pollTimeoutMs,
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.onStatus ? { onStatus: input.onStatus } : {}),
  });
}

export async function submitConfiguredEvaluation(
  context: ActionContext,
  input: {
    evaluationId: string;
    configuredRun: ParsedConfiguredRunInput;
    signal?: AbortSignal;
    idempotencyKeyFactory?: () => string;
    modelOverrides?: ConfiguredRunModelOverrides;
  },
): Promise<RunHandle> {
  const configuredRun = applyModelOverrides(input.configuredRun, input.modelOverrides ?? {});
  await validateConfiguredEvaluation(context, configuredRun, input.signal);
  return createConfiguredRunSubmission(context, {
    evaluationId: input.evaluationId,
    methodology: configuredRun.methodology,
    configuration: configuredRun.configuration,
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.idempotencyKeyFactory ? { idempotencyKeyFactory: input.idempotencyKeyFactory } : {}),
  });
}
