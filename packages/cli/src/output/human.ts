import { z } from 'zod';

import type { DoctorCheck, DoctorReport } from '../actions/doctor.js';
import type { GateReport } from '../actions/gate.js';
import type { SuiteGateResult } from '../actions/suite-gate.js';
import type { SuiteSummary } from '../actions/suite.js';
import type { ConfiguredRunValidationResult } from '../configured-run/validation.js';
import type { JsonObject } from '../domain/common.js';
import type {
  Evaluation,
  EvaluationPage,
  EvaluationResults,
  EvaluationVersionHistory,
  RunExecution,
  RunHandle,
  RunStatus,
  SupportedModel,
  UserIdentity,
  WorkspacePage,
} from '../domain/types.js';
import type { FailureCluster } from '../suite/reporting.js';
import { paint } from './colors.js';
import { summarizeEvaluationConfiguration, summarizeScenarioResults } from './digest.js';
import { renderCallout, renderHeading, renderMetadata } from './layout.js';
import { renderResultScorecard } from './scorecard.js';
import { safeMultilineTerminalText, safeTerminalText } from './safe-text.js';
import { formatTable } from './table.js';

function clean(value: string): string {
  return safeTerminalText(value);
}

const sessionScorecardSchema = z
  .object({
    outcome: z
      .object({
        achieved: z.boolean(),
        score: z.number().nullable(),
        has_data: z.boolean(),
      })
      .loose(),
    overall: z.number().nullable(),
    per_metric: z.record(
      z.string(),
      z
        .object({
          score: z.number().nullable(),
          has_data: z.boolean(),
        })
        .loose(),
    ),
    judge_agreement: z
      .object({
        pass: z.number().int().nonnegative().nullable(),
        total: z.number().int().nonnegative().nullable(),
      })
      .loose()
      .optional(),
  })
  .loose();

const trajectoryScorecardSchema = z
  .object({
    trajectory_score: z.number().nullable(),
    judge_agreement: z
      .object({
        agreed: z.number().int().nonnegative().nullable(),
        total: z.number().int().nonnegative().nullable(),
      })
      .loose(),
    dimensions: z.array(
      z
        .object({
          key: z.string(),
          label: z.string().min(1),
          score: z.number().nullable(),
        })
        .loose(),
    ),
  })
  .loose();

function formatScore(score: number | null): string {
  return score === null ? 'Not available' : String(score);
}

function formatAgreement(
  agreement: { pass: number | null; total: number | null } | undefined,
): string {
  const pass = agreement?.pass;
  const total = agreement?.total;
  if (pass === undefined || pass === null || total === undefined || total === null) {
    return 'Not available';
  }
  return `${pass}/${total}`;
}

function formatSessionScorecard(input: unknown, indent = ''): string[] {
  const parsed = sessionScorecardSchema.safeParse(input);
  if (!parsed.success) return [`${indent}Score summary: Not available`];
  const scorecard = parsed.data;
  const lines = [
    `${indent}Outcome: ${scorecard.outcome.has_data ? (scorecard.outcome.achieved ? 'Pass' : 'Fail') : 'Not available'}`,
    `${indent}Overall score: ${formatScore(scorecard.overall)}`,
    `${indent}Judge agreement: ${formatAgreement(scorecard.judge_agreement)}`,
  ];
  const metrics = Object.entries(scorecard.per_metric).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (metrics.length > 0) {
    lines.push(`${indent}Metric scores:`);
    for (const [name, metric] of metrics) {
      lines.push(
        `${indent}  ${clean(name)}: ${metric.has_data ? formatScore(metric.score) : 'Not available'}`,
      );
    }
  }
  return lines;
}

function formatTrajectoryScorecard(input: unknown, indent = ''): string[] {
  const parsed = trajectoryScorecardSchema.safeParse(input);
  if (!parsed.success) return [`${indent}Trajectory: Not available`];
  const scorecard = parsed.data;
  const agreement =
    scorecard.judge_agreement.agreed === null || scorecard.judge_agreement.total === null
      ? 'Not available'
      : `${scorecard.judge_agreement.agreed}/${scorecard.judge_agreement.total}`;
  const lines = [
    `${indent}Trajectory score: ${formatScore(scorecard.trajectory_score)}`,
    `${indent}Judge agreement: ${agreement}`,
  ];
  if (scorecard.dimensions.length > 0) {
    lines.push(`${indent}Trajectory dimensions:`);
    for (const dimension of scorecard.dimensions) {
      lines.push(`${indent}  ${clean(dimension.label)}: ${formatScore(dimension.score)}`);
    }
  }
  return lines;
}

export function renderIdentity(identity: UserIdentity): string {
  return `Authenticated as ${clean(identity.email)}${identity.name ? ` (${clean(identity.name)})` : ''}\n`;
}

export function renderLogin(input: {
  identity: UserIdentity;
  source: 'environment' | 'keyring' | 'prompt' | 'flag';
  wasPersisted: boolean;
  replacedInvalidStoredKey?: boolean;
}): string {
  const persistence = input.wasPersisted
    ? 'The CLI key was saved in the OS credential store'
    : input.source === 'environment'
      ? 'The environment-provided CLI key was not persisted'
      : 'Using the CLI key already stored in the OS credential store';
  const replaced = input.replacedInvalidStoredKey
    ? 'Removed an invalid stored CLI key before signing in\n'
    : '';
  return `${replaced}${renderIdentity(input.identity)}${persistence}\n`;
}

export function renderLoginGuidance(): string {
  return [
    'No valid Autoeval CLI key was found.',
    '',
    '  1. Go to https://app.plumloom.ai',
    '  2. Create a CLI key',
    '  3. Copy the key starting with pl_sk_',
    '',
    'Paste it below — it will be verified and saved to your OS credential store.',
    '',
  ].join('\n');
}

export function renderLogout(wasRemoved: boolean, hasEnvironmentCredential = false): string {
  if (wasRemoved) {
    return 'Removed the locally stored CLI key. Environment credentials were not changed\n';
  }
  if (hasEnvironmentCredential) {
    return [
      'No locally stored CLI key was found',
      'AUTOEVAL_API_KEY is currently set in your environment, so authentication still works',
      'Unset AUTOEVAL_API_KEY in your shell to fully log out of this terminal session',
      '',
    ].join('\n');
  }
  return 'No locally stored CLI key was found. Environment credentials were not changed\n';
}

export function renderWorkspaces(page: WorkspacePage): string {
  if (page.items.length === 0) {
    return 'No workspaces found\nCreate one with `autoeval workspace create --name "My workspace"`\n';
  }
  const table = formatTable(
    [
      { header: 'NAME', minWidth: 20, maxWidth: 44 },
      { header: 'WORKSPACE ID', atomic: true, tone: 'meta' },
      { header: 'EVALUATIONS', align: 'right' },
    ],
    page.items.map((workspace) => [
      workspace.name,
      workspace.id,
      String(workspace.evaluationCount),
    ]),
  );

  return `${table}\n\nShowing ${page.items.length} of ${page.total} workspaces\nList evaluations with \`autoeval eval list --workspace <workspace-id>\`\n`;
}

export function renderWorkspaceSummaryList(page: WorkspacePage): string {
  if (page.items.length === 0) return 'No workspaces found\n';
  return `${formatTable(
    [
      { header: 'NAME', minWidth: 20, maxWidth: 44 },
      { header: 'ID', atomic: true, tone: 'meta' },
      { header: 'EVALUATIONS', align: 'right' },
    ],
    page.items.map((workspace) => [
      workspace.name,
      workspace.id,
      String(workspace.evaluationCount),
    ]),
  )}\n`;
}

export function renderCreatedWorkspace(workspace: { id: string; name: string }): string {
  return `Created workspace ${clean(workspace.name)} (${clean(workspace.id)})\n`;
}

export function renderCreatedEvaluation(evaluation: {
  evaluationId: string;
  workspaceId: string;
  evaluationName: string;
}): string {
  return `Created evaluation ${clean(evaluation.evaluationName)} (${clean(evaluation.evaluationId)}) in workspace ${clean(evaluation.workspaceId)}\n`;
}

export function renderEvaluations(page: EvaluationPage): string {
  if (page.items.length === 0) {
    return 'No evaluations found in this workspace\nCreate one with `autoeval eval create --workspace <workspace-id> --name "My evaluation"`\n';
  }
  const table = formatTable(
    [
      { header: 'NAME', minWidth: 20, maxWidth: 52 },
      { header: 'EVALUATION ID', atomic: true, tone: 'meta' },
    ],
    page.items.map((evaluation) => [evaluation.name, evaluation.id]),
  );
  return `${table}\n\nShowing ${page.items.length} of ${page.total} evaluations\nInspect one with \`autoeval eval show <evaluation-id>\`\n`;
}

export function renderEvaluationVersions(history: EvaluationVersionHistory): string {
  if (history.versions.length === 0) {
    return `No versions found for evaluation ${clean(history.evaluationId)}\n`;
  }

  const table = formatTable(
    [
      { header: 'VERSION', atomic: true },
      { header: 'CONFIG ID', atomic: true, tone: 'meta' },
      { header: 'CREATED', atomic: true },
      { header: 'STATUS', atomic: true },
    ],
    history.versions.map((version) => [
      String(version.version),
      version.configVersionId,
      version.createdAt ?? '-',
      version.isCurrent ? 'current' : '',
    ]),
  );

  return `${table}\n\nShow one with \`autoeval eval show ${clean(history.evaluationId)} --version <number>\`\n`;
}

export function renderEvaluationSummaryList(page: EvaluationPage): string {
  if (page.items.length === 0) return 'No evaluations found in this workspace\n';
  return `${formatTable(
    [
      { header: 'NAME', minWidth: 20, maxWidth: 52 },
      { header: 'ID', atomic: true, tone: 'meta' },
    ],
    page.items.map((evaluation) => [evaluation.name, evaluation.id]),
  )}\n`;
}

export function renderEvaluation(evaluation: Evaluation): string {
  const evaluationName = [evaluation.raw, evaluation.configuration]
    .map((candidate) =>
      ['evaluation_name', 'evaluationName', 'eval_name', 'name']
        .map((key) => candidate[key])
        .find((value): value is string => typeof value === 'string' && value.trim().length > 0),
    )
    .find((value): value is string => value !== undefined);
  return [
    `Evaluation: ${evaluationName ? `${clean(evaluationName)} (${clean(evaluation.evaluationId)})` : clean(evaluation.evaluationId)}`,
    `Context: ${clean(evaluation.contextType)}`,
    '',
    ...(evaluation.version === undefined
      ? []
      : [`Evaluation version: ${evaluation.version}${evaluation.isCurrent ? ' (current)' : ''}`]),
    `  Methodology version ID: ${paint.meta(clean(evaluation.methodologyVersionId))}`,
    `  Config version ID:      ${paint.meta(clean(evaluation.configVersionId))}`,
    '',
    summarizeEvaluationConfiguration(evaluation),
    '',
    'Use --json to view the validated configuration payload',
    '',
  ].join('\n');
}

export function renderModels(models: SupportedModel[]): string {
  if (models.length === 0) return 'No supported models were returned\n';
  const sorted = [...models].sort((left, right) =>
    `${left.provider}/${left.displayName}`.localeCompare(`${right.provider}/${right.displayName}`),
  );
  const table = formatTable(
    [
      { header: 'NAME' },
      { header: 'PROVIDER' },
      { header: 'MODEL ID', atomic: true, tone: 'meta' },
      { header: 'FLAGS', tone: 'warn' },
    ],
    sorted.map((model) => [
      model.displayName,
      model.provider,
      model.id,
      [model.isLocked ? 'locked' : '', model.isDeprecated ? 'deprecated' : '']
        .filter(Boolean)
        .join(', '),
    ]),
  );
  return `${table}\n\nShowing ${sorted.length} models\n`;
}

export function renderRunStatus(status: RunStatus): string {
  const rows: string[][] = [
    ['Run ID', clean(status.runId)],
    ['Evaluation', clean(status.evaluationId)],
    ['Status', clean(status.state)],
  ];
  if (status.progress) {
    const completed = status.progress.runsCompleted ?? '?';
    const total = status.progress.totalRuns ?? '?';
    const percentage = status.progress.percentage ?? '?';
    rows.push(['Progress', `${completed}/${total} (${percentage}%)`]);
  }
  if (status.failureCode) rows.push(['Failure code', clean(status.failureCode)]);
  const metadata = renderMetadata(rows.map(([label, value]) => [label ?? '', value ?? '']));
  const next = [
    '',
    'Use the Run ID above with status and results:',
    `  autoeval status  ${clean(status.evaluationId)} ${clean(status.runId)}`,
    `  autoeval results ${clean(status.evaluationId)} ${clean(status.runId)}`,
    'Run with --json for full reliability detail',
    '',
  ].join('\n');
  return `${metadata}${next}`;
}

export function renderRunExecution(execution: RunExecution): string {
  const seconds = Math.round(execution.outcome.elapsedMs / 1_000);
  return `${renderRunStatus(execution.outcome.status)}Finished in ${seconds}s\n`;
}

export type QuickstartPlan = {
  workspace: { id: string; name: string };
  judge: SupportedModel;
  primary?: SupportedModel;
  sample: string;
  evaluationName: string;
  evaluationId: string;
};

export function renderQuickstartPlan(plan: QuickstartPlan): string {
  return renderMetadata([
    ['Workspace', `${clean(plan.workspace.name)} (${clean(plan.workspace.id)})`],
    ['Judge', `${clean(plan.judge.displayName)} (${clean(plan.judge.id)})`],
    ...(plan.primary === undefined
      ? []
      : ([['Under test', `${clean(plan.primary.displayName)} (${clean(plan.primary.id)})`]] as [
          string,
          string,
        ][])),
    ['Sample', clean(plan.sample)],
    ['Evaluation', `${clean(plan.evaluationName)} (${clean(plan.evaluationId)})`],
  ]);
}

export function renderQuickstartNextSteps(evaluationId: string, runId: string): string {
  return [
    '',
    'Re-read this run any time:',
    `  autoeval results ${clean(evaluationId)} ${clean(runId)}`,
    'Run with --json for full reliability detail',
    '',
  ].join('\n');
}

export type TraceImportReport = {
  outputFile: string;
  schema: string;
  events: number;
  spans: number;
  llmSpans: number;
  toolSpans: number;
  unpairedToolCalls: number;
  skippedSubagentSessions: number;
  syntheticTimestamps: boolean;
};

export function renderTraceImport(report: TraceImportReport): string {
  const rows: [string, string][] = [
    ['Wrote', clean(report.outputFile)],
    ['Harness schema', clean(report.schema)],
    ['Events read', String(report.events)],
    ['Spans written', `${report.spans} (${report.llmSpans} LLM, ${report.toolSpans} tool)`],
  ];
  const notes: string[] = [];
  if (report.unpairedToolCalls > 0) {
    notes.push(`${report.unpairedToolCalls} tool call(s) had no matching result.`);
  }
  if (report.skippedSubagentSessions > 0) {
    notes.push(
      `${report.skippedSubagentSessions} subagent event(s) skipped; subagents log to their own sessions.`,
    );
  }
  if (report.syntheticTimestamps) {
    notes.push('The log carried no timestamps, so span times are synthetic and ordering-only.');
  }
  const metadata = renderMetadata(rows.map(([label, value]) => [label, value]));
  return notes.length === 0 ? metadata : `${metadata}\n${notes.join('\n')}\n`;
}

function renderModelReference(model: SupportedModel): string {
  return `${clean(model.displayName)} (${clean(model.id)})`;
}

export function renderConfiguredRunValidation(result: ConfiguredRunValidationResult): string {
  const artifactLabel =
    result.contextType === 'scenario'
      ? 'Scenarios'
      : result.contextType === 'conversation'
        ? 'Messages'
        : 'Resource spans';
  const lines = [
    `Valid ${clean(result.contextType)} evaluation input`,
    `Judge: ${renderModelReference(result.models.judge)}`,
  ];
  if (result.models.primary) {
    lines.push(`Primary: ${renderModelReference(result.models.primary)}`);
  }
  if (result.models.comparisons.length > 0) {
    lines.push(`Comparisons: ${result.models.comparisons.map(renderModelReference).join(', ')}`);
  }
  lines.push(`${artifactLabel}: ${result.artifactCount}`);
  return `${lines.join('\n')}\n`;
}

export function renderQualityStandard(
  qualityStandard: Record<string, unknown>,
  fallbackId: string,
): string {
  const idCandidate =
    qualityStandard.id ??
    qualityStandard.quality_standard_id ??
    qualityStandard.qualityStandardId ??
    qualityStandard.qs_id;
  const qualityStandardId =
    typeof idCandidate === 'string' && idCandidate.trim() ? idCandidate : fallbackId;
  const nameCandidate = qualityStandard.name ?? qualityStandard.qs_name;
  const name =
    typeof nameCandidate === 'string' && nameCandidate.trim() ? nameCandidate : 'Not available';
  const judgeModel =
    typeof qualityStandard.judge_model === 'string' && qualityStandard.judge_model.trim()
      ? qualityStandard.judge_model
      : 'Not available';
  const rubric =
    typeof qualityStandard.rubric === 'string' && qualityStandard.rubric.trim()
      ? qualityStandard.rubric
      : 'Not available';
  const anchors = Array.isArray(qualityStandard.anchors)
    ? qualityStandard.anchors.filter(
        (anchor): anchor is Record<string, unknown> =>
          typeof anchor === 'object' && anchor !== null && !Array.isArray(anchor),
      )
    : [];
  const indent = (value: unknown, spaces: number): string => {
    const text = typeof value === 'string' && value.trim() ? value : 'Not available';
    const padding = ' '.repeat(spaces);
    return safeMultilineTerminalText(text)
      .split(/\r?\n/u)
      .map((line) => `${padding}${line}`)
      .join('\n');
  };

  const lines = [
    'Quality Standard',
    '',
    `Name: ${clean(name)}`,
    `QS ID: ${clean(qualityStandardId)}`,
    `Judge model: ${clean(judgeModel)}`,
    '',
    'Rubric',
    indent(rubric, 2),
    '',
    `Anchors (${anchors.length})`,
  ];

  for (const [index, anchor] of anchors.entries()) {
    const rating = anchor.score === 5 ? 'Accept' : anchor.score === 1 ? 'Reject' : 'Unknown';
    const score = typeof anchor.score === 'number' ? String(anchor.score) : 'Not available';
    lines.push(
      '',
      `${index + 1}. ${rating} (${score})`,
      '   Input',
      indent(anchor.input, 5),
      '   Response',
      indent(anchor.response, 5),
      '   Reference',
      indent(anchor.reference, 5),
      '   Reasoning',
      indent(anchor.reasoning, 5),
    );
  }

  if (anchors.length === 0) {
    lines.push('', 'No anchors were returned.');
  }

  return `${lines.join('\n')}\n`;
}

export function renderWorkspaceQualityStandard(
  qualityStandard: Record<string, unknown> | null,
  workspaceId: string,
): string {
  if (qualityStandard === null) {
    return 'No Quality Standard assigned to this workspace.\n';
  }

  const idCandidate =
    qualityStandard.quality_standard_id ??
    qualityStandard.qualityStandardId ??
    qualityStandard.id ??
    qualityStandard.qs_id;
  const qualityStandardId =
    typeof idCandidate === 'string' && idCandidate.trim() ? idCandidate : undefined;
  const nameCandidate = qualityStandard.name ?? qualityStandard.qs_name;
  const name =
    typeof nameCandidate === 'string' && nameCandidate.trim() ? nameCandidate : undefined;

  if (name && qualityStandardId) {
    return `Workspace ${clean(workspaceId)} is assigned quality standard ${clean(name)} (${clean(qualityStandardId)})\n`;
  }
  if (qualityStandardId) {
    return `Workspace ${clean(workspaceId)} is assigned quality standard ${clean(qualityStandardId)}\n`;
  }
  return `Retrieved workspace quality standard assignment for ${clean(workspaceId)}\n`;
}

/**
 * Plain-text result summary. It carries no colour or table layout because it is
 * also the text handed to downstream consumers as data.
 */
export function renderResultsSummary(results: EvaluationResults): string {
  if (results.contextType === 'scenario') {
    return `${summarizeScenarioResults(results)}\n`;
  }
  if (results.contextType === 'conversation') {
    return ['Context: conversation', ...formatSessionScorecard(results.conversation), ''].join(
      '\n',
    );
  }
  const lines = [
    'Context: agent_trace',
    'Session evaluation:',
    ...formatSessionScorecard(results.agentTrace, '  '),
    'Trajectory evaluation:',
  ];
  if (results.trajectory?.has_trajectory === false) {
    lines.push('  Trajectory: Not available');
  } else if (results.trajectory) {
    lines.push(...formatTrajectoryScorecard(results.trajectory, '  '));
  } else {
    lines.push('  Trajectory: Not available');
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Result display: a readable scorecard over the payloads the backend returned.
 *
 * Scores are read from the payload, never derived beyond the arithmetic the
 * scorecard documents, and the untouched payloads stay one flag away via
 * `--json` for anyone who needs the raw shape.
 */
export function renderResults(
  results: EvaluationResults,
  options: { showOutputs?: boolean; scenarioStatus?: JsonObject } = {},
): string {
  const scorecard = renderResultScorecard(results, undefined, {
    showOutputs: options.showOutputs === true,
    ...(options.scenarioStatus === undefined ? {} : { scenarioStatus: options.scenarioStatus }),
  }).replace(/\n+$/u, '');
  const hint =
    results.contextType === 'scenario'
      ? '--show-outputs for full responses · --json for the raw payload'
      : 'Use --json for full reliability detail and the untouched backend payload';
  return `${scorecard}\n\n${hint}\n`;
}

export type GateExecutionSummary = {
  report: GateReport;
  run: RunHandle;
  elapsedMs: number;
};

/** Render the release-gate verdict as an aligned, scannable report. */
export function renderGateReport(summary: GateExecutionSummary): string {
  const { report } = summary;
  const verdict = report.decision;
  const tone = report.decision === 'PASS' ? 'pass' : report.decision === 'FAIL' ? 'fail' : 'warn';
  const lines = [
    renderCallout(tone, `Gate: ${verdict}`).replace(/\n$/u, ''),
    renderMetadata([
      ['Evaluation', clean(summary.run.evaluationId)],
      ['Run ID', clean(summary.run.runId)],
      ['Context', clean(report.contextType)],
      ['Finished in', `${Math.round(summary.elapsedMs / 1_000)}s`],
    ]).replace(/\n$/u, ''),
    '',
  ];

  if (report.checks.length === 0) {
    lines.push(
      report.contextType === 'scenario'
        ? 'No thresholds were configured, so the gate did not evaluate any metric.'
        : 'No metric thresholds were configured, so this gate is INCONCLUSIVE.',
      '',
    );
    return lines.join('\n');
  }

  lines.push(
    formatTable(
      [
        { header: 'METRIC', minWidth: 22 },
        { header: 'THRESHOLD', minWidth: 12 },
        { header: 'ACTUAL', minWidth: 16 },
        { header: 'STATUS' },
      ],
      report.checks.map((check) => [
        check.detail ? `${check.label} (${check.detail})` : check.label,
        check.threshold,
        check.actual,
        check.decision === 'PASS' ? 'pass' : check.decision,
      ]),
    ),
  );
  lines.push('');
  return lines.join('\n');
}

/** Render execution and result-fetch status for every eval in a suite. */
export function renderSuiteSummary(
  summary: SuiteSummary,
  clusters: readonly FailureCluster[] = [],
): string {
  const blocks = [...summary.evals]
    .sort((left, right) => left.index - right.index)
    .map((entry) => {
      const lines: string[] = [];
      const execution = entry.execution;
      const label = execution ? clean(execution.evaluationName) : clean(entry.inputFile);
      lines.push(`Eval ${entry.index + 1}: ${label}`);
      lines.push(`  Source: ${clean(entry.inputFile)}`);
      if (execution) {
        lines.push(`  Evaluation ID: ${clean(execution.evaluationId)}`);
        lines.push(`  Run ID: ${clean(execution.runId)}`);
        lines.push(`  Context: ${clean(execution.contextType)}`);
        lines.push(
          `  Execution: ${clean(execution.state)} in ${Math.round(execution.elapsedMs / 1_000)}s`,
        );
      }
      lines.push(`  Status: ${clean(entry.status)}`);
      if (entry.error !== undefined) lines.push(`  Error: ${clean(entry.error)}`);
      if (entry.results) {
        lines.push(
          renderResults(entry.results, {
            ...(entry.execution?.statusRaw === undefined
              ? {}
              : { scenarioStatus: entry.execution.statusRaw }),
          })
            .split('\n')
            .map((line) => (line === '' ? line : `  ${line}`))
            .join('\n'),
        );
      }
      return `${lines.join('\n')}\n`;
    });

  return [
    renderHeading('Suite summary').replace(/^\n+|\n+$/gu, ''),
    `Workspace: ${clean(summary.workspaceId)}`,
    `Evals: ${summary.total} total, ${summary.completed} with results, ${summary.failed} failed`,
    '',
    ...blocks,
    renderFailureClusters(clusters),
  ].join('\n');
}

/** Render the suite verdict, counts, and evidence for every blocking eval. */
export function renderSuiteGateReport(
  result: SuiteGateResult,
  clusters: readonly FailureCluster[] = [],
): string {
  const tone =
    result.suiteDecision === 'PASS' ? 'pass' : result.suiteDecision === 'FAIL' ? 'fail' : 'warn';
  const lines = [
    renderCallout(tone, `Suite release gate: ${result.suiteDecision}`).replace(/\n$/u, ''),
    renderMetadata([
      ['Workspace', clean(result.workspaceId)],
      ['PASS', String(result.counts.PASS)],
      ['FAIL', String(result.counts.FAIL)],
      ['INCONCLUSIVE', String(result.counts.INCONCLUSIVE)],
      ['ERROR', String(result.counts.ERROR)],
    ]).replace(/\n$/u, ''),
    '',
  ];

  const notPassing = result.perEvalDecisions.filter((entry) => entry.decision !== 'PASS');
  if (notPassing.length === 0) {
    lines.push('Every eval in the suite met its configured release criteria.', '');
    return lines.join('\n');
  }

  lines.push(renderHeading('Blocking evals').replace(/^\n+|\n+$/gu, ''));
  for (const entry of notPassing) {
    const label = entry.evaluationName ?? entry.inputFile;
    lines.push(`- ${clean(label)} [${entry.decision}]`);
    if (entry.contextType) lines.push(`  context: ${clean(entry.contextType)}`);
    if (entry.runId) lines.push(`  run: ${clean(entry.runId)}`);
    const convergence = entry.evidence.convergence;
    if (convergence) lines.push(`  convergence: ${clean(convergence.status)}`);
    for (const check of entry.checks) {
      if (check.decision === 'PASS') continue;
      lines.push(
        `  ${clean(check.label)}: ${clean(check.actual)} required ${clean(check.threshold)} -> ${check.decision}`,
      );
      lines.push(`    reason: ${clean(check.reason)}`);
    }
    lines.push(`  reason: ${clean(entry.reason)}`);
    lines.push('');
  }
  lines.push(renderFailureClusters(clusters));
  return lines.join('\n');
}

/** Render distinct root causes behind a blocked suite, most frequent first. */
export function renderFailureClusters(clusters: readonly FailureCluster[]): string {
  if (clusters.length === 0) return '';
  const total = clusters.reduce((sum, cluster) => sum + cluster.count, 0);
  const lines = [
    renderHeading('Failure clusters').replace(/^\n+|\n+$/gu, ''),
    `${total} failure(s) grouped into ${clusters.length} root cause(s).`,
    '',
    formatTable(
      [
        { header: 'ROOT CAUSE', minWidth: 30 },
        { header: 'CATEGORY', minWidth: 12 },
        { header: 'COUNT', align: 'right', minWidth: 5 },
        { header: 'EVALS', minWidth: 20 },
      ],
      clusters.map((cluster) => [
        clean(cluster.label),
        cluster.category,
        String(cluster.count),
        clean(cluster.evals.join(', ')),
      ]),
    ),
    '',
  ];
  for (const cluster of clusters) {
    lines.push(`- ${clean(cluster.label)}: ${clean(cluster.exemplar)}`);
  }
  lines.push('');
  return lines.join('\n');
}

function doctorCheckStatusLabel(check: DoctorCheck): string {
  return check.status === 'pass' ? 'pass' : check.status === 'fail' ? 'FAIL' : 'skipped';
}

/** Pre-flight report: one row per check, then the remediation for each failure. */
export function renderDoctorReport(report: DoctorReport): string {
  const tone = report.status === 'ready' ? 'pass' : 'fail';
  const lines = [
    renderCallout(
      tone,
      report.status === 'ready'
        ? 'Pre-flight checks passed. This configuration is ready to run.'
        : 'Pre-flight checks failed. Fix the items below before running the suite.',
    ).replace(/\n$/u, ''),
    renderMetadata([
      ['Passed', String(report.counts.pass)],
      ['Failed', String(report.counts.fail)],
      ['Skipped', String(report.counts.skipped)],
    ]).replace(/\n$/u, ''),
    '',
    formatTable(
      [
        { header: 'CHECK', minWidth: 24 },
        {
          header: 'STATUS',
          minWidth: 8,
          toneOf: (value) => (value === 'pass' ? 'pass' : value === 'FAIL' ? 'fail' : 'meta'),
        },
        { header: 'DETAIL', minWidth: 30 },
      ],
      report.checks.map((check) => [
        clean(check.label),
        doctorCheckStatusLabel(check),
        clean(check.detail),
      ]),
    ),
    '',
  ];

  const failures = report.checks.filter((check) => check.status === 'fail');
  if (failures.length > 0) {
    lines.push(renderHeading('How to fix').replace(/^\n+|\n+$/gu, ''));
    for (const check of failures) {
      lines.push(`- ${clean(check.label)}: ${clean(check.hint ?? check.detail)}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
