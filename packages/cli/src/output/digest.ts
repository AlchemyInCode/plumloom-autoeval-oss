import type { JsonObject } from '../domain/common.js';
import type { Evaluation, EvaluationResults, ScenarioResults } from '../domain/types.js';
import { safeTerminalText } from '../output/safe-text.js';

/**
 * Deterministic, bounded digests over already-validated Autoeval payloads.
 *
 * These helpers only read fields that are present and omit everything else, so
 * a digest can never assert a detail the backend did not return. They perform
 * no network access and no inference.
 */

export const MAX_DIGEST_CHARS = 4_000;

const MAX_LISTED_SCENARIOS = 20;
const MAX_LISTED_MODELS = 12;
const MAX_LISTED_STEPS = 20;
const MAX_LISTED_MESSAGES = 20;
const MAX_LISTED_DOCUMENTS = 10;
const MAX_TEXT_CHARS = 160;
const MAX_NAME_CHARS = 120;
/** The judge rubric drives every score, so it is kept far longer than other prose. */
const MAX_RUBRIC_CHARS = 1_200;
const MAX_PROMPT_CHARS = 600;

function asObject(input: unknown): Record<string, unknown> | undefined {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : undefined;
}

function asArray(input: unknown): unknown[] {
  return Array.isArray(input) ? input : [];
}

function text(input: unknown, maxChars = MAX_TEXT_CHARS): string | undefined {
  if (typeof input !== 'string') return undefined;
  const trimmed = input.trim();
  if (trimmed.length === 0) return undefined;
  const clipped = trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}…` : trimmed;
  return safeTerminalText(clipped);
}

function num(input: unknown): number | undefined {
  return typeof input === 'number' && Number.isFinite(input) ? input : undefined;
}

function round(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/u, '');
}

function stringList(input: unknown, limit = MAX_LISTED_MODELS): string | undefined {
  const values = asArray(input)
    .map((value) => text(value, MAX_NAME_CHARS))
    .filter((value): value is string => value !== undefined);
  if (values.length === 0) return undefined;
  const shown = values.slice(0, limit);
  const suffix = values.length > shown.length ? `, … (${values.length} total)` : '';
  return `${shown.join(', ')}${suffix}`;
}

function bound(lines: string[]): string {
  const rendered = lines.join('\n');
  return rendered.length > MAX_DIGEST_CHARS ? `${rendered.slice(0, MAX_DIGEST_CHARS)}…` : rendered;
}

function pushField(lines: string[], label: string, value: string | undefined): void {
  if (value !== undefined) lines.push(`  ${label}: ${value}`);
}

function parsedEvaluatorInstructions(input: unknown): Record<string, unknown> | undefined {
  const direct = asObject(input);
  if (direct) return direct;

  const raw = typeof input === 'string' ? input.trim() : undefined;
  if (!raw) return undefined;
  try {
    return asObject(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

function qualityStandardName(configuration: Record<string, unknown>): string | undefined {
  return (
    text(configuration.quality_standard_name, MAX_NAME_CHARS) ??
    text(asObject(configuration.quality_standard)?.name, MAX_NAME_CHARS) ??
    text(configuration.quality_standard_id, MAX_NAME_CHARS) ??
    text(parsedEvaluatorInstructions(configuration.evaluator_instructions)?.name, MAX_NAME_CHARS) ??
    text(
      parsedEvaluatorInstructions(configuration.evaluator_instructions)?.quality_standard_name,
      MAX_NAME_CHARS,
    )
  );
}

function qualityStandardAnchorCount(configuration: Record<string, unknown>): number | undefined {
  const directAnchors = asArray(asObject(configuration.quality_standard)?.anchors);
  if (directAnchors.length > 0) return directAnchors.length;
  const parsedAnchors = asArray(
    parsedEvaluatorInstructions(configuration.evaluator_instructions)?.anchors,
  );
  return parsedAnchors.length > 0 ? parsedAnchors.length : undefined;
}

function judgeModel(configuration: Record<string, unknown>): string | undefined {
  return (
    text(configuration.judge_model, MAX_NAME_CHARS) ??
    text(configuration.judge_model_id, MAX_NAME_CHARS) ??
    text(configuration.judge_llm, MAX_NAME_CHARS) ??
    text(configuration.judgeModel, MAX_NAME_CHARS) ??
    text(
      parsedEvaluatorInstructions(configuration.evaluator_instructions)?.judge_model,
      MAX_NAME_CHARS,
    ) ??
    text(
      parsedEvaluatorInstructions(configuration.evaluator_instructions)?.judge_model_id,
      MAX_NAME_CHARS,
    )
  );
}

/** Extracts the Quality Standard prose from the evaluator instructions field. */
function qualityStandard(input: unknown): string | undefined {
  const raw = typeof input === 'string' ? input.trim() : undefined;
  if (!raw) return undefined;
  if (raw.startsWith('{')) {
    try {
      const parsed = asObject(JSON.parse(raw));
      const instructions = text(parsed?.judge_instructions, MAX_RUBRIC_CHARS);
      if (instructions) return instructions;
    } catch {
      // Not JSON: fall through and use the raw prose.
    }
  }
  return text(raw, MAX_RUBRIC_CHARS);
}

function evaluationName(evaluation: Evaluation): string | undefined {
  for (const candidate of [evaluation.configuration, evaluation.raw] as JsonObject[]) {
    for (const key of ['evaluation_name', 'evaluationName', 'eval_name', 'name']) {
      const value = text(candidate[key], MAX_NAME_CHARS);
      if (value) return value;
    }
  }
  return undefined;
}

/** First present string field, so digests survive backend field-name variation. */
function firstText(
  source: Record<string, unknown>,
  keys: readonly string[],
  maxChars = MAX_TEXT_CHARS,
): string | undefined {
  for (const key of keys) {
    const value = text(source[key], maxChars);
    if (value) return value;
  }
  return undefined;
}

function overflowLine(total: number, shown: number, noun: string): string[] {
  return total > shown ? [`    … ${total - shown} more ${noun}`] : [];
}

function scenarioLines(configuration: Record<string, unknown>): string[] {
  const scenarios = asArray(configuration.scenarios);
  if (scenarios.length === 0) return [];
  const lines = [`  Scenarios (${scenarios.length}):`];
  for (const [index, rawScenario] of scenarios.slice(0, MAX_LISTED_SCENARIOS).entries()) {
    const scenario = asObject(rawScenario);
    if (!scenario) continue;
    const name = text(scenario.name, MAX_NAME_CHARS) ?? text(scenario.id, MAX_NAME_CHARS);
    const id = text(scenario.id, MAX_NAME_CHARS);
    const heading = name
      ? `${name}${id && id !== name ? ` (${id})` : ''}`
      : `Scenario ${index + 1}`;
    lines.push(`    ${index + 1}. ${heading}`);
    const prompt = text(scenario.prompt);
    if (prompt) lines.push(`       Prompt: ${prompt}`);
    const expected = text(scenario.expected);
    if (expected) lines.push(`       Expected: ${expected}`);
  }
  lines.push(...overflowLine(scenarios.length, MAX_LISTED_SCENARIOS, 'scenarios'));
  return lines;
}

function referenceDocumentLines(configuration: Record<string, unknown>): string[] {
  const documents = asArray(configuration.reference_documents);
  if (documents.length === 0) return [];
  const lines = [`  Reference documents (${documents.length}):`];
  for (const [index, rawDocument] of documents.slice(0, MAX_LISTED_DOCUMENTS).entries()) {
    const document = asObject(rawDocument);
    const label = document
      ? firstText(document, ['name', 'title', 'filename', 'id'], MAX_NAME_CHARS)
      : text(rawDocument, MAX_NAME_CHARS);
    lines.push(`    ${index + 1}. ${label ?? `Document ${index + 1}`}`);
  }
  lines.push(...overflowLine(documents.length, MAX_LISTED_DOCUMENTS, 'documents'));
  return lines;
}

/** Agent-trace inputs: the steps the judge scores, with any tool calls. */
function traceStepLines(configuration: Record<string, unknown>): string[] {
  const steps = asArray(configuration.steps);
  if (steps.length === 0) return [];
  const lines = [`  Trace steps (${steps.length}):`];
  for (const [index, rawStep] of steps.slice(0, MAX_LISTED_STEPS).entries()) {
    const step = asObject(rawStep);
    if (!step) continue;
    const role = firstText(step, ['role', 'actor', 'type', 'step_type'], MAX_NAME_CHARS);
    const tool = firstText(step, ['tool', 'tool_name', 'action', 'function'], MAX_NAME_CHARS);
    const content = firstText(step, ['content', 'text', 'message', 'input', 'output', 'thought']);
    const heading = [role ?? `Step ${index + 1}`, tool ? `tool ${tool}` : undefined]
      .filter((part): part is string => part !== undefined)
      .join(' — ');
    lines.push(`    ${index + 1}. ${heading}`);
    if (content) lines.push(`       ${content}`);
  }
  lines.push(...overflowLine(steps.length, MAX_LISTED_STEPS, 'steps'));
  return lines;
}

/** Conversation inputs: the turns the judge scores. */
function conversationLines(configuration: Record<string, unknown>): string[] {
  const messages = asArray(configuration.messages);
  if (messages.length === 0) return [];
  const lines = [`  Conversation turns (${messages.length}):`];
  for (const [index, rawMessage] of messages.slice(0, MAX_LISTED_MESSAGES).entries()) {
    const message = asObject(rawMessage);
    if (!message) continue;
    const role = firstText(message, ['role', 'speaker', 'actor'], MAX_NAME_CHARS) ?? 'turn';
    const content = firstText(message, ['content', 'text', 'message']);
    lines.push(`    ${index + 1}. ${role}${content ? `: ${content}` : ''}`);
  }
  lines.push(...overflowLine(messages.length, MAX_LISTED_MESSAGES, 'turns'));
  return lines;
}

/**
 * Summarises the validated evaluation configuration — the evaluation's inputs —
 * for display and reasoning. The sections shown depend on the context type, so
 * the consumer sees the material the judge actually scored.
 */
export function summarizeEvaluationConfiguration(evaluation: Evaluation): string {
  const configuration = evaluation.configuration as Record<string, unknown>;
  const lines: string[] = ['Configuration summary:'];

  pushField(lines, 'Name', evaluationName(evaluation));
  pushField(lines, 'Context', safeTerminalText(evaluation.contextType));
  pushField(lines, 'Judge model', judgeModel(configuration));
  pushField(lines, 'Primary model', text(configuration.primary_model, MAX_NAME_CHARS));
  pushField(lines, 'Comparison models', stringList(configuration.comparison_models));
  const temperature = num(configuration.temperature);
  pushField(lines, 'Temperature', temperature === undefined ? undefined : round(temperature));
  pushField(lines, 'Selected metrics', stringList(configuration.selected_metrics, 20));
  pushField(lines, 'Quality standard', qualityStandardName(configuration));
  const anchorCount = qualityStandardAnchorCount(configuration);
  pushField(
    lines,
    'Quality standard anchors',
    anchorCount === undefined ? undefined : String(anchorCount),
  );
  pushField(lines, 'Judge rubric', qualityStandard(configuration.evaluator_instructions));
  pushField(lines, 'Prompt', text(configuration.prompt_text, MAX_PROMPT_CHARS));
  const turnCount = num(configuration.turn_count);
  pushField(lines, 'Turns', turnCount === undefined ? undefined : String(turnCount));
  pushField(lines, 'Expected outcome', text(configuration.expected_outcome, MAX_PROMPT_CHARS));

  if (evaluation.contextType === 'agent_trace') {
    lines.push(...traceStepLines(configuration));
  } else if (evaluation.contextType === 'conversation') {
    lines.push(...conversationLines(configuration));
  } else {
    lines.push(...scenarioLines(configuration));
  }
  lines.push(...referenceDocumentLines(configuration));

  if (lines.length === 1) lines.push('  No configuration details were returned');
  return bound(lines);
}

type ModelScore = {
  name: string;
  mean: number;
  sampleSize?: number;
  runs?: number;
  isPrimary?: boolean;
};

function modelLabel(model: Record<string, unknown>): string | undefined {
  return text(model.display_name, MAX_NAME_CHARS) ?? text(model.model_key, MAX_NAME_CHARS);
}

/** Per-model overall means from the model-performance payload. */
export function scenarioModelScores(modelPerformance: JsonObject): ModelScore[] {
  return asArray(modelPerformance.models).flatMap((rawModel) => {
    const model = asObject(rawModel);
    if (!model) return [];
    const overall = asObject(asObject(model.scores)?.overall);
    const mean = num(overall?.mean);
    const name = modelLabel(model);
    if (mean === undefined || !name || overall?.has_data === false) return [];
    const sampleSize = num(overall?.sample_size);
    const runs = num(model.n_runs);
    return [
      {
        name,
        mean,
        ...(sampleSize === undefined ? {} : { sampleSize }),
        ...(runs === undefined ? {} : { runs }),
        ...(typeof model.is_primary === 'boolean' ? { isPrimary: model.is_primary } : {}),
      },
    ];
  });
}

/** One metric of one model, with the interval the payload reported. */
export type ScenarioMetricScore = {
  metric: string;
  mean: number;
  ci95?: number;
  ci95Lower?: number;
  ci95Upper?: number;
  sampleSize?: number;
  insufficientSamples?: boolean;
};

export type ScenarioModelMetrics = {
  model: string;
  isPrimary?: boolean;
  runs?: number;
  metrics: ScenarioMetricScore[];
};

/**
 * Per-metric means for each scored model. `overall` is an aggregate of the
 * other metrics, so it is excluded here and reported separately as the headline
 * score. Metrics the payload marks without data are dropped, never defaulted.
 */
export function scenarioMetricScores(modelPerformance: JsonObject): ScenarioModelMetrics[] {
  return asArray(modelPerformance.models).flatMap((rawModel) => {
    const model = asObject(rawModel);
    const name = model ? modelLabel(model) : undefined;
    const scores = asObject(model?.scores);
    if (!model || !name || !scores) return [];
    const metrics = Object.entries(scores).flatMap(([metricName, rawScore]) => {
      if (metricName === 'overall') return [];
      const score = asObject(rawScore);
      const mean = num(score?.mean);
      const label = text(metricName, MAX_NAME_CHARS);
      if (!label || mean === undefined || score?.has_data === false) return [];
      const ci95 = num(score?.ci95);
      const ci95Lower = num(score?.ci95_lower);
      const ci95Upper = num(score?.ci95_upper);
      const sampleSize = num(score?.sample_size);
      return [
        {
          metric: label,
          mean,
          ...(ci95 === undefined ? {} : { ci95 }),
          ...(ci95Lower === undefined ? {} : { ci95Lower }),
          ...(ci95Upper === undefined ? {} : { ci95Upper }),
          ...(sampleSize === undefined ? {} : { sampleSize }),
          ...(score?.insufficient_samples === true ? { insufficientSamples: true } : {}),
        },
      ];
    });
    if (metrics.length === 0) return [];
    metrics.sort((left, right) => left.metric.localeCompare(right.metric));
    const runs = num(model.n_runs);
    return [
      {
        model: name,
        metrics,
        ...(runs === undefined ? {} : { runs }),
        ...(typeof model.is_primary === 'boolean' ? { isPrimary: model.is_primary } : {}),
      },
    ];
  });
}

export type ScenarioTestCaseScore = {
  name: string;
  index: number;
  scores: { model: string; mean: number; ci95?: number; insufficientSamples?: boolean }[];
};

/**
 * Per-test-case means in the order the backend indexed them, so repeated runs
 * of the same evaluation always list the cases identically.
 */
export function scenarioTestCaseScores(scenarioComparison: JsonObject): ScenarioTestCaseScore[] {
  const rows = asArray(scenarioComparison.scenarios).flatMap((rawScenario, position) => {
    const scenario = asObject(rawScenario);
    if (!scenario) return [];
    const index = num(scenario.scenario_index) ?? position;
    const name =
      text(scenario.scenario_name, MAX_NAME_CHARS) ??
      text(scenario.scenario_id, MAX_NAME_CHARS) ??
      `Test case ${index + 1}`;
    const scores = asArray(scenario.model_scores).flatMap((rawScore) => {
      const entry = asObject(rawScore);
      const score = asObject(entry?.score);
      const mean = num(score?.mean);
      const model = entry ? modelLabel(entry) : undefined;
      if (!model || mean === undefined || score?.has_data === false) return [];
      const ci95 = num(score?.ci95);
      return [
        {
          model,
          mean,
          ...(ci95 === undefined ? {} : { ci95 }),
          ...(score?.insufficient_samples === true ? { insufficientSamples: true } : {}),
        },
      ];
    });
    return scores.length === 0 ? [] : [{ name, index, scores }];
  });
  return rows.sort((left, right) => left.index - right.index);
}

export type ScenarioHeadline = {
  mean?: number;
  ci95?: number;
  ci95Lower?: number;
  ci95Upper?: number;
  runs?: number;
  testCases?: number;
  primaryModel?: string;
};

/** Headline numbers for a scenario run, read straight from the payloads. */
export function scenarioHeadline(
  modelPerformance: JsonObject,
  scenarioComparison: JsonObject,
): ScenarioHeadline {
  const models = asArray(modelPerformance.models)
    .map((rawModel) => asObject(rawModel))
    .filter((model): model is Record<string, unknown> => model !== undefined);
  const primary = models.find((model) => model.is_primary === true) ?? models[0];
  const overall = asObject(asObject(primary?.scores)?.overall);
  const summary = asObject(scenarioComparison.evaluation_summary);
  const mean = num(overall?.mean) ?? num(summary?.overall_mean);
  const ci95 = num(overall?.ci95) ?? num(summary?.overall_ci);
  const ci95Lower = num(overall?.ci95_lower) ?? num(summary?.overall_ci_lower);
  const ci95Upper = num(overall?.ci95_upper) ?? num(summary?.overall_ci_upper);
  const runs = num(primary?.n_runs) ?? num(overall?.sample_size);
  const testCases = num(summary?.test_case_count) ?? asArray(scenarioComparison.scenarios).length;
  const primaryModel = primary ? modelLabel(primary) : undefined;
  return {
    ...(mean === undefined ? {} : { mean }),
    ...(ci95 === undefined ? {} : { ci95 }),
    ...(ci95Lower === undefined ? {} : { ci95Lower }),
    ...(ci95Upper === undefined ? {} : { ci95Upper }),
    ...(runs === undefined ? {} : { runs }),
    ...(testCases ? { testCases } : {}),
    ...(primaryModel === undefined ? {} : { primaryModel }),
  };
}

export type ScenarioConvergence = {
  headline?: string;
  consistencyTarget?: string;
  observedVariation?: number;
  autoStopRun?: number;
  runsPlanned?: number;
  judgesPerOutput?: number;
  targetMet?: boolean;
};

const CONVERGENCE_KEYS = ['convergence', 'evaluation_status', 'reliability', 'stability'] as const;

/**
 * The Evaluation Status card's own numbers. Nothing here is derived: when the
 * backend does not report convergence detail the block is omitted entirely,
 * because a variation figure recomputed from a standard deviation would be a
 * different statistic wearing the same label.
 */
export function scenarioConvergence(
  ...payloads: readonly (JsonObject | undefined)[]
): ScenarioConvergence {
  for (const payload of payloads) {
    if (payload === undefined) continue;
    // A status payload may carry the detail nested or at its top level.
    const candidates = [...CONVERGENCE_KEYS.map((key) => asObject(payload[key])), payload];
    for (const source of candidates) {
      if (!source) continue;
      const observedVariation = num(source.observed_variation) ?? num(source.observed_cv);
      const autoStopRun = num(source.auto_stop_run) ?? num(source.stopped_after_run);
      const runsPlanned = num(source.runs_planned) ?? num(source.max_runs);
      const judgesPerOutput = num(source.judges_per_output) ?? num(source.judge_count);
      const targetMet =
        typeof source.target_met === 'boolean'
          ? source.target_met
          : typeof source.is_stable === 'boolean'
            ? source.is_stable
            : undefined;
      const headline = text(source.headline ?? source.message, MAX_NAME_CHARS);
      const consistencyTarget = text(source.consistency_target ?? source.target, MAX_NAME_CHARS);
      const detail: ScenarioConvergence = {
        ...(headline === undefined ? {} : { headline }),
        ...(consistencyTarget === undefined ? {} : { consistencyTarget }),
        ...(observedVariation === undefined ? {} : { observedVariation }),
        ...(autoStopRun === undefined ? {} : { autoStopRun }),
        ...(runsPlanned === undefined ? {} : { runsPlanned }),
        ...(judgesPerOutput === undefined ? {} : { judgesPerOutput }),
        ...(targetMet === undefined ? {} : { targetMet }),
      };
      if (Object.keys(detail).length > 0) return detail;
    }
  }
  return {};
}

/**
 * The reliability figures the evaluation service reports for a multi-run scenario.
 *
 * `multiRun` is decided by the presence of `achievedConsistency`, and the
 * stability verdict compares that reported figure against the reported target
 * with the reported operator. Nothing here is recomputed from standard
 * deviations, and the coarse `consistency_level` enum is deliberately ignored.
 */
export type ScenarioReliability = {
  multiRun: boolean;
  achievedConsistency?: number;
  targetConsistency?: number;
  targetOperator?: string;
  stable?: boolean;
  runsCompleted?: number;
  runsPlanned?: number;
  stoppedAtRun?: number;
  autoStopTriggered?: boolean;
  maxRunsReached?: boolean;
};

const RELIABILITY_KEYS = ['evaluationMetrics', 'evaluation_metrics'] as const;

function meetsTarget(achieved: number, operator: string, target: number): boolean {
  if (operator === '<=') return achieved <= target;
  if (operator === '>') return achieved > target;
  if (operator === '>=') return achieved >= target;
  return achieved < target;
}

/** Reliability detail read from the run status payload, or `multiRun: false`. */
export function scenarioReliability(status: JsonObject | undefined): ScenarioReliability {
  const roots = [asObject(status), asObject(asObject(status)?.status)];
  for (const root of roots) {
    if (!root) continue;
    for (const key of RELIABILITY_KEYS) {
      const source = asObject(root[key]);
      const achievedConsistency =
        num(source?.achievedConsistency) ?? num(source?.achieved_consistency);
      if (!source || achievedConsistency === undefined) continue;
      const targetConsistency = num(source.targetConsistency) ?? num(source.target_consistency);
      const targetOperator =
        text(source.targetConsistencyOperator ?? source.target_consistency_operator, 4) ?? '<';
      const autoStop = asObject(source.autoStopTriggered ?? source.auto_stop_triggered);
      const autoStopTriggered =
        typeof autoStop?.triggered === 'boolean'
          ? autoStop.triggered
          : typeof source.autoStopTriggered === 'boolean'
            ? source.autoStopTriggered
            : undefined;
      const reason = text(autoStop?.reason, MAX_NAME_CHARS);
      const runsCompleted = num(source.runsCompleted) ?? num(source.runs_completed);
      const runsPlanned =
        num(source.runsPlanned) ?? num(source.runs_planned) ?? num(source.maxRuns);
      const stoppedAtRun =
        num(autoStop?.atRun) ?? num(autoStop?.at_run) ?? num(autoStop?.runNumber) ?? runsCompleted;
      const maxRunsReached =
        reason === 'MAX_RUNS_REACHED' ||
        (autoStopTriggered === false &&
          runsCompleted !== undefined &&
          runsCompleted === runsPlanned);
      return {
        multiRun: true,
        achievedConsistency,
        targetOperator,
        ...(targetConsistency === undefined ? {} : { targetConsistency }),
        ...(targetConsistency === undefined
          ? {}
          : { stable: meetsTarget(achievedConsistency, targetOperator, targetConsistency) }),
        ...(runsCompleted === undefined ? {} : { runsCompleted }),
        ...(runsPlanned === undefined ? {} : { runsPlanned }),
        ...(stoppedAtRun === undefined ? {} : { stoppedAtRun }),
        ...(autoStopTriggered === undefined ? {} : { autoStopTriggered }),
        ...(maxRunsReached ? { maxRunsReached: true } : {}),
      };
    }
  }
  return { multiRun: false };
}

export type ScenarioOutput = {
  name: string;
  index: number;
  input?: string;
  responses: {
    model: string;
    response?: string;
    overallScore?: number;
    runNumber?: number;
    runCount?: number;
    metrics: { metric: string; score: number }[];
    tokens?: number;
    cost?: number;
    latencyMs?: number;
  }[];
  detailsUrl?: string;
};

const MAX_OUTPUT_CHARS = 2_000;

/** Per-test-case model outputs, shown only when the user asks for them. */
export function scenarioOutputs(modelResponses: JsonObject): ScenarioOutput[] {
  return asArray(modelResponses.outputs).flatMap((rawOutput, position) => {
    const output = asObject(rawOutput);
    if (!output) return [];
    const index = num(output.scenario_index) ?? position;
    const name = text(output.scenario_name, MAX_NAME_CHARS) ?? `Test case ${index + 1}`;
    const input = text(output.input, MAX_OUTPUT_CHARS);
    const detailsUrl = text(asObject(output.actions)?.view_details_url, MAX_NAME_CHARS);
    const responses = asArray(output.model_responses).flatMap((rawResponse) => {
      const response = asObject(rawResponse);
      const model = response ? modelLabel(response) : undefined;
      if (!model) return [];
      const bestRun = asObject(response?.best_run);
      const metadata = asObject(bestRun?.metadata);
      const metrics = Object.entries(asObject(response?.metric_scores) ?? {}).flatMap(
        ([metricName, rawScore]) => {
          const score = num(rawScore);
          const label = text(metricName, MAX_NAME_CHARS);
          return !label || score === undefined ? [] : [{ metric: label, score }];
        },
      );
      metrics.sort((left, right) => left.metric.localeCompare(right.metric));
      const overallScore = num(bestRun?.overall_score);
      // Usage may sit on the run metadata, the run itself, or the response.
      const usage = [metadata, bestRun, response];
      const pick = (...keys: readonly string[]): number | undefined => {
        for (const source of usage) {
          for (const key of keys) {
            const value = num(source?.[key]);
            if (value !== undefined) return value;
          }
        }
        return undefined;
      };
      const tokens = pick('total_tokens', 'tokens');
      const cost = pick('cost', 'total_cost');
      const latencyMs = pick('latency_ms', 'duration_ms');
      const responseText = text(bestRun?.response, MAX_OUTPUT_CHARS);
      const runNumber = num(bestRun?.run_number);
      const runCount =
        num(response?.run_count) ??
        num(response?.total_runs) ??
        num(response?.n_runs) ??
        (asArray(response?.runs).length > 0 ? asArray(response?.runs).length : undefined);
      return [
        {
          model,
          metrics,
          ...(responseText === undefined ? {} : { response: responseText }),
          ...(overallScore === undefined ? {} : { overallScore }),
          ...(runNumber === undefined ? {} : { runNumber }),
          ...(runCount === undefined ? {} : { runCount }),
          ...(tokens === undefined ? {} : { tokens }),
          ...(cost === undefined ? {} : { cost }),
          ...(latencyMs === undefined ? {} : { latencyMs }),
        },
      ];
    });
    return [
      {
        name,
        index,
        responses,
        ...(input === undefined ? {} : { input }),
        ...(detailsUrl === undefined ? {} : { detailsUrl }),
      },
    ];
  });
}

type ScenarioRow = {
  name: string;
  scores: { model: string; mean: number }[];
};

function modelLabels(modelPerformance: JsonObject): Map<string, string> {
  const labels = new Map<string, string>();
  for (const rawModel of asArray(modelPerformance.models)) {
    const model = asObject(rawModel);
    const key = text(model?.model_key, MAX_NAME_CHARS);
    const label = text(model?.display_name, MAX_NAME_CHARS);
    if (key && label) labels.set(key, label);
  }
  return labels;
}

function scenarioRows(scenarioComparison: JsonObject, labels: Map<string, string>): ScenarioRow[] {
  return asArray(scenarioComparison.scenarios).flatMap((rawScenario, index) => {
    const scenario = asObject(rawScenario);
    if (!scenario) return [];
    const name =
      text(scenario.scenario_name, MAX_NAME_CHARS) ??
      text(scenario.scenario_id, MAX_NAME_CHARS) ??
      `Scenario ${index + 1}`;
    const scores = asArray(scenario.model_scores).flatMap((rawScore) => {
      const score = asObject(rawScore);
      const mean = num(asObject(score?.score)?.mean);
      const rawLabel = score ? modelLabel(score) : undefined;
      const model = rawLabel ? (labels.get(rawLabel) ?? rawLabel) : undefined;
      return mean === undefined || !model ? [] : [{ model, mean }];
    });
    return scores.length === 0 ? [] : [{ name, scores }];
  });
}

function rowMean(row: ScenarioRow): number {
  return row.scores.reduce((total, score) => total + score.mean, 0) / row.scores.length;
}

function modelPerformanceLines(modelPerformance: JsonObject): string[] {
  const scores = scenarioModelScores(modelPerformance);
  if (scores.length === 0) return ['Model performance: no scored models were returned'];
  const sorted = [...scores].sort((left, right) => right.mean - left.mean);
  const lines = ['Model performance:'];
  for (const score of sorted.slice(0, MAX_LISTED_MODELS)) {
    const details = [
      score.isPrimary ? 'primary' : undefined,
      score.sampleSize === undefined ? undefined : `sample size ${score.sampleSize}`,
      score.runs === undefined ? undefined : `${score.runs} runs`,
    ].filter((detail): detail is string => detail !== undefined);
    lines.push(
      `  ${score.name} — overall mean ${round(score.mean)}${details.length > 0 ? ` (${details.join(', ')})` : ''}`,
    );
  }
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  if (best && worst && sorted.length > 1) {
    lines.push(
      `  Best: ${best.name} (${round(best.mean)}); weakest: ${worst.name} (${round(worst.mean)}); spread ${round(best.mean - worst.mean)}`,
    );
  }
  return lines;
}

function scenarioComparisonLines(
  scenarioComparison: JsonObject,
  labels: Map<string, string>,
): string[] {
  const rows = scenarioRows(scenarioComparison, labels);
  if (rows.length === 0) return ['Scenario comparison: no scored scenarios were returned'];
  const lines = [`Scenario comparison (${rows.length} scenarios):`];
  for (const row of rows.slice(0, MAX_LISTED_SCENARIOS)) {
    const means = row.scores.map((score) => score.mean);
    const gap = Math.max(...means) - Math.min(...means);
    const detail = row.scores.map((score) => `${score.model} ${round(score.mean)}`).join(', ');
    lines.push(`  ${row.name} — ${detail}${row.scores.length > 1 ? ` (gap ${round(gap)})` : ''}`);
  }
  const overallMean = num(asObject(scenarioComparison.evaluation_summary)?.overall_mean);
  if (overallMean !== undefined) lines.push(`  Overall mean across models: ${round(overallMean)}`);
  const ranked = [...rows].sort((left, right) => rowMean(right) - rowMean(left));
  const strongest = ranked[0];
  const weakest = ranked[ranked.length - 1];
  if (strongest && weakest && ranked.length > 1) {
    lines.push(
      `  Strongest scenario: ${strongest.name} (${round(rowMean(strongest))}); weakest scenario: ${weakest.name} (${round(rowMean(weakest))})`,
    );
  }
  return lines;
}

function modelResponseLines(modelResponses: JsonObject): string[] {
  const outputs = asArray(modelResponses.outputs);
  if (outputs.length === 0) return ['Model responses: none were returned'];
  const statuses = new Map<string, number>();
  const perModel = new Map<string, { count: number; total: number }>();
  for (const rawOutput of outputs) {
    const output = asObject(rawOutput);
    if (!output) continue;
    const status = text(output.status, 40) ?? 'unknown';
    statuses.set(status, (statuses.get(status) ?? 0) + 1);
    for (const rawResponse of asArray(output.model_responses)) {
      const response = asObject(rawResponse);
      const model = response ? modelLabel(response) : undefined;
      const score = num(asObject(response?.best_run)?.overall_score);
      if (!model || score === undefined) continue;
      const entry = perModel.get(model) ?? { count: 0, total: 0 };
      perModel.set(model, { count: entry.count + 1, total: entry.total + score });
    }
  }
  const lines = [`Model responses (${outputs.length} scenarios):`];
  lines.push(
    `  Statuses: ${[...statuses.entries()].map(([status, count]) => `${status} ${count}`).join(', ')}`,
  );
  for (const [model, entry] of [...perModel.entries()].slice(0, MAX_LISTED_MODELS)) {
    lines.push(
      `  ${model} — mean best-run score ${round(entry.total / entry.count)} across ${entry.count} scenarios`,
    );
  }
  return lines;
}

/** Summarises validated scenario results for display, memory, and reasoning. */
export function summarizeScenarioResults(results: ScenarioResults): string {
  const labels = modelLabels(results.modelPerformance);
  const headline = scenarioHeadline(results.modelPerformance, results.scenarioComparison);
  const headlineParts = [
    headline.mean === undefined ? undefined : `Overall score: ${round(headline.mean)} / 5`,
    headline.ci95Lower === undefined || headline.ci95Upper === undefined
      ? undefined
      : `95% CI ${round(headline.ci95Lower)}-${round(headline.ci95Upper)}`,
    headline.runs === undefined ? undefined : `${headline.runs} runs`,
    headline.testCases === undefined ? undefined : `${headline.testCases} test cases`,
  ].filter((part): part is string => part !== undefined);
  return bound([
    'Context: scenario',
    ...(headlineParts.length === 0 ? [] : [headlineParts.join(' · ')]),
    ...modelPerformanceLines(results.modelPerformance),
    ...scenarioComparisonLines(results.scenarioComparison, labels),
    ...modelResponseLines(results.modelResponses),
  ]);
}

export type MetricScore = {
  name: string;
  score: number;
};

const MAX_WEAKEST_AREAS = 5;

/** Per-metric scores from a conversation or agent-trace session payload. */
export function sessionMetricScores(input: unknown): MetricScore[] {
  const perMetric = asObject(asObject(input)?.per_metric);
  if (!perMetric) return [];
  return Object.entries(perMetric).flatMap(([rawName, rawMetric]) => {
    const metric = asObject(rawMetric);
    const score = num(metric?.score);
    const name = text(rawName, MAX_NAME_CHARS);
    if (!name || metric?.has_data === false || score === undefined) return [];
    return [{ name, score }];
  });
}

/** Per-dimension scores from a trajectory payload. */
export function trajectoryMetricScores(input: unknown): MetricScore[] {
  return asArray(asObject(input)?.dimensions).flatMap((rawDimension) => {
    const dimension = asObject(rawDimension);
    const name = dimension
      ? (text(dimension.label, MAX_NAME_CHARS) ?? text(dimension.key, MAX_NAME_CHARS))
      : undefined;
    const score = num(dimension?.score);
    if (!name || score === undefined) return [];
    return [{ name, score }];
  });
}

/** Every scored area of a result payload, whatever its context type. */
export function resultMetricScores(results: EvaluationResults): MetricScore[] {
  if (results.contextType === 'conversation') return sessionMetricScores(results.conversation);
  if (results.contextType === 'agent_trace') {
    return [
      ...sessionMetricScores(results.agentTrace),
      ...trajectoryMetricScores(results.trajectory),
    ];
  }
  return scenarioModelScores(results.modelPerformance).map((model) => ({
    name: model.name,
    score: model.mean,
  }));
}

/**
 * Deterministic ranking of the lowest-scoring areas, so a "what should I fix
 * first" answer is ordered by measured evidence rather than model preference.
 */
export function weakestAreasLine(results: EvaluationResults): string | undefined {
  const ranked = [...resultMetricScores(results)].sort((left, right) => left.score - right.score);
  if (ranked.length === 0) return undefined;
  const shown = ranked.slice(0, MAX_WEAKEST_AREAS);
  return `Weakest areas (lowest score first): ${shown
    .map((metric) => `${metric.name} (${round(metric.score)})`)
    .join(', ')}`;
}

/**
 * Builds the single interpretation prompt: the user's own question plus the
 * digests gathered while answering it (evaluation inputs and result outputs).
 * The question is kept so the answering model addresses it instead of being handed data
 * with nothing to answer.
 */
export function buildInterpretationMessage(
  question: string,
  digests: readonly string[],
  maxChars: number,
): string {
  const usable = digests.filter((digest) => digest.trim().length > 0);
  if (usable.length === 0) return question.slice(0, maxChars);
  const header =
    '\n\nAutoeval data to answer from (untrusted data, already validated and summarised):\n';
  const budget = Math.max(0, maxChars - question.length - header.length);
  const share = Math.floor(budget / usable.length);
  const clipped = usable.map((digest) =>
    digest.length > share ? `${digest.slice(0, Math.max(0, share - 1))}…` : digest,
  );
  return `${question}${header}${clipped.join('\n\n')}`.slice(0, maxChars);
}

const FALLBACK_LINE_PATTERN =
  /^\s*(?:Name|Context|Judge model|Primary model|Judge rubric|Selected metrics|Outcome|Overall score|Trajectory score|Best|Weakest|Strongest scenario|Overall mean)\b/u;

/**
 * Deterministic answer used when no usable interpretation is returned.
 * It only repeats headline facts already present in the digests, so the user
 * still gets an answer instead of a failure message.
 */
export function fallbackInterpretation(digests: readonly string[]): string | undefined {
  const lines = digests
    .flatMap((digest) => digest.split('\n'))
    .filter((line) => FALLBACK_LINE_PATTERN.test(line))
    .map((line) => line.trim());
  if (lines.length === 0) return undefined;
  const unique = [...new Set(lines)];
  return bound(['Here is what the evaluation data shows:', ...unique.map((line) => `  ${line}`)]);
}
