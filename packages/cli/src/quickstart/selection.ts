import type { SupportedModel, Workspace } from '../domain/types.js';
import { AutoevalError } from '../errors/autoeval-error.js';

/**
 * Quickstart resolves the workspace and the two model roles itself so that a
 * first evaluation needs no UUID copy-paste.
 *
 * The model catalog exposes no judge/primary role eligibility: a supported
 * model carries only `isDeprecated` and `isLocked` (see
 * `AutoevalApi.getModels`). So both roles draw from the same candidate set —
 * every enabled model — and no role-eligibility concept is invented here.
 */

/**
 * Committed, ordered preference for the sample evaluation, best first. Entries
 * are matched case-insensitively against a model's `modelKey`, falling back to
 * its `apiModelId`. Changing this list is a reviewable code change.
 *
 * Quickstart optimises for time-to-first-result, so both roles prefer small,
 * fast models and fall back to larger ones only when no fast model is enabled.
 */
export const QUICKSTART_JUDGE_PREFERENCE: readonly string[] = [
  'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  'zai-org/GLM-5.3-Flash',
  'deepseek-ai/DeepSeek-V4-Flash-0731',
  'zai-org/GLM-5.3',
  'deepseek-ai/DeepSeek-V4-Pro-0813',
];

export const QUICKSTART_PRIMARY_PREFERENCE: readonly string[] = [
  'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  'zai-org/GLM-5.3-Flash',
  'deepseek-ai/DeepSeek-V4-Flash-0731',
  'zai-org/GLM-5.3',
];

export type ModelRole = 'judge' | 'primary';

export type WorkspaceResolution =
  | { kind: 'resolved'; workspace: Workspace }
  | { kind: 'choice-required'; candidates: readonly Workspace[] };

export type ModelResolution =
  | { kind: 'resolved'; model: SupportedModel }
  | { kind: 'choice-required'; role: ModelRole; candidates: readonly SupportedModel[] };

/** Enabled models, in catalog order. The only eligibility the schema exposes. */
export function enabledModels(models: readonly SupportedModel[]): SupportedModel[] {
  return models.filter((model) => !model.isDeprecated && !model.isLocked);
}

function modelIdentifiers(model: SupportedModel): string[] {
  return [model.modelKey, model.apiModelId]
    .filter((value): value is string => value !== undefined && value !== '')
    .map((value) => value.toLowerCase());
}

/**
 * Workspace rule: an explicit ID wins; a single workspace is used as-is; more
 * than one requires a choice. No workspace is ever created here, and no name
 * such as "Default Workspace" is treated as special.
 */
export function selectQuickstartWorkspace(
  workspaces: readonly Workspace[],
  overrideWorkspaceId?: string,
): WorkspaceResolution {
  if (overrideWorkspaceId !== undefined) {
    const wanted = overrideWorkspaceId.toLowerCase();
    const match = workspaces.find((workspace) => workspace.id.toLowerCase() === wanted);
    if (!match) {
      throw new AutoevalError(
        `Workspace ${overrideWorkspaceId} was not found for this account. Run "autoeval workspace list" to see your workspaces.`,
        { kind: 'validation', code: 'QUICKSTART_WORKSPACE_NOT_FOUND' },
      );
    }
    return { kind: 'resolved', workspace: match };
  }

  if (workspaces.length === 0) {
    throw new AutoevalError(
      'This account has no workspaces. Create one with "autoeval workspace create --name \'My workspace\'" and run quickstart again.',
      { kind: 'usage', code: 'QUICKSTART_NO_WORKSPACE' },
    );
  }

  const [only] = workspaces;
  if (workspaces.length === 1 && only) {
    return { kind: 'resolved', workspace: only };
  }

  const ordered = [...workspaces].sort(
    (left, right) =>
      right.evaluationCount - left.evaluationCount || left.name.localeCompare(right.name),
  );
  return { kind: 'choice-required', candidates: ordered };
}

/**
 * Model rule, in order:
 *   1. an explicit `--judge-model-id` / `--primary-model-id` wins;
 *   2. exactly one enabled model (the Free tier shape) is used silently;
 *   3. the first committed preference entry present in the catalog wins;
 *   4. otherwise a choice is required — never an implicit alphabetical pick.
 */
export function selectQuickstartModel(
  candidates: readonly SupportedModel[],
  role: ModelRole,
  overrideModelId?: string,
): ModelResolution {
  if (candidates.length === 0) {
    throw new AutoevalError(
      'No enabled models are available for this account. Run "autoeval models" and enable a model before running quickstart.',
      { kind: 'validation', code: 'QUICKSTART_NO_ENABLED_MODELS' },
    );
  }

  if (overrideModelId !== undefined) {
    const wanted = overrideModelId.toLowerCase();
    const match = candidates.find((model) => model.id.toLowerCase() === wanted);
    if (!match) {
      throw new AutoevalError(
        `${role === 'judge' ? 'Judge' : 'Primary'} model ID ${overrideModelId} is not enabled for this account. Run "autoeval models" and choose an enabled model UUID.`,
        { kind: 'validation', code: 'MODEL_NOT_ENABLED' },
      );
    }
    return { kind: 'resolved', model: match };
  }

  const [only] = candidates;
  if (candidates.length === 1 && only) {
    return { kind: 'resolved', model: only };
  }

  const preference = role === 'judge' ? QUICKSTART_JUDGE_PREFERENCE : QUICKSTART_PRIMARY_PREFERENCE;
  for (const preferred of preference) {
    const wanted = preferred.toLowerCase();
    const match = candidates.find((model) => modelIdentifiers(model).includes(wanted));
    if (match) return { kind: 'resolved', model: match };
  }

  return { kind: 'choice-required', role, candidates };
}
