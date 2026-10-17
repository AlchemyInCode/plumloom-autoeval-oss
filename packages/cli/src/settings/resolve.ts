import type { AutoevalSettings } from './settings.js';

/**
 * Resolution precedence for a workspace or model, applied in the command
 * activation/action workflow before model selection: explicit flag → saved settings default →
 * the existing interactive/auto behavior handled downstream (a return of
 * `undefined` means "fall through to that behavior"). See ADR 0014.
 */
export function resolveWorkspaceId(
  flag: string | undefined,
  settings: AutoevalSettings,
): string | undefined {
  return flag ?? settings.defaultWorkspaceId;
}

export type ModelIdFlags = {
  judgeModelId?: string;
  primaryModelId?: string;
};

export function resolveModelIds(flags: ModelIdFlags, settings: AutoevalSettings): ModelIdFlags {
  const judgeModelId = flags.judgeModelId ?? settings.defaultJudgeModelId;
  const primaryModelId = flags.primaryModelId ?? settings.defaultPrimaryModelId;
  return {
    ...(judgeModelId !== undefined ? { judgeModelId } : {}),
    ...(primaryModelId !== undefined ? { primaryModelId } : {}),
  };
}
