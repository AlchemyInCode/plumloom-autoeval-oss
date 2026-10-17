import { randomBytes } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { z } from 'zod';

import { containsCliCredential } from '../auth/redact.js';
import { AutoevalError } from '../errors/autoeval-error.js';

/**
 * The first on-disk settings file. It holds only non-secret user defaults so
 * commands stop demanding a workspace or model UUID every time.
 *
 * It never holds the API key (that stays in the OS keyring, ADR 0002) and never
 * holds an API base URL (ADR 0011). See ADR 0014 for the full rationale.
 */
export type AutoevalSettings = {
  version: 1;
  defaultWorkspaceId?: string;
  defaultJudgeModelId?: string;
  defaultPrimaryModelId?: string;
  /** Owned by SPEC-02 (opt-in telemetry); the field is reserved here. */
  telemetryOptIn?: boolean;
};

export type SettingsEnvironment = Readonly<Record<string, string | undefined>>;

export type LoadSettingsOptions = {
  /** Overrides the resolved file path; used for hermetic tests and injection. */
  path?: string;
  /** Overrides the environment used to resolve the default path. */
  env?: SettingsEnvironment;
  /** Receives a human-readable message when a present file could not be used. */
  onDiagnostic?: (message: string) => void;
};

export type WriteSettingsOptions = {
  path?: string;
  env?: SettingsEnvironment;
};

const DEFAULT_SETTINGS: AutoevalSettings = { version: 1 };

/** A corrupt or oversized settings file degrades to defaults, never a crash. */
const MAX_SETTINGS_BYTES = 64 * 1024;

/**
 * IDs are stored as non-empty strings rather than strict UUIDs so `config
 * set-*` works offline and the value is validated lazily when it is used.
 */
const nonSecretSettingSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !containsCliCredential(value), {
    message: 'Settings values must not contain an Autoeval CLI credential.',
  });

const settingsSchema = z
  .object({
    version: z.literal(1),
    defaultWorkspaceId: nonSecretSettingSchema.optional(),
    defaultJudgeModelId: nonSecretSettingSchema.optional(),
    defaultPrimaryModelId: nonSecretSettingSchema.optional(),
    telemetryOptIn: z.boolean().optional(),
  })
  .strip();

function resolveEnvironment(env: SettingsEnvironment | undefined): SettingsEnvironment {
  return env ?? process.env;
}

export function settingsDirectory(env?: SettingsEnvironment): string {
  const environment = resolveEnvironment(env);
  const configHome = environment.XDG_CONFIG_HOME;
  const base =
    configHome !== undefined && configHome.trim() !== '' ? configHome : join(homedir(), '.config');
  return join(base, 'autoeval');
}

export function settingsPath(env?: SettingsEnvironment): string {
  return join(settingsDirectory(env), 'settings.json');
}

function normalizeSettings(parsed: z.infer<typeof settingsSchema>): AutoevalSettings {
  return {
    version: 1,
    ...(parsed.defaultWorkspaceId !== undefined
      ? { defaultWorkspaceId: parsed.defaultWorkspaceId }
      : {}),
    ...(parsed.defaultJudgeModelId !== undefined
      ? { defaultJudgeModelId: parsed.defaultJudgeModelId }
      : {}),
    ...(parsed.defaultPrimaryModelId !== undefined
      ? { defaultPrimaryModelId: parsed.defaultPrimaryModelId }
      : {}),
    ...(parsed.telemetryOptIn !== undefined ? { telemetryOptIn: parsed.telemetryOptIn } : {}),
  };
}

/**
 * Reads settings from disk. A missing file returns defaults silently; a present
 * but unreadable, oversized, or invalid file returns defaults and reports a
 * diagnostic. This never throws, so it can run at the top of any command.
 */
export async function loadSettings(options: LoadSettingsOptions = {}): Promise<AutoevalSettings> {
  const filePath = options.path ?? settingsPath(options.env);
  let handle;
  let contents: string;
  try {
    handle = await open(filePath, 'r');
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      options.onDiagnostic?.(`Ignoring settings at ${filePath}: not a regular file.`);
      return DEFAULT_SETTINGS;
    }
    if (metadata.size > MAX_SETTINGS_BYTES) {
      options.onDiagnostic?.(`Ignoring settings at ${filePath}: file exceeds the size limit.`);
      return DEFAULT_SETTINGS;
    }
    contents = await handle.readFile('utf8');
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : undefined;
    if (code !== 'ENOENT') {
      options.onDiagnostic?.(`Ignoring settings at ${filePath}: ${code ?? 'could not be read'}.`);
    }
    return DEFAULT_SETTINGS;
  } finally {
    await handle?.close();
  }

  let documentJson: unknown;
  try {
    documentJson = JSON.parse(contents) as unknown;
  } catch {
    options.onDiagnostic?.(`Ignoring settings at ${filePath}: file is not valid JSON.`);
    return DEFAULT_SETTINGS;
  }

  const parsed = settingsSchema.safeParse(documentJson);
  if (!parsed.success) {
    options.onDiagnostic?.(`Ignoring settings at ${filePath}: file did not match the schema.`);
    return DEFAULT_SETTINGS;
  }
  return normalizeSettings(parsed.data);
}

/**
 * Writes settings atomically with `0600` permissions. The temporary file is
 * created with the `wx` flag (`O_EXCL`), so the write fails rather than
 * following or overwriting a pre-planted file or symlink at the temp path, and
 * uses a random suffix to avoid predictable names. It is `fsync`ed and then
 * renamed over the target, so a partial write can never replace a good file.
 */
export async function saveSettings(
  next: AutoevalSettings,
  options: WriteSettingsOptions = {},
): Promise<void> {
  const parsed = settingsSchema.safeParse(next);
  if (!parsed.success) {
    throw new AutoevalError('Refusing to write invalid Autoeval settings.', {
      kind: 'validation',
      code: 'SETTINGS_WRITE_FAILED',
      cause: parsed.error,
    });
  }
  const validated = normalizeSettings(parsed.data);

  const filePath = options.path ?? settingsPath(options.env);
  const directory = dirname(filePath);
  const temporaryPath = `${filePath}.${randomBytes(12).toString('hex')}.tmp`;
  const body = `${JSON.stringify(validated, null, 2)}\n`;
  let createdTemporaryFile = false;
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    // `wx` = O_CREAT | O_EXCL: never follow or overwrite an existing path.
    const handle = await open(temporaryPath, 'wx', 0o600);
    createdTemporaryFile = true;
    try {
      await handle.writeFile(body, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, filePath);
    createdTemporaryFile = false;
  } catch (error) {
    if (createdTemporaryFile) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
    throw new AutoevalError('The Autoeval settings file could not be written.', {
      kind: 'usage',
      code: 'SETTINGS_WRITE_FAILED',
      cause: error,
    });
  }
}

/** Removes the settings file. A missing file is treated as already cleared. */
export async function clearSettings(options: WriteSettingsOptions = {}): Promise<void> {
  const filePath = options.path ?? settingsPath(options.env);
  try {
    await rm(filePath, { force: true });
  } catch (error) {
    throw new AutoevalError('The Autoeval settings file could not be removed.', {
      kind: 'usage',
      code: 'SETTINGS_WRITE_FAILED',
      cause: error,
    });
  }
}
