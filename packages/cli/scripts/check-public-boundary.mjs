#!/usr/bin/env node
/**
 * Architectural guard for the public CLI package. It enforces two invariants:
 *
 * 1. No reference — import or otherwise — to the removed conversation package.
 * 2. No static conversational/planner knowledge in the shipped sources, so the
 *    public CLI behaves as if conversation was never part of the product.
 *
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
// Both guard scripts must name the forbidden vocabulary to check for it.
const GUARD_FILES = new Set([
  join('scripts', 'check-public-boundary.mjs'),
  join('scripts', 'check-package-contents.mjs'),
]);

const CLOSED_PACKAGE_PATTERNS = [
  /@plumloom\/autoeval-conversation/u,
  /['"][^'"]*packages\/conversation[^'"]*['"]/u,
  /\.\.\/\.\.\/conversation\//u,
];

// Shipped sources must not mention the conversational surface at all.
const CONVERSATION_SURFACE_PATTERNS = [
  /AUTOEVAL_CONVERSATION/u,
  /AUTOEVAL_PLANNER_PROVIDER/u,
  /OPENAI_API_KEY/u,
  /AUTOEVAL_OPENAI_/u,
  /\bchat\b/iu,
  /\bplanner\b/iu,
  /\bconversational\b/iu,
];

async function* walk(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      yield* walk(full);
    } else if (/\.(ts|mts|js|mjs)$/u.test(entry.name)) {
      yield full;
    }
  }
}

const violations = [];

for (const directory of ['src', 'tests', 'scripts']) {
  for await (const file of walk(join(packageRoot, directory))) {
    const relativePath = relative(packageRoot, file);
    if (GUARD_FILES.has(relativePath)) continue;
    const contents = await readFile(file, 'utf8');
    for (const pattern of CLOSED_PACKAGE_PATTERNS) {
      if (pattern.test(contents)) {
        violations.push(`${relativePath}: references the removed package (${pattern.source})`);
      }
    }
    // Tests are allowed to assert the absence of the surface; sources are not.
    if (!relativePath.startsWith('tests')) {
      for (const pattern of CONVERSATION_SURFACE_PATTERNS) {
        if (pattern.test(contents)) {
          violations.push(
            `${relativePath}: mentions the conversational surface (${pattern.source})`,
          );
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Public boundary violated:');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log('Public boundary intact: packages/cli carries no conversation or planner surface.');
