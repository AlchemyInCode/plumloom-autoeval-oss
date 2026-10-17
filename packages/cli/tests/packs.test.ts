import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ensurePackInstalled,
  installPack,
  packRequiresPrimaryModel,
  planPackInstall,
} from '../src/actions/pack.js';
import { parseConfiguredRunInput } from '../src/configured-run/validation.js';
import { AutoevalError } from '../src/errors/autoeval-error.js';
import type { BundledPack } from '../src/packs/registry.js';
import { DEFAULT_PACK_NAME, listPacks, requirePack } from '../src/packs/registry.js';
import { readSuiteManifest } from '../src/suite/manifest.js';

const EXPECTED_PACKS = [
  'agent-trace',
  'coding-agent',
  'rag-answer-quality',
  'support-bot',
] as const;

const packsSourceRoot = fileURLToPath(new URL('../../../examples/packs/', import.meta.url));

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'autoeval-pack-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('pack registry', () => {
  it('lists every built-in starter pack', () => {
    expect(
      listPacks()
        .map((pack) => pack.name)
        .sort(),
    ).toEqual([...EXPECTED_PACKS]);
  });

  it('exposes the documented default pack', () => {
    expect(DEFAULT_PACK_NAME).toBe('support-bot');
    expect(requirePack(DEFAULT_PACK_NAME).context).toBe('conversation');
  });

  it('throws PACK_NOT_FOUND for an unknown pack', () => {
    expect(() => requirePack('does-not-exist')).toThrow(AutoevalError);
    try {
      requirePack('does-not-exist');
    } catch (error) {
      expect(error).toMatchObject({ code: 'PACK_NOT_FOUND' });
    }
  });

  it('carries no account-specific model IDs in pack metadata', () => {
    for (const pack of listPacks()) {
      for (const file of pack.files) {
        if (file.relativePath === 'pack.yaml') {
          expect(file.contents).not.toMatch(/model[iI]d/u);
        }
      }
    }
  });

  it('contains schema-valid eval inputs for every registered pack', () => {
    for (const pack of listPacks()) {
      for (const evalPath of pack.evals) {
        const file = pack.files.find((candidate) => candidate.relativePath === evalPath);
        expect(file, `${pack.name}/${evalPath}`).toBeDefined();
        expect(() => parseConfiguredRunInput(JSON.parse(file?.contents ?? 'null'))).not.toThrow();
      }
    }
  });
});

describe('bundled pack data matches the examples source (drift guard)', () => {
  it.each(EXPECTED_PACKS)('%s is byte-identical to examples/packs', async (name) => {
    const pack = requirePack(name);
    for (const file of pack.files) {
      const source = await readFile(join(packsSourceRoot, name, file.relativePath), 'utf8');
      expect(file.contents).toBe(source);
    }
  });
});

describe('packRequiresPrimaryModel', () => {
  it('is true only for scenario packs', () => {
    expect(packRequiresPrimaryModel('scenario')).toBe(true);
    expect(packRequiresPrimaryModel('conversation')).toBe(false);
    expect(packRequiresPrimaryModel('agent_trace')).toBe(false);
  });
});

describe('planPackInstall', () => {
  it('produces a manifest that parses under the suite manifest schema', async () => {
    const pack = requirePack('support-bot');
    const plan = planPackInstall(pack, directory, { workspaceId: 'ws-123' });

    for (const file of plan.files) {
      await mkdir(dirname(file.absolutePath), { recursive: true });
      await writeFile(file.absolutePath, file.contents, 'utf8');
    }

    const manifest = await readSuiteManifest(plan.manifestPath);
    expect(manifest.workspaceId).toBe('ws-123');
    expect(manifest.evalFiles).toEqual(plan.evalFileAbsolutePaths);
    expect(manifest.entries[0]?.gate.metrics).toMatchObject({ factuality: 4.0, helpfulness: 4.0 });
  });

  it('falls back to a synthetic workspace placeholder when none is supplied', () => {
    const plan = planPackInstall(requirePack('agent-trace'), directory);
    const manifestFile = plan.files.find((file) => file.absolutePath === plan.manifestPath);
    expect(manifestFile?.contents).toContain('ffffffff-ffff-4fff-8fff-ffffffffffff');
  });

  it('installs into a per-pack subdirectory', () => {
    const plan = planPackInstall(requirePack('rag-answer-quality'), directory);
    expect(plan.installDirectory).toBe(join(directory, 'rag-answer-quality'));
    expect(plan.context).toBe('scenario');
  });
});

describe('planPackInstall treats pack contents as untrusted', () => {
  function maliciousPack(overrides: Partial<BundledPack>): BundledPack {
    return {
      name: 'evil',
      version: 1,
      title: 'Evil',
      description: 'Evil',
      context: 'conversation',
      evals: ['evals/a.json'],
      files: [{ relativePath: 'evals/a.json', contents: '{}' }],
      ...overrides,
    };
  }

  it('rejects a pack file path that escapes the install directory', () => {
    const pack = maliciousPack({
      files: [{ relativePath: '../../etc/evil.json', contents: 'x' }],
    });
    expect(() => planPackInstall(pack, directory)).toThrow(AutoevalError);
    try {
      planPackInstall(pack, directory);
    } catch (error) {
      expect(error).toMatchObject({ code: 'PACK_INVALID_PATH' });
    }
  });

  it('rejects an absolute pack file path', () => {
    const pack = maliciousPack({ files: [{ relativePath: '/etc/evil.json', contents: 'x' }] });
    expect(() => planPackInstall(pack, directory)).toThrow(/PACK_INVALID_PATH|relative/u);
  });

  it('rejects an eval path that escapes the install directory', () => {
    const pack = maliciousPack({
      evals: ['../../../escape.json'],
      files: [{ relativePath: 'evals/a.json', contents: '{}' }],
    });
    expect(() => planPackInstall(pack, directory)).toThrow(AutoevalError);
  });

  it('rejects a pack name that is not a single safe segment', () => {
    const pack = maliciousPack({ name: '../escape' });
    expect(() => planPackInstall(pack, directory)).toThrow(AutoevalError);
  });
});

describe('pack installation integrity', () => {
  it('reuses only a byte-identical installed pack', async () => {
    const plan = planPackInstall(requirePack('support-bot'), directory, {
      workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    await expect(ensurePackInstalled(plan)).resolves.toMatchObject({ status: 'installed' });
    await expect(ensurePackInstalled(plan)).resolves.toMatchObject({
      status: 'already-installed',
      manifest: { workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    });
  });

  it('allows only the generated workspace field to differ in an existing manifest', async () => {
    const initial = planPackInstall(requirePack('support-bot'), directory, {
      workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    await ensurePackInstalled(initial);
    const next = planPackInstall(requirePack('support-bot'), directory, {
      workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
    await expect(ensurePackInstalled(next)).resolves.toMatchObject({
      status: 'already-installed',
      manifest: { workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    });
  });

  it('rejects a modified bundled eval instead of executing it', async () => {
    const plan = planPackInstall(requirePack('support-bot'), directory);
    await ensurePackInstalled(plan);
    const evalPath = plan.evalFileAbsolutePaths[0];
    expect(evalPath).toBeDefined();
    await writeFile(evalPath ?? '', '{"tampered":true}\n', 'utf8');
    await expect(ensurePackInstalled(plan)).rejects.toMatchObject({
      code: 'PACK_FILES_MODIFIED',
    });
  });

  it('rejects a manifest that redirects execution to another file', async () => {
    const plan = planPackInstall(requirePack('support-bot'), directory);
    await ensurePackInstalled(plan);
    await writeFile(
      plan.manifestPath,
      'workspace: ffffffff-ffff-4fff-8fff-ffffffffffff\nevals:\n  - ../../outside.json\n',
      'utf8',
    );
    await expect(ensurePackInstalled(plan)).rejects.toMatchObject({
      code: 'PACK_FILES_MODIFIED',
    });
  });

  it('rejects a partial installation instead of silently filling it in', async () => {
    const plan = planPackInstall(requirePack('support-bot'), directory);
    const first = plan.files[0];
    expect(first).toBeDefined();
    await mkdir(dirname(first?.absolutePath ?? ''), { recursive: true });
    await writeFile(first?.absolutePath ?? '', first?.contents ?? '', 'utf8');
    await expect(ensurePackInstalled(plan)).rejects.toMatchObject({
      code: 'PACK_FILES_MODIFIED',
    });
  });

  it('rejects an install directory symlink without touching its target', async () => {
    const targetDirectory = join(directory, 'target');
    const outside = join(directory, 'outside');
    await mkdir(targetDirectory, { recursive: true });
    await mkdir(outside, { recursive: true });
    await symlink(outside, join(targetDirectory, 'support-bot'));
    const plan = planPackInstall(requirePack('support-bot'), targetDirectory);
    await expect(ensurePackInstalled(plan)).rejects.toMatchObject({ code: 'PACK_INVALID_PATH' });
    await expect(readFile(join(outside, 'pack.yaml'), 'utf8')).rejects.toBeTruthy();
  });

  it('rejects a symlink in the nearest existing target ancestor', async () => {
    const outside = join(directory, 'outside');
    const linked = join(directory, 'linked');
    await mkdir(outside);
    await symlink(outside, linked);
    const plan = planPackInstall(requirePack('support-bot'), join(linked, 'nested'));
    await expect(ensurePackInstalled(plan)).rejects.toMatchObject({ code: 'PACK_INVALID_PATH' });
    await expect(
      readFile(join(outside, 'nested', 'support-bot', 'pack.yaml'), 'utf8'),
    ).rejects.toBeTruthy();
  });

  it('pack add refuses a collision even when the existing bytes match', async () => {
    const plan = planPackInstall(requirePack('support-bot'), directory);
    await installPack(plan);
    await expect(installPack(plan)).rejects.toMatchObject({ code: 'PACK_FILE_EXISTS' });
  });
});
