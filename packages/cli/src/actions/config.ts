import { AutoevalError } from '../errors/autoeval-error.js';
import { containsCliCredential } from '../auth/redact.js';
import type { AutoevalSettings } from '../settings/settings.js';

/**
 * Pure helpers for the `config` command group. The executor owns reading and
 * writing the settings file; these functions validate a new value and compute
 * the view used for display. Credential-shaped values are rejected before they
 * can enter a settings object or output path.
 */
export type ConfigField = 'defaultWorkspaceId' | 'defaultJudgeModelId' | 'defaultPrimaryModelId';

export function setConfigValue(
  settings: AutoevalSettings,
  field: ConfigField,
  rawValue: string,
): AutoevalSettings {
  const value = rawValue.trim();
  if (value === '') {
    throw new AutoevalError(`A non-empty value is required for ${field}.`, {
      kind: 'usage',
      code: 'INVALID_CONFIG_VALUE',
    });
  }
  if (containsCliCredential(value)) {
    throw new AutoevalError(`A credential cannot be saved as ${field}.`, {
      kind: 'validation',
      code: 'INVALID_CONFIG_VALUE',
    });
  }
  return { ...settings, [field]: value };
}

export type ConfigRow = { label: string; value: string };

/** Ordered rows for human display; unset defaults read as "(not set)". */
export function describeSettings(settings: AutoevalSettings): ConfigRow[] {
  const show = (value: string | undefined): string =>
    value !== undefined && value !== '' ? value : '(not set)';
  return [
    { label: 'Default workspace', value: show(settings.defaultWorkspaceId) },
    { label: 'Default judge model', value: show(settings.defaultJudgeModelId) },
    { label: 'Default primary model', value: show(settings.defaultPrimaryModelId) },
  ];
}
