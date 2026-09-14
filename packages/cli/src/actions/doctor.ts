import type { ParsedConfiguredRunInput } from '../configured-run/validation.js';
import { validateConfiguredRunInput } from '../configured-run/validation.js';
import { redactText } from '../auth/redact.js';
import type { SupportedModel } from '../domain/types.js';
import { AutoevalError } from '../errors/autoeval-error.js';
import type { SuiteManifest } from '../suite/manifest.js';
import type { ActionContext } from './context.js';
import { getModels } from './models.js';
import { whoAmI } from './identity.js';
import { getWorkspace } from './workspaces.js';

/**
 * Pre-flight diagnostics.
 *
 * A suite run costs time and evaluation usage, so the failures worth catching
 * are the ones that are knowable before the first run is submitted: an API key
 * that cannot authenticate, a workspace the key cannot reach, a model ID that
 * is not enabled for the account, and an eval or manifest file that does not
 * parse. Every check reads only what the CLI already reads elsewhere; nothing
 * here creates evaluations or submits runs.
 */

export type DoctorCheckStatus = 'pass' | 'fail' | 'skipped';

export type DoctorCheck = {
  /** Stable machine identifier, e.g. `auth`, `workspace`, `eval:./refund.json`. */
  id: string;
  label: string;
  status: DoctorCheckStatus;
  detail: string;
  /** Actionable next step, present only for a failing check. */
  hint?: string;
};

export type DoctorReport = {
  status: 'ready' | 'blocked';
  counts: Record<DoctorCheckStatus, number>;
  checks: DoctorCheck[];
};

export type DoctorInput = {
  /** Workspace to verify; falls back to the manifest's workspace when omitted. */
  workspaceId?: string;
  manifestFile?: string;
  /** Reads and parses the suite manifest. Injected so file IO stays out of actions. */
  loadManifest?: () => Promise<SuiteManifest>;
  /** Eval files to check in addition to the manifest's entries. */
  evalFiles?: readonly string[];
  /** Reads, expands, and parses one eval file. */
  loadEvalFile: (inputFile: string) => Promise<ParsedConfiguredRunInput>;
  signal?: AbortSignal;
};

function errorMessage(error: unknown): string {
  return redactText(error instanceof Error ? error.message : String(error));
}

function pass(id: string, label: string, detail: string): DoctorCheck {
  return { id, label, status: 'pass', detail };
}

function fail(id: string, label: string, detail: string, hint: string): DoctorCheck {
  return { id, label, status: 'fail', detail, hint };
}

function skipped(id: string, label: string, detail: string): DoctorCheck {
  return { id, label, status: 'skipped', detail };
}

function summarize(checks: readonly DoctorCheck[]): DoctorReport {
  const counts: Record<DoctorCheckStatus, number> = { pass: 0, fail: 0, skipped: 0 };
  for (const check of checks) counts[check.status] += 1;
  return { status: counts.fail === 0 ? 'ready' : 'blocked', counts, checks: [...checks] };
}

async function checkManifest(
  input: DoctorInput,
): Promise<{ check: DoctorCheck; manifest?: SuiteManifest }> {
  const id = 'manifest';
  const label = 'Manifest syntax';
  if (input.loadManifest === undefined) {
    return { check: skipped(id, label, 'No manifest was provided.') };
  }
  const file = input.manifestFile ?? 'suite manifest';
  try {
    const manifest = await input.loadManifest();
    return {
      check: pass(id, label, `${file} lists ${manifest.entries.length} eval file(s).`),
      manifest,
    };
  } catch (error) {
    return {
      check: fail(
        id,
        label,
        `${file}: ${errorMessage(error)}`,
        'Fix the manifest so it parses as YAML or JSON with a workspace and evals.',
      ),
    };
  }
}

async function checkEvalFile(
  input: DoctorInput,
  inputFile: string,
  models: readonly SupportedModel[] | undefined,
): Promise<DoctorCheck> {
  const id = `eval:${inputFile}`;
  const label = inputFile;
  let configuredRun: ParsedConfiguredRunInput;
  try {
    configuredRun = await input.loadEvalFile(inputFile);
  } catch (error) {
    return fail(
      id,
      label,
      errorMessage(error),
      'Fix the eval file so it parses and matches the configured-run schema.',
    );
  }

  if (models === undefined) {
    return skipped(
      id,
      label,
      `${configuredRun.configuration.contextType} eval parsed; models were not probed.`,
    );
  }

  try {
    const validation = validateConfiguredRunInput(configuredRun, models);
    const probed = [
      validation.models.judge,
      ...(validation.models.primary ? [validation.models.primary] : []),
      ...validation.models.comparisons,
    ].length;
    return pass(
      id,
      label,
      `${validation.contextType} eval is valid; ${probed} model(s) enabled for this account.`,
    );
  } catch (error) {
    return fail(
      id,
      label,
      errorMessage(error),
      'Run "autoeval models" and use an enabled model ID.',
    );
  }
}

/** Runs every pre-flight check and returns one report; it never throws for a failing check. */
export async function runDoctor(context: ActionContext, input: DoctorInput): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];

  let authenticated = false;
  try {
    await whoAmI(context, input.signal);
    authenticated = true;
    checks.push(pass('auth', 'Auth and scopes', 'Authenticated with a valid CLI identity.'));
  } catch (error) {
    checks.push(
      fail(
        'auth',
        'Auth and scopes',
        errorMessage(error),
        'Run "autoeval login" or set AUTOEVAL_API_KEY to a valid CLI key.',
      ),
    );
  }

  const manifestResult = await checkManifest(input);
  checks.push(manifestResult.check);

  const workspaceId = input.workspaceId ?? manifestResult.manifest?.workspaceId;
  if (!authenticated) {
    checks.push(skipped('workspace', 'Workspace scope', 'Skipped because authentication failed.'));
  } else if (workspaceId === undefined) {
    checks.push(skipped('workspace', 'Workspace scope', 'No workspace was provided.'));
  } else {
    try {
      await getWorkspace(context, workspaceId, input.signal);
      checks.push(pass('workspace', 'Workspace scope', 'The selected workspace is reachable.'));
    } catch (error) {
      checks.push(
        fail(
          'workspace',
          'Workspace scope',
          errorMessage(error),
          'Run "autoeval workspace list" and use a workspace this key can reach.',
        ),
      );
    }
  }

  let models: SupportedModel[] | undefined;
  if (!authenticated) {
    checks.push(skipped('models', 'Model catalog', 'Skipped because authentication failed.'));
  } else {
    try {
      models = await getModels(context, input.signal);
      const enabled = models.filter((model) => !model.isDeprecated && !model.isLocked).length;
      checks.push(
        pass('models', 'Model catalog', `${enabled} of ${models.length} model(s) are usable.`),
      );
    } catch (error) {
      checks.push(
        fail(
          'models',
          'Model catalog',
          errorMessage(error),
          'Confirm the account has BYOK models enabled, then retry.',
        ),
      );
    }
  }

  const evalFiles = [
    ...(manifestResult.manifest?.evalFiles ?? []),
    ...(input.evalFiles ?? []),
  ].filter((file, index, all) => all.indexOf(file) === index);

  for (const inputFile of evalFiles) {
    checks.push(await checkEvalFile(input, inputFile, models));
  }

  return summarize(checks);
}

/** CI exit decision: a blocked report must fail the command. */
export function doctorExitError(report: DoctorReport): AutoevalError | undefined {
  if (report.status === 'ready') return undefined;
  return new AutoevalError(
    `Pre-flight check failed: ${report.counts.fail} of ${report.checks.length} checks did not pass.`,
    { kind: 'validation', code: 'DOCTOR_BLOCKED' },
  );
}
