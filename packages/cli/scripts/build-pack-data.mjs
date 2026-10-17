#!/usr/bin/env node
/**
 * Regenerates `src/packs/data.ts` from the human-readable pack sources under
 * `examples/packs/`. The examples are the source of truth; the generated TS
 * data module is what compiles into `dist` and ships, because the published
 * `files` allowlist is `dist, README.md, LICENSE, NOTICE` and cannot include
 * `examples/`.
 *
 * Run this after editing any pack, then rely on the pack drift test to confirm
 * the generated data still matches the sources.
 *
 * Usage: node scripts/build-pack-data.mjs
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = join(packageRoot, '..', '..');
const packsRoot = join(repoRoot, 'examples', 'packs');
const outputPath = join(packageRoot, 'src', 'packs', 'data.ts');

async function readPack(name) {
  const packDirectory = join(packsRoot, name);
  const manifestSource = await readFile(join(packDirectory, 'pack.yaml'), 'utf8');
  const manifest = parseYaml(manifestSource);
  const files = [{ relativePath: 'pack.yaml', contents: manifestSource }];
  for (const evalRelativePath of manifest.evals) {
    const contents = await readFile(join(packDirectory, evalRelativePath), 'utf8');
    files.push({ relativePath: evalRelativePath, contents });
  }
  return { manifest, files };
}

const packNames = (await readdir(packsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const packs = [];
for (const name of packNames) {
  const { manifest, files } = await readPack(name);
  packs.push({
    name: manifest.name,
    version: manifest.version,
    title: manifest.title,
    description: manifest.description,
    context: manifest.context,
    evals: manifest.evals,
    ...(manifest.gate === undefined ? {} : { gate: manifest.gate }),
    files,
  });
}

const header = `// GENERATED FILE — do not edit by hand.
//
// Regenerate with: node scripts/build-pack-data.mjs
// Source of truth: examples/packs/<name>/ (pack.yaml + eval files).
// The pack drift test asserts this data matches those sources byte for byte.

import type { BundledPack } from './registry.js';

export const BUNDLED_PACKS: readonly BundledPack[] = `;

const body = JSON.stringify(packs, null, 2);
await writeFile(outputPath, `${header}${body} as const;\n`, 'utf8');
console.log(`Wrote ${outputPath} (${packs.length} packs).`);
