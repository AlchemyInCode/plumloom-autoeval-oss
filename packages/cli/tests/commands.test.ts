import { CommanderError } from 'commander';
import { describe, expect, it, vi } from 'vitest';

import { configureSafeProgramOutput, createProgram } from '../src/commands/program.js';
import type {
  CommandExecutor,
  DeterministicCommand,
  ExecutionOptions,
} from '../src/commands/types.js';
import { IDS, VALID_KEY } from './helpers.js';

function parserHarness(): {
  calls: { command: DeterministicCommand; options: ExecutionOptions }[];
  parse: (args: string[]) => Promise<void>;
} {
  const calls: { command: DeterministicCommand; options: ExecutionOptions }[] = [];
  const executor: CommandExecutor = {
    execute: vi.fn((command: DeterministicCommand, options: ExecutionOptions) => {
      calls.push({ command, options });
      return Promise.resolve();
    }),
  };
  const program = createProgram(executor);
  const silence = (command: typeof program): void => {
    command.configureOutput({ writeOut: () => undefined, writeErr: () => undefined });
    command.commands.forEach(silence);
  };
  silence(program);
  return {
    calls,
    parse: async (args) => {
      await program.parseAsync(['node', 'autoeval', ...args]);
    },
  };
}

describe('deterministic command parsing', () => {
  const cases: [string[], DeterministicCommand][] = [
    [['login'], { kind: 'login' }],
    [['login', '--key', 'pl_sk_abc123'], { kind: 'login', key: 'pl_sk_abc123' }],
    [['logout'], { kind: 'logout' }],
    [['whoami'], { kind: 'whoami' }],
    [['workspace', 'list'], { kind: 'workspace-list' }],
    [
      ['workspace', 'create', '--name', 'Product launch v2', '--description', 'r'],
      { kind: 'workspace-create', name: 'Product launch v2', description: 'r' },
    ],
    [
      ['eval', 'list', '--workspace', IDS.workspace],
      { kind: 'evaluation-list', workspaceId: IDS.workspace },
    ],
    [
      ['eval', 'create', '--workspace', IDS.workspace, '--name', 'Untitled'],
      { kind: 'evaluation-create', workspaceId: IDS.workspace, name: 'Untitled' },
    ],
    [
      [
        'eval',
        'create-from',
        '--workspace',
        IDS.workspace,
        '--input',
        'fixture.json',
        '--judge-model-id',
        IDS.model,
        '--primary-model-id',
        IDS.config,
        '--run',
      ],
      {
        kind: 'evaluation-create-from',
        workspaceId: IDS.workspace,
        inputFiles: ['fixture.json'],
        judgeModelId: IDS.model,
        primaryModelId: IDS.config,
        run: true,
      },
    ],
    [
      [
        'eval',
        'update-title',
        '--workspace',
        IDS.workspace,
        '--evaluation',
        IDS.evaluation,
        '--name',
        'Untitled123',
        '--user-system-id',
        'USR-3B98B101F7D2',
        '--description',
        'd',
      ],
      {
        kind: 'evaluation-update-title',
        workspaceId: IDS.workspace,
        evaluationId: IDS.evaluation,
        name: 'Untitled123',
        userSystemId: 'USR-3B98B101F7D2',
        description: 'd',
        page: 1,
        size: 50,
      },
    ],
    [
      ['eval', 'validate', '--input', 'fixture.json'],
      {
        kind: 'evaluation-validate',
        inputFile: 'fixture.json',
      },
    ],
    [
      ['eval', 'run-configured', '--evaluation', IDS.evaluation, '--input', 'fixture.json'],
      {
        kind: 'evaluation-run-configured',
        evaluationId: IDS.evaluation,
        inputFile: 'fixture.json',
      },
    ],
    [
      ['suite', 'run', '--manifest', 'autoeval.suite.yaml'],
      {
        kind: 'suite-run',
        manifestFile: 'autoeval.suite.yaml',
      },
    ],
    [
      [
        'suite',
        'run',
        '--manifest',
        'autoeval.suite.yaml',
        '--workspace',
        IDS.workspace,
        '--judge-model-id',
        IDS.model,
        '--primary-model-id',
        IDS.config,
      ],
      {
        kind: 'suite-run',
        manifestFile: 'autoeval.suite.yaml',
        workspaceId: IDS.workspace,
        judgeModelId: IDS.model,
        primaryModelId: IDS.config,
      },
    ],
    [
      [
        'suite',
        'run',
        '--manifest',
        'autoeval.suite.yaml',
        '--concurrency',
        '4',
        '--stagger-ms',
        '200',
      ],
      {
        kind: 'suite-run',
        manifestFile: 'autoeval.suite.yaml',
        concurrency: 4,
        staggerMs: 200,
      },
    ],
    [
      ['suite', 'gate', '--manifest', 'autoeval.suite.yaml'],
      {
        kind: 'suite-gate',
        manifestFile: 'autoeval.suite.yaml',
      },
    ],
    [
      [
        'suite',
        'gate',
        '--manifest',
        'autoeval.suite.yaml',
        '--workspace',
        IDS.workspace,
        '--judge-model-id',
        IDS.model,
        '--primary-model-id',
        IDS.config,
      ],
      {
        kind: 'suite-gate',
        manifestFile: 'autoeval.suite.yaml',
        workspaceId: IDS.workspace,
        judgeModelId: IDS.model,
        primaryModelId: IDS.config,
      },
    ],
    [
      [
        'suite',
        'gate',
        '--manifest',
        'autoeval.suite.yaml',
        '--concurrency',
        '4',
        '--stagger-ms',
        '200',
      ],
      {
        kind: 'suite-gate',
        manifestFile: 'autoeval.suite.yaml',
        concurrency: 4,
        staggerMs: 200,
      },
    ],
    [
      ['qs', 'create', '--input', 'qs.json'],
      {
        kind: 'quality-standard-create',
        inputFile: 'qs.json',
      },
    ],
    [
      ['qs', 'create', '--workspace', IDS.workspace, '--input', 'qs.json'],
      {
        kind: 'quality-standard-create',
        workspaceId: IDS.workspace,
        inputFile: 'qs.json',
      },
    ],
    [
      ['qs', 'update', IDS.methodology, '--input', 'qs.json'],
      {
        kind: 'quality-standard-update',
        qualityStandardId: IDS.methodology,
        inputFile: 'qs.json',
      },
    ],
    [
      ['qs', 'assign', IDS.methodology, '--workspace', IDS.workspace],
      {
        kind: 'quality-standard-assign',
        workspaceId: IDS.workspace,
        qualityStandardId: IDS.methodology,
      },
    ],
    [
      ['qs', 'workspace', '--workspace', IDS.workspace],
      {
        kind: 'quality-standard-workspace',
        workspaceId: IDS.workspace,
      },
    ],
    [
      ['qs', 'show', IDS.methodology],
      {
        kind: 'quality-standard-show',
        qualityStandardId: IDS.methodology,
      },
    ],
    [
      ['eval', 'versions', IDS.evaluation],
      { kind: 'evaluation-versions', evaluationId: IDS.evaluation },
    ],
    [['eval', 'show', IDS.evaluation], { kind: 'evaluation-show', evaluationId: IDS.evaluation }],
    [
      ['eval', 'show', IDS.evaluation, '--version', '2'],
      { kind: 'evaluation-show', evaluationId: IDS.evaluation, version: 2 },
    ],
    [
      [
        'doctor',
        '--workspace',
        IDS.workspace,
        '--manifest',
        'autoeval.suite.yaml',
        '--input',
        'a.json',
        '--input',
        'b.json',
      ],
      {
        kind: 'doctor',
        workspaceId: IDS.workspace,
        manifestFile: 'autoeval.suite.yaml',
        inputFiles: ['a.json', 'b.json'],
      },
    ],
    [
      [
        'trace',
        'import',
        '--from',
        'deepseek-harness',
        '--session',
        'session.jsonl',
        '--template',
        'template.json',
        '--out',
        'imported.json',
      ],
      {
        kind: 'trace-import',
        source: 'deepseek-harness',
        sessionFile: 'session.jsonl',
        templateFile: 'template.json',
        outputFile: 'imported.json',
        run: false,
      },
    ],
    [
      ['gate', IDS.evaluation, '--metric', 'factuality=4', 'tone=3.5'],
      {
        kind: 'gate',
        evaluationId: IDS.evaluation,
        thresholds: { metrics: { factuality: 4, tone: 3.5 } },
      },
    ],
    [
      ['gate', IDS.evaluation, '--min-judge-agreement', '0.66'],
      {
        kind: 'gate',
        evaluationId: IDS.evaluation,
        thresholds: { minJudgeAgreement: 0.66 },
      },
    ],
    [['models'], { kind: 'models' }],
    [
      ['quickstart'],
      {
        kind: 'quickstart',
        sample: 'trace',
        assumeYes: false,
      },
    ],
    [
      [
        'quickstart',
        '--sample',
        'scenario',
        '--workspace',
        IDS.workspace,
        '--judge-model-id',
        IDS.model,
        '--primary-model-id',
        IDS.config,
        '--input',
        'fixture.json',
        '--yes',
      ],
      {
        kind: 'quickstart',
        workspaceId: IDS.workspace,
        judgeModelId: IDS.model,
        primaryModelId: IDS.config,
        inputFile: 'fixture.json',
        sample: 'scenario',
        assumeYes: true,
      },
    ],
    [['run', IDS.evaluation], { kind: 'run', evaluationId: IDS.evaluation }],
    [
      ['status', IDS.evaluation, IDS.run],
      { kind: 'status', evaluationId: IDS.evaluation, runId: IDS.run },
    ],
    [
      ['results', IDS.evaluation, IDS.run],
      { kind: 'results', evaluationId: IDS.evaluation, runId: IDS.run },
    ],
    [
      ['results', IDS.evaluation, IDS.run, '--show-outputs'],
      { kind: 'results', evaluationId: IDS.evaluation, runId: IDS.run, showOutputs: true },
    ],
  ];

  it.each(cases)('parses %j exactly', async (arguments_, expected) => {
    const harness = parserHarness();
    await harness.parse(arguments_);
    expect(harness.calls).toEqual([{ command: expected, options: { json: false, debug: false } }]);
  });

  it('inherits global JSON and debug flags', async () => {
    const harness = parserHarness();
    await harness.parse(['--json', '--debug', 'whoami']);
    expect(harness.calls[0]?.options).toEqual({ json: true, debug: true });
  });

  it('rejects missing required options and unknown commands', async () => {
    await expect(parserHarness().parse(['eval', 'list'])).rejects.toBeInstanceOf(CommanderError);
    await expect(parserHarness().parse(['workspace', 'create'])).rejects.toBeInstanceOf(
      CommanderError,
    );
    await expect(
      parserHarness().parse(['eval', 'run-configured', '--evaluation', IDS.evaluation]),
    ).rejects.toBeInstanceOf(CommanderError);
    await expect(
      parserHarness().parse(['suite', 'run', '--manifest', 'm.yaml', '--concurrency', '0']),
    ).rejects.toMatchObject({ kind: 'usage', code: 'INVALID_SUITE_OPTION' });
    await expect(
      parserHarness().parse(['suite', 'run', '--manifest', 'm.yaml', '--stagger-ms', '-1']),
    ).rejects.toMatchObject({ kind: 'usage', code: 'INVALID_SUITE_OPTION' });
    await expect(parserHarness().parse(['eval', 'validate'])).rejects.toBeInstanceOf(
      CommanderError,
    );
    await expect(
      parserHarness().parse(['eval', 'show', IDS.evaluation, '--version', '0']),
    ).rejects.toMatchObject({ kind: 'usage', code: 'INVALID_EVALUATION_VERSION' });
    await expect(parserHarness().parse(['qs', 'create'])).rejects.toBeInstanceOf(CommanderError);
    await expect(parserHarness().parse(['qs', 'update', IDS.methodology])).rejects.toBeInstanceOf(
      CommanderError,
    );
    await expect(parserHarness().parse(['qs', 'assign', IDS.methodology])).rejects.toBeInstanceOf(
      CommanderError,
    );
    await expect(parserHarness().parse(['qs', 'workspace'])).rejects.toBeInstanceOf(CommanderError);
    await expect(
      parserHarness().parse(['trace', 'import', '--from', 'unsupported']),
    ).rejects.toBeInstanceOf(CommanderError);
    await expect(
      parserHarness().parse(['gate', IDS.evaluation, '--metric', 'missing-separator']),
    ).rejects.toMatchObject({ kind: 'usage', code: 'INVALID_GATE_THRESHOLD' });
  });

  it('redacts CLI-key-shaped values from parser errors', async () => {
    const program = createProgram({ execute: () => Promise.resolve() });
    let stderr = '';
    configureSafeProgramOutput(
      program,
      { write: () => true },
      {
        write: (chunk) => {
          stderr += chunk;
          return true;
        },
      },
    );

    await expect(program.parseAsync(['node', 'autoeval', VALID_KEY])).rejects.toBeInstanceOf(
      CommanderError,
    );
    expect(stderr).not.toContain(VALID_KEY);
    expect(stderr).toContain('[REDACTED]');
  });

  it('exposes no extra surface beyond the deterministic commands', async () => {
    const execute = vi.fn(() => Promise.resolve());
    const rootProgram = createProgram({ execute });
    configureSafeProgramOutput(rootProgram, { write: () => true }, { write: () => true });
    await expect(rootProgram.parseAsync(['node', 'autoeval'])).rejects.toMatchObject({
      kind: 'usage',
      code: 'NO_COMMAND',
      exitCode: 2,
    });

    let help = '';
    const helpProgram = createProgram({ execute });
    configureSafeProgramOutput(
      helpProgram,
      {
        write: (chunk) => {
          help += chunk;
          return true;
        },
      },
      { write: () => true },
    );
    helpProgram.outputHelp();
    for (const forbidden of [
      'chat',
      'AUTOEVAL_CONVERSATION',
      'AUTOEVAL_PLANNER_PROVIDER',
      'OPENAI_API_KEY',
    ]) {
      expect(help).not.toContain(forbidden);
    }
    expect(help).toContain('autoeval quickstart');
  });

  it('registers commands supplied by a composing distribution', async () => {
    const execute = vi.fn(() => Promise.resolve());
    const extra = vi.fn(() => undefined);
    const program = createProgram({ execute }, [
      (command) => {
        command.command('extra').action(extra);
      },
    ]);
    await program.parseAsync(['node', 'autoeval', 'extra']);
    expect(extra).toHaveBeenCalledOnce();
  });

  it('rejects excess positional arguments on the root command', async () => {
    const program = createProgram({ execute: () => Promise.resolve() });
    configureSafeProgramOutput(program, { write: () => true }, { write: () => true });
    await expect(program.parseAsync(['node', 'autoeval', 'not-a-command'])).rejects.toBeInstanceOf(
      CommanderError,
    );
  });
});
