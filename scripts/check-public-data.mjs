#!/usr/bin/env node
/**
 * Guards the public documentation, examples, packaged JSON, tests, and test
 * fixtures against real-looking identifiers and credentials.
 *
 * Public files may only contain synthetic placeholders:
 *   - UUIDs must be repeated-character v4 UUIDs, e.g. 11111111-1111-4111-8111-111111111111
 *   - email addresses must use an RFC 2606 reserved domain (example.com/net/org, *.invalid)
 *   - no credential-like values (pl_sk_*, sk-*, Bearer tokens, long base64/hex secrets)
 *   - no account identity fields (userSystemId values)
 *
 * Usage: node scripts/check-public-data.mjs [rootDir]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Directories scanned for public source and shipped-to-users data. */
export const PUBLIC_DATA_DIRS = ['examples', 'packages/cli/src/json', 'packages/cli/tests'];

/** Documentation files are scanned for concrete identifiers as well. */
export const PUBLIC_DOC_DIRS = ['docs'];

/** Public documentation and configuration that live at repository root. */
export const PUBLIC_ROOT_FILES = [
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'TROUBLESHOOTING.md',
  'AGENTS.md',
  'CODING_STANDARDS.md',
  '.env.example',
  'smoke-suite.yaml',
];

/** Local-only fixtures beneath otherwise public directories. */
const EXCLUDED_PATH_PREFIXES = ['packages/cli/src/json/local/'];
const EXCLUDED_PATHS = new Set([
  // This test intentionally embeds violating values to prove the scanner reports them.
  'packages/cli/tests/public-data-sanitization.test.ts',
]);

/**
 * Temporary, narrowly scoped exceptions for deferred OSS test-data sanitization.
 * Each exception requires the exact file, scanner rule, matched value, and
 * occurrence count so any additional or changed finding remains an error.
 */
const TEMPORARY_DEFERRED_TEST_FINDINGS = new Map([
  [
    'packages/cli/tests/auth.test.ts',
    new Map([
      [
        'Plumloom CLI key',
        new Map([
          ['pl_sk_should_not_be_used', 1],
          ['pl_sk_storedcredential123', 1],
          ['pl_sk_promptcredential123', 1],
        ]),
      ],
    ]),
  ],
  [
    'packages/cli/tests/commands.test.ts',
    new Map([['userSystemId value', new Map([['USR-3B98B101F7D2', 1]])]]),
  ],
  [
    'packages/cli/tests/configured-run-input.test.ts',
    new Map([['userSystemId value', new Map([['USR-3B98B101F7D2', 3]])]]),
  ],
  [
    'packages/cli/tests/configured-run-validation.test.ts',
    new Map([['userSystemId value', new Map([['USR-3B98B101F7D2', 1]])]]),
  ],
  [
    'packages/cli/tests/deterministic-workflows.test.ts',
    new Map([['userSystemId value', new Map([['USR-3B98B101F7D2', 8]])]]),
  ],
  [
    'packages/cli/tests/eval-file-inputs.test.ts',
    new Map([['non-synthetic UUID', new Map([['af851ab7-69cf-4b99-9ddc-bea8233ddb2a', 1]])]]),
  ],
  [
    'packages/cli/tests/api-contract.test.ts',
    new Map([['userSystemId value', new Map([['USR-3B98B101F7D2', 4]])]]),
  ],
  [
    'packages/cli/tests/results-and-validation.test.ts',
    new Map([['userSystemId value', new Map([['USR-3B98B101F7D2', 1]])]]),
  ],
  [
    'packages/cli/tests/run-splash.test.ts',
    new Map([['Plumloom CLI key', new Map([['pl_sk_123456789012', 4]])]]),
  ],
  [
    'packages/cli/tests/splash.test.ts',
    new Map([['non-reserved email domain', new Map([['john.doe@plumloom.ai', 3]])]]),
  ],
]);

const SCANNED_EXTENSIONS = new Set([
  '.json',
  '.jsonl',
  '.md',
  '.yml',
  '.yaml',
  '.sh',
  '.txt',
  '.ts',
]);

const UUID = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
const SYNTHETIC_UUID = /^([0-9a-f])\1{7}-\1{4}-4\1{3}-8\1{3}-\1{12}$/;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const RESERVED_EMAIL_DOMAIN = /@(example\.(com|net|org)|[A-Za-z0-9.-]+\.(invalid|test|localhost))$/;

/** Credential shapes. Documented prefixes without a secret body stay allowed. */
const CREDENTIAL_PATTERNS = [
  {
    name: 'Plumloom CLI key',
    pattern: /pl_sk_[A-Za-z0-9_-]{8,}/g,
    allow:
      /^pl_sk_(ci_smoke_placeholder|testcredential12345|example[A-Za-z0-9_]*|synthetic[A-Za-z0-9_]*|unused[A-Za-z0-9_]*)$/i,
  },
  { name: 'OpenAI-style key', pattern: /\bsk-[A-Za-z0-9_-]{16,}/g },
  { name: 'Bearer token', pattern: /Bearer\s+(?!pl_sk_\.{3}|<)[A-Za-z0-9._-]{20,}/g },
  {
    name: 'userSystemId value',
    pattern: /\b(?:userSystemId|user_sys_id)["'\s]*[:=]\s*["'][^"']+["']/g,
    allow: /["'](?:USR-1|USR-SYNTHETIC|USR-SANITIZED-TEST|USR-REPLACE-ME|sys-1|system-1)["']$/,
  },
];

function isSyntheticUuid(value) {
  if (SYNTHETIC_UUID.test(value)) return true;

  const compact = value.toLowerCase().replaceAll('-', '');
  if (compact[12] !== '4' || compact[16] !== '8') return false;

  const payload = [...compact].filter((_, index) => index !== 12 && index !== 16);
  const counts = new Map();
  for (const character of payload) counts.set(character, (counts.get(character) ?? 0) + 1);
  return Math.max(...counts.values()) >= payload.length - 1;
}

function listFiles(root, dir) {
  const absolute = join(root, dir);
  let entries;
  try {
    entries = readdirSync(absolute, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(root, child));
      continue;
    }
    const dot = entry.name.lastIndexOf('.');
    const posix = child.split(sep).join('/');
    if (EXCLUDED_PATH_PREFIXES.some((prefix) => posix.startsWith(prefix))) continue;
    if (EXCLUDED_PATHS.has(posix)) continue;
    if (dot === -1 || SCANNED_EXTENSIONS.has(entry.name.slice(dot))) files.push(child);
  }
  return files;
}

function lineOf(contents, index) {
  return contents.slice(0, index).split('\n').length;
}

function matchedValue(match) {
  const quotedValue = /["']([^"']+)["']$/u.exec(match)?.[1];
  return quotedValue ?? match;
}

function isTemporarilyDeferredFinding(file, rule, match, deferredFindingCounts) {
  const value = matchedValue(match);
  const allowedCount = TEMPORARY_DEFERRED_TEST_FINDINGS.get(file)?.get(rule)?.get(value) ?? 0;
  if (allowedCount === 0) return false;

  const key = `${file}\0${rule}\0${value}`;
  const seenCount = deferredFindingCounts.get(key) ?? 0;
  if (seenCount >= allowedCount) return false;

  deferredFindingCounts.set(key, seenCount + 1);
  return true;
}

/**
 * Scans the public data surface.
 * @param {string} root repository root
 * @returns {{file: string, line: number, rule: string}[]} violations
 */
export function scanPublicData(root) {
  const files = [
    ...PUBLIC_ROOT_FILES.filter((file) => existsSync(join(root, file))),
    ...[...PUBLIC_DATA_DIRS, ...PUBLIC_DOC_DIRS].flatMap((dir) => listFiles(root, dir)),
  ];
  const violations = [];
  const deferredFindingCounts = new Map();

  for (const file of files) {
    const contents = readFileSync(join(root, file), 'utf8');
    const posix = file.split(sep).join('/');

    for (const match of contents.matchAll(UUID)) {
      if (isSyntheticUuid(match[0])) continue;
      if (
        isTemporarilyDeferredFinding(posix, 'non-synthetic UUID', match[0], deferredFindingCounts)
      )
        continue;
      violations.push({
        file: posix,
        line: lineOf(contents, match.index ?? 0),
        rule: 'non-synthetic UUID',
      });
    }

    for (const match of contents.matchAll(EMAIL)) {
      if (RESERVED_EMAIL_DOMAIN.test(match[0])) continue;
      if (
        isTemporarilyDeferredFinding(
          posix,
          'non-reserved email domain',
          match[0],
          deferredFindingCounts,
        )
      )
        continue;
      violations.push({
        file: posix,
        line: lineOf(contents, match.index ?? 0),
        rule: 'non-reserved email domain',
      });
    }

    for (const { name, pattern, allow } of CREDENTIAL_PATTERNS) {
      for (const match of contents.matchAll(pattern)) {
        if (allow?.test(match[0])) continue;
        if (isTemporarilyDeferredFinding(posix, name, match[0], deferredFindingCounts)) continue;
        violations.push({
          file: posix,
          line: lineOf(contents, match.index ?? 0),
          rule: name,
        });
      }
    }
  }

  return violations;
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(relative('/', process.argv[1]));
if (invokedDirectly) {
  const root = process.argv[2] ?? process.cwd();
  const violations = scanPublicData(root);
  if (violations.length > 0) {
    console.error('Public example/test data contains real-looking identifiers:\n');
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}  ${v.rule}`);
    }
    console.error('\nReplace them with synthetic placeholders (see examples/reference/README.md).');
    process.exit(1);
  }
  console.log('Public data surface is clean: only synthetic identifiers found.');
}
