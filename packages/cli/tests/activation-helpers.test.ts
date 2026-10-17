import { describe, expect, it, vi } from 'vitest';

import { describeSettings, setConfigValue } from '../src/actions/config.js';
import { runActivation, settingsToPersist } from '../src/actions/init.js';
import { AutoevalError } from '../src/errors/autoeval-error.js';
import { requirePack } from '../src/packs/registry.js';
import type { AutoevalSettings } from '../src/settings/settings.js';
import { createApi, IDS } from './helpers.js';

const PRIMARY_MODEL_ID = '77777777-7777-4777-8777-777777777777';

function supportedModel(id: string, displayName: string) {
  return {
    id,
    provider: 'test',
    displayName,
    apiModelId: displayName.toLowerCase().replaceAll(' ', '-'),
    isDeprecated: false,
    isLocked: false,
  };
}

describe('setConfigValue', () => {
  it('sets a trimmed value for the requested field', () => {
    const next = setConfigValue({ version: 1 }, 'defaultWorkspaceId', '  ws-1  ');
    expect(next).toEqual({ version: 1, defaultWorkspaceId: 'ws-1' });
  });

  it('rejects an empty value', () => {
    expect(() => setConfigValue({ version: 1 }, 'defaultJudgeModelId', '   ')).toThrow(
      AutoevalError,
    );
  });

  it('keeps other saved fields untouched', () => {
    const current: AutoevalSettings = { version: 1, defaultJudgeModelId: 'judge-1' };
    expect(setConfigValue(current, 'defaultWorkspaceId', 'ws-1')).toEqual({
      version: 1,
      defaultJudgeModelId: 'judge-1',
      defaultWorkspaceId: 'ws-1',
    });
  });
});

describe('describeSettings', () => {
  it('reports unset defaults as "(not set)" and never exposes a secret field', () => {
    const rows = describeSettings({ version: 1, defaultWorkspaceId: 'ws-1' });
    const asText = rows.map((row) => `${row.label}: ${row.value}`).join('\n');
    expect(asText).toContain('Default workspace: ws-1');
    expect(asText).toContain('Default judge model: (not set)');
    expect(asText.toLowerCase()).not.toContain('key');
    expect(asText.toLowerCase()).not.toContain('token');
  });
});

describe('settingsToPersist', () => {
  it('persists workspace and judge, and primary only when present', () => {
    expect(
      settingsToPersist({ version: 1 }, { workspaceId: 'ws-1', judgeModelId: 'judge-1' }),
    ).toEqual({ version: 1, defaultWorkspaceId: 'ws-1', defaultJudgeModelId: 'judge-1' });

    expect(
      settingsToPersist(
        { version: 1 },
        { workspaceId: 'ws-1', judgeModelId: 'judge-1', primaryModelId: 'primary-1' },
      ),
    ).toEqual({
      version: 1,
      defaultWorkspaceId: 'ws-1',
      defaultJudgeModelId: 'judge-1',
      defaultPrimaryModelId: 'primary-1',
    });
  });

  it('preserves an unrelated reserved field such as telemetryOptIn', () => {
    expect(
      settingsToPersist(
        { version: 1, telemetryOptIn: true },
        { workspaceId: 'ws-1', judgeModelId: 'judge-1' },
      ),
    ).toMatchObject({ telemetryOptIn: true });
  });
});

describe('runActivation', () => {
  it('owns scenario role selection, pack execution, and persistence', async () => {
    const workspace = {
      id: IDS.workspace,
      name: 'Workspace',
      evaluationCount: 1,
    };
    const judge = supportedModel(IDS.model, 'Judge');
    const primary = supportedModel(PRIMARY_MODEL_ID, 'Primary');
    const runPack = vi.fn(() =>
      Promise.resolve({
        workspaceId: IDS.workspace,
        total: 1,
        completed: 1,
        failed: 0,
        evals: [],
      }),
    );
    const persistSettings = vi.fn(() => Promise.resolve());
    const api = createApi({
      listWorkspaces: vi.fn(() =>
        Promise.resolve({
          items: [workspace],
          total: 1,
          page: 1,
          size: 100,
          totalPages: 1,
        }),
      ),
      getModels: vi.fn(() => Promise.resolve([judge, primary])),
    });

    const result = await runActivation(
      { api },
      {
        pack: requirePack('rag-answer-quality'),
        settings: { version: 1 },
        judgeModelId: IDS.model,
        primaryModelId: PRIMARY_MODEL_ID,
        runPack,
        persistSettings,
      },
    );

    expect(runPack).toHaveBeenCalledWith({ workspace, judge, primary });
    expect(persistSettings).toHaveBeenCalledWith({
      version: 1,
      defaultWorkspaceId: IDS.workspace,
      defaultJudgeModelId: IDS.model,
      defaultPrimaryModelId: PRIMARY_MODEL_ID,
    });
    expect(result.persistedDefaults).toBe(true);
  });

  it('does not persist settings when execution fails', async () => {
    const persistSettings = vi.fn(() => Promise.resolve());
    const api = createApi({
      listWorkspaces: vi.fn(() =>
        Promise.resolve({
          items: [{ id: IDS.workspace, name: 'Workspace', evaluationCount: 0 }],
          total: 1,
          page: 1,
          size: 100,
          totalPages: 1,
        }),
      ),
      getModels: vi.fn(() => Promise.resolve([supportedModel(IDS.model, 'Judge')])),
    });
    const result = await runActivation(
      { api },
      {
        pack: requirePack('support-bot'),
        settings: { version: 1 },
        runPack: () =>
          Promise.resolve({
            workspaceId: IDS.workspace,
            total: 1,
            completed: 0,
            failed: 1,
            evals: [],
          }),
        persistSettings,
      },
    );
    expect(result.persistedDefaults).toBe(false);
    expect(persistSettings).not.toHaveBeenCalled();
  });
});
