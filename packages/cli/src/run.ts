import { CommanderError } from 'commander';
import { validateCliKey } from './auth/credentials.js';
import { KeyringCredentialStore } from './auth/keyring-store.js';
import { redactText } from './auth/redact.js';
import { RuntimeCommandExecutor } from './commands/executor.js';
import {
  configureSafeProgramOutput,
  createProgram,
  normalizeGlobalCliFlags,
  type ProgramExtension,
} from './commands/program.js';
import type { CommandExecutor } from './commands/types.js';
import { loadConfiguration, type AutoevalConfiguration } from './config.js';
import { asAutoevalError } from './errors/autoeval-error.js';
import { hintForError } from './errors/hints.js';
import { OutputWriter } from './output/writer.js';
import {
  renderSplash,
  renderWelcome,
  resolveColorMode,
  resolveBoltSize,
  shouldShowSplash,
  supportsUnicode,
} from './output/splash.js';

import { CLI_VERSION } from './version.js';

export type CliSplashIo = {
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  stderrIsTTY: boolean;
};

function hasPrimaryCommand(userArgs: readonly string[]): boolean {
  for (const token of userArgs) {
    if (token === '--') return false;
    if (token.startsWith('-')) continue;
    return true;
  }
  return false;
}

function hasRootHelpFlag(userArgs: readonly string[]): boolean {
  for (const token of userArgs) {
    if (token === '--') return false;
    if (token === '--help' || token === '-h') return true;
    if (!token.startsWith('-')) return false;
  }
  return false;
}

function hasJsonFlag(userArgs: readonly string[]): boolean {
  return userArgs.includes('--json');
}

export function shouldRenderCliSplash(
  argv: readonly string[],
  io: CliSplashIo,
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  const userArgs = argv.slice(2);
  const rootInteractive =
    !hasPrimaryCommand(userArgs) && (userArgs.length === 0 || hasRootHelpFlag(userArgs));
  return shouldShowSplash({
    interactive: rootInteractive,
    json: hasJsonFlag(userArgs),
    stdinIsTTY: io.stdinIsTTY,
    stdoutIsTTY: io.stdoutIsTTY,
    stderrIsTTY: io.stderrIsTTY,
    environment,
  });
}

async function resolveSplashSignedIn(
  environment: Readonly<Record<string, string | undefined>>,
  apiOrigin: string,
): Promise<boolean> {
  const environmentKey = environment.AUTOEVAL_API_KEY;
  if (environmentKey !== undefined && environmentKey.trim() !== '') {
    try {
      validateCliKey(environmentKey);
      return true;
    } catch {
      return false;
    }
  }

  try {
    const storedKey = await new KeyringCredentialStore(apiOrigin).read();
    if (storedKey === undefined || storedKey.trim() === '') return false;
    validateCliKey(storedKey);
    return true;
  } catch {
    return false;
  }
}
export type RunCliOptions = {
  argv?: readonly string[];
  /**
   * Extra command registration supplied by the composing distribution. The
   * public CLI passes none, so its surface is exactly the deterministic
   * commands declared in `createProgram`.
   */
  extend?: (context: {
    configuration: AutoevalConfiguration;
    commandExecutor: CommandExecutor;
    signal: AbortSignal;
  }) => ProgramExtension[] | Promise<ProgramExtension[]>;
};

/**
 * Builds and runs the CLI program, translating thrown errors into redacted
 * output and process exit codes.
 */
export async function runCli(options: RunCliOptions = {}): Promise<void> {
  const abortController = new AbortController();
  const onInterrupt = (): void => abortController.abort(new Error('interrupted'));
  const onTerminate = (): void => abortController.abort(new Error('terminated'));
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);

  const writer = new OutputWriter(process.stdout, process.stderr);
  const sourceArgv = [...(options.argv ?? process.argv)];
  const argv = [...sourceArgv.slice(0, 2), ...normalizeGlobalCliFlags(sourceArgv.slice(2))];
  const environment = process.env;
  try {
    const configuration = loadConfiguration();
    const commandExecutor = new RuntimeCommandExecutor({
      configuration,
      signal: abortController.signal,
    });
    const extensions = options.extend
      ? await options.extend({
          configuration,
          commandExecutor,
          signal: abortController.signal,
        })
      : [];
    const program = createProgram(commandExecutor, extensions);
    configureSafeProgramOutput(program, process.stdout, process.stderr);
    if (
      shouldRenderCliSplash(
        argv,
        {
          stdinIsTTY: process.stdin.isTTY,
          stdoutIsTTY: process.stdout.isTTY,
          stderrIsTTY: process.stderr.isTTY,
        },
        environment,
      )
    ) {
      const signedIn = await resolveSplashSignedIn(environment, configuration.apiBaseUrl.origin);
      const unicode = supportsUnicode(environment);
      const splashContext = {
        version: CLI_VERSION,
        signedIn,
        colorMode: resolveColorMode(environment),
        unicode,
        boltSize: resolveBoltSize(environment, unicode),
      };
      process.stderr.write(renderSplash(splashContext));

      if (argv.slice(2).length === 0) {
        process.stderr.write(`${renderWelcome(splashContext)}\n`);
        return;
      }
    }
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') return;
      process.exitCode = error.exitCode;
      return;
    }

    const normalized = asAutoevalError(error);
    writer.writeError(
      redactText(normalized.message),
      hasJsonFlag(argv.slice(2)),
      normalized.code,
      hintForError(normalized),
    );
    process.exitCode = normalized.exitCode;
  }
}
