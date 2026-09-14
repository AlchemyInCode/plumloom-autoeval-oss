import type { JsonObject } from '../domain/common.js';
import type { EvaluationResults, ScenarioResults } from '../domain/types.js';
import {
  resultMetricScores,
  scenarioHeadline,
  scenarioMetricScores,
  scenarioModelScores,
  scenarioOutputs,
  scenarioReliability,
  scenarioTestCaseScores,
  sessionMetricScores,
  trajectoryMetricScores,
  type MetricScore,
  type ScenarioHeadline,
  type ScenarioMetricScore,
  type ScenarioOutput,
  type ScenarioReliability,
  type ScenarioTestCaseScore,
} from './digest.js';
import { renderBigScore } from './big-digits.js';
import { paint } from './colors.js';
import { renderBadge, renderMetadata, renderRule, type CalloutTone } from './layout.js';
import { safeMultilineTerminalText, safeTerminalText } from './safe-text.js';
import { formatTable } from './table.js';

/**
 * Result scorecard rendering.
 *
 * A result is a data summary, not an interpreter. The only verdict shown is
 * the one the evaluation service returns in `outcome.achieved` (conversation / agent trace).
 * Scenario results carry no outcome, so the scorecard displays scores only.
 * Scores are on a 1–5 scale. Only values the payload actually contains are
 * shown: no derived recommendation, and no delta on session or trajectory
 * tables.
 */

function round(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** Two decimals, rounded half up, so score columns line up on the decimal point. */
function fixed2(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function agreementOf(input: unknown): string | undefined {
  const agreement = asObject(asObject(input)?.judge_agreement);
  const pass = num(agreement?.pass) ?? num(agreement?.agreed);
  const total = num(agreement?.total);
  return pass === undefined || total === undefined ? undefined : `${pass}/${total}`;
}

function sessionSummary(input: unknown): {
  achieved?: boolean;
  overall?: number;
  agreement?: string;
} {
  const session = asObject(input);
  const outcome = asObject(session?.outcome);
  const overall = num(session?.overall);
  const agreement = agreementOf(session);
  return {
    ...(outcome?.has_data === false || typeof outcome?.achieved !== 'boolean'
      ? {}
      : { achieved: outcome.achieved }),
    ...(overall === undefined ? {} : { overall }),
    ...(agreement === undefined ? {} : { agreement }),
  };
}

/** Metric | Score table, used for session and trajectory payloads. */
function scoreTable(
  label: 'METRIC' | 'DIMENSION',
  metrics: readonly MetricScore[],
  width?: number,
): string {
  if (metrics.length === 0) return paint.meta('No scored entries were returned');
  return formatTable(
    [
      { header: label, minWidth: 24, maxWidth: 44 },
      { header: 'SCORE', align: 'right', minWidth: 7, tone: 'input' },
    ],
    [...metrics]
      .sort((left, right) => left.score - right.score)
      .map((metric) => [safeTerminalText(metric.name), round(metric.score)]),
    width === undefined ? {} : { width },
  );
}

function subheading(title: string): string {
  return paint.header(title.toUpperCase());
}

/**
 * Render a result payload as a scorecard: outcome badge, headline metadata, and
 * a table per scored area. Returns plain stdout text so selection and copy keep
 * working.
 */
/**
 * The overall score a payload reports, or the mean of the scores it contains
 * when it reports none. Returns undefined when the payload carries no score at
 * all, so callers never plot or compare an invented value.
 */
export function resultOverallScore(results: EvaluationResults): number | undefined {
  const sessionPayload =
    results.contextType === 'conversation'
      ? results.conversation
      : results.contextType === 'agent_trace'
        ? results.agentTrace
        : undefined;
  const models =
    results.contextType === 'scenario' ? scenarioModelScores(results.modelPerformance) : [];
  const allMetrics = resultMetricScores(results);
  const sessionOverall =
    sessionPayload === undefined ? undefined : sessionSummary(sessionPayload).overall;
  return (
    sessionOverall ??
    (models.length > 0
      ? models.reduce((total, model) => total + model.mean, 0) / models.length
      : allMetrics.length > 0
        ? allMetrics.reduce((total, metric) => total + metric.score, 0) / allMetrics.length
        : undefined)
  );
}

/**
 * How wide an interval has to be before the row is flagged: at ±1.0 on a 1–5
 * scale the judge disagreed by a full scale point, so the mean stops being a
 * useful summary of the runs behind it.
 */
const WIDE_INTERVAL = 1;
const SCALE_MIN = 1;
const SCALE_MAX = 5;
const RESPONSE_PREVIEW_CHARS = 180;
const INPUT_PREVIEW_CHARS = 100;

function interval(ci95: number | undefined): string {
  return ci95 === undefined ? '' : `±${ci95.toFixed(2)}`;
}

function seconds(latencyMs: number): string {
  return `${Math.round(latencyMs / 100) / 10}s`;
}

function clip(value: string, maxChars: number): { shown: string; remaining: number } {
  const collapsed = value.replace(/\s+/gu, ' ').trim();
  if (collapsed.length <= maxChars) return { shown: collapsed, remaining: 0 };
  return {
    shown: `${collapsed.slice(0, maxChars)}…`,
    remaining: collapsed.length - maxChars,
  };
}

/** ⚠ marks an interval too wide to summarise; the note marks a full-scale span. */
function metricFlag(metric: ScenarioMetricScore): string {
  if (metric.ci95 === undefined || metric.ci95 < WIDE_INTERVAL) return '';
  const spansScale =
    metric.ci95Lower !== undefined &&
    metric.ci95Upper !== undefined &&
    metric.ci95Lower <= SCALE_MIN &&
    metric.ci95Upper >= SCALE_MAX;
  return spansScale ? '⚠ spans the scale' : '⚠';
}

/**
 * Rubric fit: one row per scored metric, alphabetical, with `overall` pinned
 * last because it aggregates the rows above it rather than sitting among them.
 * Single-run payloads have no interval, so the CI columns are dropped instead
 * of being filled with a blank.
 */
function rubricFitTable(
  metrics: readonly ScenarioMetricScore[],
  multiRun: boolean,
  width?: number,
): string {
  if (metrics.length === 0) return paint.meta('No scored metrics were returned');
  const columns = [
    { header: 'METRIC', minWidth: 24, maxWidth: 44 },
    { header: 'MEAN', align: 'right' as const, minWidth: 7, tone: 'input' as const },
    ...(multiRun
      ? [
          { header: '95% CI', align: 'right' as const, minWidth: 8, tone: 'meta' as const },
          { header: '', minWidth: 18, tone: 'warn' as const },
        ]
      : []),
  ];
  return formatTable(
    columns,
    metrics.map((metric) => [
      multiRun && metric.insufficientSamples
        ? paint.meta(`${safeTerminalText(metric.metric)} (few samples)`)
        : safeTerminalText(metric.metric),
      fixed2(metric.mean),
      ...(multiRun ? [interval(metric.ci95), metricFlag(metric)] : []),
    ]),
    width === undefined ? {} : { width },
  );
}

/** Test case | mean | 95% CI, in the order the backend indexed the cases. */
function testCaseTable(
  rows: readonly ScenarioTestCaseScore[],
  multiRun: boolean,
  width?: number,
): string {
  if (rows.length === 0) return paint.meta('No scored test cases were returned');
  const widest = Math.max(...rows.map((row) => Math.max(...row.scores.map((s) => s.ci95 ?? 0))));
  const columns = [
    { header: 'TEST CASE', minWidth: 24, maxWidth: 44 },
    { header: 'MEAN', align: 'right' as const, minWidth: 7, tone: 'input' as const },
    ...(multiRun
      ? [
          { header: '95% CI', align: 'right' as const, minWidth: 8, tone: 'meta' as const },
          { header: '', minWidth: 10, tone: 'meta' as const },
        ]
      : []),
  ];
  return formatTable(
    columns,
    rows.map((row) => {
      const mean = row.scores.reduce((total, score) => total + score.mean, 0) / row.scores.length;
      const ci95 = Math.max(...row.scores.map((score) => score.ci95 ?? 0));
      const insufficient = row.scores.some((score) => score.insufficientSamples);
      const name =
        multiRun && insufficient
          ? paint.meta(`${safeTerminalText(row.name)} (few samples)`)
          : safeTerminalText(row.name);
      // Nothing can be the widest when there is only one test case.
      const marker = rows.length > 1 && widest > 0 && ci95 === widest ? '← widest' : '';
      return [name, fixed2(mean), ...(multiRun ? [interval(ci95), marker] : [])];
    }),
    width === undefined ? {} : { width },
  );
}

function consistencyPart(reliability: ScenarioReliability): string | undefined {
  if (reliability.achievedConsistency === undefined) return undefined;
  const target =
    reliability.targetConsistency === undefined
      ? ''
      : ` (target ${reliability.targetOperator ?? '<'}${reliability.targetConsistency.toFixed(2)})`;
  return `CV ${reliability.achievedConsistency.toFixed(2)}${target}`;
}

function stopPart(reliability: ScenarioReliability): string | undefined {
  if (reliability.stoppedAtRun === undefined) return undefined;
  const planned = reliability.runsPlanned === undefined ? '' : ` of ${reliability.runsPlanned}`;
  return reliability.maxRunsReached
    ? `stopped at run ${reliability.stoppedAtRun}${planned} (max)`
    : `auto-stopped at run ${reliability.stoppedAtRun}${planned}`;
}

function confidencePart(headline: ScenarioHeadline, spans: boolean): string | undefined {
  if (headline.ci95Lower !== undefined && headline.ci95Upper !== undefined) {
    return `95% CI ${spans ? 'spans ' : ''}${round(headline.ci95Lower)}–${round(headline.ci95Upper)}`;
  }
  return headline.ci95 === undefined ? undefined : `95% CI ${interval(headline.ci95)}`;
}

function joinParts(parts: readonly (string | undefined)[]): string | undefined {
  const present = parts.filter((part): part is string => part !== undefined && part !== '');
  return present.length === 0 ? undefined : present.join(' · ');
}

/**
 * The hero. Visual weight follows trust: a score that met its consistency
 * target is rendered large, an unstable one is demoted below the warning that
 * explains why a single number would mislead, and a single run gets neither
 * treatment because it carries no reliability signal at all.
 */
function heroLines(
  headline: ScenarioHeadline,
  reliability: ScenarioReliability,
  multiRun: boolean,
): string[] {
  if (headline.mean === undefined) return [paint.heading('Overall score not available')];
  const score = round(headline.mean);

  if (!multiRun) {
    return [
      '',
      paint.heading(`${score} / 5 overall`),
      paint.meta('Single run — no reliability signal. Scores can vary from run to run.'),
      paint.meta('Run a multi-run evaluation to see confidence intervals and stability.'),
    ];
  }

  if (reliability.stable === false) {
    const runs = reliability.runsCompleted ?? headline.runs;
    const detail = joinParts([
      `overall ${score}`,
      confidencePart(headline, true),
      consistencyPart(reliability),
      stopPart(reliability),
    ]);
    return [
      '',
      paint.warn(
        `⚠  Unreliable — score did not stabilize${runs === undefined ? '' : ` across ${runs} runs`}`,
      ),
      ...(detail === undefined ? [] : [detail]),
      paint.meta('A single number misleads here. The judge disagreed most on the flagged metrics.'),
      paint.meta('Add runs or fix the prompt/judge, then re-run.'),
    ];
  }

  const detail = joinParts([
    confidencePart(headline, false),
    consistencyPart(reliability),
    stopPart(reliability),
  ]);
  return [
    '',
    ...renderBigScore(score, `/ 5 overall${reliability.stable === true ? ' · stable' : ''}`),
    ...(detail === undefined ? [] : [paint.meta(detail)]),
  ];
}

/**
 * The single strongest run the payload contains, promoted into the default
 * view: a score is easier to trust once the text behind it is visible.
 *
 * The "best of N" count is taken from the displayed test case's own runs,
 * because `best_run` is per test case/model, not eval-wide.
 */
function bestResponseLines(outputs: readonly ScenarioOutput[], multiRun: boolean): string[] {
  let best:
    | { output: ScenarioOutput; response: ScenarioOutput['responses'][number]; score: number }
    | undefined;
  for (const output of outputs) {
    for (const response of output.responses) {
      const score = response.overallScore;
      if (score === undefined) continue;
      if (best === undefined || score > best.score) best = { output, response, score };
    }
  }
  if (best === undefined) return [];
  const { response } = best;
  const runs = response.runCount;
  const header = [
    safeTerminalText(response.model),
    multiRun && response.runNumber !== undefined ? `run ${response.runNumber}` : undefined,
    `scored ${round(best.score)} / 5`,
    multiRun && runs !== undefined ? `best of ${runs} for this test case` : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(' · ');

  const lines = [subheading('Best response'), paint.heading(header)];
  if (best.output.input !== undefined) {
    lines.push(paint.meta(`"${clip(best.output.input, INPUT_PREVIEW_CHARS).shown}"  →`));
  }
  if (response.response !== undefined) {
    const { shown, remaining } = clip(response.response, RESPONSE_PREVIEW_CHARS);
    lines.push(`"${shown}"${remaining > 0 ? paint.meta(`  [+${remaining} chars]`) : ''}`);
  }
  if (response.metrics.length > 0) {
    lines.push(
      paint.meta(
        response.metrics
          .map((metric) => `${safeTerminalText(metric.metric)} ${round(metric.score)}`)
          .join(' · '),
      ),
    );
  }
  const usage = [
    response.tokens === undefined ? undefined : `${response.tokens} tokens`,
    response.cost === undefined ? undefined : `$${response.cost.toFixed(4)}`,
    response.latencyMs === undefined ? undefined : seconds(response.latencyMs),
  ].filter((part): part is string => part !== undefined);
  if (usage.length > 0) lines.push(paint.meta(`${usage.join(' · ')}  (this run)`));
  return lines;
}

/**
 * Footer totals. These sum one run per test case — the best run — so they are
 * labelled as such, and the time is summed model inference time rather than
 * wall-clock evaluation time, which runs concurrently and includes judging.
 */
function scenarioFooter(
  runs: number | undefined,
  multiRun: boolean,
  outputs: readonly ScenarioOutput[],
): string[] {
  let tokens = 0;
  let cost = 0;
  let latencyMs = 0;
  for (const output of outputs) {
    for (const response of output.responses) {
      tokens += response.tokens ?? 0;
      cost += response.cost ?? 0;
      latencyMs += response.latencyMs ?? 0;
    }
  }
  const usage = [
    tokens > 0 ? `${tokens} tokens` : undefined,
    cost > 0 ? `$${cost.toFixed(4)}` : undefined,
    latencyMs > 0 ? `${seconds(latencyMs)} model time` : undefined,
  ].filter((part): part is string => part !== undefined);
  if (usage.length === 0) {
    return runs === undefined || !multiRun ? [] : [paint.meta(`${runs} runs`)];
  }
  // A single run's only response already carries these exact usage figures.
  // Repeating them here adds no information; the caller's command hint follows.
  if (!multiRun) return [];
  return [
    ...(runs === undefined ? [] : [paint.meta(`${runs} runs`)]),
    paint.meta(`best run per test case: ${usage.join(' · ')}`),
  ];
}

/**
 * Scenario scorecard: a hero whose weight matches how much the score can be
 * trusted, the rubric and test-case breakdowns behind it, and the best response
 * the run produced. Every number is read from the payload.
 */
function renderScenarioScorecard(
  results: ScenarioResults,
  width?: number,
  options: { showOutputs?: boolean; status?: JsonObject } = {},
): string {
  const headline = scenarioHeadline(results.modelPerformance, results.scenarioComparison);
  const perModel = scenarioMetricScores(results.modelPerformance);
  const primary = perModel.find((model) => model.isPrimary) ?? perModel[0];
  const testCases = scenarioTestCaseScores(results.scenarioComparison);
  const reliability = scenarioReliability(options.status);
  const outputs = scenarioOutputs(results.modelResponses);
  const multiRun = reliability.multiRun && (headline.runs ?? 2) > 1;

  // `overall` aggregates the metrics above it, so it is appended last rather
  // than sorted among them.
  const metrics: ScenarioMetricScore[] = [
    ...(primary?.metrics ?? []),
    ...(headline.mean === undefined
      ? []
      : [
          {
            metric: 'overall',
            mean: headline.mean,
            ...(headline.ci95 === undefined ? {} : { ci95: headline.ci95 }),
            ...(headline.ci95Lower === undefined ? {} : { ci95Lower: headline.ci95Lower }),
            ...(headline.ci95Upper === undefined ? {} : { ci95Upper: headline.ci95Upper }),
          },
        ]),
  ];

  const context = [
    'scenario',
    headline.primaryModel === undefined
      ? undefined
      : `${safeTerminalText(headline.primaryModel)} (primary)`,
    headline.testCases === undefined
      ? undefined
      : `${headline.testCases} test ${headline.testCases === 1 ? 'case' : 'cases'}`,
    headline.runs === undefined
      ? undefined
      : `${headline.runs} ${headline.runs === 1 ? 'run' : 'runs'}`,
    primary === undefined
      ? undefined
      : `${primary.metrics.length} ${primary.metrics.length === 1 ? 'metric' : 'metrics'}`,
  ].filter((part): part is string => part !== undefined);

  const body: string[] = [
    subheading('Rubric fit'),
    rubricFitTable(metrics, multiRun, width),
    '',
    subheading('Test cases'),
    testCaseTable(testCases, multiRun, width),
    '',
  ];
  const responses = options.showOutputs
    ? renderScenarioOutputs(results).replace(/\n+$/u, '').split('\n')
    : bestResponseLines(outputs, multiRun);
  if (responses.length > 0) body.push(...responses, '');
  body.push(...scenarioFooter(headline.runs, multiRun, outputs));

  return [
    ...heroLines(headline, reliability, multiRun),
    renderRule(width).replace(/\n$/u, ''),
    renderMetadata([['Context', context.join(paint.meta(' · '))]], width).replace(/\n$/u, ''),
    '',
    ...body,
    '',
  ].join('\n');
}

export function renderResultScorecard(
  results: EvaluationResults,
  width?: number,
  options: { showOutputs?: boolean; scenarioStatus?: JsonObject } = {},
): string {
  if (results.contextType === 'scenario') {
    return renderScenarioScorecard(results, width, {
      showOutputs: options.showOutputs === true,
      ...(options.scenarioStatus === undefined ? {} : { status: options.scenarioStatus }),
    });
  }

  const sessionPayload =
    results.contextType === 'conversation' ? results.conversation : results.agentTrace;
  const session = sessionSummary(sessionPayload);
  const sessionMetrics = sessionMetricScores(sessionPayload);
  const trajectoryPayload =
    results.contextType === 'agent_trace' && results.trajectory?.has_trajectory !== false
      ? results.trajectory
      : undefined;
  const trajectoryMetrics = trajectoryMetricScores(trajectoryPayload);
  const trajectoryScore = num(asObject(trajectoryPayload)?.trajectory_score);
  const trajectoryAgreement = agreementOf(trajectoryPayload);
  const allMetrics = resultMetricScores(results);

  const overall = resultOverallScore(results);

  const verdict =
    session.achieved === undefined
      ? undefined
      : session.achieved
        ? { label: 'Pass', tone: 'pass' as CalloutTone }
        : { label: 'Fail', tone: 'fail' as CalloutTone };

  const badge = verdict === undefined ? '' : `${renderBadge(verdict.tone, verdict.label)}  `;
  // When a score exists it leads the card as large block digits; the plain
  // text line remains the fallback for payloads without an overall score.
  const headline = `${badge}${paint.heading(
    overall === undefined ? 'Overall score not available' : 'Overall score',
  )}`;
  const bigScore =
    overall === undefined ? [] : ['', ...renderBigScore(round(overall), '/ 5 overall')];

  const entries: [string, string][] = [['Context', safeTerminalText(results.contextType)]];
  if (session.agreement) entries.push(['Judge agreement', session.agreement]);
  entries.push(['Metrics scored', String(allMetrics.length)]);

  const body: string[] = [
    subheading('Session evaluation'),
    scoreTable('METRIC', sessionMetrics, width),
  ];
  if (results.contextType === 'agent_trace') {
    const trajectoryHeader: [string, string][] = [];
    if (trajectoryScore !== undefined) {
      trajectoryHeader.push(['Trajectory score', `${round(trajectoryScore)} / 5`]);
    }
    if (trajectoryAgreement) trajectoryHeader.push(['Judge agreement', trajectoryAgreement]);
    body.push('', subheading('Trajectory evaluation'));
    if (trajectoryPayload === undefined) {
      body.push(paint.meta('No trajectory evaluation was returned'));
    } else {
      if (trajectoryHeader.length > 0) {
        body.push(renderMetadata(trajectoryHeader, width).replace(/\n$/u, ''), '');
      }
      body.push(scoreTable('DIMENSION', trajectoryMetrics, width));
    }
  }

  return [
    headline,
    ...bigScore,
    renderRule(width).replace(/\n$/u, ''),
    renderMetadata(entries, width).replace(/\n$/u, ''),
    '',
    ...body,
    '',
  ].join('\n');
}

/**
 * Per-test-case model outputs. Verbose by nature, so `autoeval results` keeps
 * the scorecard to one screen and renders this only behind `--show-outputs`.
 */
export function renderScenarioOutputs(results: ScenarioResults): string {
  const outputs = [...scenarioOutputs(results.modelResponses)].sort(
    (left, right) => left.index - right.index,
  );
  if (outputs.length === 0) return '';
  const lines: string[] = [subheading('Best response — every test case'), ''];
  for (const output of outputs) {
    lines.push(paint.heading(safeTerminalText(output.name)));
    if (output.input !== undefined) {
      lines.push(paint.meta('Input'), safeMultilineTerminalText(output.input), '');
    }
    for (const response of output.responses) {
      const score =
        response.overallScore === undefined ? '' : ` — ${round(response.overallScore)} / 5`;
      lines.push(`${paint.input(safeTerminalText(response.model))}${score}`);
      if (response.response !== undefined) {
        lines.push(safeMultilineTerminalText(response.response));
      }
      if (response.metrics.length > 0) {
        lines.push(
          paint.meta(
            response.metrics
              .map((metric) => `${safeTerminalText(metric.metric)} ${round(metric.score)}`)
              .join(' · '),
          ),
        );
      }
      const usage = [
        response.tokens === undefined ? undefined : `${response.tokens} tokens`,
        response.cost === undefined ? undefined : `$${response.cost.toFixed(4)}`,
        response.latencyMs === undefined
          ? undefined
          : `${Math.round(response.latencyMs / 100) / 10}s`,
      ].filter((part): part is string => part !== undefined);
      if (usage.length > 0) lines.push(paint.meta(usage.join(' · ')));
      lines.push('');
    }
  }
  return `${lines.join('\n').replace(/\n+$/u, '')}\n`;
}
