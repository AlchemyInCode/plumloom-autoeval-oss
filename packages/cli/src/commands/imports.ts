import { createInterface } from 'node:readline/promises';
import { open } from 'node:fs/promises';
import { Option, type Command } from 'commander';

import type { ImportCommand } from '../actions/imports.js';
import { AutoevalError } from '../errors/autoeval-error.js';
import type { CommandExecutor } from './types.js';

export async function readImportIds(filename: string): Promise<string[]> {
  let handle;
  try {
    handle = await open(filename, 'r');
    if (!(await handle.stat()).isFile()) throw new Error('Not a regular file');
    const maximumBytes = 1024 * 1024;
    const buffer = Buffer.alloc(maximumBytes + 1);
    let received = 0;
    while (received < buffer.length) {
      const { bytesRead } = await handle.read(buffer, received, buffer.length - received);
      if (bytesRead === 0) break;
      received += bytesRead;
    }
    if (received > maximumBytes) throw new Error('File too large');
    return new TextDecoder('utf-8', { fatal: true })
      .decode(buffer.subarray(0, received))
      .replace(/^\uFEFF/u, '')
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (error) {
    throw new AutoevalError(
      'Import ID file must be a readable UTF-8 regular file of at most 1 MiB.',
      { kind: 'usage', code: 'INVALID_IMPORT_FILE', cause: error },
    );
  } finally {
    await handle?.close();
  }
}

function boundedInteger(value: string, label: string, maximum: number): number {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new AutoevalError(`${label} must be an integer between 1 and ${maximum}.`, {
      kind: 'usage',
      code: 'INVALID_IMPORT_ARGUMENTS',
    });
  }

  return parsed;
}

export async function confirmImportRemoval(
  question: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await terminal.question(`${question} [y/N] `, signal ? { signal } : {});
    return /^(y|yes)$/iu.test(answer.trim());
  } finally {
    terminal.close();
  }
}

export function registerImportCommands(program: Command, executor: CommandExecutor): void {
  const group = program
    .command('import')
    .description('import OpenAI evaluations into Plumloom (never writes to OpenAI)');
  const execute = async (
    input: ImportCommand,
    command: Command,
    inputFile?: string,
  ): Promise<void> => {
    const global = command.optsWithGlobals<{ json?: boolean; debug?: boolean }>();
    await executor.execute(
      { kind: 'external-import', input, ...(inputFile ? { inputFile } : {}) },
      { json: global.json === true, debug: global.debug === true },
    );
  };
  const pagination = (command: Command, maximumSize = 100): Command =>
    command
      .option('--page <number>', 'page number (1-1000)', (v) => boundedInteger(v, 'page', 1000), 1)
      .option(
        '--size <number>',
        `page size (1-${maximumSize})`,
        (v) => boundedInteger(v, 'size', maximumSize),
        50,
      );
  group
    .command('status')
    .description('check server-side OpenAI key and Evals access')
    .action(async (_options: object, command: Command) =>
      execute({ operation: 'status' }, command),
    );
  group
    .command('connect')
    .description('validate OpenAI access and cache the eval list')
    .option('--refresh', 'force a fresh OpenAI eval list')
    .action(async (options: { refresh?: boolean }, command: Command) =>
      execute({ operation: 'connect', refresh: options.refresh === true }, command),
    );
  pagination(
    group.command('review').description('review cached OpenAI evaluations; imports nothing'),
  )
    .option('--search <text>', 'filter evaluations')
    .option('--all', 'read every page (up to 25,000 evaluations)')
    .action(
      async (
        options: { page: number; size: number; search?: string; all?: boolean },
        command: Command,
      ) => execute({ operation: 'review', ...options }, command),
    );
  group
    .command('run')
    .description('import selected OpenAI evaluations in batches of at most 25')
    .addOption(
      new Option('--eval <openai-eval-id>', 'OpenAI source ID (repeatable)')
        .argParser((id: string, previous: string[]) => [...previous, id])
        .default([])
        .conflicts(['input', 'allNew']),
    )
    .addOption(
      new Option('--input <file>', 'UTF-8 file: one OpenAI eval ID per line').conflicts([
        'eval',
        'allNew',
      ]),
    )
    .addOption(
      new Option('--all-new', 'import every not-yet-imported evaluation').conflicts([
        'eval',
        'input',
      ]),
    )
    .action(
      async (options: { eval: string[]; input?: string; allNew?: boolean }, command: Command) =>
        execute(
          {
            operation: 'run',
            ...(options.input || options.allNew ? {} : { evalIds: options.eval }),
            allNew: options.allNew === true,
          },
          command,
          options.input,
        ),
    );
  group
    .command('list')
    .description('list imported workspaces')
    .action(async (_options: object, command: Command) => execute({ operation: 'list' }, command));
  pagination(group.command('evals').description('list imported evaluations in a workspace'), 200)
    .requiredOption('--workspace <uuid>', 'Plumloom workspace UUID')
    .option('--search <text>', 'filter imported evaluations')
    .action(
      async (
        options: { workspace: string; page: number; size: number; search?: string },
        command: Command,
      ) => {
        const { workspace, ...paging } = options;
        await execute({ operation: 'evals', workspaceId: workspace, ...paging }, command);
      },
    );
  pagination(
    group
      .command('show <plumloom-eval-id>')
      .description('show an imported evaluation and run results'),
  )
    .option('--run <run-id>', 'select a Plumloom run UUID (newest by default)')
    .option('--show-outputs', 'expand inputs, expected values, and outputs')
    .action(
      async (
        evaluationId: string,
        options: { page: number; size: number; run?: string; showOutputs?: boolean },
        command: Command,
      ) => execute({ operation: 'show', evaluationId, ...options }, command),
    );
  group
    .command('insights')
    .description('show insights derived by Plumloom')
    .requiredOption('--workspace <uuid>', 'Plumloom workspace UUID')
    .action(async (options: { workspace: string }, command: Command) =>
      execute({ operation: 'insights', workspaceId: options.workspace }, command),
    );
  group
    .command('remove <plumloom-eval-id>')
    .description('delete an imported evaluation and its runs/results')
    .option('--yes', 'confirm deletion without prompting')
    .action(async (evaluationId: string, options: { yes?: boolean }, command: Command) =>
      execute({ operation: 'remove', evaluationId, yes: options.yes === true }, command),
    );
  group
    .command('disconnect')
    .description('clear discovery cache; retain OpenAI key and imported evaluations')
    .action(async (_options: object, command: Command) =>
      execute({ operation: 'disconnect' }, command),
    );
}
