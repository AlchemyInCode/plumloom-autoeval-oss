import type { SupportedModel, Workspace } from '../domain/types.js';
import { AutoevalError } from '../errors/autoeval-error.js';
import type { BundledPack } from '../packs/registry.js';
import {
  enabledModels,
  selectQuickstartModel,
  selectQuickstartWorkspace,
  type ModelRole,
} from '../quickstart/selection.js';
import { resolveModelIds, resolveWorkspaceId } from '../settings/resolve.js';
import type { AutoevalSettings } from '../settings/settings.js';
import type { ActionContext } from './context.js';
import { getModels } from './models.js';
import { packRequiresPrimaryModel } from './pack.js';
import type { SuiteSummary } from './suite.js';
import { listWorkspaces } from './workspaces.js';

export type ResolvedInitDefaults = {
  workspaceId: string;
  judgeModelId: string;
  /** Present only for scenario packs, which grade a model under test. */
  primaryModelId?: string;
};

export function settingsToPersist(
  current: AutoevalSettings,
  resolved: ResolvedInitDefaults,
): AutoevalSettings {
  return {
    ...current,
    version: 1,
    defaultWorkspaceId: resolved.workspaceId,
    defaultJudgeModelId: resolved.judgeModelId,
    ...(resolved.primaryModelId !== undefined
      ? { defaultPrimaryModelId: resolved.primaryModelId }
      : {}),
  };
}

export type ActivationSelection = {
  workspace: Workspace;
  judge: SupportedModel;
  primary?: SupportedModel;
};

export type ActivationResult = ActivationSelection & {
  summary: SuiteSummary;
  persistedDefaults: boolean;
};

export type RunActivationInput = {
  pack: BundledPack;
  settings: AutoevalSettings;
  workspaceId?: string;
  judgeModelId?: string;
  primaryModelId?: string;
  /** Used by `init --yes`; selects the first ordered candidate instead of prompting. */
  assumeFirstChoice?: boolean;
  chooseWorkspace?: (candidates: readonly Workspace[]) => Promise<Workspace>;
  chooseModel?: (role: ModelRole, candidates: readonly SupportedModel[]) => Promise<SupportedModel>;
  runPack: (selection: ActivationSelection) => Promise<SuiteSummary>;
  /** Present for init only. Failure is fatal because persisted defaults are required. */
  persistSettings?: (settings: AutoevalSettings) => Promise<void>;
  signal?: AbortSignal;
};

function workspaceRequired(): AutoevalError {
  return new AutoevalError(
    'More than one workspace is available. Save one with "autoeval config set-workspace <workspace-id>", pass --workspace to init, or run in a terminal to choose.',
    { kind: 'usage', code: 'INIT_WORKSPACE_REQUIRED' },
  );
}

function modelRequired(): AutoevalError {
  return new AutoevalError(
    'More than one model is enabled and none matches the preference list. Save model defaults with "autoeval config", pass model IDs to init, or run in a terminal to choose; "autoeval models" lists IDs.',
    { kind: 'usage', code: 'INIT_MODEL_REQUIRED' },
  );
}

async function resolveWorkspace(
  candidates: readonly Workspace[],
  overrideId: string | undefined,
  input: RunActivationInput,
): Promise<Workspace> {
  const resolution = selectQuickstartWorkspace(candidates, overrideId);
  if (resolution.kind === 'resolved') return resolution.workspace;
  if (input.assumeFirstChoice === true) {
    const first = resolution.candidates[0];
    if (first !== undefined) return first;
  }
  if (input.chooseWorkspace === undefined) throw workspaceRequired();
  return input.chooseWorkspace(resolution.candidates);
}

async function resolveModel(
  candidates: readonly SupportedModel[],
  role: ModelRole,
  overrideId: string | undefined,
  input: RunActivationInput,
  excludeModelId?: string,
): Promise<SupportedModel> {
  const resolution = selectQuickstartModel(candidates, role, overrideId, excludeModelId);
  if (resolution.kind === 'resolved') return resolution.model;
  if (input.assumeFirstChoice === true) {
    const first = resolution.candidates[0];
    if (first !== undefined) return first;
  }
  if (input.chooseModel === undefined) throw modelRequired();
  return input.chooseModel(role, resolution.candidates);
}

/**
 * Shared activation workflow used by `init` and `pack run`. The CLI supplies
 * prompt and filesystem ports; workspace/model resolution, run sequencing,
 * success determination, and required persistence remain reusable product logic.
 */
export async function runActivation(
  context: ActionContext,
  input: RunActivationInput,
): Promise<ActivationResult> {
  const workspacePage = await listWorkspaces(context, {}, input.signal);
  const workspace = await resolveWorkspace(
    workspacePage.items,
    resolveWorkspaceId(input.workspaceId, input.settings),
    input,
  );

  const models = enabledModels(await getModels(context, input.signal));
  const resolvedModelIds = resolveModelIds(input, input.settings);
  const judge = await resolveModel(models, 'judge', resolvedModelIds.judgeModelId, input);
  const primary = packRequiresPrimaryModel(input.pack.context)
    ? await resolveModel(models, 'primary', resolvedModelIds.primaryModelId, input, judge.id)
    : undefined;
  const selection: ActivationSelection = {
    workspace,
    judge,
    ...(primary === undefined ? {} : { primary }),
  };

  const summary = await input.runPack(selection);
  let persistedDefaults = false;
  if (summary.failed === 0 && input.persistSettings !== undefined) {
    await input.persistSettings(
      settingsToPersist(input.settings, {
        workspaceId: workspace.id,
        judgeModelId: judge.id,
        ...(primary === undefined ? {} : { primaryModelId: primary.id }),
      }),
    );
    persistedDefaults = true;
  }

  return { ...selection, summary, persistedDefaults };
}

/** Produces the non-zero error used after a failed activation summary is rendered. */
export function activationRunFailure(summary: SuiteSummary, code: string): AutoevalError {
  const failed = summary.evals
    .filter((entry) => entry.status !== 'completed')
    .map((entry) => `${entry.inputFile} (${entry.status})`)
    .join(', ');
  return new AutoevalError(
    `${summary.failed} of ${summary.total} evaluation(s) did not finish: ${failed}.`,
    { kind: 'run_failed', code },
  );
}
