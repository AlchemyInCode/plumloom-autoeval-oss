import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { AutoevalError } from '../errors/autoeval-error.js';
import { mergePolicies, suiteGatePolicySchema, type SuiteGatePolicy } from '../gate/policy.js';

/**
 * A suite manifest is the CI unit of work: one file listing the eval files a
 * release is gated on. It carries no eval configuration of its own — artifact
 * and reference-document paths live inside each eval file — so the manifest
 * stays reviewable and stable across runs.
 *
 *   workspace: 4c1c8a3e-...
 *   gate:
 *     minOverall: 4.0
 *   evals:
 *     - ./evals/refund-policy.autoeval.json
 *     - file: ./evals/support-conversation.autoeval.json
 *       gate:
 *         metrics:
 *           factuality: 4.0
 *
 * YAML and JSON are both accepted; paths resolve relative to the manifest.
 * The optional `gate` blocks configure the release gate only; they are never
 * sent to the backend.
 */

const evalEntrySchema = z.union([
  z.string().trim().min(1),
  z
    .object({
      file: z.string().trim().min(1),
      gate: suiteGatePolicySchema.optional(),
    })
    .strict(),
]);

const manifestSchema = z
  .object({
    workspace: z.string().trim().min(1),
    gate: suiteGatePolicySchema.optional(),
    evals: z.array(evalEntrySchema).min(1),
  })
  .strict();

export type SuiteManifestEntry = {
  /** Eval file path, resolved against the manifest's directory. */
  file: string;
  /** Suite default merged with the per-eval override. */
  gate: SuiteGatePolicy;
};

export type SuiteManifest = {
  workspaceId: string;
  entries: readonly SuiteManifestEntry[];
  /** Eval file paths in manifest order. */
  evalFiles: readonly string[];
};

export function parseSuiteManifest(source: string, manifestPath: string): SuiteManifest {
  let document: unknown;
  try {
    document = parseYaml(source) as unknown;
  } catch (error) {
    throw new AutoevalError(`${manifestPath} is not valid YAML or JSON.`, {
      kind: 'usage',
      code: 'INVALID_SUITE_MANIFEST',
      cause: error,
    });
  }

  const parsed = manifestSchema.safeParse(document);
  if (!parsed.success) {
    const details = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.map(String).join('.') || 'manifest'}: ${issue.message}`)
      .join('; ');
    throw new AutoevalError(`${manifestPath} is not a valid suite manifest: ${details}.`, {
      kind: 'validation',
      code: 'INVALID_SUITE_MANIFEST_SCHEMA',
      cause: parsed.error,
    });
  }

  const baseDirectory = dirname(resolve(manifestPath));
  const toPath = (entry: string): string =>
    isAbsolute(entry) ? entry : resolve(baseDirectory, entry);

  const entries = parsed.data.evals.map<SuiteManifestEntry>((entry) =>
    typeof entry === 'string'
      ? { file: toPath(entry), gate: mergePolicies(parsed.data.gate, undefined) }
      : { file: toPath(entry.file), gate: mergePolicies(parsed.data.gate, entry.gate) },
  );

  return {
    workspaceId: parsed.data.workspace,
    entries,
    evalFiles: entries.map((entry) => entry.file),
  };
}

export async function readSuiteManifest(manifestPath: string): Promise<SuiteManifest> {
  let source: string;
  try {
    source = await readFile(manifestPath, 'utf8');
  } catch (error) {
    throw new AutoevalError(`Suite manifest was not found or could not be read: ${manifestPath}`, {
      kind: 'usage',
      code: 'SUITE_MANIFEST_READ_FAILED',
      cause: error,
    });
  }
  return parseSuiteManifest(source, manifestPath);
}
