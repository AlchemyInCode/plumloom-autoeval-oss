import { createHash } from 'node:crypto';

import type { SuiteGateResult } from '../actions/suite-gate.js';
import type { SuiteSummary } from '../actions/suite.js';
import { redactText } from '../auth/redact.js';
import type { EvaluationContextType } from '../domain/types.js';
import {
  extractJudgmentEvidence,
  extractScenarioRepeatabilityEvidence,
  type JudgmentEvidence,
  type RunStandardEvidence,
  type ScenarioRepeatabilityEvidence,
} from '../reliability/evidence.js';

const GITHUB_COMMENT_LIMIT = 65_536;
const REPORT_LIMIT = 65_000;
const MAX_CELL_CHARS = 280;

type ReportContext = EvaluationContextType | 'unknown';

type ReportEvaluation = {
  index: number;
  name: string;
  context: ReportContext;
  decision: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'ERROR';
  checks: SuiteGateResult['perEvalDecisions'][number]['checks'];
  reason: string;
  standard?: RunStandardEvidence;
  judgment: JudgmentEvidence[];
  repeatability?: ScenarioRepeatabilityEvidence;
};

export type ReliabilityReportInput = {
  gate: SuiteGateResult;
  summary: SuiteSummary;
  actionsRunUrl?: string;
  marker: string;
};

export type RenderedReliabilityReport = {
  markdown: string;
  detailLevel: 'full' | 'summary' | 'critical' | 'minimal';
};

function clean(input: string, maxChars = 1_000): string {
  const withoutControls = Array.from(redactText(input), (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159) ? ' ' : character;
  }).join('');
  const clipped =
    withoutControls.length > maxChars
      ? `${withoutControls.slice(0, maxChars - 1)}…`
      : withoutControls;
  return clipped
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/([\\`*_[\]{}()#+.!|])/gu, '\\$1');
}

function cell(input: string): string {
  return clean(input.replace(/[\r\n]+/gu, ' '), MAX_CELL_CHARS);
}

function number(input: number): string {
  return Number.isInteger(input) ? String(input) : input.toFixed(3).replace(/0+$/u, '');
}

function safeRunUrl(input: string | undefined): string | undefined {
  if (!input) return undefined;
  try {
    const url = new URL(input);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function contextLabel(context: ReportContext): string {
  switch (context) {
    case 'scenario':
      return 'Live scenario';
    case 'conversation':
      return 'Frozen conversation';
    case 'agent_trace':
      return 'Frozen agent trace';
    default:
      return 'Unknown';
  }
}

function standardSummary(standard: RunStandardEvidence | undefined): string {
  if (!standard?.rubricApplied) return 'Not available';
  const parts = ['Rubric'];
  if (standard.judgeModel) {
    parts.push(`judge ${standard.judgeModel}${standard.judgeModelPinned ? ' (pinned)' : ''}`);
  }
  if (standard.qualityStandardStatus === 'not_configured') {
    parts.push('QS: Not configured');
  } else if (standard.qualityStandardStatus === 'not_available') {
    parts.push('QS: Not available');
  } else {
    const name = standard.qualityStandardName ?? 'applied';
    const version = standard.qualityStandardVersion
      ? `; version ${standard.qualityStandardVersion}`
      : '';
    const anchors = standard.anchorCount === undefined ? '' : `; ${standard.anchorCount} anchors`;
    parts.push(`QS: ${name}${version}${anchors}`);
  }
  return parts.join('; ');
}

function judgmentLine(evidence: JudgmentEvidence): string {
  const count = evidence.assessmentCount;
  if (count === 1) return `K=1; Agreement not measured`;
  if (count === undefined) return 'K: Not available';
  if (evidence.passVotes !== undefined) {
    return `K=${count}; ${evidence.passVotes}/${count} pass votes`;
  }
  if (evidence.agreedAssessments !== undefined) {
    return `K=${count}; ${evidence.agreedAssessments}/${count} assessments agreed`;
  }
  return `K=${count}; agreement evidence Not available`;
}

function judgmentSummary(entries: readonly JudgmentEvidence[]): string {
  if (entries.length === 0) return 'Not available';
  if (entries.length === 1 && entries[0]) return judgmentLine(entries[0]);
  return entries.map((entry) => `${entry.scope}: ${judgmentLine(entry)}`).join('; ');
}

function repeatabilitySummary(evaluation: ReportEvaluation): string {
  if (evaluation.context === 'conversation' || evaluation.context === 'agent_trace') {
    return 'N/A: frozen input; behavioral repeatability not measured';
  }
  if (evaluation.context === 'unknown') return 'Not available';
  if (evaluation.decision === 'ERROR' && evaluation.repeatability?.statistics.length === 0) {
    return 'Error';
  }
  const evidence = evaluation.repeatability;
  if (!evidence) return 'Not available';
  const trials = evidence.completedTrials;
  const hasStatistics = evidence.statistics.length > 0;
  const insufficient =
    trials === 1 || evidence.statistics.some((entry) => entry.insufficientEvidence === true);
  if (insufficient) {
    return `${trials === undefined ? 'Trial count Not available' : `${trials} trial`}; Insufficient evidence`;
  }
  if (trials !== undefined) {
    return `${trials} trials; statistics ${hasStatistics ? 'available' : 'Not available'}`;
  }
  return hasStatistics ? 'Trial count Not available; statistics available' : 'Not available';
}

function reportEvaluations(input: ReliabilityReportInput): ReportEvaluation[] {
  const summaryByIndex = new Map(input.summary.evals.map((entry) => [entry.index, entry]));
  return [...input.gate.perEvalDecisions]
    .sort((left, right) => left.index - right.index)
    .map((decision) => {
      const summary = summaryByIndex.get(decision.index);
      const executionContext = summary?.execution?.contextType;
      const decisionContext = decision.contextType;
      const context: ReportContext =
        executionContext && decisionContext && executionContext !== decisionContext
          ? 'unknown'
          : (executionContext ?? decisionContext ?? 'unknown');
      const results = summary?.results;
      const statusRaw = summary?.execution?.statusRaw;
      return {
        index: decision.index,
        name: decision.evaluationName ?? decision.inputFile,
        context,
        decision: decision.decision,
        checks: decision.checks,
        reason: decision.reason,
        ...(summary?.execution?.standard === undefined
          ? {}
          : { standard: summary.execution.standard }),
        judgment: extractJudgmentEvidence(
          context === 'unknown' ? undefined : context,
          results,
          statusRaw,
        ),
        ...(context === 'scenario'
          ? { repeatability: extractScenarioRepeatabilityEvidence(results, statusRaw) }
          : {}),
      };
    });
}

function contextCounts(evaluations: readonly ReportEvaluation[]): string {
  const counts: Record<ReportContext, number> = {
    scenario: 0,
    conversation: 0,
    agent_trace: 0,
    unknown: 0,
  };
  for (const evaluation of evaluations) counts[evaluation.context] += 1;
  return [
    `${counts.scenario} live scenario`,
    `${counts.conversation} frozen conversation`,
    `${counts.agent_trace} frozen agent trace`,
    ...(counts.unknown > 0 ? [`${counts.unknown} unknown`] : []),
  ].join(' · ');
}

function header(input: ReliabilityReportInput, evaluations: readonly ReportEvaluation[]): string[] {
  const runUrl = safeRunUrl(input.actionsRunUrl);
  return [
    input.marker,
    `## Autoeval Reliability Report — ${input.gate.suiteDecision}`,
    '',
    `${evaluations.length} evaluations · ${contextCounts(evaluations)}${runUrl ? ` · [GitHub Actions run](${runUrl})` : ''}`,
    '',
  ];
}

function legend(): string[] {
  return [
    '**Standard:** instructions, Quality Standard, and calibration anchors used.',
    '**Judgment:** evidence from multiple judge assessments.',
    '**Repeatability:** performance variation across independent executions of the system being evaluated.',
    '',
  ];
}

function table(evaluations: readonly ReportEvaluation[]): string[] {
  const lines = [
    '| Evaluation | Context | Gate | Standard | Judgment | Repeatability |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const evaluation of evaluations) {
    lines.push(
      `| ${cell(evaluation.name)} | ${cell(contextLabel(evaluation.context))} | **${evaluation.decision}** | ${cell(standardSummary(evaluation.standard))} | ${cell(judgmentSummary(evaluation.judgment))} | ${cell(repeatabilitySummary(evaluation))} |`,
    );
  }
  lines.push('');
  return lines;
}

function statisticLine(statistic: ScenarioRepeatabilityEvidence['statistics'][number]): string {
  if (statistic.hasData === false) return `${statistic.scope}: Not measured`;
  if (statistic.insufficientEvidence === true) {
    const sample = statistic.sampleSize === undefined ? '' : ` (n=${statistic.sampleSize})`;
    return `${statistic.scope}: Insufficient evidence${sample}`;
  }
  const fields: string[] = [];
  if (statistic.mean !== undefined) fields.push(`mean ${number(statistic.mean)}`);
  if (statistic.standardDeviation !== undefined) {
    fields.push(`SD ${number(statistic.standardDeviation)}`);
  }
  if (statistic.ci95Lower !== undefined && statistic.ci95Upper !== undefined) {
    fields.push(`95% CI ${number(statistic.ci95Lower)}–${number(statistic.ci95Upper)}`);
  } else if (statistic.ci95HalfWidth !== undefined) {
    fields.push(`reported 95% CI half-width ±${number(statistic.ci95HalfWidth)}`);
  }
  if (statistic.sampleSize !== undefined) fields.push(`n=${statistic.sampleSize}`);
  return `${statistic.scope}: ${fields.length === 0 ? 'Not available' : fields.join('; ')}`;
}

function missingEvidence(evaluation: ReportEvaluation): string[] {
  const missing: string[] = [];
  if (!evaluation.standard?.rubricApplied) missing.push('Standard metadata: Not available.');
  else if (evaluation.standard.qualityStandardStatus === 'not_available') {
    missing.push('Quality Standard metadata: Not available for this run.');
  }
  if (evaluation.judgment.length === 0) missing.push('Judgment evidence: Not available.');
  else if (
    evaluation.judgment.some(
      (entry) =>
        (entry.assessmentCount ?? 0) > 1 &&
        entry.passVotes === undefined &&
        entry.agreedAssessments === undefined,
    )
  ) {
    missing.push('Judge agreement evidence: Not available at the reported granularity.');
  }
  if (evaluation.context === 'scenario' && evaluation.repeatability?.statistics.length === 0) {
    missing.push('Repeatability statistics: Not available.');
  }
  if (evaluation.context === 'unknown') {
    missing.push('Authoritative context: Not available; repeatability was not inferred.');
  }
  return missing;
}

function details(evaluation: ReportEvaluation, actionsRunUrl: string | undefined): string[] {
  const lines = [
    '<details>',
    `<summary>${evaluation.decision} — ${clean(evaluation.name, 200)} (${contextLabel(evaluation.context)})</summary>`,
    '',
    `- **Standard:** ${clean(standardSummary(evaluation.standard), 500)}`,
  ];
  if (evaluation.judgment.length === 0) {
    lines.push('- **Judgment:** Not available');
  } else {
    lines.push('- **Judgment:**');
    for (const entry of evaluation.judgment) {
      lines.push(`  - ${clean(entry.scope)}: ${clean(judgmentLine(entry))}`);
    }
  }

  if (evaluation.context === 'scenario') {
    lines.push(`- **Repeatability:** ${clean(repeatabilitySummary(evaluation))}`);
    for (const statistic of evaluation.repeatability?.statistics ?? []) {
      lines.push(`  - ${clean(statisticLine(statistic), 700)}`);
    }
  } else {
    lines.push(`- **Repeatability:** ${clean(repeatabilitySummary(evaluation))}`);
  }

  if (evaluation.checks.length === 0) {
    lines.push(`- **Gate checks:** ${clean(evaluation.reason, 700)}`);
  } else {
    lines.push('- **Gate checks:**');
    for (const check of evaluation.checks) {
      lines.push(
        `  - ${clean(check.label, 200)}: ${clean(check.actual, 200)}; required ${clean(check.threshold, 200)} → **${check.decision}**${check.decision === 'PASS' ? '' : ` — ${clean(check.reason, 500)}`}`,
      );
    }
  }

  const missing = missingEvidence(evaluation);
  if (missing.length > 0) {
    lines.push('- **Missing evidence:**');
    for (const item of missing) lines.push(`  - ${item}`);
  }
  if (actionsRunUrl) lines.push(`- [Full diagnostics in GitHub Actions](${actionsRunUrl})`);
  lines.push('', '</details>', '');
  return lines;
}

function renderFull(
  input: ReliabilityReportInput,
  evaluations: readonly ReportEvaluation[],
): string {
  const runUrl = safeRunUrl(input.actionsRunUrl);
  const priority = { ERROR: 3, FAIL: 2, INCONCLUSIVE: 1, PASS: 0 } as const;
  const detailOrder = [...evaluations].sort(
    (left, right) => priority[right.decision] - priority[left.decision] || left.index - right.index,
  );
  return [
    ...header(input, evaluations),
    ...legend(),
    ...table(evaluations),
    ...detailOrder.flatMap((evaluation) => details(evaluation, runUrl)),
  ].join('\n');
}

function renderSummary(
  input: ReliabilityReportInput,
  evaluations: readonly ReportEvaluation[],
): string {
  return [...header(input, evaluations), ...legend(), ...table(evaluations)].join('\n');
}

function renderCritical(
  input: ReliabilityReportInput,
  evaluations: readonly ReportEvaluation[],
): string {
  const critical = evaluations.filter((evaluation) => evaluation.decision !== 'PASS');
  return [
    ...header(input, evaluations),
    'Detailed evidence was omitted to stay within the GitHub comment size limit.',
    '',
    ...(critical.length === 0
      ? ['All evaluations passed. See the Actions run for full diagnostics.', '']
      : table(critical)),
  ].join('\n');
}

function renderMinimal(
  input: ReliabilityReportInput,
  evaluations: readonly ReportEvaluation[],
): string {
  const runUrl = safeRunUrl(input.actionsRunUrl);
  return [
    input.marker,
    `## Autoeval Reliability Report — ${input.gate.suiteDecision}`,
    '',
    `${evaluations.length} evaluations · ${contextCounts(evaluations)}`,
    ...(runUrl ? ['', `[Full diagnostics in GitHub Actions](${runUrl})`] : []),
    '',
    'Evaluation details were omitted to stay within the GitHub comment size limit.',
  ].join('\n');
}

export function createReliabilityReportMarker(identity: string): string {
  const digest = createHash('sha256').update(identity).digest('hex').slice(0, 24);
  return `<!-- autoeval-reliability-report:${digest} -->`;
}

/** Deterministic, context-aware Markdown over already-sanitized suite evidence. */
export function renderReliabilityReport(input: ReliabilityReportInput): RenderedReliabilityReport {
  const evaluations = reportEvaluations(input);
  const candidates: [RenderedReliabilityReport['detailLevel'], string][] = [
    ['full', renderFull(input, evaluations)],
    ['summary', renderSummary(input, evaluations)],
    ['critical', renderCritical(input, evaluations)],
    ['minimal', renderMinimal(input, evaluations)],
  ];
  for (const [detailLevel, markdown] of candidates) {
    if (markdown.length <= REPORT_LIMIT) return { markdown, detailLevel };
  }
  const fallback = renderMinimal(input, []);
  if (fallback.length > GITHUB_COMMENT_LIMIT) {
    throw new Error('Autoeval reliability report could not fit within the GitHub comment limit.');
  }
  return { markdown: fallback, detailLevel: 'minimal' };
}
