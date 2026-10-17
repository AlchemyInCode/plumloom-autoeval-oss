import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:crypto', () => ({ randomBytes: () => Buffer.alloc(12, 0xab) }));

import {
  clearSettings,
  loadSettings,
  saveSettings,
  settingsDirectory,
  settingsPath,
} from '../src/settings/settings.js';

let directory: string;
let path: string;
const ID_FIELDS = ['defaultWorkspaceId', 'defaultJudgeModelId', 'defaultPrimaryModelId'] as const;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'autoeval-settings-'));
  path = join(directory, 'settings.json');
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('settings path resolution', () => {
  it('prefers $XDG_CONFIG_HOME when it is set', () => {
    expect(settingsDirectory({ XDG_CONFIG_HOME: '/tmp/xdg' })).toBe('/tmp/xdg/autoeval');
    expect(settingsPath({ XDG_CONFIG_HOME: '/tmp/xdg' })).toBe('/tmp/xdg/autoeval/settings.json');
  });

  it('falls back to ~/.config when $XDG_CONFIG_HOME is absent', () => {
    const resolved = settingsPath({ HOME: undefined, XDG_CONFIG_HOME: undefined });
    expect(resolved.endsWith(join('.config', 'autoeval', 'settings.json'))).toBe(true);
  });
});

describe('loadSettings', () => {
  it('returns defaults for a missing file without a diagnostic', async () => {
    const diagnostics: string[] = [];
    const settings = await loadSettings({ path, onDiagnostic: (m) => diagnostics.push(m) });
    expect(settings).toEqual({ version: 1 });
    expect(diagnostics).toEqual([]);
  });

  it('degrades a corrupt file to defaults and reports a diagnostic', async () => {
    await writeFile(path, '{ not valid json', 'utf8');
    const diagnostics: string[] = [];
    const settings = await loadSettings({ path, onDiagnostic: (m) => diagnostics.push(m) });
    expect(settings).toEqual({ version: 1 });
    expect(diagnostics).toHaveLength(1);
  });

  it('degrades a schema-invalid file to defaults and reports a diagnostic', async () => {
    await writeFile(path, JSON.stringify({ version: 2 }), 'utf8');
    const diagnostics: string[] = [];
    const settings = await loadSettings({ path, onDiagnostic: (m) => diagnostics.push(m) });
    expect(settings).toEqual({ version: 1 });
    expect(diagnostics).toHaveLength(1);
  });

  it('drops unknown keys and keeps known defaults', async () => {
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        defaultWorkspaceId: 'ws-1',
        apiBaseUrl: 'https://evil.example.com',
        unexpected: true,
      }),
      'utf8',
    );
    const settings = await loadSettings({ path });
    expect(settings).toEqual({ version: 1, defaultWorkspaceId: 'ws-1' });
    expect(settings).not.toHaveProperty('apiBaseUrl');
  });

  it.each(ID_FIELDS)('rejects a credential hidden in %s without returning it', async (field) => {
    const credential = `pl_sk_${'A'.repeat(24)}`;
    await writeFile(path, JSON.stringify({ version: 1, [field]: credential }), 'utf8');
    const diagnostics: string[] = [];
    const settings = await loadSettings({
      path,
      onDiagnostic: (message) => diagnostics.push(message),
    });

    expect(settings).toEqual({ version: 1 });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics.join('\n')).not.toContain(credential);
  });

  it('degrades an oversized file to defaults before reading it', async () => {
    await writeFile(path, 'x'.repeat(64 * 1024 + 1), 'utf8');
    const diagnostics: string[] = [];
    await expect(
      loadSettings({ path, onDiagnostic: (message) => diagnostics.push(message) }),
    ).resolves.toEqual({ version: 1 });
    expect(diagnostics[0]).toContain('size limit');
  });

  it('degrades a non-regular settings path to defaults', async () => {
    await mkdir(path);
    const diagnostics: string[] = [];
    await expect(
      loadSettings({ path, onDiagnostic: (message) => diagnostics.push(message) }),
    ).resolves.toEqual({ version: 1 });
    expect(diagnostics[0]).toContain('not a regular file');
  });

  it('degrades an unreadable settings file to defaults', async () => {
    await writeFile(path, JSON.stringify({ version: 1 }), 'utf8');
    await chmod(path, 0o000);
    const diagnostics: string[] = [];
    await expect(
      loadSettings({ path, onDiagnostic: (message) => diagnostics.push(message) }),
    ).resolves.toEqual({ version: 1 });
    expect(diagnostics).toHaveLength(1);
  });
});

describe('saveSettings', () => {
  it('round-trips a save then load', async () => {
    await saveSettings(
      {
        version: 1,
        defaultWorkspaceId: 'ws-1',
        defaultJudgeModelId: 'judge-1',
        defaultPrimaryModelId: 'primary-1',
      },
      { path },
    );
    await expect(loadSettings({ path })).resolves.toEqual({
      version: 1,
      defaultWorkspaceId: 'ws-1',
      defaultJudgeModelId: 'judge-1',
      defaultPrimaryModelId: 'primary-1',
    });
  });

  it('creates the file with 0600 permissions', async () => {
    await saveSettings({ version: 1, defaultWorkspaceId: 'ws-1' }, { path });
    const mode = (await stat(path)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('restores 0600 permissions when replacing an overly permissive file', async () => {
    await writeFile(path, JSON.stringify({ version: 1 }), { mode: 0o644 });
    await chmod(path, 0o644);
    await saveSettings({ version: 1, defaultWorkspaceId: 'ws-1' }, { path });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('never writes a credential even if asked', async () => {
    await saveSettings(
      { version: 1, defaultWorkspaceId: 'ws-1', apiKey: 'pl_sk_synthetic_unused_value' } as never,
      { path },
    );
    const raw = await readFile(path, 'utf8');
    expect(raw).not.toContain('pl_sk_');
    expect(raw).not.toContain('apiKey');
  });

  it.each(ID_FIELDS)('rejects a credential placed in %s', async (field) => {
    const credential = `pl_sk_${'B'.repeat(24)}`;
    await expect(saveSettings({ version: 1, [field]: credential }, { path })).rejects.toMatchObject(
      { code: 'SETTINGS_WRITE_FAILED' },
    );
    await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('leaves the previous file intact when a rename cannot complete', async () => {
    await saveSettings({ version: 1, defaultWorkspaceId: 'ws-good' }, { path });
    // Point the path at a directory to force the write to fail.
    await expect(
      saveSettings({ version: 1, defaultWorkspaceId: 'ws-bad' }, { path: directory }),
    ).rejects.toMatchObject({ code: 'SETTINGS_WRITE_FAILED' });
    await expect(loadSettings({ path })).resolves.toEqual({
      version: 1,
      defaultWorkspaceId: 'ws-good',
    });
  });

  it('does not follow a symlink planted at the target path', async () => {
    const outside = join(directory, 'outside.txt');
    await writeFile(outside, 'original', 'utf8');
    await symlink(outside, path);

    await saveSettings({ version: 1, defaultWorkspaceId: 'ws-1' }, { path });

    // The atomic rename replaces the symlink with a regular file and never
    // writes through it to the outside target.
    expect((await lstat(path)).isSymbolicLink()).toBe(false);
    expect((await stat(path)).isFile()).toBe(true);
    expect(await readFile(outside, 'utf8')).toBe('original');
  });

  it('leaves no temporary files behind after a successful write', async () => {
    await saveSettings({ version: 1, defaultWorkspaceId: 'ws-1' }, { path });
    const entries = await readdir(directory);
    expect(entries.filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
  });

  it('does not follow or replace a symlink planted at the temporary path', async () => {
    const outside = join(directory, 'outside-temp.txt');
    const temporaryPath = `${path}.${'ab'.repeat(12)}.tmp`;
    await writeFile(outside, 'original', 'utf8');
    await symlink(outside, temporaryPath);

    await expect(
      saveSettings({ version: 1, defaultWorkspaceId: 'ws-1' }, { path }),
    ).rejects.toMatchObject({ code: 'SETTINGS_WRITE_FAILED' });

    expect(await readFile(outside, 'utf8')).toBe('original');
    expect((await lstat(temporaryPath)).isSymbolicLink()).toBe(true);
    await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('clearSettings', () => {
  it('removes the file and tolerates a missing file', async () => {
    await saveSettings({ version: 1, defaultWorkspaceId: 'ws-1' }, { path });
    await clearSettings({ path });
    await expect(loadSettings({ path })).resolves.toEqual({ version: 1 });
    await expect(clearSettings({ path })).resolves.toBeUndefined();
  });
});
