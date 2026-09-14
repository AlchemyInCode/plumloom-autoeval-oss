import { z } from 'zod';

import type { EvaluationContextType, EvaluationResults } from '../domain/types.js';

/**
 * Release-gate thresholds. Every field is optional; only configured thresholds
 * produce checks. A gate with no configured threshold is advisory and passes.
 */
export type GateThresholds = {
  /** Scenario only: minimum primary-model overall score. */
  minOverall?: number;
  /** Scenario only: minimum score for every scenario cell. */
  minScenario?: number;
  /** Scenario only: minimum judge agreement ratio. */
  minJudgeAgreement?: number;
  /** Conversation and agent trace only: minimum per-metric scores. */
  metrics?: Readonly<Record<string, number>>;
};

export type GateVerdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE';

export type GateCheck = {
  /** Stable metric identifier, safe for machine consumption. */
  metric: string;
  label: string;
  threshold: string;
  actual: string;
  decision: GateVerdict;
  passed: boolean;
  /** Why a check is not a pass; omitted for passing checks. */
  reason?: string;
  /** Extra context, such as the scenario that produced the minimum score. */
  detail?: string;
};

export type GateMetrics = {
  overall?: number;
  scenarioMinimum?: { score: number; scenarioName?: string; modelKey?: string };
  judgeAgreement?: { agreed: number; total: number; ratio: number };
  trajectoryScore?: number;
};

export type GateReport = {
  contextType: EvaluationContextType;
  decision: GateVerdict;
  passed: boolean;
  /** True when no threshold was configured, so the gate could not fail. */
  advisory: boolean;
  thresholds: GateThresholds;
  metrics: GateMetrics;
  checks: GateCheck[];
};

const modelPerformanceSchema = z
  .object({
    models: z
      .array(
        z
          .object({
            display_name: z.string().optional(),
            model_key: z.string().optional(),
            is_primary: z.boolean().optional(),
            scores: z
              .object({
                overall: z
                  .object({ mean: z.number().nullable(), has_data: z.boolean().optional() })
                  .loose()
                  .optional(),
              })
              .loose()
              .optional(),
          })
          .loose(),
      )
      .optional(),
  })
  .loose();

const scenarioComparisonSchema = z
  .object({
    evaluation_summary: z.object({ overall_mean: z.number().nullable() }).loose().optional(),
    scenarios: z
      .array(
        z
          .object({
            scenario_name: z.string().optional(),
            model_scores: z
              .array(
                z
                  .object({
                    model_key: z.string().optional(),
                    score: z.object({ mean: z.number().nullable() }).loose().optional(),
                  })
                  .loose(),
              )
              .optional(),
          })
          .loose(),
      )
      .optional(),
  })
  .loose();

const sessionScorecardSchema = z
  .object({
    overall: z.number().nullable().optional(),
    judge_agreement: z
      .object({
        pass: z.number().nullable().optional(),
        agreed: z.number().nullable().optional(),
        total: z.number().nullable().optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

const trajectorySchema = z.object({ trajectory_score: z.number().nullable().optional() }).loose();

function readAgreement(
  input:
    | {
        pass?: number | null | undefined;
        agreed?: number | null | undefined;
        total?: number | null | undefined;
      }
    | undefined,
): GateMetrics['judgeAgreement'] {
  const agreed = input?.agreed ?? input?.pass;
  const total = input?.total;
  if (agreed === undefined || agreed === null || total === undefined || total === null) {
    return undefined;
  }
  if (total === 0) return undefined;
  return { agreed, total, ratio: agreed / total };
}

function extractScenarioMetrics(results: Extract<EvaluationResults, { contextType: 'scenario' }>) {
  const metrics: GateMetrics = {};
  const performance = modelPerformanceSchema.safeParse(results.modelPerformance);
  if (performance.success) {
    const models = performance.data.models ?? [];
    const primary = models.find((model) => model.is_primary === true) ?? models[0];
    const mean = primary?.scores?.overall?.mean;
    if (typeof mean === 'number') metrics.overall = mean;
  }

  const comparison = scenarioComparisonSchema.safeParse(results.scenarioComparison);
  if (comparison.success) {
    if (metrics.overall === undefined) {
      const summaryMean = comparison.data.evaluation_summary?.overall_mean;
      if (typeof summaryMean === 'number') metrics.overall = summaryMean;
    }
    for (const scenario of comparison.data.scenarios ?? []) {
      for (const modelScore of scenario.model_scores ?? []) {
        const mean = modelScore.score?.mean;
        if (typeof mean !== 'number') continue;
        if (metrics.scenarioMinimum !== undefined && metrics.scenarioMinimum.score <= mean) {
          continue;
        }
        metrics.scenarioMinimum = {
          score: mean,
          ...(scenario.scenario_name ? { scenarioName: scenario.scenario_name } : {}),
          ...(modelScore.model_key ? { modelKey: modelScore.model_key } : {}),
        };
      }
    }
  }
  return metrics;
}

function extractSessionMetrics(scorecardInput: unknown, trajectoryInput?: unknown): GateMetrics {
  const metrics: GateMetrics = {};
  const parsed = sessionScorecardSchema.safeParse(scorecardInput);
  if (parsed.success) {
    const scorecard = parsed.data;
    if (typeof scorecard.overall === 'number') metrics.overall = scorecard.overall;
    const agreement = readAgreement(scorecard.judge_agreement);
    if (agreement) metrics.judgeAgreement = agreement;
  }
  if (trajectoryInput !== undefined) {
    const trajectory = trajectorySchema.safeParse(trajectoryInput);
    if (trajectory.success && typeof trajectory.data.trajectory_score === 'number') {
      metrics.trajectoryScore = trajectory.data.trajectory_score;
    }
  }
  return metrics;
}

export function extractGateMetrics(results: EvaluationResults): GateMetrics {
  if (results.contextType === 'scenario') return extractScenarioMetrics(results);
  if (results.contextType === 'conversation') return extractSessionMetrics(results.conversation);
  return extractSessionMetrics(results.agentTrace, results.trajectory);
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '');
}

const NOT_AVAILABLE = 'Not available';

const perMetricSchema = z
  .object({
    per_metric: z
      .record(
        z.string(),
        z
          .object({
            score: z.number().nullable().optional(),
            has_data: z.boolean().nullable().optional(),
          })
          .loose(),
      )
      .optional(),
  })
  .loose();

function worstVerdict(checks: readonly GateCheck[]): GateVerdict {
  if (checks.some((check) => check.decision === 'FAIL')) return 'FAIL';
  if (checks.some((check) => check.decision === 'INCONCLUSIVE')) return 'INCONCLUSIVE';
  return 'PASS';
}

function sessionMetricChecks(
  payload: unknown,
  thresholds: Readonly<Record<string, number>>,
): GateCheck[] {
  const parsed = perMetricSchema.safeParse(payload);
  const perMetric = parsed.success ? (parsed.data.per_metric ?? {}) : {};

  return Object.entries(thresholds).map(([name, threshold]) => {
    const cell = perMetric[name];
    const base = {
      metric: `metric:${name}`,
      label: name,
      threshold: `>= ${formatNumber(threshold)}`,
    };
    const inconclusive = (actual: string, reason: string): GateCheck => ({
      ...base,
      actual,
      decision: 'INCONCLUSIVE',
      passed: false,
      reason,
    });

    if (cell === undefined) {
      return inconclusive(NOT_AVAILABLE, 'required metric is missing from the result payload');
    }
    if (cell.has_data === false) {
      return inconclusive(NOT_AVAILABLE, 'metric reported has_data: false');
    }
    if (typeof cell.score !== 'number') {
      return inconclusive(NOT_AVAILABLE, 'required score is unavailable');
    }
    const passed = cell.score >= threshold;
    return {
      ...base,
      actual: formatNumber(cell.score),
      decision: passed ? 'PASS' : 'FAIL',
      passed,
      ...(passed ? {} : { reason: 'score is below the required threshold' }),
    };
  });
}

/** Canonical Scenario gate semantics. */
function scenarioChecks(metrics: GateMetrics, thresholds: GateThresholds): GateCheck[] {
  const checks: GateCheck[] = [];

  if (thresholds.minOverall !== undefined) {
    const actual = metrics.overall;
    const passed = actual !== undefined && actual >= thresholds.minOverall;
    checks.push({
      metric: 'overall',
      label: 'Overall score',
      threshold: `>= ${formatNumber(thresholds.minOverall)}`,
      actual: actual === undefined ? NOT_AVAILABLE : formatNumber(actual),
      decision: passed ? 'PASS' : 'FAIL',
      passed,
    });
  }

  if (thresholds.minScenario !== undefined) {
    const lowest = metrics.scenarioMinimum;
    const detail =
      lowest === undefined
        ? undefined
        : [lowest.scenarioName, lowest.modelKey].filter(Boolean).join(' · ');
    const passed = lowest !== undefined && lowest.score >= thresholds.minScenario;
    checks.push({
      metric: 'scenario-minimum',
      label: 'Lowest scenario score',
      threshold: `>= ${formatNumber(thresholds.minScenario)}`,
      actual: lowest === undefined ? NOT_AVAILABLE : formatNumber(lowest.score),
      decision: passed ? 'PASS' : 'FAIL',
      passed,
      ...(detail ? { detail } : {}),
    });
  }

  if (thresholds.minJudgeAgreement !== undefined) {
    const agreement = metrics.judgeAgreement;
    const passed = agreement !== undefined && agreement.ratio >= thresholds.minJudgeAgreement;
    checks.push({
      metric: 'judge-agreement',
      label: 'Judge agreement',
      threshold: `>= ${formatNumber(thresholds.minJudgeAgreement)}`,
      actual:
        agreement === undefined
          ? NOT_AVAILABLE
          : `${formatNumber(agreement.ratio)} (${agreement.agreed}/${agreement.total})`,
      decision: passed ? 'PASS' : 'FAIL',
      passed,
    });
  }

  return checks;
}

/**
 * Compare evaluation results against release thresholds. Pure: it performs no
 * I/O and never inspects credentials or raw upstream diagnostics. Scenario
 * evaluations retain the canonical score and agreement checks. Conversation
 * and agent-trace evaluations gate only on configured `per_metric` scores;
 * outcome-judge fields never contribute evidence.
 */
export function evaluateGate(results: EvaluationResults, thresholds: GateThresholds): GateReport {
  const metrics = extractGateMetrics(results);
  if (results.contextType !== 'scenario') {
    const payload =
      results.contextType === 'conversation' ? results.conversation : results.agentTrace;
    const configured = thresholds.metrics ?? {};
    const checks = sessionMetricChecks(payload, configured);
    const advisory = Object.keys(configured).length === 0;
    const decision = advisory ? 'INCONCLUSIVE' : worstVerdict(checks);
    return {
      contextType: results.contextType,
      decision,
      passed: decision === 'PASS',
      advisory,
      thresholds,
      metrics,
      checks,
    };
  }

  const checks = scenarioChecks(metrics, thresholds);
  const passed = checks.every((check) => check.passed);
  return {
    contextType: results.contextType,
    decision: passed ? 'PASS' : 'FAIL',
    passed,
    advisory: checks.length === 0,
    thresholds,
    metrics,
    checks,
  };
}
