import { open, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { z } from 'zod';

import {
  createEvaluation,
  getEvaluation,
  listEvaluationVersions,
  listEvaluations,
  updateEvaluationTitleAndRefreshList,
} from '../actions/evaluations.js';
import {
  runConfiguredEvaluation,
  validateConfiguredEvaluation,
} from '../actions/configured-runs.js';
import {
  assignQualityStandardToWorkspace,
  getWorkspaceQualityStandard,
  type QualityStandardCreateInput,
  createQualityStandard,
  getQualityStandard,
  updateQualityStandard,
} from '../actions/quality-standards.js';
import { whoAmI } from '../actions/identity.js';
import { getModels } from '../actions/models.js';
import { getResults } from '../actions/results.js';
import type { ActionContext } from '../actions/context.js';
import type { SupportedModel } from '../domain/types.js';
import { runSuite, type SuiteSummary } from '../actions/suite.js';
import { gateSuite, suiteGateExitError } from '../actions/suite-gate.js';
import { doctorExitError, runDoctor } from '../actions/doctor.js';
import { clusterExecutionFailures, clusterSuiteFailures } from '../suite/reporting.js';
import { evaluateGate, type GateThresholds } from '../actions/gate.js';
import { getRunStatus, runEvaluation } from '../actions/runs.js';
import { createWorkspace, listWorkspaces } from '../actions/workspaces.js';
import type { CredentialStore, SecretPrompt } from '../auth/credential-store.js';
import { resolveCredential } from '../auth/credentials.js';
import { KeyringCredentialStore } from '../auth/keyring-store.js';
import { login, logoutWithEnvironment } from '../auth/login.js';
import { MaskedSecretPrompt } from '../auth/password-prompt.js';
import type { AutoevalConfiguration } from '../config.js';
import {
  applyModelOverrides,
  parseConfiguredRunInput,
  requireModelOverridesForPublicPlaceholders,
} from '../configured-run/validation.js';
import { resolveEvalFileInputs } from '../configured-run/file-inputs.js';
import { ReadlineChoicePrompt, type ChoicePrompt } from '../quickstart/prompt.js';
import {
  enabledModels,
  selectQuickstartModel,
  selectQuickstartWorkspace,
} from '../quickstart/selection.js';
import { quickstartEvaluationName, quickstartSample } from '../quickstart/sample.js';
import { AutoevalError } from '../errors/autoeval-error.js';
import type { FetchImplementation, ApiDiagnostic } from '../api/client.js';
import { SystemPollClock, type PollClock } from '../polling/clock.js';
import { createApiActionContext } from '../runtime/action-context.js';
import { readSuiteManifest, type SuiteManifest } from '../suite/manifest.js';
import { convertHarnessSession } from '../trace/deepseek-harness.js';
import { buildAgentTraceInput } from '../trace/import.js';
import {
  renderEvaluation,
  renderEvaluationVersions,
  renderEvaluations,
  renderCreatedWorkspace,
  renderCreatedEvaluation,
  renderIdentity,
  renderLogin,
  renderLoginGuidance,
  renderLogout,
  renderModels,
  renderResults,
  renderGateReport,
  renderRunExecution,
  renderQuickstartPlan,
  renderQuickstartNextSteps,
  renderRunStatus,
  renderConfiguredRunValidation,
  renderQualityStandard,
  renderWorkspaceQualityStandard,
  renderDoctorReport,
  renderSuiteSummary,
  renderSuiteGateReport,
  renderTraceImport,
  renderWorkspaces,
} from '../output/human.js';
import {
  createProgressReporter,
  formatStatusProgress,
  type ProgressReporter,
} from '../output/progress.js';
import { resolveColorMode, supportsUnicode } from '../output/splash.js';
import { OutputWriter, type OutputStream } from '../output/writer.js';
import type { CommandExecutor, DeterministicCommand, ExecutionOptions } from './types.js';

const DEFAULT_SUITE_RUN_CONCURRENCY = 3;
const DEFAULT_SUITE_RUN_START_STAGGER_MS = 250;
const SUITE_TIMELINE_DEBUG_ENV = 'AUTOEVAL_SUITE_TIMELINE_DEBUG';
const MAX_TRACE_SESSION_BYTES = 32 * 1024 * 1024;
const MAX_TRACE_TEMPLATE_BYTES = 1024 * 1024;
const MAX_TRACE_OUTPUT_BYTES = 64 * 1024 * 1024;
const NULL_STATISTIC_KEYS = new Set([
  'ci95',
  'ci95_lower',
  'ci95_upper',
  'std_dev',
  'overall_ci',
  'overall_ci_lower',
  'overall_ci_upper',
]);

async function readBoundedTextFile(
  inputFile: string,
  maxBytes: number,
  label: string,
  code: string,
): Promise<string> {
  let handle;
  try {
    handle = await open(inputFile, 'r');
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      throw new AutoevalError(`${label} must be a regular file.`, {
        kind: 'usage',
        code,
      });
    }
    if (metadata.size > maxBytes) {
      throw new AutoevalError(
        `${label} exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MiB limit.`,
        {
          kind: 'usage',
          code,
        },
      );
    }
    return await handle.readFile('utf8');
  } catch (error) {
    if (error instanceof AutoevalError) throw error;
    throw new AutoevalError(`${label} was not found or could not be read.`, {
      kind: 'usage',
      code,
      cause: error,
    });
  } finally {
    await handle?.close();
  }
}

function formatTimelineTimestamp(epochMs: number): string {
  const date = new Date(epochMs);
  const timezoneLabel =
    new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
      .formatToParts(date)
      .find((part) => part.type === 'timeZoneName')?.value ?? 'local';
  return `${date.getHours().toString().padStart(2, '0')}:${date
    .getMinutes()
    .toString()
    .padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}.${date
    .getMilliseconds()
    .toString()
    .padStart(3, '0')} ${timezoneLabel}`;
}

export type RuntimeInput = {
  isTTY?: boolean;
};

export type RuntimeDependencies = {
  configuration: AutoevalConfiguration;
  environment?: Readonly<Record<string, string | undefined>>;
  store?: CredentialStore;
  prompt?: SecretPrompt;
  choicePrompt?: ChoicePrompt;
  clock?: PollClock;
  fetchImplementation?: FetchImplementation;
  stdout?: OutputStream;
  stderr?: OutputStream;
  stdin?: RuntimeInput;
  signal?: AbortSignal;
  /** Injected so the quickstart evaluation name is deterministic in tests. */
  now?: () => Date;
};

const qualityStandardFileSchema = z
  .object({
    name: z.string().trim().min(1),
    judge_model: z.uuid(),
    rubric: z.string().min(1),
    anchors: z
      .array(
        z
          .object({
            input: z.string().min(1),
            response: z.string().min(1),
            reference: z.string().min(1),
            score: z.union([z.literal(1), z.literal(5)]),
            reasoning: z.string().min(1),
          })
          .strict(),
      )
      .min(1)
      .max(5),
  })
  .loose();

const qualityStandardDraftFileSchema = z
  .object({
    qs_name: z.string().trim().min(1),
    judgeModel: z.uuid(),
    rubric: z.string().min(1),
    anchors: z
      .array(
        z
          .object({
            user_question: z.string().min(1),
            example_response: z.string().min(1),
            ideal_answer: z.string().min(1),
            why: z.string().min(1),
            score: z.union([z.literal(1), z.literal(5)]),
            rating: z.string().trim().min(1).optional(),
          })
          .loose(),
      )
      .min(1)
      .max(5),
  })
  .loose();

function deriveDraftAnchorScore(score: 1 | 5): 1 | 5 {
  return score;
}

const REQUIRED_ANCHOR_FIELDS = ['input', 'score', 'response', 'reasoning', 'reference'] as const;

function isCanonicalQualityStandardPayload(parsedJson: unknown): boolean {
  if (typeof parsedJson !== 'object' || parsedJson === null) {
    return false;
  }

  const record = parsedJson as Record<string, unknown>;
  if ('name' in record || 'judge_model' in record) {
    return true;
  }

  const anchors = record.anchors;
  if (!Array.isArray(anchors)) {
    return false;
  }

  return anchors.some((anchor) => {
    if (typeof anchor !== 'object' || anchor === null) {
      return false;
    }
    const anchorRecord = anchor as Record<string, unknown>;
    return (
      'input' in anchorRecord ||
      'response' in anchorRecord ||
      'reference' in anchorRecord ||
      'reasoning' in anchorRecord
    );
  });
}

function listMissingCanonicalAnchorFields(parsedJson: unknown): string[] {
  if (typeof parsedJson !== 'object' || parsedJson === null || !('anchors' in parsedJson)) {
    return [];
  }

  const anchors = (parsedJson as { anchors?: unknown }).anchors;
  if (!Array.isArray(anchors)) {
    return [];
  }

  const missing: string[] = [];
  anchors.forEach((anchor, index) => {
    if (typeof anchor !== 'object' || anchor === null) {
      return;
    }
    const record = anchor as Record<string, unknown>;
    for (const field of REQUIRED_ANCHOR_FIELDS) {
      if (!(field in record)) {
        missing.push(`anchors[${index}].${field}`);
      }
    }
  });
  return missing;
}

function parseQualityStandardInput(parsedJson: unknown): QualityStandardCreateInput {
  const canonical = qualityStandardFileSchema.safeParse(parsedJson);
  if (canonical.success) {
    const anchors = canonical.data.anchors.map((anchor) => ({
      input: anchor.input,
      score: anchor.score,
      response: anchor.response,
      reasoning: anchor.reasoning,
      reference: anchor.reference,
    }));
    return {
      name: canonical.data.name,
      judge_model: canonical.data.judge_model,
      rubric: canonical.data.rubric,
      anchors,
    };
  }

  const missingCanonicalFields = isCanonicalQualityStandardPayload(parsedJson)
    ? listMissingCanonicalAnchorFields(parsedJson)
    : [];
  if (missingCanonicalFields.length > 0) {
    throw new AutoevalError(
      `Quality standard anchors are missing required fields: ${missingCanonicalFields.join(', ')}`,
      {
        kind: 'usage',
        code: 'INVALID_QUALITY_STANDARD_SCHEMA',
        cause: canonical.error,
      },
    );
  }

  const draft = qualityStandardDraftFileSchema.safeParse(parsedJson);
  if (draft.success) {
    return {
      name: draft.data.qs_name,
      judge_model: draft.data.judgeModel,
      rubric: draft.data.rubric,
      anchors: draft.data.anchors.map((anchor) => ({
        input: anchor.user_question,
        response: anchor.example_response,
        reference: anchor.ideal_answer,
        score: deriveDraftAnchorScore(anchor.score),
        reasoning: anchor.why,
      })),
    };
  }

  throw new AutoevalError(
    'Quality standard input does not match a supported schema (canonical or draft format).',
    {
      kind: 'usage',
      code: 'INVALID_QUALITY_STANDARD_SCHEMA',
      cause: canonical.error,
    },
  );
}

function qualityStandardIdFromRecord(input: Record<string, unknown>): string | undefined {
  const idCandidate = input.quality_standard_id ?? input.qualityStandardId ?? input.id;
  return typeof idCandidate === 'string' && idCandidate.trim() !== '' ? idCandidate : undefined;
}

const assignedWorkspaceQualityStandardSchema = qualityStandardFileSchema
  .extend({
    quality_standard_id: z.uuid().optional(),
    qualityStandardId: z.uuid().optional(),
    id: z.uuid().optional(),
  })
  .loose();

function assertAssignedWorkspaceQualityStandard(
  workspaceQualityStandard: Record<string, unknown>,
): Record<string, unknown> {
  const parsed = assignedWorkspaceQualityStandardSchema.safeParse(workspaceQualityStandard);
  if (!parsed.success) {
    throw new AutoevalError(
      'Workspace quality standard lookup returned an invalid quality standard payload.',
      {
        kind: 'upstream',
        code: 'INVALID_WORKSPACE_QUALITY_STANDARD',
        cause: parsed.error,
      },
    );
  }
  return parsed.data;
}

async function ensureWorkspaceQualityStandardUnassigned(
  context: ActionContext,
  workspaceId: string,
  signal?: AbortSignal,
): Promise<void> {
  const existing = await getWorkspaceQualityStandard(context, workspaceId, signal);
  if (existing === null) {
    return;
  }

  const validatedExisting = assertAssignedWorkspaceQualityStandard(existing);
  const existingId = qualityStandardIdFromRecord(validatedExisting);
  throw new AutoevalError(
    existingId
      ? `Workspace ${workspaceId} already has a quality standard assigned (${existingId}). Delete the existing quality standard first, then create a new one for this workspace.`
      : `Workspace ${workspaceId} already has a quality standard assigned. Delete the existing quality standard first, then create a new one for this workspace.`,
    {
      kind: 'validation',
      code: 'WORKSPACE_QUALITY_STANDARD_ALREADY_ASSIGNED',
    },
  );
}

async function readQualityStandardInput(inputFile: string): Promise<QualityStandardCreateInput> {
  let inputFileContent: string;
  try {
    inputFileContent = await readFile(inputFile, 'utf8');
  } catch (error) {
    throw new AutoevalError(
      `Quality standard input file was not found or could not be read: ${inputFile}`,
      {
        kind: 'usage',
        code: 'QUALITY_STANDARD_INPUT_READ_FAILED',
        cause: error,
      },
    );
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(inputFileContent) as unknown;
  } catch (error) {
    throw new AutoevalError('Quality standard input file must contain valid JSON.', {
      kind: 'usage',
      code: 'INVALID_QUALITY_STANDARD_JSON',
      cause: error,
    });
  }

  return parseQualityStandardInput(parsedJson);
}

export { parseConfiguredRunInput } from '../configured-run/validation.js';

async function readConfiguredRunInput(inputFile: string): Promise<unknown> {
  let inputFileContent: string;
  try {
    inputFileContent = await readFile(inputFile, 'utf8');
  } catch (error) {
    throw new AutoevalError(
      `Configured run input file was not found or could not be read: ${inputFile}`,
      {
        kind: 'usage',
        code: 'CONFIGURED_RUN_INPUT_READ_FAILED',
        cause: error,
      },
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(inputFileContent) as unknown;
  } catch (error) {
    throw new AutoevalError('Configured run input file must contain valid JSON', {
      kind: 'usage',
      code: 'INVALID_CONFIGURED_RUN_JSON',
      cause: error,
    });
  }
  return resolveEvalFileInputs(parsedJson, dirname(resolve(inputFile)));
}

const gateThresholdsFileSchema = z
  .object({
    minOverall: z.number().optional(),
    minScenario: z.number().optional(),
    minJudgeAgreement: z.number().min(0).max(1).optional(),
    metrics: z.record(z.string().min(1), z.number()).optional(),
  })
  .strict();

async function readGateThresholdsFile(inputFile: string): Promise<GateThresholds> {
  let content: string;
  try {
    content = await readFile(inputFile, 'utf8');
  } catch (error) {
    throw new AutoevalError(
      `Gate thresholds file was not found or could not be read: ${inputFile}`,
      { kind: 'usage', code: 'GATE_THRESHOLDS_READ_FAILED', cause: error },
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(content) as unknown;
  } catch (error) {
    throw new AutoevalError('Gate thresholds file must contain valid JSON.', {
      kind: 'usage',
      code: 'INVALID_GATE_THRESHOLDS_JSON',
      cause: error,
    });
  }

  const parsed = gateThresholdsFileSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new AutoevalError(
      'Gate thresholds file must contain only numeric minOverall, minScenario, minJudgeAgreement, or a numeric metrics object.',
      { kind: 'usage', code: 'INVALID_GATE_THRESHOLD', cause: parsed.error },
    );
  }
  const data = parsed.data;
  return {
    ...(data.minOverall !== undefined ? { minOverall: data.minOverall } : {}),
    ...(data.minScenario !== undefined ? { minScenario: data.minScenario } : {}),
    ...(data.minJudgeAgreement !== undefined ? { minJudgeAgreement: data.minJudgeAgreement } : {}),
    ...(data.metrics !== undefined ? { metrics: data.metrics } : {}),
  };
}

export class RuntimeCommandExecutor implements CommandExecutor {
  readonly #configuration: AutoevalConfiguration;
  readonly #environment: Readonly<Record<string, string | undefined>>;
  readonly #store: CredentialStore;
  readonly #prompt: SecretPrompt;
  readonly #choicePrompt: ChoicePrompt;
  readonly #now: () => Date;
  readonly #clock: PollClock;
  readonly #fetchImplementation: FetchImplementation | undefined;
  readonly #writer: OutputWriter;
  readonly #stdin: RuntimeInput;
  readonly #stderr: OutputStream;
  readonly #signal: AbortSignal | undefined;
  #lastCreateFromRuns: { evaluationId: string; runId: string }[] = [];

  constructor(dependencies: RuntimeDependencies) {
    this.#configuration = dependencies.configuration;
    this.#environment = dependencies.environment ?? process.env;
    this.#store =
      dependencies.store ??
      new KeyringCredentialStore(dependencies.configuration.apiBaseUrl.origin);
    this.#prompt = dependencies.prompt ?? new MaskedSecretPrompt();
    this.#choicePrompt = dependencies.choicePrompt ?? new ReadlineChoicePrompt();
    this.#now = dependencies.now ?? (() => new Date());
    this.#clock = dependencies.clock ?? new SystemPollClock();
    this.#fetchImplementation = dependencies.fetchImplementation;
    const stdout = dependencies.stdout ?? process.stdout;
    this.#stderr = dependencies.stderr ?? process.stderr;
    this.#writer = new OutputWriter(stdout, this.#stderr);
    this.#stdin = dependencies.stdin ?? process.stdin;
    this.#signal = dependencies.signal;
  }

  async execute(command: DeterministicCommand, options: ExecutionOptions): Promise<void> {
    this.#lastCreateFromRuns = [];

    if (command.kind === 'logout') {
      const result = await logoutWithEnvironment({
        store: this.#store,
        environment: this.#environment,
      });
      this.#writer.writeResult(
        result,
        renderLogout(result.wasRemoved, result.hasEnvironmentCredential),
        options.json,
      );
      return;
    }
    if (command.kind === 'login') {
      const allowPrompt =
        command.key === undefined &&
        this.#stdin.isTTY === true &&
        this.#stderr.isTTY === true &&
        !options.json;
      if (allowPrompt) {
        const environmentKey = this.#environment.AUTOEVAL_API_KEY;
        const hasEnvironmentKey = environmentKey !== undefined && environmentKey.trim() !== '';
        let hasStoredKey = false;
        if (!hasEnvironmentKey) {
          try {
            const storedKey = await this.#store.read();
            hasStoredKey = storedKey !== undefined && storedKey.trim() !== '';
          } catch {
            hasStoredKey = false;
          }
        }
        if (!hasEnvironmentKey && !hasStoredKey) {
          this.#stderr.write(renderLoginGuidance());
        }
      }
      const result = await login({
        environment: this.#environment,
        store: this.#store,
        prompt: this.#prompt,
        allowPrompt,
        ...(command.key !== undefined ? { explicitKey: command.key } : {}),
        validate: async (apiKey) =>
          this.#createContext(apiKey, options).api.getCurrentUser(this.#signal),
      });
      this.#writer.writeResult(result, renderLogin(result), options.json);
      return;
    }

    // Trace conversion is local-only. Resolve credentials only if the command
    // subsequently submits the generated evaluation.
    if (command.kind === 'trace-import') {
      const report = await this.#importTrace(command, options);
      if (command.run) {
        await this.execute(
          {
            kind: 'evaluation-create-from',
            workspaceId: report.workspaceId,
            inputFiles: [command.outputFile],
            run: true,
          },
          options,
        );
      }
      return;
    }

    const credential = await resolveCredential({
      environment: this.#environment,
      store: this.#store,
      prompt: this.#prompt,
      allowPrompt: false,
    });
    const context = this.#createContext(credential.apiKey, options);

    switch (command.kind) {
      case 'whoami': {
        const result = await whoAmI(context, this.#signal);
        this.#writer.writeResult(result, renderIdentity(result), options.json);
        return;
      }
      case 'workspace-list': {
        const result = await listWorkspaces(context, {}, this.#signal);
        this.#writer.writeResult(result, renderWorkspaces(result), options.json);
        return;
      }
      case 'workspace-create': {
        const result = await createWorkspace(
          context,
          {
            name: command.name,
            ...(command.description ? { description: command.description } : {}),
          },
          this.#signal,
        );
        this.#writer.writeResult(result, renderCreatedWorkspace(result), options.json);
        return;
      }
      case 'evaluation-list': {
        const result = await listEvaluations(
          context,
          { workspaceId: command.workspaceId },
          this.#signal,
        );
        this.#writer.writeResult(result, renderEvaluations(result), options.json);
        return;
      }
      case 'evaluation-create': {
        const result = await createEvaluation(
          context,
          {
            workspaceId: command.workspaceId,
            ...(command.name ? { evaluationName: command.name } : {}),
          },
          this.#signal,
        );
        this.#writer.writeResult(result, renderCreatedEvaluation(result), options.json);
        return;
      }
      case 'evaluation-update-title': {
        const result = await updateEvaluationTitleAndRefreshList(
          context,
          {
            workspaceId: command.workspaceId,
            evaluationId: command.evaluationId,
            evaluationName: command.name,
            userSystemId: command.userSystemId,
            ...(command.description !== undefined ? { description: command.description } : {}),
            ...(command.page !== undefined ? { page: command.page } : {}),
            ...(command.size !== undefined ? { size: command.size } : {}),
          },
          this.#signal,
        );
        this.#writer.writeResult(result, renderEvaluations(result.page), options.json);
        return;
      }
      case 'quality-standard-create': {
        const payload = await readQualityStandardInput(command.inputFile);
        if (command.workspaceId !== undefined) {
          await ensureWorkspaceQualityStandardUnassigned(
            context,
            command.workspaceId,
            this.#signal,
          );
        }
        const result = await createQualityStandard(context, payload, this.#signal);
        if (command.workspaceId !== undefined) {
          if (result.qualityStandardId === undefined) {
            throw new AutoevalError(
              'The Autoeval API did not return a quality standard ID, so workspace association could not be completed.',
              {
                kind: 'upstream',
                code: 'MISSING_QUALITY_STANDARD_ID',
              },
            );
          }

          await assignQualityStandardToWorkspace(
            context,
            {
              workspaceId: command.workspaceId,
              qualityStandardId: result.qualityStandardId,
            },
            this.#signal,
          );
        }

        const rendered =
          result.qualityStandardId !== undefined
            ? command.workspaceId !== undefined
              ? `Created quality standard ${payload.name} (${result.qualityStandardId}) and associated it with workspace ${command.workspaceId}\n`
              : `Created quality standard ${payload.name} (${result.qualityStandardId})\n`
            : `Created quality standard ${payload.name}\n`;
        this.#writer.writeResult(result, rendered, options.json);
        return;
      }
      case 'quality-standard-update': {
        const payload = await readQualityStandardInput(command.inputFile);
        const result = await updateQualityStandard(
          context,
          {
            qualityStandardId: command.qualityStandardId,
            name: payload.name,
            judge_model: payload.judge_model,
            rubric: payload.rubric,
            anchors: payload.anchors,
          },
          this.#signal,
        );
        this.#writer.writeResult(
          result,
          `Updated quality standard ${payload.name} (${command.qualityStandardId})\n`,
          options.json,
        );
        return;
      }
      case 'quality-standard-assign': {
        const result = await assignQualityStandardToWorkspace(
          context,
          {
            workspaceId: command.workspaceId,
            qualityStandardId: command.qualityStandardId,
          },
          this.#signal,
        );
        this.#writer.writeResult(
          result,
          `Associated quality standard ${command.qualityStandardId} with workspace ${command.workspaceId}\n`,
          options.json,
        );
        return;
      }
      case 'quality-standard-workspace': {
        const workspaceQualityStandard = await getWorkspaceQualityStandard(
          context,
          command.workspaceId,
          this.#signal,
        );
        const result =
          workspaceQualityStandard === null
            ? null
            : assertAssignedWorkspaceQualityStandard(workspaceQualityStandard);
        this.#writer.writeResult(
          result,
          renderWorkspaceQualityStandard(result, command.workspaceId),
          options.json,
        );
        return;
      }
      case 'quality-standard-show': {
        const result = await getQualityStandard(context, command.qualityStandardId, this.#signal);
        this.#writer.writeResult(
          result,
          renderQualityStandard(result, command.qualityStandardId),
          options.json,
        );
        return;
      }
      case 'evaluation-validate': {
        const parsedJson = await readConfiguredRunInput(command.inputFile);
        const input = parseConfiguredRunInput(parsedJson);
        const result = await validateConfiguredEvaluation(context, input, this.#signal);
        this.#writer.writeResult(result, renderConfiguredRunValidation(result), options.json);
        return;
      }
      case 'suite-run': {
        const manifest = await readSuiteManifest(command.manifestFile);
        const summary = await this.#runSuiteFromManifest(context, manifest, command, options);
        const failureClusters = clusterExecutionFailures(summary);
        this.#writer.writeResult(
          { ...summary, failureClusters },
          renderSuiteSummary(summary, failureClusters),
          options.json,
        );
        return;
      }
      case 'suite-gate': {
        const manifest = await readSuiteManifest(command.manifestFile);
        const summary = await this.#runSuiteFromManifest(context, manifest, command, options);
        const policyByFile = new Map(manifest.entries.map((entry) => [entry.file, entry.gate]));
        const gateResult = gateSuite({ summary, policyByFile });
        const failureClusters = clusterSuiteFailures(gateResult);
        this.#writer.writeResult(
          { ...gateResult, failureClusters },
          renderSuiteGateReport(gateResult, failureClusters),
          options.json,
        );
        const gateError = suiteGateExitError(gateResult);
        if (gateError !== undefined) throw gateError;
        return;
      }
      case 'evaluation-create-from': {
        const created: { evaluationId: string; name: string; input: string; runId?: string }[] = [];
        const elapsedByEvaluationId = new Map<string, number>();
        const createAndMaybeRun = async (
          inputFile: string,
        ): Promise<{ evaluationId: string; name: string; input: string; runId?: string }> => {
          const parsedConfiguredRun = parseConfiguredRunInput(
            await readConfiguredRunInput(inputFile),
          );
          const configuredRun = applyModelOverrides(parsedConfiguredRun, {
            ...(command.judgeModelId === undefined ? {} : { judgeModelId: command.judgeModelId }),
            ...(command.primaryModelId === undefined
              ? {}
              : { primaryModelId: command.primaryModelId }),
          });
          if (command.run) {
            requireModelOverridesForPublicPlaceholders(configuredRun);
            await validateConfiguredEvaluation(context, configuredRun, this.#signal);
          }
          const evaluation = await createEvaluation(
            context,
            {
              workspaceId: command.workspaceId,
              evaluationName:
                configuredRun.evaluationName ?? configuredRun.configuration.contextName,
            },
            this.#signal,
          );
          const createdEntry: {
            evaluationId: string;
            name: string;
            input: string;
            runId?: string;
          } = {
            evaluationId: evaluation.evaluationId,
            name: configuredRun.evaluationName ?? configuredRun.configuration.contextName,
            input: inputFile,
          };
          if (!command.run) {
            return createdEntry;
          }
          const progress = this.#createProgressReporter(
            `Configured run (${configuredRun.configuration.contextName})`,
            options,
          );
          try {
            progress.update('starting run');
            const run = await runConfiguredEvaluation(context, {
              evaluationId: evaluation.evaluationId,
              configuredRun,
              clock: this.#clock,
              pollIntervalMs: this.#configuration.pollIntervalMs,
              pollTimeoutMs: this.#configuration.pollTimeoutMs,
              prevalidated: true,
              onStatus: (status) => progress.reportStatus(status),
              ...(this.#signal ? { signal: this.#signal } : {}),
            });
            createdEntry.runId = run.run.runId;
            elapsedByEvaluationId.set(evaluation.evaluationId, run.outcome.elapsedMs);
            return createdEntry;
          } finally {
            progress.stop();
          }
        };

        if (!command.run) {
          for (const inputFile of command.inputFiles) {
            created.push(await createAndMaybeRun(inputFile));
          }
        } else {
          const runConcurrency = command.runConcurrency ?? command.inputFiles.length;
          const runStartStaggerMs = command.runStartStaggerMs ?? 0;
          const timelineDebug = this.#environment[SUITE_TIMELINE_DEBUG_ENV] === '1';
          const maxWorkers = Math.max(1, Math.min(runConcurrency, command.inputFiles.length));
          const orderedEntries = new Array<
            { evaluationId: string; name: string; input: string; runId?: string } | undefined
          >(command.inputFiles.length);
          let nextIndex = 0;
          let nextStartAtMs = this.#clock.now();

          const claimNext = async (): Promise<{ index: number; inputFile: string } | undefined> => {
            if (nextIndex >= command.inputFiles.length) return undefined;
            const index = nextIndex;
            nextIndex += 1;
            const inputFile = command.inputFiles[index];
            if (inputFile === undefined) return undefined;
            const scheduledStartMs = nextStartAtMs;
            nextStartAtMs += runStartStaggerMs;
            const delayMs = Math.max(0, scheduledStartMs - this.#clock.now());
            if (delayMs > 0) {
              await this.#clock.sleep(delayMs, this.#signal);
            }
            return { index, inputFile };
          };

          const worker = async (): Promise<void> => {
            while (true) {
              const next = await claimNext();
              if (next === undefined) return;
              const evalNumber = next.index + 1;
              if (timelineDebug) {
                const startedAt = formatTimelineTimestamp(this.#clock.now());
                this.#stderr.write(`[${startedAt}] START Eval ${evalNumber}\n`);
              }
              try {
                const createdEntry = await createAndMaybeRun(next.inputFile);
                orderedEntries[next.index] = createdEntry;
                if (timelineDebug) {
                  const finishedAt = formatTimelineTimestamp(this.#clock.now());
                  this.#stderr.write(`[${finishedAt}] FINISH Eval ${evalNumber}\n`);
                }
              } catch (error) {
                if (timelineDebug) {
                  const failedAt = formatTimelineTimestamp(this.#clock.now());
                  this.#stderr.write(`[${failedAt}] FAIL Eval ${evalNumber}\n`);
                }
                throw error;
              }
            }
          };

          await Promise.all(Array.from({ length: maxWorkers }, () => worker()));
          created.push(
            ...orderedEntries.filter(
              (
                entry,
              ): entry is { evaluationId: string; name: string; input: string; runId?: string } =>
                entry !== undefined,
            ),
          );
        }
        const rendered = created
          .map((entry) => {
            const header = `Created "${entry.name}" (${entry.evaluationId}) from ${entry.input}\n`;
            if (!command.run) {
              return `${header}  Run it with: autoeval eval run-configured --evaluation ${entry.evaluationId} --input ${entry.input}\n`;
            }
            if (entry.runId === undefined) return header;
            const seconds = Math.round(
              (elapsedByEvaluationId.get(entry.evaluationId) ?? 0) / 1_000,
            );
            return [
              header,
              `  Run ${entry.runId} finished in ${seconds}s\n`,
              '\n',
              '  Fetch the results with:\n',
              `    autoeval results ${entry.evaluationId} ${entry.runId}\n`,
              '\n',
              '  Add --json for machine-readable output.\n',
            ].join('');
          })
          .join('\n');
        this.#lastCreateFromRuns = created
          .filter(
            (
              entry,
            ): entry is { evaluationId: string; name: string; input: string; runId: string } =>
              typeof entry.runId === 'string',
          )
          .map((entry) => ({ evaluationId: entry.evaluationId, runId: entry.runId }));
        this.#writer.writeResult({ created, ran: command.run }, rendered, options.json);
        return;
      }
      case 'evaluation-run-configured': {
        const parsedJson = await readConfiguredRunInput(command.inputFile);
        const configuredRun = parseConfiguredRunInput(parsedJson);
        const progress = this.#createProgressReporter('Configured run', options);
        try {
          progress.update('validating input and creating versions');
          const result = await runConfiguredEvaluation(context, {
            evaluationId: command.evaluationId,
            configuredRun,
            clock: this.#clock,
            pollIntervalMs: this.#configuration.pollIntervalMs,
            pollTimeoutMs: this.#configuration.pollTimeoutMs,
            onStatus: (status) => progress.reportStatus(status),
            ...(this.#signal ? { signal: this.#signal } : {}),
          });
          progress.stop();
          this.#writer.writeResult(result, renderRunExecution(result), options.json);
        } finally {
          progress.stop();
        }
        return;
      }
      case 'evaluation-show': {
        const result = await getEvaluation(
          context,
          command.evaluationId,
          command.version,
          this.#signal,
        );
        this.#writer.writeResult(result, renderEvaluation(result), options.json);
        return;
      }
      case 'evaluation-versions': {
        const result = await listEvaluationVersions(context, command.evaluationId, this.#signal);
        this.#writer.writeResult(result, renderEvaluationVersions(result), options.json);
        return;
      }
      case 'doctor': {
        const manifestFile = command.manifestFile;
        const report = await runDoctor(context, {
          loadEvalFile: async (inputFile: string) =>
            parseConfiguredRunInput(await readConfiguredRunInput(inputFile)),
          evalFiles: command.inputFiles,
          ...(command.workspaceId === undefined ? {} : { workspaceId: command.workspaceId }),
          ...(manifestFile === undefined
            ? {}
            : {
                manifestFile,
                loadManifest: () => readSuiteManifest(manifestFile),
              }),
          ...(this.#signal ? { signal: this.#signal } : {}),
        });
        this.#writer.writeResult(report, renderDoctorReport(report), options.json);
        const doctorError = doctorExitError(report);
        if (doctorError !== undefined) throw doctorError;
        return;
      }
      case 'models': {
        const result = await getModels(context, this.#signal);
        this.#writer.writeResult(result, renderModels(result), options.json);
        return;
      }
      case 'quickstart': {
        await this.#runQuickstart(context, command, options);
        return;
      }
      case 'run': {
        const progress = this.#createProgressReporter('Run', options);
        try {
          progress.update('starting');
          const result = await runEvaluation(context, {
            evaluationId: command.evaluationId,
            clock: this.#clock,
            pollIntervalMs: this.#configuration.pollIntervalMs,
            pollTimeoutMs: this.#configuration.pollTimeoutMs,
            onStatus: (status) => progress.reportStatus(status),
            ...(this.#signal ? { signal: this.#signal } : {}),
          });
          progress.stop();
          this.#writer.writeResult(result, renderRunExecution(result), options.json);
        } finally {
          progress.stop();
        }
        return;
      }
      case 'status': {
        const result = await getRunStatus(context, command, this.#signal);
        this.#writer.writeResult(result, renderRunStatus(result), options.json);
        return;
      }
      case 'gate': {
        const fileThresholds =
          command.thresholdsFile === undefined
            ? {}
            : await readGateThresholdsFile(command.thresholdsFile);
        const thresholds: GateThresholds = {
          ...fileThresholds,
          ...command.thresholds,
          ...(fileThresholds.metrics === undefined && command.thresholds.metrics === undefined
            ? {}
            : { metrics: { ...fileThresholds.metrics, ...command.thresholds.metrics } }),
        };
        if (
          thresholds.minOverall === undefined &&
          thresholds.minScenario === undefined &&
          thresholds.minJudgeAgreement === undefined &&
          Object.keys(thresholds.metrics ?? {}).length === 0
        ) {
          throw new AutoevalError('The gate needs at least one configured threshold.', {
            kind: 'usage',
            code: 'NO_GATE_THRESHOLD',
          });
        }

        const progress = this.#createProgressReporter('Gate', options);
        let execution;
        let results;
        try {
          progress.update('starting run');
          execution = await runEvaluation(context, {
            evaluationId: command.evaluationId,
            clock: this.#clock,
            pollIntervalMs: this.#configuration.pollIntervalMs,
            pollTimeoutMs: this.#configuration.pollTimeoutMs,
            onStatus: (status) => progress.reportStatus(status),
            ...(this.#signal ? { signal: this.#signal } : {}),
          });
          progress.update('reading results');
          results = await getResults(context, {
            evaluationId: execution.run.evaluationId,
            runId: execution.run.runId,
            clock: this.#clock,
            resultReadyIntervalMs: this.#configuration.resultReadyIntervalMs,
            resultReadyTimeoutMs: this.#configuration.resultReadyTimeoutMs,
            ...(this.#signal ? { signal: this.#signal } : {}),
          });
        } finally {
          progress.stop();
        }
        const report = evaluateGate(results, thresholds);
        const summary = {
          report,
          run: { ...execution.run, status: execution.outcome.status.state },
          elapsedMs: execution.outcome.elapsedMs,
        };
        this.#writer.writeResult(summary, renderGateReport(summary), options.json);
        if (report.decision === 'FAIL') {
          const failed = report.checks
            .filter((check) => check.decision === 'FAIL')
            .map((check) => check.label)
            .join(', ');
          throw new AutoevalError(`Gate failed: ${failed} did not meet the configured threshold.`, {
            kind: 'gate_failed',
            code: 'GATE_THRESHOLD_NOT_MET',
          });
        }
        if (report.decision === 'INCONCLUSIVE') {
          const blocked = report.checks
            .filter((check) => check.decision === 'INCONCLUSIVE')
            .map((check) => check.label)
            .join(', ');
          throw new AutoevalError(
            report.advisory
              ? 'Gate inconclusive: no metric thresholds are configured for this context type.'
              : `Gate inconclusive: ${blocked} did not report usable evidence.`,
            { kind: 'gate_failed', code: 'GATE_INCONCLUSIVE' },
          );
        }
        return;
      }
      case 'results': {
        const progress = this.#createProgressReporter('Results', options);
        try {
          progress.update('reading results');
          const result = await getResults(context, {
            evaluationId: command.evaluationId,
            runId: command.runId,
            clock: this.#clock,
            resultReadyIntervalMs: this.#configuration.resultReadyIntervalMs,
            resultReadyTimeoutMs: this.#configuration.resultReadyTimeoutMs,
            ...(this.#signal ? { signal: this.#signal } : {}),
          });
          const scenarioStatus =
            result.contextType === 'scenario' && !options.json
              ? await getRunStatus(
                  context,
                  { evaluationId: command.evaluationId, runId: command.runId },
                  this.#signal,
                )
                  .then((status) => status.raw)
                  .catch(() => undefined)
              : undefined;
          progress.stop();
          const humanResult = this.#omitNullStatisticFields(result) as typeof result;
          const output = options.json ? result : humanResult;
          this.#writer.writeResult(
            output,
            renderResults(humanResult, {
              showOutputs: command.showOutputs === true,
              ...(scenarioStatus === undefined ? {} : { scenarioStatus }),
            }),
            options.json,
          );
        } finally {
          progress.stop();
        }
      }
    }
  }

  /** True when a numbered picker may be shown. */
  #canPrompt(options: ExecutionOptions, assumeYes: boolean): boolean {
    return !assumeYes && !options.json && this.#stdin.isTTY === true && this.#stderr.isTTY === true;
  }

  async #runQuickstart(
    context: ActionContext,
    command: Extract<DeterministicCommand, { kind: 'quickstart' }>,
    options: ExecutionOptions,
  ): Promise<void> {
    const interactive = this.#canPrompt(options, command.assumeYes);

    const workspacePage = await listWorkspaces(context, {}, this.#signal);
    const workspaceResolution = selectQuickstartWorkspace(workspacePage.items, command.workspaceId);
    let workspace;
    if (workspaceResolution.kind === 'resolved') {
      workspace = workspaceResolution.workspace;
    } else {
      if (!interactive) {
        throw new AutoevalError(
          'This account has more than one workspace. Pass --workspace <workspace-id>; run "autoeval workspace list" to see them.',
          { kind: 'usage', code: 'QUICKSTART_WORKSPACE_REQUIRED' },
        );
      }
      const index = await this.#choicePrompt.choose(
        'Which workspace should this evaluation go in?',
        workspaceResolution.candidates.map((candidate) => ({
          label: candidate.name,
          detail: `${candidate.evaluationCount} evaluations`,
        })),
      );
      const chosen = workspaceResolution.candidates[index];
      if (!chosen) {
        throw new AutoevalError('No workspace was chosen.', {
          kind: 'usage',
          code: 'QUICKSTART_WORKSPACE_REQUIRED',
        });
      }
      workspace = chosen;
    }

    const models = await getModels(context, this.#signal);
    const candidates = enabledModels(models);
    const resolveModel = async (
      role: 'judge' | 'primary',
      override: string | undefined,
    ): Promise<SupportedModel> => {
      const resolution = selectQuickstartModel(candidates, role, override);
      if (resolution.kind === 'resolved') return resolution.model;
      if (!interactive) {
        throw new AutoevalError(
          'More than one model is enabled and none matches the quickstart preference list. Pass --judge-model-id and --primary-model-id; run "autoeval models" to see the IDs.',
          { kind: 'usage', code: 'QUICKSTART_MODEL_REQUIRED' },
        );
      }
      const index = await this.#choicePrompt.choose(
        role === 'judge' ? 'Which model should judge?' : 'Which model is under test?',
        resolution.candidates.map((model) => ({
          label: model.displayName,
          detail: model.provider,
        })),
      );
      const chosen = resolution.candidates[index];
      if (!chosen) {
        throw new AutoevalError('No model was chosen.', {
          kind: 'usage',
          code: 'QUICKSTART_MODEL_REQUIRED',
        });
      }
      return chosen;
    };

    const bundled = quickstartSample(command.sample);
    const sampleSource =
      command.inputFile === undefined
        ? bundled.data
        : await readConfiguredRunInput(command.inputFile);
    const sampleLabel = command.inputFile ?? `${bundled.name} (bundled)`;

    const parsed = parseConfiguredRunInput(sampleSource);
    const judge = await resolveModel('judge', command.judgeModelId);
    const primary =
      parsed.configuration.contextType === 'scenario'
        ? await resolveModel('primary', command.primaryModelId)
        : undefined;

    const overridden = applyModelOverrides(parsed, {
      judgeModelId: judge.id,
      ...(primary === undefined ? {} : { primaryModelId: primary.id }),
    });
    const quickstartAgentTrace = overridden.configuration.contextType === 'agent_trace';
    const configuredRun = {
      ...overridden,
      methodology: {
        ...overridden.methodology,
        judgeModel: quickstartAgentTrace ? judge.id : judge.displayName,
        ...(quickstartAgentTrace ? { runsPerScenario: 1 } : {}),
      },
    };
    const evaluationName = quickstartEvaluationName(this.#now());

    await validateConfiguredEvaluation(context, configuredRun, this.#signal);
    const evaluation = await createEvaluation(
      context,
      { workspaceId: workspace.id, evaluationName },
      this.#signal,
    );

    if (!options.json) {
      this.#stderr.write(
        renderQuickstartPlan({
          workspace: { id: workspace.id, name: workspace.name },
          judge,
          ...(primary === undefined ? {} : { primary }),
          sample: sampleLabel,
          evaluationName,
          evaluationId: evaluation.evaluationId,
        }),
      );
    }

    const progress = this.#createProgressReporter('Quickstart', options);
    try {
      progress.update('starting run');
      const run = await runConfiguredEvaluation(context, {
        evaluationId: evaluation.evaluationId,
        configuredRun,
        clock: this.#clock,
        pollIntervalMs: this.#configuration.pollIntervalMs,
        pollTimeoutMs: this.#configuration.pollTimeoutMs,
        prevalidated: true,
        onStatus: (status) => progress.reportStatus(status),
        ...(this.#signal ? { signal: this.#signal } : {}),
      });
      progress.update('reading results');
      const results = await getResults(context, {
        evaluationId: evaluation.evaluationId,
        runId: run.run.runId,
        clock: this.#clock,
        resultReadyIntervalMs: this.#configuration.resultReadyIntervalMs,
        resultReadyTimeoutMs: this.#configuration.resultReadyTimeoutMs,
        ...(this.#signal ? { signal: this.#signal } : {}),
      });
      this.#lastCreateFromRuns = [{ evaluationId: evaluation.evaluationId, runId: run.run.runId }];

      progress.stop();
      const humanResults = this.#omitNullStatisticFields(results) as typeof results;
      this.#writer.writeResult(
        {
          workspaceId: workspace.id,
          evaluationId: evaluation.evaluationId,
          evaluationName,
          runId: run.run.runId,
          judgeModelId: judge.id,
          ...(primary === undefined ? {} : { primaryModelId: primary.id }),
          results: this.#redactResultsJson(results),
        },
        `${renderResults(humanResults, {
          ...(results.contextType === 'scenario' ? { scenarioStatus: run.outcome.status.raw } : {}),
        })}${renderQuickstartNextSteps(evaluation.evaluationId, run.run.runId)}`,
        options.json,
      );
    } finally {
      progress.stop();
    }
  }

  async #runSuiteFromManifest(
    context: ActionContext,
    manifest: SuiteManifest,
    command: {
      workspaceId?: string;
      concurrency?: number;
      staggerMs?: number;
      judgeModelId?: string;
      primaryModelId?: string;
    },
    options: ExecutionOptions,
  ): Promise<SuiteSummary> {
    const progress = this.#createProgressReporter('Suite', options);
    try {
      progress.update('starting evaluations');
      const summary = await runSuite(context, {
        workspaceId: command.workspaceId ?? manifest.workspaceId,
        inputFiles: manifest.evalFiles,
        loadEvalFile: async (inputFile) =>
          parseConfiguredRunInput(await readConfiguredRunInput(inputFile)),
        clock: this.#clock,
        pollIntervalMs: this.#configuration.pollIntervalMs,
        pollTimeoutMs: this.#configuration.pollTimeoutMs,
        resultReadyIntervalMs: this.#configuration.resultReadyIntervalMs,
        resultReadyTimeoutMs: this.#configuration.resultReadyTimeoutMs,
        concurrency: command.concurrency ?? DEFAULT_SUITE_RUN_CONCURRENCY,
        staggerMs: command.staggerMs ?? DEFAULT_SUITE_RUN_START_STAGGER_MS,
        modelOverrides: {
          ...(command.judgeModelId === undefined ? {} : { judgeModelId: command.judgeModelId }),
          ...(command.primaryModelId === undefined
            ? {}
            : { primaryModelId: command.primaryModelId }),
        },
        onStatus: (item, status) =>
          progress.update(`eval ${item.index + 1}: ${formatStatusProgress(status)}`),
        ...(this.#signal ? { signal: this.#signal } : {}),
      });
      this.#lastCreateFromRuns = summary.evals
        .map((entry) => entry.execution)
        .filter((execution): execution is NonNullable<typeof execution> => execution !== undefined)
        .map((execution) => ({
          evaluationId: execution.evaluationId,
          runId: execution.runId,
        }));
      return summary;
    } finally {
      progress.stop();
    }
  }

  async #importTrace(
    command: Extract<DeterministicCommand, { kind: 'trace-import' }>,
    options: ExecutionOptions,
  ): Promise<{ workspaceId: string }> {
    if (command.run && command.workspaceId === undefined) {
      throw new AutoevalError('--run requires --workspace <workspace-id>.', {
        kind: 'usage',
        code: 'TRACE_IMPORT_WORKSPACE_REQUIRED',
      });
    }

    const sessionContent = await readBoundedTextFile(
      command.sessionFile,
      MAX_TRACE_SESSION_BYTES,
      'Session log',
      'HARNESS_SESSION_READ_FAILED',
    );
    const templateContent = await readBoundedTextFile(
      command.templateFile,
      MAX_TRACE_TEMPLATE_BYTES,
      'Template file',
      'TRACE_TEMPLATE_READ_FAILED',
    );

    let template: unknown;
    try {
      template = JSON.parse(templateContent) as unknown;
    } catch (error) {
      throw new AutoevalError('Template file must contain valid JSON.', {
        kind: 'usage',
        code: 'TRACE_TEMPLATE_INVALID_JSON',
        cause: error,
      });
    }

    const conversion = convertHarnessSession({
      content: sessionContent,
      ...(command.serviceName ? { serviceName: command.serviceName } : {}),
    });
    const evaluationInput = buildAgentTraceInput({
      template,
      conversion,
      ...(command.evaluationName ? { evaluationName: command.evaluationName } : {}),
    });
    const serialized = `${JSON.stringify(evaluationInput, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_TRACE_OUTPUT_BYTES) {
      throw new AutoevalError('Imported trace exceeds the 64 MiB output limit.', {
        kind: 'usage',
        code: 'TRACE_OUTPUT_TOO_LARGE',
      });
    }

    try {
      await writeFile(command.outputFile, serialized, { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : undefined;
      throw new AutoevalError(
        code === 'EEXIST'
          ? 'Output file already exists; choose a new --out path.'
          : 'Output file could not be written.',
        {
          kind: 'usage',
          code: code === 'EEXIST' ? 'TRACE_OUTPUT_EXISTS' : 'TRACE_OUTPUT_WRITE_FAILED',
          cause: error,
        },
      );
    }

    const report = { outputFile: command.outputFile, ...conversion.stats };
    this.#writer.writeResult(report, renderTraceImport(report), options.json);
    return { workspaceId: command.workspaceId ?? '' };
  }

  #createProgressReporter(label: string, options: ExecutionOptions): ProgressReporter {
    return createProgressReporter({
      stream: this.#stderr,
      enabled: this.#stderr.isTTY === true && !options.json,
      label,
      unicode: supportsUnicode(this.#environment),
      color: resolveColorMode(this.#environment) !== 'none',
    });
  }

  #createContext(
    apiKey: string,
    options: ExecutionOptions,
  ): ReturnType<typeof createApiActionContext> {
    const onDiagnostic = options.debug
      ? (diagnostic: ApiDiagnostic): void => this.#writer.writeDiagnostic(diagnostic)
      : undefined;
    return createApiActionContext({
      configuration: this.#configuration,
      apiKey,
      ...(this.#fetchImplementation ? { fetchImplementation: this.#fetchImplementation } : {}),
      ...(onDiagnostic ? { onDiagnostic } : {}),
    });
  }

  takeLastCreateFromRuns(): readonly { evaluationId: string; runId: string }[] {
    const runs = this.#lastCreateFromRuns;
    this.#lastCreateFromRuns = [];
    return runs;
  }

  #redactResultsJson(value: unknown): unknown {
    const hiddenKeys = new Set([
      'evaluation_id',
      'generated_at',
      '_meta',
      'provider_key',
      'scenario_id',
      'schema_version',
      'view_details_url',
      'view_details_label',
      'execution_id',
      'pagination',
      'actions',
      'metadata',
      'color_code',
      'model_name',
    ]);

    if (Array.isArray(value)) {
      return value.map((entry) => this.#redactResultsJson(entry));
    }
    if (typeof value !== 'object' || value === null) {
      return value;
    }

    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(source)) {
      if (hiddenKeys.has(key)) continue;
      if (key === 'step_id' || key === 'parent_step_id') {
        result[key] = this.#normalizeStepId(nested);
        continue;
      }
      if (key === 'step_ids' && Array.isArray(nested)) {
        result[key] = nested.map((entry) => this.#normalizeStepId(entry));
        continue;
      }
      result[key] = this.#redactResultsJson(nested);
    }
    return result;
  }

  #normalizeStepId(value: unknown): unknown {
    if (typeof value !== 'string') return value;
    if (!/^\d+$/u.test(value)) return value;
    const normalized = value.replace(/^0+/u, '');
    return normalized === '' ? '0' : normalized;
  }

  #omitNullStatisticFields(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((entry) => this.#omitNullStatisticFields(entry));
    }
    if (typeof value !== 'object' || value === null) {
      return value;
    }

    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(source)) {
      if (nested === null && NULL_STATISTIC_KEYS.has(key)) continue;
      result[key] = this.#omitNullStatisticFields(nested);
    }
    return result;
  }
}
