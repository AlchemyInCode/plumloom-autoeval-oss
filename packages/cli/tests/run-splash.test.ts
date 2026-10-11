import type { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AUTOEVAL_API_ORIGIN } from '../src/config.js';
import { CLI_VERSION } from '../src/version.js';
import { runCli, shouldRenderCliSplash, type CliSplashIo } from '../src/run.js';

const ttyIo: CliSplashIo = {
  stdinIsTTY: true,
  stdoutIsTTY: true,
  stderrIsTTY: true,
};

function setIsTTY(stream: object, value: boolean): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(stream, 'isTTY');
  Object.defineProperty(stream, 'isTTY', { value, configurable: true });
  return () => {
    if (descriptor) {
      Object.defineProperty(stream, 'isTTY', descriptor);
      return;
    }
    Reflect.deleteProperty(stream, 'isTTY');
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('shouldRenderCliSplash', () => {
  it('hides for subcommand invocations', () => {
    expect(
      shouldRenderCliSplash(['node', 'autoeval', 'whoami'], ttyIo, {
        TERM: 'xterm-256color',
        LANG: 'en_US.UTF-8',
      }),
    ).toBe(false);
  });

  it('shows for bare root invocation and root help on a TTY', () => {
    const environment = { TERM: 'xterm-256color', LANG: 'en_US.UTF-8' };
    expect(shouldRenderCliSplash(['node', 'autoeval'], ttyIo, environment)).toBe(true);
    expect(shouldRenderCliSplash(['node', 'autoeval', '--help'], ttyIo, environment)).toBe(true);
  });

  it('hides for json mode or non-TTY output', () => {
    const environment = { TERM: 'xterm-256color', LANG: 'en_US.UTF-8' };
    expect(
      shouldRenderCliSplash(['node', 'autoeval', '--json', 'whoami'], ttyIo, environment),
    ).toBe(false);
    expect(
      shouldRenderCliSplash(
        ['node', 'autoeval', 'whoami'],
        { ...ttyIo, stdoutIsTTY: false },
        environment,
      ),
    ).toBe(false);
  });

  it('hides when CI is enabled', () => {
    expect(
      shouldRenderCliSplash(['node', 'autoeval'], ttyIo, {
        TERM: 'xterm-256color',
        LANG: 'en_US.UTF-8',
        CI: 'true',
      }),
    ).toBe(false);
  });

  it('hides when NO_SPLASH is enabled', () => {
    expect(
      shouldRenderCliSplash(['node', 'autoeval'], ttyIo, {
        TERM: 'xterm-256color',
        NO_SPLASH: '1',
      }),
    ).toBe(false);
  });
});

describe('runCli splash integration', () => {
  it('ignores the former API base URL environment override', async () => {
    vi.stubEnv('AUTOEVAL_API_BASE_URL', 'http://localhost:8000');
    vi.stubEnv('CI', 'true');
    let configuredOrigin = '';

    await runCli({
      argv: ['node', 'autoeval', 'noop'],
      extend: ({ configuration }) => {
        configuredOrigin = configuration.apiBaseUrl.origin;
        return [
          (program) => {
            program.command('noop').action(() => undefined);
          },
        ];
      },
    });

    expect(configuredOrigin).toBe(AUTOEVAL_API_ORIGIN);
  });

  it('does not print the splash before a subcommand', async () => {
    vi.stubEnv('TERM', 'xterm-256color');
    vi.stubEnv('LANG', 'en_US.UTF-8');
    vi.stubEnv('CI', '');
    vi.stubEnv('AUTOEVAL_API_KEY', 'pl_sk_123456789012');

    const restoreStdoutTTY = setIsTTY(process.stdout, true);
    const restoreStderrTTY = setIsTTY(process.stderr, true);
    const restoreStdinTTY = setIsTTY(process.stdin, true);

    const stderrWrites: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      stderrWrites.push(String(chunk));
      return true;
    });

    try {
      await runCli({
        argv: ['node', 'autoeval', 'noop'],
        extend: () => [
          (program) => {
            program
              .command('noop')
              .description('test command')
              .action(() => undefined);
          },
        ],
      });
    } finally {
      restoreStdoutTTY();
      restoreStderrTTY();
      restoreStdinTTY();
    }

    const stderrOutput = stderrWrites.join('');
    expect(stderrOutput).not.toContain('Run a command to get started...');
  });

  it('does not print the splash in json mode', async () => {
    vi.stubEnv('TERM', 'xterm-256color');
    vi.stubEnv('LANG', 'en_US.UTF-8');
    vi.stubEnv('CI', '');
    vi.stubEnv('AUTOEVAL_API_KEY', 'pl_sk_123456789012');

    const restoreStdoutTTY = setIsTTY(process.stdout, true);
    const restoreStderrTTY = setIsTTY(process.stderr, true);
    const restoreStdinTTY = setIsTTY(process.stdin, true);

    const stderrWrites: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      stderrWrites.push(String(chunk));
      return true;
    });

    try {
      await runCli({
        argv: ['node', 'autoeval', '--json', 'noop'],
        extend: () => [
          (program) => {
            program
              .command('noop')
              .description('test command')
              .action(() => undefined);
          },
        ],
      });
    } finally {
      restoreStdoutTTY();
      restoreStderrTTY();
      restoreStdinTTY();
    }

    const stderrOutput = stderrWrites.join('');
    expect(stderrOutput).not.toContain('Run a command to get started...');
  });

  it('accepts trailing --json after a subcommand', async () => {
    vi.stubEnv('TERM', 'xterm-256color');
    vi.stubEnv('LANG', 'en_US.UTF-8');
    vi.stubEnv('CI', '');

    const restoreStdoutTTY = setIsTTY(process.stdout, true);
    const restoreStderrTTY = setIsTTY(process.stderr, true);
    const restoreStdinTTY = setIsTTY(process.stdin, true);

    let observedJson = false;
    try {
      await runCli({
        argv: ['node', 'autoeval', 'noop', '--json'],
        extend: () => [
          (program) => {
            program
              .command('noop')
              .description('test command')
              .action((_options: object, command: Command) => {
                const options = command.optsWithGlobals<{ json?: boolean }>();
                observedJson = options.json === true;
              });
          },
        ],
      });
    } finally {
      restoreStdoutTTY();
      restoreStderrTTY();
      restoreStdinTTY();
    }

    expect(observedJson).toBe(true);
  });

  it('accepts trailing --debug after a subcommand', async () => {
    vi.stubEnv('TERM', 'xterm-256color');
    vi.stubEnv('LANG', 'en_US.UTF-8');
    vi.stubEnv('CI', '');

    const restoreStdoutTTY = setIsTTY(process.stdout, true);
    const restoreStderrTTY = setIsTTY(process.stderr, true);
    const restoreStdinTTY = setIsTTY(process.stdin, true);

    let observedDebug = false;
    try {
      await runCli({
        argv: ['node', 'autoeval', 'noop', '--debug'],
        extend: () => [
          (program) => {
            program
              .command('noop')
              .description('test command')
              .action((_options: object, command: Command) => {
                const options = command.optsWithGlobals<{ debug?: boolean }>();
                observedDebug = options.debug === true;
              });
          },
        ],
      });
    } finally {
      restoreStdoutTTY();
      restoreStderrTTY();
      restoreStdinTTY();
    }

    expect(observedDebug).toBe(true);
  });

  it('accepts trailing --json after nested subcommands', async () => {
    vi.stubEnv('TERM', 'xterm-256color');
    vi.stubEnv('LANG', 'en_US.UTF-8');
    vi.stubEnv('CI', '');

    const restoreStdoutTTY = setIsTTY(process.stdout, true);
    const restoreStderrTTY = setIsTTY(process.stderr, true);
    const restoreStdinTTY = setIsTTY(process.stdin, true);

    let observedJson = false;
    let observedDebug = false;
    try {
      await runCli({
        argv: ['node', 'autoeval', 'group', 'leaf', '--json', '--debug'],
        extend: () => [
          (program) => {
            program
              .command('group')
              .description('nested command group')
              .command('leaf')
              .description('nested leaf command')
              .action((_options: object, command: Command) => {
                const options = command.optsWithGlobals<{ json?: boolean; debug?: boolean }>();
                observedJson = options.json === true;
                observedDebug = options.debug === true;
              });
          },
        ],
      });
    } finally {
      restoreStdoutTTY();
      restoreStderrTTY();
      restoreStdinTTY();
    }

    expect(observedJson).toBe(true);
    expect(observedDebug).toBe(true);
  });

  it('prints the splash for root help invocation', async () => {
    vi.stubEnv('TERM', 'xterm-256color');
    vi.stubEnv('LANG', 'en_US.UTF-8');
    vi.stubEnv('CI', '');
    vi.stubEnv('AUTOEVAL_API_KEY', 'pl_sk_123456789012');

    const restoreStdoutTTY = setIsTTY(process.stdout, true);
    const restoreStderrTTY = setIsTTY(process.stderr, true);
    const restoreStdinTTY = setIsTTY(process.stdin, true);

    const stderrWrites: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      stderrWrites.push(String(chunk));
      return true;
    });

    try {
      await runCli({ argv: ['node', 'autoeval', '--help'] });
    } finally {
      restoreStdoutTTY();
      restoreStderrTTY();
      restoreStdinTTY();
    }

    const stderrOutput = stderrWrites.join('');
    expect(stderrOutput).toContain('Run a command to get started...');
    expect(stderrOutput).toContain(`v${CLI_VERSION}`);
  });

  it('prints the splash and a compact welcome for bare root invocation', async () => {
    vi.stubEnv('TERM', 'xterm-256color');
    vi.stubEnv('LANG', 'en_US.UTF-8');
    vi.stubEnv('CI', '');
    vi.stubEnv('AUTOEVAL_API_KEY', 'pl_sk_123456789012');

    const restoreStdoutTTY = setIsTTY(process.stdout, true);
    const restoreStderrTTY = setIsTTY(process.stderr, true);
    const restoreStdinTTY = setIsTTY(process.stdin, true);

    const stderrWrites: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      stderrWrites.push(String(chunk));
      return true;
    });

    const originalExitCode = process.exitCode;
    try {
      await runCli({ argv: ['node', 'autoeval'] });
    } finally {
      process.exitCode = originalExitCode;
      restoreStdoutTTY();
      restoreStderrTTY();
      restoreStdinTTY();
    }

    const stderrOutput = stderrWrites.join('');
    expect(stderrOutput).toContain('Run a command to get started...');
    expect(stderrOutput).toContain('Signed in.');
    expect(stderrOutput).toContain('autoeval quickstart');
    expect(stderrOutput).toContain('autoeval --help');
    expect(stderrOutput).not.toContain('Commands:');
    expect(stderrOutput).not.toContain('Autoeval requires a command.');
  });
});
