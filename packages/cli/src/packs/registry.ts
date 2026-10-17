import type { EvaluationContextType } from '../domain/types.js';
import type { SuiteGatePolicy } from '../gate/policy.js';
import { AutoevalError } from '../errors/autoeval-error.js';
import { BUNDLED_PACKS } from './data.js';

/**
 * A pack is a named, versioned bundle: a suite manifest plus its eval files,
 * installable by name and runnable with zero IDs. Pack metadata carries no
 * account-specific IDs; eval files contain public synthetic placeholders that
 * are replaced in memory by the judge (and scenario model under test) selected
 * at run time.
 *
 * `examples/packs/<name>/` is the human-readable source of truth. `data.ts` is
 * the generated, shipped copy (see `scripts/build-pack-data.mjs`). A drift test
 * asserts the two stay identical.
 */
export type BundledPackFile = {
  /** Path relative to the pack root, for example `evals/answer-quality.json`. */
  relativePath: string;
  /** Verbatim file contents, written to disk unchanged on `pack add`. */
  contents: string;
};

export type BundledPack = {
  name: string;
  version: number;
  title: string;
  description: string;
  context: EvaluationContextType;
  /** Eval file paths, relative to the pack root, in manifest order. */
  evals: readonly string[];
  /** Optional default release gate, in suite-gate policy shape. */
  gate?: SuiteGatePolicy;
  files: readonly BundledPackFile[];
};

export function listPacks(): readonly BundledPack[] {
  return BUNDLED_PACKS;
}

export function findPack(name: string): BundledPack | undefined {
  return BUNDLED_PACKS.find((pack) => pack.name === name);
}

export function requirePack(name: string): BundledPack {
  const pack = findPack(name);
  if (pack === undefined) {
    const available = BUNDLED_PACKS.map((entry) => entry.name).join(', ');
    throw new AutoevalError(
      `Unknown pack "${name}". Run "autoeval pack list" to see the available packs: ${available}.`,
      { kind: 'usage', code: 'PACK_NOT_FOUND' },
    );
  }
  return pack;
}

/** The default pack installed by `autoeval init` when none is requested. */
export const DEFAULT_PACK_NAME = 'support-bot';
