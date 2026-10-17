import { describe, expect, it } from 'vitest';

import { resolveModelIds, resolveWorkspaceId } from '../src/settings/resolve.js';
import type { AutoevalSettings } from '../src/settings/settings.js';

const SETTINGS: AutoevalSettings = {
  version: 1,
  defaultWorkspaceId: 'ws-default',
  defaultJudgeModelId: 'judge-default',
  defaultPrimaryModelId: 'primary-default',
};

describe('resolveWorkspaceId precedence', () => {
  it('prefers an explicit flag over the saved default', () => {
    expect(resolveWorkspaceId('ws-flag', SETTINGS)).toBe('ws-flag');
  });

  it('falls back to the saved default when no flag is given', () => {
    expect(resolveWorkspaceId(undefined, SETTINGS)).toBe('ws-default');
  });

  it('returns undefined when neither flag nor default is set', () => {
    expect(resolveWorkspaceId(undefined, { version: 1 })).toBeUndefined();
  });
});

describe('resolveModelIds precedence', () => {
  it('prefers explicit flags for both roles', () => {
    expect(
      resolveModelIds({ judgeModelId: 'judge-flag', primaryModelId: 'primary-flag' }, SETTINGS),
    ).toEqual({ judgeModelId: 'judge-flag', primaryModelId: 'primary-flag' });
  });

  it('falls back to saved defaults per role independently', () => {
    expect(resolveModelIds({ judgeModelId: 'judge-flag' }, SETTINGS)).toEqual({
      judgeModelId: 'judge-flag',
      primaryModelId: 'primary-default',
    });
  });

  it('omits roles that have neither a flag nor a default', () => {
    expect(resolveModelIds({}, { version: 1 })).toEqual({});
  });
});
