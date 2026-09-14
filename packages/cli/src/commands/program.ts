import { Command, Option } from 'commander';
import type { QuickstartSampleKind } from '../quickstart/sample.js';

import { safeMultilineTerminalText } from '../output/safe-text.js';
import type { OutputStream } from '../output/writer.js';
import type { GateThresholds } from '../actions/gate.js';
import { AutoevalError } from '../errors/autoeval-error.js';
import { CLI_VERSION } from '../version.js';
import type { CommandExecutor, ExecutionOptions } from './types.js';

export function parseThresholdNumber(flag: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new AutoevalError(`${flag} must be a number, received "${value}".`, {
      kind: 'usage',
      code: 'INVALID_GATE_THRESHOLD',
    });
  }
  if (flag === '--min-judge-agreement' && (parsed < 0 || parsed > 1)) {
    throw new AutoevalError(`${flag} must be between 0 and 1.`, {
      kind: 'usage',
      code: 'INVALID_GATE_THRESHOLD',
    });
  }
  return parsed;
}

/** Parse repeatable `--metric name=score` pairs for session release gating. */
export function parseMetricThresholds(values: readonly string[]): Record<string, number> {
  const metrics: Record<string, number> = {};
  for (const value of values) {
    const separator = value.indexOf('=');
    const name = separator === -1 ? '' : value.slice(0, separator).trim();
    if (name === '') {
      throw new AutoevalError(`--metric must use the form name=score, received "${value}".`, {
        kind: 'usage',
        code: 'INVALID_GATE_THRESHOLD',
      });
    }
    metrics[name] = parseThresholdNumber('--metric', value.slice(separator + 1).trim());
  }
  return metrics;
}

function parsePositiveInteger(flag: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AutoevalError(`${flag} must be a positive integer, received "${value}".`, {
      kind: 'usage',
      code: 'INVALID_SUITE_OPTION',
    });
  }
  return parsed;
}

function parseNonNegativeInteger(flag: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new AutoevalError(`${flag} must be a non-negative integer, received "${value}".`, {
      kind: 'usage',
      code: 'INVALID_SUITE_OPTION',
    });
  }
  return parsed;
}

function parseEvaluationVersion(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AutoevalError(`--version must be a positive integer, received "${value}".`, {
      kind: 'usage',
      code: 'INVALID_EVALUATION_VERSION',
    });
  }
  return parsed;
}

/**
 * Keep global flags ergonomic by accepting them before or after subcommands.
 * Commander with positional options expects root flags before the command, so
 * normalize trailing global flags into leading positions before parsing.
 */
export function normalizeGlobalCliFlags(tokens: readonly string[]): string[] {
  const leading: string[] = [];
  const trailing: string[] = [];
  let passthrough = false;

  for (const token of tokens) {
    if (passthrough) {
      trailing.push(token);
      continue;
    }
    if (token === '--') {
      passthrough = true;
      trailing.push(token);
      continue;
    }
    if (token === '--json' || token === '--debug') {
      if (!leading.includes(token)) leading.push(token);
      continue;
    }
    trailing.push(token);
  }

  return [...leading, ...trailing];
}

function executionOptions(command: Command): ExecutionOptions {
  const options = command.optsWithGlobals<{ json?: boolean; debug?: boolean }>();
  return { json: options.json === true, debug: options.debug === true };
}

/**
 * Optional composition hook. Distributions that ship additional surfaces
 * register their commands and help text here; the public CLI passes none.
 */
export type ProgramExtension = (program: Command) => void;

export function createProgram(
  executor: CommandExecutor,
  extensions: readonly ProgramExtension[] = [],
): Command {
  const program = new Command();
  program
    .name('autoeval')
    .description('Deterministic terminal client for Plumloom Autoeval')
    .version(CLI_VERSION)
    .option('--json', 'emit machine-readable JSON')
    .option('--debug', 'emit redacted request diagnostics to stderr')
    .enablePositionalOptions()
    .showHelpAfterError()
    .showSuggestionAfterError()
    // Root only: no subcommand declares variadic positionals, but scoping this
    // here keeps future variadic subcommands unaffected.
    .allowExcessArguments(false)
    .exitOverride();

  program.addHelpText(
    'after',
    [
      '',
      'Getting started:',
      '  1. autoeval login                             authenticate once (or set AUTOEVAL_API_KEY)',
      '  2. autoeval quickstart                        run a first evaluation end to end',
      '  3. autoeval run <evaluation-id>               run and wait; prints the Run ID',
      '  4. autoeval results <evaluation-id> <run-id>  read results for the Run ID from step 3',
      '',
      'Tips:',
      '  Add --json to any command for machine-readable output on stdout',
      '  Add --debug to print redacted request diagnostics to stderr',
      '',
      'Environment:',
      '  AUTOEVAL_API_KEY          CLI key used instead of the OS credential store',
      '  AUTOEVAL_API_BASE_URL     required Autoeval API origin (https, no path)',
      '',
    ].join('\n'),
  );

  // Non-interactive bare invocations still return an actionable usage error.
  program.action((_options: object, command: Command) => {
    command.outputHelp();
    throw new AutoevalError('Autoeval requires a command.', {
      kind: 'usage',
      code: 'NO_COMMAND',
    });
  });

  program
    .command('login')
    .description('authenticate with a Plumloom CLI key')
    .option('--key <key>', 'CLI key (pl_sk_...) for non-interactive login')
    .action(async (options: { key?: string }, command: Command) => {
      await executor.execute(
        { kind: 'login', ...(options.key !== undefined ? { key: options.key } : {}) },
        executionOptions(command),
      );
    });

  program
    .command('logout')
    .description('remove the locally stored CLI key')
    .action(async (_options: object, command: Command) => {
      await executor.execute({ kind: 'logout' }, executionOptions(command));
    });

  program
    .command('whoami')
    .description('show the authenticated Plumloom identity')
    .action(async (_options: object, command: Command) => {
      await executor.execute({ kind: 'whoami' }, executionOptions(command));
    });

  const workspace = program.command('workspace').description('workspace operations');
  workspace
    .command('list')
    .description('list accessible workspaces')
    .action(async (_options: object, command: Command) => {
      await executor.execute({ kind: 'workspace-list' }, executionOptions(command));
    });
  workspace
    .command('create')
    .description('create a new workspace')
    .requiredOption('--name <name>', 'workspace name')
    .option('--description <description>', 'workspace description')
    .action(async (options: { name: string; description?: string }, command: Command) => {
      await executor.execute(
        {
          kind: 'workspace-create',
          name: options.name,
          ...(options.description ? { description: options.description } : {}),
        },
        executionOptions(command),
      );
    });

  const evaluation = program.command('eval').description('evaluation operations');
  evaluation
    .command('list')
    .description('list evaluations in a workspace')
    .requiredOption('--workspace <workspace-id>', 'workspace UUID')
    .action(async (options: { workspace: string }, command: Command) => {
      await executor.execute(
        { kind: 'evaluation-list', workspaceId: options.workspace },
        executionOptions(command),
      );
    });
  evaluation
    .command('create')
    .description('create an evaluation draft in a workspace')
    .requiredOption('--workspace <workspace-id>', 'workspace UUID')
    .option('--name <evaluation-name>', 'evaluation name', 'Untitled')
    .action(async (options: { workspace: string; name?: string }, command: Command) => {
      await executor.execute(
        {
          kind: 'evaluation-create',
          workspaceId: options.workspace,
          ...(options.name ? { name: options.name } : {}),
        },
        executionOptions(command),
      );
    });
  evaluation
    .command('create-from')
    .description('create an evaluation in a workspace from a configured-run file')
    .requiredOption('--workspace <workspace-id>', 'workspace UUID')
    .requiredOption('--input <json-file>', 'configured-run file, such as one from eval scaffold')
    .option('--judge-model-id <uuid>', 'override the file judge model with an enabled model UUID')
    .option(
      '--primary-model-id <uuid>',
      'override the file scenario primary model with an enabled model UUID',
    )
    .option('--run', 'run the evaluation immediately after creating it')
    .action(
      async (
        options: {
          workspace: string;
          input: string;
          judgeModelId?: string;
          primaryModelId?: string;
          run?: boolean;
        },
        command: Command,
      ) => {
        await executor.execute(
          {
            kind: 'evaluation-create-from',
            workspaceId: options.workspace,
            inputFiles: [options.input],
            run: options.run === true,
            ...(options.judgeModelId === undefined ? {} : { judgeModelId: options.judgeModelId }),
            ...(options.primaryModelId === undefined
              ? {}
              : { primaryModelId: options.primaryModelId }),
          },
          executionOptions(command),
        );
      },
    );

  const trace = program
    .command('trace')
    .description('convert agent trajectories into agent_trace evaluation input');
  trace
    .command('import')
    .description('convert a DeepSeek Harness session log into an agent_trace evaluation input file')
    .requiredOption('--from <source>', 'trajectory source; only deepseek-harness is supported')
    .requiredOption('--session <jsonl-file>', 'Harness session log written as raw JSONL lines')
    .requiredOption('--template <json-file>', 'configured-run file supplying methodology and judge')
    .requiredOption('--out <json-file>', 'new path to write the agent_trace evaluation input')
    .option('--name <evaluation-name>', 'evaluation name for the imported trace')
    .option('--service-name <service-name>', 'service.name resource attribute for the trace')
    .option('--workspace <workspace-id>', 'workspace UUID, required with --run')
    .option('--run', 'create and run the evaluation immediately after writing the file')
    .action(
      async (
        options: {
          from: string;
          session: string;
          template: string;
          out: string;
          name?: string;
          serviceName?: string;
          workspace?: string;
          run?: boolean;
        },
        command: Command,
      ) => {
        if (options.from !== 'deepseek-harness') {
          throw new AutoevalError(
            `Unsupported trajectory source: ${options.from}. Use --from deepseek-harness.`,
            { kind: 'usage', code: 'UNSUPPORTED_TRACE_SOURCE' },
          );
        }
        await executor.execute(
          {
            kind: 'trace-import',
            source: 'deepseek-harness',
            sessionFile: options.session,
            templateFile: options.template,
            outputFile: options.out,
            ...(options.name ? { evaluationName: options.name } : {}),
            ...(options.serviceName ? { serviceName: options.serviceName } : {}),
            ...(options.workspace ? { workspaceId: options.workspace } : {}),
            run: options.run === true,
          },
          executionOptions(command),
        );
      },
    );

  evaluation
    .command('versions <evaluation-id>')
    .description('list saved evaluation versions for an evaluation')
    .action(async (evaluationId: string, _options: object, command: Command) => {
      await executor.execute(
        { kind: 'evaluation-versions', evaluationId },
        executionOptions(command),
      );
    });

  evaluation
    .command('show <evaluation-id>')
    .description(
      "show the evaluation's configuration and version information (evaluation version plus methodology and config version IDs)",
    )
    .option(
      '--version <number>',
      'evaluation version number to inspect (a revision number such as 1, not an ID)',
    )
    .action(async (evaluationId: string, options: { version?: string }, command: Command) => {
      await executor.execute(
        {
          kind: 'evaluation-show',
          evaluationId,
          ...(options.version === undefined
            ? {}
            : { version: parseEvaluationVersion(options.version) }),
        },
        executionOptions(command),
      );
    });
  evaluation
    .command('validate')
    .description('validate evaluation input without creating or running an evaluation')
    .requiredOption('--input <json-file>', 'path to JSON file with methodology and configuration')
    .action(async (options: { input: string }, command: Command) => {
      await executor.execute(
        { kind: 'evaluation-validate', inputFile: options.input },
        executionOptions(command),
      );
    });
  evaluation
    .command('run-configured')
    .description('create methodology/config, run once, and wait for completion')
    .requiredOption('--evaluation <evaluation-id>', 'evaluation UUID')
    .requiredOption('--input <json-file>', 'path to JSON file with methodology and configuration')
    .action(async (options: { evaluation: string; input: string }, command: Command) => {
      await executor.execute(
        {
          kind: 'evaluation-run-configured',
          evaluationId: options.evaluation,
          inputFile: options.input,
        },
        executionOptions(command),
      );
    });
  evaluation
    .command('update-title')
    .description('update evaluation title, sync evaltool list, and fetch refreshed workspace list')
    .requiredOption('--workspace <workspace-id>', 'workspace UUID')
    .requiredOption('--evaluation <evaluation-id>', 'evaluation UUID')
    .requiredOption('--name <evaluation-name>', 'new evaluation title')
    .requiredOption('--user-system-id <user-system-id>', 'user system ID for patch payload')
    .option('--description <description>', 'evaluation description')
    .option('--page <page>', 'result page number', '1')
    .option('--size <size>', 'result page size', '50')
    .action(
      async (
        options: {
          workspace: string;
          evaluation: string;
          name: string;
          userSystemId: string;
          description?: string;
          page?: string;
          size?: string;
        },
        command: Command,
      ) => {
        await executor.execute(
          {
            kind: 'evaluation-update-title',
            workspaceId: options.workspace,
            evaluationId: options.evaluation,
            name: options.name,
            userSystemId: options.userSystemId,
            ...(options.description ? { description: options.description } : {}),
            ...(options.page ? { page: Number(options.page) } : {}),
            ...(options.size ? { size: Number(options.size) } : {}),
          },
          executionOptions(command),
        );
      },
    );

  const suite = program.command('suite').description('workspace-level evaluation suites');
  suite
    .command('run')
    .description('create and run every evaluation listed in a suite manifest')
    .requiredOption('--manifest <manifest-file>', 'suite manifest (YAML or JSON)')
    .option('--workspace <workspace-id>', "override the manifest's workspace UUID")
    .option('--judge-model-id <uuid>', 'override every eval judge model with an enabled model UUID')
    .option(
      '--primary-model-id <uuid>',
      'override every scenario primary model with an enabled model UUID',
    )
    .option('--concurrency <count>', 'maximum number of evals to run at once')
    .option('--stagger-ms <milliseconds>', 'delay between scheduling eval starts')
    .action(
      async (
        options: {
          manifest: string;
          workspace?: string;
          judgeModelId?: string;
          primaryModelId?: string;
          concurrency?: string;
          staggerMs?: string;
        },
        command: Command,
      ) => {
        const concurrency =
          options.concurrency === undefined
            ? undefined
            : parsePositiveInteger('--concurrency', options.concurrency);
        const staggerMs =
          options.staggerMs === undefined
            ? undefined
            : parseNonNegativeInteger('--stagger-ms', options.staggerMs);
        await executor.execute(
          {
            kind: 'suite-run',
            manifestFile: options.manifest,
            ...(options.workspace === undefined ? {} : { workspaceId: options.workspace }),
            ...(options.judgeModelId === undefined ? {} : { judgeModelId: options.judgeModelId }),
            ...(options.primaryModelId === undefined
              ? {}
              : { primaryModelId: options.primaryModelId }),
            ...(concurrency === undefined ? {} : { concurrency }),
            ...(staggerMs === undefined ? {} : { staggerMs }),
          },
          executionOptions(command),
        );
      },
    );

  suite
    .command('gate')
    .description('run a suite manifest and decide whether the release is allowed')
    .requiredOption('--manifest <manifest-file>', 'suite manifest (YAML or JSON)')
    .option('--workspace <workspace-id>', "override the manifest's workspace UUID")
    .option('--judge-model-id <uuid>', 'override every eval judge model with an enabled model UUID')
    .option(
      '--primary-model-id <uuid>',
      'override every scenario primary model with an enabled model UUID',
    )
    .option('--concurrency <count>', 'maximum number of evals to run at once')
    .option('--stagger-ms <milliseconds>', 'delay between scheduling eval starts')
    .action(
      async (
        options: {
          manifest: string;
          workspace?: string;
          judgeModelId?: string;
          primaryModelId?: string;
          concurrency?: string;
          staggerMs?: string;
        },
        command: Command,
      ) => {
        const concurrency =
          options.concurrency === undefined
            ? undefined
            : parsePositiveInteger('--concurrency', options.concurrency);
        const staggerMs =
          options.staggerMs === undefined
            ? undefined
            : parseNonNegativeInteger('--stagger-ms', options.staggerMs);
        await executor.execute(
          {
            kind: 'suite-gate',
            manifestFile: options.manifest,
            ...(options.workspace === undefined ? {} : { workspaceId: options.workspace }),
            ...(options.judgeModelId === undefined ? {} : { judgeModelId: options.judgeModelId }),
            ...(options.primaryModelId === undefined
              ? {}
              : { primaryModelId: options.primaryModelId }),
            ...(concurrency === undefined ? {} : { concurrency }),
            ...(staggerMs === undefined ? {} : { staggerMs }),
          },
          executionOptions(command),
        );
      },
    );

  program
    .command('doctor')
    .description('run pre-flight checks on auth, workspace, models, and eval or manifest files')
    .option('--workspace <workspace-id>', 'workspace UUID to verify access to')
    .option('--manifest <manifest-file>', 'suite manifest to parse and check (YAML or JSON)')
    .option(
      '--input <json-file>',
      'eval file to check; repeat for several files',
      (value: string, previous: readonly string[]) => [...previous, value],
      [] as string[],
    )
    .action(
      async (
        options: { workspace?: string; manifest?: string; input?: string[] },
        command: Command,
      ) => {
        await executor.execute(
          {
            kind: 'doctor',
            inputFiles: options.input ?? [],
            ...(options.workspace === undefined ? {} : { workspaceId: options.workspace }),
            ...(options.manifest === undefined ? {} : { manifestFile: options.manifest }),
          },
          executionOptions(command),
        );
      },
    );

  const qualityStandard = program.command('qs').description('quality standard operations');
  qualityStandard
    .command('create')
    .description('create a quality standard from JSON input')
    .option('--workspace <workspace-id>', 'workspace UUID to auto-associate after creation')
    .requiredOption('--input <file>', 'path to JSON file with quality standard payload')
    .action(async (options: { input: string; workspace?: string }, command: Command) => {
      await executor.execute(
        {
          kind: 'quality-standard-create',
          inputFile: options.input,
          ...(options.workspace ? { workspaceId: options.workspace } : {}),
        },
        executionOptions(command),
      );
    });
  qualityStandard
    .command('update <qs-id>')
    .description('update a quality standard from JSON input')
    .requiredOption('--input <file>', 'path to JSON file with quality standard payload')
    .action(async (qualityStandardId: string, options: { input: string }, command: Command) => {
      await executor.execute(
        {
          kind: 'quality-standard-update',
          qualityStandardId,
          inputFile: options.input,
        },
        executionOptions(command),
      );
    });
  qualityStandard
    .command('assign <qs-id>')
    .description('associate a quality standard with a workspace')
    .requiredOption('--workspace <workspace-id>', 'workspace UUID')
    .action(async (qualityStandardId: string, options: { workspace: string }, command: Command) => {
      await executor.execute(
        {
          kind: 'quality-standard-assign',
          workspaceId: options.workspace,
          qualityStandardId,
        },
        executionOptions(command),
      );
    });
  qualityStandard
    .command('workspace')
    .description('retrieve the quality standard assigned to a workspace')
    .requiredOption('--workspace <workspace-id>', 'workspace UUID')
    .action(async (options: { workspace: string }, command: Command) => {
      await executor.execute(
        { kind: 'quality-standard-workspace', workspaceId: options.workspace },
        executionOptions(command),
      );
    });
  qualityStandard
    .command('show <qs-id>')
    .description('retrieve a quality standard by ID')
    .action(async (qualityStandardId: string, _options: object, command: Command) => {
      await executor.execute(
        { kind: 'quality-standard-show', qualityStandardId },
        executionOptions(command),
      );
    });

  program
    .command('models')
    .description('list models available through Plumloom')
    .action(async (_options: object, command: Command) => {
      await executor.execute({ kind: 'models' }, executionOptions(command));
    });

  program
    .command('quickstart')
    .description(
      'run a first evaluation end to end: resolves your workspace and judge model, runs the bundled agent trace sample, and prints the result',
    )
    .option('--workspace <workspace-id>', 'use this workspace instead of resolving one')
    .option('--judge-model-id <model-id>', 'use this judge model instead of resolving one')
    .option(
      '--primary-model-id <model-id>',
      'use this model under test instead of resolving one (scenario sample only)',
    )
    .addOption(
      new Option(
        '--sample <kind>',
        'which bundled sample to run: an agent trace, or a scenario that calls a model under test',
      )
        .choices(['trace', 'scenario'])
        .default('trace'),
    )
    .option('--input <file>', 'run this evaluation file instead of the bundled sample')
    .option('--yes', 'never prompt; fail if a choice is required', false)
    .action(
      async (
        options: {
          workspace?: string;
          judgeModelId?: string;
          primaryModelId?: string;
          input?: string;
          sample: QuickstartSampleKind;
          yes?: boolean;
        },
        command: Command,
      ) => {
        await executor.execute(
          {
            kind: 'quickstart',
            ...(options.workspace === undefined ? {} : { workspaceId: options.workspace }),
            ...(options.judgeModelId === undefined ? {} : { judgeModelId: options.judgeModelId }),
            ...(options.primaryModelId === undefined
              ? {}
              : { primaryModelId: options.primaryModelId }),
            ...(options.input === undefined ? {} : { inputFile: options.input }),
            sample: options.sample,
            assumeYes: options.yes === true,
          },
          executionOptions(command),
        );
      },
    );

  program
    .command('run <evaluation-id>')
    .description(
      'start an evaluation run, wait for a terminal state, and print the Run ID used by status and results',
    )
    .action(async (evaluationId: string, _options: object, command: Command) => {
      await executor.execute({ kind: 'run', evaluationId }, executionOptions(command));
    });

  program
    .command('status <evaluation-id> <run-id>')
    .description('show the status of an evaluation run for the Run ID printed when the run started')
    .action(async (evaluationId: string, runId: string, _options: object, command: Command) => {
      await executor.execute({ kind: 'status', evaluationId, runId }, executionOptions(command));
    });

  program
    .command('results <evaluation-id> <run-id>')
    .description(
      'retrieve results for the Run ID printed when the run started, using the evaluation context',
    )
    .option('-v, --show-outputs', 'also print each test case input and the model response')
    .action(
      async (
        evaluationId: string,
        runId: string,
        options: { showOutputs?: boolean },
        command: Command,
      ) => {
        await executor.execute(
          {
            kind: 'results',
            evaluationId,
            runId,
            ...(options.showOutputs === true ? { showOutputs: true } : {}),
          },
          executionOptions(command),
        );
      },
    );

  program
    .command('gate <evaluation-id>')
    .description('evaluate a run result and fail when it misses the configured thresholds')
    .option('--min-overall <score>', 'minimum overall score')
    .option('--min-scenario <score>', 'minimum score for every scenario and model')
    .option('--min-judge-agreement <ratio>', 'minimum judge agreement ratio between 0 and 1')
    .option(
      '--metric <name=score...>',
      'minimum per-metric score (conversation, agent trace); repeatable',
    )
    .option('--thresholds <json-file>', 'read thresholds from a JSON file; flags take precedence')
    .action(
      async (
        evaluationId: string,
        options: {
          minOverall?: string;
          minScenario?: string;
          minJudgeAgreement?: string;
          metric?: string[];
          thresholds?: string;
        },
        command: Command,
      ) => {
        const thresholds: GateThresholds = {
          ...(options.minOverall !== undefined
            ? { minOverall: parseThresholdNumber('--min-overall', options.minOverall) }
            : {}),
          ...(options.minScenario !== undefined
            ? { minScenario: parseThresholdNumber('--min-scenario', options.minScenario) }
            : {}),
          ...(options.minJudgeAgreement !== undefined
            ? {
                minJudgeAgreement: parseThresholdNumber(
                  '--min-judge-agreement',
                  options.minJudgeAgreement,
                ),
              }
            : {}),
          ...(options.metric === undefined
            ? {}
            : { metrics: parseMetricThresholds(options.metric) }),
        };
        await executor.execute(
          {
            kind: 'gate',
            evaluationId,
            thresholds,
            ...(options.thresholds !== undefined ? { thresholdsFile: options.thresholds } : {}),
          },
          executionOptions(command),
        );
      },
    );

  addCommandExamples(program);

  for (const extend of extensions) extend(program);

  return program;
}

const COMMAND_EXAMPLES: Readonly<Record<string, readonly string[]>> = {
  login: ['autoeval login', 'AUTOEVAL_API_KEY=pl_sk_... autoeval whoami'],
  whoami: ['autoeval whoami', 'autoeval --json whoami'],
  'workspace list': ['autoeval workspace list'],
  'workspace create': ['autoeval workspace create --name "Support quality"'],
  'eval list': ['autoeval eval list --workspace <workspace-id>'],
  'eval create': ['autoeval eval create --workspace <workspace-id> --name "Refund flow"'],
  'eval create-from': [
    'autoeval eval create-from --workspace <workspace-id> --input refunds.autoeval.json',
    'autoeval eval create-from --workspace <workspace-id> --input refunds.autoeval.json --run',
  ],
  'suite run': ['autoeval suite run --manifest autoeval.suite.yaml'],
  'eval show': ['autoeval eval show <evaluation-id>'],
  'eval validate': ['autoeval eval validate --input examples/evals/scenario-basic.json'],
  'eval run-configured': [
    'autoeval eval run-configured --evaluation <evaluation-id> --input examples/evals/scenario-basic.json',
  ],
  'qs create': ['autoeval qs create --input <file> --workspace <workspace-id>'],
  qs: [
    'autoeval qs create --input <file> --workspace <workspace-id>',
    'autoeval qs show <qs-id>',
    'autoeval --json qs show <qs-id>',
    'autoeval qs update <qs-id> --input <file>',
    'autoeval qs assign <qs-id> --workspace <workspace-id>',
    'autoeval qs workspace --workspace <workspace-id>',
  ],
  'qs show': ['autoeval qs show <qs-id>', 'autoeval --json qs show <qs-id>'],
  'qs update': ['autoeval qs update <qs-id> --input <file>'],
  'qs assign': ['autoeval qs assign <qs-id> --workspace <workspace-id>'],
  'qs workspace': ['autoeval qs workspace --workspace <workspace-id>'],
  models: ['autoeval models', 'autoeval --json models'],
  run: ['autoeval run <evaluation-id>'],
  status: ['autoeval status <evaluation-id> <run-id>'],
  gate: [
    'autoeval gate <evaluation-id> --min-overall 4.0',
    'autoeval --json gate <evaluation-id> --thresholds .autoeval/gate.json',
  ],
  results: ['autoeval results <evaluation-id> <run-id>', 'autoeval --json results <id> <run-id>'],
};

function addCommandExamples(program: Command): void {
  const visit = (command: Command, path: string[]): void => {
    const examples = COMMAND_EXAMPLES[path.join(' ')];
    if (examples) {
      command.addHelpText(
        'after',
        `\nExamples:\n${examples.map((example) => `  ${example}`).join('\n')}\n`,
      );
    }
    command.commands.forEach((subcommand) => visit(subcommand, [...path, subcommand.name()]));
  };
  program.commands.forEach((command) => visit(command, [command.name()]));
}

const MISSING_OPTION_HINTS: Readonly<Record<string, string>> = {
  '--workspace':
    'provide a workspace ID with --workspace <workspace-id>. Use `autoeval workspace list` to find one',
  '--evaluation':
    'provide an evaluation ID with --evaluation <evaluation-id>. Use `autoeval eval list --workspace <workspace-id>` to find one',
  '--input': 'provide a JSON file with --input <path>. See examples/ for ready-made payloads',
  '--name': 'provide a human-readable name with --name "My workspace"',
};

const MISSING_OPTION_PATTERN = /^error: required option '(--[^ '<]+)/;

export function missingOptionHint(message: string): string | undefined {
  const flag = MISSING_OPTION_PATTERN.exec(message)?.[1];
  return flag === undefined ? undefined : MISSING_OPTION_HINTS[flag];
}

export function configureSafeProgramOutput(
  command: Command,
  stdout: OutputStream,
  stderr: OutputStream,
): void {
  command.configureOutput({
    writeOut: (message) => stdout.write(safeMultilineTerminalText(message)),
    writeErr: (message) => {
      const hint = missingOptionHint(message);
      const text = hint === undefined ? message : `${message.trimEnd()}\nHint: ${hint}\n`;
      stderr.write(safeMultilineTerminalText(text));
    },
  });
  command.commands.forEach((subcommand) => configureSafeProgramOutput(subcommand, stdout, stderr));
}
