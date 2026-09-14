import { describe, expect, it } from 'vitest';

import {
  renderSplash,
  renderWelcome,
  resolveColorMode,
  shouldShowSplash,
  supportsUnicode,
  type SplashContext,
} from '../src/output/splash.js';

const interactiveEnvironment = { TERM: 'xterm-256color', LANG: 'en_US.UTF-8' } as const;

function visibility(overrides: Partial<Parameters<typeof shouldShowSplash>[0]> = {}) {
  return {
    interactive: true,
    json: false,
    stdinIsTTY: true,
    stdoutIsTTY: true,
    stderrIsTTY: true,
    environment: interactiveEnvironment as Readonly<Record<string, string | undefined>>,
    ...overrides,
  };
}

function context(overrides: Partial<SplashContext> = {}): SplashContext {
  return {
    version: '0.1.0',
    signedIn: true,
    colorMode: 'truecolor',
    unicode: true,
    ...overrides,
  };
}

describe('shouldShowSplash', () => {
  it('shows for an interactive TTY session', () => {
    expect(shouldShowSplash(visibility())).toBe(true);
  });

  it('hides for scripted subcommands', () => {
    expect(shouldShowSplash(visibility({ interactive: false }))).toBe(false);
  });

  it('hides for --json', () => {
    expect(shouldShowSplash(visibility({ json: true }))).toBe(false);
  });

  it('hides when any stream is not a TTY', () => {
    expect(shouldShowSplash(visibility({ stdoutIsTTY: false }))).toBe(false);
    expect(shouldShowSplash(visibility({ stdinIsTTY: false }))).toBe(false);
    expect(shouldShowSplash(visibility({ stderrIsTTY: false }))).toBe(false);
  });

  it('hides in CI and when opted out', () => {
    expect(
      shouldShowSplash(visibility({ environment: { ...interactiveEnvironment, CI: 'true' } })),
    ).toBe(false);
    expect(
      shouldShowSplash(
        visibility({ environment: { ...interactiveEnvironment, AUTOEVAL_NO_SPLASH: '1' } }),
      ),
    ).toBe(false);
    expect(
      shouldShowSplash(visibility({ environment: { ...interactiveEnvironment, NO_SPLASH: '1' } })),
    ).toBe(false);
  });

  it('still shows when CI is explicitly falsy', () => {
    expect(
      shouldShowSplash(visibility({ environment: { ...interactiveEnvironment, CI: 'false' } })),
    ).toBe(true);
  });
});

describe('capability detection', () => {
  it('resolves color modes', () => {
    expect(resolveColorMode({ TERM: 'xterm-256color', COLORTERM: 'truecolor' })).toBe('truecolor');
    expect(resolveColorMode({ TERM: 'xterm-256color' })).toBe('basic');
    expect(resolveColorMode({ TERM: 'dumb' })).toBe('none');
    expect(resolveColorMode({ TERM: 'xterm', NO_COLOR: '1' })).toBe('none');
    expect(resolveColorMode({})).toBe('none');
  });

  it('detects unicode from the locale', () => {
    expect(supportsUnicode({ TERM: 'xterm', LANG: 'en_US.UTF-8' })).toBe(true);
    expect(supportsUnicode({ TERM: 'xterm', LC_ALL: 'C.utf8' })).toBe(true);
    expect(supportsUnicode({ TERM: 'xterm', LANG: 'C' })).toBe(false);
    expect(supportsUnicode({ TERM: 'dumb', LANG: 'en_US.UTF-8' })).toBe(false);
  });
});

describe('renderSplash', () => {
  it('includes the wordmark and aligned design guidance lines', () => {
    const output = renderSplash(
      context({ identity: 'john.doe@plumloom.ai', workspace: 'CLI Test Workspace' }),
    );
    expect(output).toContain('v0.1.0');
    expect(output).toContain('Autoeval');
    expect(output).toContain('intelligent evaluation engine');
    expect(output).toContain('powered by');
    expect(output).toContain('plumloom');
    expect(output).toContain('Run a command to evaluate with Autoeval.');
  });

  it('does not print identity or workspace in the design block', () => {
    const output = renderSplash(
      context({ identity: 'john.doe@plumloom.ai', workspace: 'CLI Test Workspace' }),
    );
    expect(output).not.toContain('john.doe@plumloom.ai');
    expect(output).not.toContain('CLI Test Workspace');
  });

  it('keeps the design block stable regardless of auth state', () => {
    const output = renderSplash(context({ signedIn: false }));
    expect(output).toContain('Autoeval');
    expect(output).not.toContain('autoeval login');
    expect(output).not.toContain('signed in');
  });

  it('emits no escape sequences without color support', () => {
    expect(renderSplash(context({ colorMode: 'none' }))).not.toContain('\u001B[');
  });

  it('emits pure ASCII without unicode support', () => {
    const output = renderSplash(context({ colorMode: 'none', unicode: false, signedIn: false }));
    // eslint-disable-next-line no-control-regex
    expect(/^[\x00-\x7F]*$/u.test(output)).toBe(true);
    expect(output).toContain('|___');
  });

  it('sanitizes control characters in cached identity', () => {
    const output = renderSplash(context({ colorMode: 'none', identity: 'a\u001B[31mb' }));
    expect(output).not.toContain('\u001B[');
  });
});

describe('renderWelcome', () => {
  it('points a signed-out user at login first', () => {
    const output = renderWelcome(context({ signedIn: false, colorMode: 'none' }));
    expect(output).toContain('Not signed in.');
    expect(output).toContain('autoeval login');
    expect(output).toContain('autoeval quickstart');
    expect(output).toContain('autoeval --help');
  });

  it('stays minimal for a signed-in user', () => {
    const output = renderWelcome(context({ signedIn: true, colorMode: 'none' }));
    expect(output).toContain('Signed in.');
    expect(output).toContain('autoeval quickstart');
    expect(output).toContain('autoeval --help');
    expect(output).not.toContain('autoeval login');
    expect(output).not.toContain('workspace');
    expect(output).not.toContain('<evaluation-id>');
  });

  it('emits no escape sequences without color support', () => {
    expect(renderWelcome(context({ colorMode: 'none' }))).not.toContain('\u001B[');
  });
});
