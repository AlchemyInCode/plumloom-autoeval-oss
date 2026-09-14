import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { scanPublicData } from '../../../scripts/check-public-data.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function scan(root: string) {
  return scanPublicData(root);
}

describe('public data sanitization', () => {
  it('finds no real-looking identifiers in the public data surface', () => {
    expect(scan(REPO_ROOT)).toEqual([]);
  });

  it('flags real-looking UUIDs, emails, and credentials in public files', () => {
    const root = mkdtempSync(join(tmpdir(), 'public-data-'));
    mkdirSync(join(root, 'examples'), { recursive: true });
    writeFileSync(
      join(root, 'examples', 'bad.json'),
      JSON.stringify({
        judgeModelId: '02b45174-dad8-4f1a-8174-281430b552e4',
        contact: 'developer@company.com',
        apiKey: 'pl_sk_liveCredential12345',
        userSystemId: 'system-9182',
      }),
    );

    const violations = scan(root);
    const rules = violations.map((violation) => violation.rule);

    expect(rules).toContain('non-synthetic UUID');
    expect(rules).toContain('non-reserved email domain');
    expect(rules).toContain('Plumloom CLI key');
    expect(rules).toContain('userSystemId value');
    expect(violations.every((violation) => !('value' in violation))).toBe(true);
  });

  it('scans the root README but ignores local-only configured-run fixtures', () => {
    const root = mkdtempSync(join(tmpdir(), 'public-data-root-'));
    mkdirSync(join(root, 'packages/cli/src/json/local'), { recursive: true });
    writeFileSync(join(root, 'README.md'), 'Contact developer@company.com');
    writeFileSync(
      join(root, 'packages/cli/src/json/local/local.json'),
      JSON.stringify({ userSystemId: 'local-account' }),
    );

    expect(scan(root)).toEqual([
      expect.objectContaining({ file: 'README.md', rule: 'non-reserved email domain' }),
    ]);
  });

  it('scans public test source and test fixtures', () => {
    const root = mkdtempSync(join(tmpdir(), 'public-data-tests-'));
    mkdirSync(join(root, 'packages/cli/tests/fixtures'), { recursive: true });
    writeFileSync(
      join(root, 'packages/cli/tests/leak.test.ts'),
      "const judgeModelId = '02b45174-dad8-4f1a-8174-281430b552e4';",
    );
    writeFileSync(
      join(root, 'packages/cli/tests/fixtures/session.jsonl'),
      JSON.stringify({ apiKey: 'pl_sk_fixtureCredential12345' }),
    );

    const violations = scan(root);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: 'packages/cli/tests/leak.test.ts',
          rule: 'non-synthetic UUID',
        }),
        expect.objectContaining({
          file: 'packages/cli/tests/fixtures/session.jsonl',
          rule: 'Plumloom CLI key',
        }),
      ]),
    );
  });

  it('limits deferred test-data exceptions to an exact file, rule, and value', () => {
    const root = mkdtempSync(join(tmpdir(), 'public-data-deferred-'));
    mkdirSync(join(root, 'packages/cli/tests'), { recursive: true });
    writeFileSync(
      join(root, 'packages/cli/tests/auth.test.ts'),
      "const existing = 'pl_sk_should_not_be_used'; const duplicate = 'pl_sk_should_not_be_used'; const changed = 'pl_sk_should_not_be_used2';",
    );
    writeFileSync(
      join(root, 'packages/cli/tests/other.test.ts'),
      "const moved = 'pl_sk_should_not_be_used';",
    );

    const violations = scan(root);
    expect(violations).toHaveLength(3);
    expect(
      violations.filter((violation) => violation.file === 'packages/cli/tests/auth.test.ts'),
    ).toHaveLength(2);
    expect(violations).toContainEqual(
      expect.objectContaining({
        file: 'packages/cli/tests/other.test.ts',
        rule: 'Plumloom CLI key',
      }),
    );
  });

  it('accepts synthetic placeholders', () => {
    const root = mkdtempSync(join(tmpdir(), 'public-data-ok-'));
    mkdirSync(join(root, 'examples'), { recursive: true });
    writeFileSync(
      join(root, 'examples', 'good.json'),
      JSON.stringify({
        judgeModelId: '11111111-1111-4111-8111-111111111111',
        primaryModelId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        contact: 'jane@example.com',
      }),
    );

    expect(scan(root)).toEqual([]);
  });
});
