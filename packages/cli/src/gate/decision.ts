import { z } from 'zod';

import type { JsonObject } from '../domain/common.js';
import type { EvaluationContextType, EvaluationResults } from '../domain/types.js';
import { isEmptyPolicy, type SuiteGatePolicy } from './policy.js';

/**
 * Gate plane.
 *
 * Execution and result fetching happen elsewhere; this module is pure. It
 * converts an already-fetched result payload plus the terminal run status into
 * one release decision per eval, then rolls the eval decisions into a single
 * suite decision. It never performs I/O and reads only fields the CLI already
 * receives from existing result and run-status payloads.
 *
 * Deliberately unused for gating: conversation / agent-trace `outcome.*`,
 * generated summaries and insights, and agent-trace model-performance CI.
 */

export type GateDecision = 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'ERROR';

const PRECEDENCE: Readonly<Record<GateDecision, number>> = {
  ERROR: 3,
  FAIL: 2,
  INCONCLUSIVE: 1,
  PASS: 0,
};

export function worstDecision(decisions: readonly GateDecision[]): GateDecision {
  return decisions.reduce<GateDecision>(
    (worst, decision) => (PRECEDENCE[decision] > PRECEDENCE[worst] ? decision : worst),
    'PASS',
  );
}

export type GateCheckEvidence = {
  mean?: number | null;
  ci95Lower?: number | null;
  ci95Upper?: number | null;
  score?: number | null;
  hasData?: boolean;
  insufficientSamples?: boolean;
};

export type GateCheckResult = {
  /** Stable machine identifier, e.g. `overall`, `scenario:Checkout`, `metric:factuality`. */
  metric: string;
  label: string;
  threshold: string;
  actual: string;
  decision: GateDecision;
  reason: string;
  basis: 'mean' | 'confidence-interval';
  evidence: GateCheckEvidence;
};

export type ConvergenceStatus =
  'CONVERGED' | 'NOT_CONVERGED' | 'NOT_APPLICABLE' | 'ERROR' | 'UNKNOWN';

export type ConvergenceEvidence = {
  status: ConvergenceStatus;
  autoStopReason?: string;
  achievedConsistency?: number;
  targetConsistency?: number;
  /** Comparison direction reported by the backend; `<` means lower is better. */
  targetConsistencyOperator?: string;
  failureReason?: string;
  /** True when the run status carried none of the convergence fields. */
  fieldsUnavailable: boolean;
};

export type EvalGateEvidence = {
  runMode: 'single_run' | 'multi_run' | 'unknown';
  runState?: string;
  totalRuns?: number;
  convergence?: ConvergenceEvidence;
};

export type EvalGateDecision = {
  index: number;
  inputFile: string;
  evaluationName?: string;
  evaluationId?: string;
  runId?: string;
  contextType?: EvaluationContextType;
  decision: GateDecision;
  checks: GateCheckResult[];
  reason: string;
  evidence: EvalGateEvidence;
};

export type SuiteGateReport = {
  suiteDecision: GateDecision;
  counts: Record<GateDecision, number>;
  perEvalDecisions: EvalGateDecision[];
};

export type GateEvalInput = {
  index: number;
  inputFile: string;
  evaluationName?: string;
  evaluationId?: string;
  runId?: string;
  contextType?: EvaluationContextType;
  /** Terminal state of the execution and results planes for this eval. */
  status: 'completed' | 'execution_failed' | 'result_failed';
  error?: string;
  results?: EvaluationResults;
  runState?: string;
  runStatusRaw?: JsonObject;
  policy: SuiteGatePolicy;
};

const NOT_AVAILABLE = 'Not available';

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toFixed(2) : value.toFixed(2);
}

function formatActual(evidence: GateCheckEvidence, basis: GateCheckResult['basis']): string {
  if (basis === 'confidence-interval') {
    const { ci95Lower: lower, ci95Upper: upper } = evidence;
    if (typeof lower !== 'number' || typeof upper !== 'number') return NOT_AVAILABLE;
    const mean = typeof evidence.mean === 'number' ? `${formatNumber(evidence.mean)} ` : '';
    return `${mean}95% CI ${formatNumber(lower)}-${formatNumber(upper)}`;
  }
  const value = evidence.score ?? evidence.mean;
  return typeof value === 'number' ? formatNumber(value) : NOT_AVAILABLE;
}

/** Point-estimate comparison. A missing value is never treated as zero. */
function checkMean(
  metric: string,
  label: string,
  threshold: number,
  evidence: GateCheckEvidence,
): GateCheckResult {
  const value = evidence.score ?? evidence.mean;
  const base = {
    metric,
    label,
    threshold: `>= ${formatNumber(threshold)}`,
    basis: 'mean' as const,
    evidence,
    actual: formatActual(evidence, 'mean'),
  };
  if (evidence.hasData === false) {
    return { ...base, decision: 'INCONCLUSIVE', reason: 'metric reported has_data: false' };
  }
  if (typeof value !== 'number') {
    return { ...base, decision: 'INCONCLUSIVE', reason: 'required score is unavailable' };
  }
  return value >= threshold
    ? { ...base, decision: 'PASS', reason: 'score meets the required threshold' }
    : { ...base, decision: 'FAIL', reason: 'score is below the required threshold' };
}

/** Interval comparison for multi-run evals. */
function checkConfidenceInterval(
  metric: string,
  label: string,
  threshold: number,
  evidence: GateCheckEvidence,
): GateCheckResult {
  const base = {
    metric,
    label,
    threshold: `>= ${formatNumber(threshold)}`,
    basis: 'confidence-interval' as const,
    evidence,
    actual: formatActual(evidence, 'confidence-interval'),
  };
  const lower = evidence.ci95Lower;
  const upper = evidence.ci95Upper;
  if (typeof lower !== 'number' || typeof upper !== 'number') {
    return {
      ...base,
      decision: 'INCONCLUSIVE',
      reason: 'required 95% confidence interval is unavailable',
    };
  }
  if (lower >= threshold) {
    return {
      ...base,
      decision: 'PASS',
      reason: 'confidence interval is entirely at or above the threshold',
    };
  }
  if (upper < threshold) {
    return {
      ...base,
      decision: 'FAIL',
      reason: 'confidence interval is entirely below the threshold',
    };
  }
  return {
    ...base,
    decision: 'INCONCLUSIVE',
    reason: 'confidence interval crosses release threshold',
  };
}

const nullableNumber = z.number().nullable().optional();

const scoreCellSchema = z
  .object({
    mean: nullableNumber,
    ci95_lower: nullableNumber,
    ci95_upper: nullableNumber,
    insufficient_samples: z.boolean().nullable().optional(),
    has_data: z.boolean().nullable().optional(),
    error: z.unknown().optional(),
  })
  .loose();

const modelPerformanceSchema = z
  .object({
    models: z
      .array(
        z
          .object({
            display_name: z.string().optional(),
            model_key: z.string().optional(),
            is_primary: z.boolean().optional(),
            scores: z.object({ overall: scoreCellSchema.optional() }).loose().optional(),
          })
          .loose(),
      )
      .optional(),
  })
  .loose();

const scenarioComparisonSchema = z
  .object({
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
                    is_primary: z.boolean().optional(),
                    score: scoreCellSchema.optional(),
                    error: z.unknown().optional(),
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

const perMetricSchema = z
  .object({
    per_metric: z
      .record(
        z.string(),
        z
          .object({
            score: nullableNumber,
            has_data: z.boolean().nullable().optional(),
          })
          .loose(),
      )
      .optional(),
  })
  .loose();

const runStatusGateSchema = z
  .object({
    evaluationState: z.string().optional(),
    progress: z.object({ totalRuns: z.number().nullable().optional() }).loose().optional(),
    evaluationMetrics: z
      .object({
        autoStopTriggered: z
          .object({ reason: z.string().nullable().optional() })
          .loose()
          .nullable()
          .optional(),
        achievedConsistency: nullableNumber,
        targetConsistency: nullableNumber,
        targetConsistencyOperator: z.string().nullable().optional(),
      })
      .loose()
      .nullable()
      .optional(),
    achievedConsistency: nullableNumber,
    targetConsistency: nullableNumber,
    targetConsistencyOperator: z.string().nullable().optional(),
    failureDetails: z
      .object({ failureReason: z.string().nullable().optional() })
      .loose()
      .nullable()
      .optional(),
    failure_reason: z.string().nullable().optional(),
    failureReason: z.string().nullable().optional(),
  })
  .loose();

function toEvidence(cell: z.infer<typeof scoreCellSchema> | undefined): GateCheckEvidence {
  return {
    mean: cell?.mean ?? null,
    ci95Lower: cell?.ci95_lower ?? null,
    ci95Upper: cell?.ci95_upper ?? null,
    ...(cell?.has_data === null || cell?.has_data === undefined ? {} : { hasData: cell.has_data }),
    ...(cell?.insufficient_samples === null || cell?.insufficient_samples === undefined
      ? {}
      : { insufficientSamples: cell.insufficient_samples }),
  };
}

/**
 * Consistency can be reported either as a score to exceed or as a spread to
 * stay under. The backend states the direction in `targetConsistencyOperator`;
 * without it, a higher-is-better target is assumed.
 */
function meetsConsistencyTarget(
  achieved: number,
  target: number,
  operator: string | undefined,
): boolean {
  switch ((operator ?? '>=').trim()) {
    case '<':
      return achieved < target;
    case '<=':
      return achieved <= target;
    case '>':
      return achieved > target;
    default:
      return achieved >= target;
  }
}

/**
 * Classify convergence from the terminal run status. `MAX_RUNS_REACHED` alone
 * does not prove a convergence failure, so the consistency target decides
 * whether convergence was enabled at all.
 */
export function classifyConvergence(
  runStatusRaw: JsonObject | undefined,
  runState: string | undefined,
): ConvergenceEvidence {
  const parsed = runStatusGateSchema.safeParse(runStatusRaw ?? {});
  const data = parsed.success ? parsed.data : {};
  const metrics = data.evaluationMetrics ?? undefined;
  const autoStopReason = metrics?.autoStopTriggered?.reason ?? undefined;
  const achieved = metrics?.achievedConsistency ?? data.achievedConsistency ?? undefined;
  const target = metrics?.targetConsistency ?? data.targetConsistency ?? undefined;
  const operator =
    metrics?.targetConsistencyOperator ?? data.targetConsistencyOperator ?? undefined;
  const failureReason =
    data.failureDetails?.failureReason ?? data.failureReason ?? data.failure_reason ?? undefined;

  const fieldsUnavailable =
    autoStopReason === undefined &&
    achieved === null &&
    target === null &&
    failureReason === undefined
      ? true
      : autoStopReason === undefined &&
        achieved === undefined &&
        target === undefined &&
        failureReason === undefined;

  const base = {
    ...(autoStopReason ? { autoStopReason } : {}),
    ...(typeof achieved === 'number' ? { achievedConsistency: achieved } : {}),
    ...(typeof target === 'number' ? { targetConsistency: target } : {}),
    ...(operator ? { targetConsistencyOperator: operator } : {}),
    ...(failureReason ? { failureReason } : {}),
    fieldsUnavailable,
  };

  if (failureReason !== undefined && failureReason !== null) {
    return { ...base, status: 'ERROR' };
  }
  const state = (runState ?? data.evaluationState ?? '').toUpperCase();
  if (state !== '' && state !== 'COMPLETED' && state !== 'COMPLETE' && state !== 'SUCCEEDED') {
    return { ...base, status: 'ERROR' };
  }
  if (fieldsUnavailable) return { ...base, status: 'UNKNOWN' };
  if (
    autoStopReason === 'OPTIMAL_CONFIDENCE_REACHED' ||
    autoStopReason === 'CONSISTENCY_TARGET_MET'
  ) {
    return { ...base, status: 'CONVERGED' };
  }
  if (typeof target !== 'number' || target <= 0) return { ...base, status: 'NOT_APPLICABLE' };
  if (typeof achieved !== 'number') return { ...base, status: 'NOT_CONVERGED' };
  return {
    ...base,
    status: meetsConsistencyTarget(achieved, target, operator) ? 'CONVERGED' : 'NOT_CONVERGED',
  };
}

function detectRunMode(
  runStatusRaw: JsonObject | undefined,
  cells: readonly GateCheckEvidence[],
): { runMode: EvalGateEvidence['runMode']; totalRuns?: number } {
  const parsed = runStatusGateSchema.safeParse(runStatusRaw ?? {});
  const totalRuns = parsed.success ? (parsed.data.progress?.totalRuns ?? undefined) : undefined;
  if (typeof totalRuns === 'number' && totalRuns > 0) {
    return { runMode: totalRuns > 1 ? 'multi_run' : 'single_run', totalRuns };
  }
  const hasInterval = cells.some(
    (cell) => typeof cell.ci95Lower === 'number' && typeof cell.ci95Upper === 'number',
  );
  return { runMode: hasInterval ? 'multi_run' : 'single_run' };
}

function scenarioChecks(
  results: Extract<EvaluationResults, { contextType: 'scenario' }>,
  policy: SuiteGatePolicy,
): { cells: { metric: string; label: string; threshold: number; evidence: GateCheckEvidence }[] } {
  const cells: {
    metric: string;
    label: string;
    threshold: number;
    evidence: GateCheckEvidence;
  }[] = [];

  const performance = modelPerformanceSchema.safeParse(results.modelPerformance);
  const models = performance.success ? (performance.data.models ?? []) : [];
  const primary = models.find((model) => model.is_primary === true) ?? models[0];
  const primaryKey = primary?.model_key;

  if (policy.minOverall !== undefined) {
    cells.push({
      metric: 'overall',
      label: 'Primary model overall score',
      threshold: policy.minOverall,
      evidence: toEvidence(primary?.scores?.overall),
    });
  }

  if (policy.minScenario !== undefined) {
    const comparison = scenarioComparisonSchema.safeParse(results.scenarioComparison);
    const scenarios = comparison.success ? (comparison.data.scenarios ?? []) : [];
    for (const scenario of scenarios) {
      const modelScores = scenario.model_scores ?? [];
      const cell =
        modelScores.find((entry) => entry.is_primary === true) ??
        (primaryKey === undefined
          ? modelScores[0]
          : (modelScores.find((entry) => entry.model_key === primaryKey) ?? undefined));
      if (cell === undefined) continue;
      const name = scenario.scenario_name ?? 'scenario';
      cells.push({
        metric: `scenario:${name}`,
        label: `Scenario ${name}`,
        threshold: policy.minScenario,
        evidence:
          cell.error === undefined || cell.error === null
            ? toEvidence(cell.score)
            : { ...toEvidence(cell.score), hasData: false },
      });
    }
  }

  return { cells };
}

function sessionChecks(payload: unknown, policy: SuiteGatePolicy): GateCheckResult[] {
  const parsed = perMetricSchema.safeParse(payload);
  const perMetric = parsed.success ? (parsed.data.per_metric ?? {}) : {};
  return Object.entries(policy.metrics ?? {}).map(([name, threshold]) => {
    const cell = perMetric[name];
    const evidence: GateCheckEvidence = {
      score: cell?.score ?? null,
      ...(cell?.has_data === null || cell?.has_data === undefined
        ? {}
        : { hasData: cell.has_data }),
    };
    if (cell === undefined) {
      return {
        metric: `metric:${name}`,
        label: name,
        threshold: `>= ${formatNumber(threshold)}`,
        actual: NOT_AVAILABLE,
        decision: 'INCONCLUSIVE',
        reason: 'required metric is missing from the result payload',
        basis: 'mean',
        evidence,
      };
    }
    return checkMean(`metric:${name}`, name, threshold, evidence);
  });
}

function summarize(decision: GateDecision, checks: readonly GateCheckResult[]): string {
  if (decision === 'PASS') {
    return checks.length === 0
      ? 'no blocking criteria configured'
      : 'every configured criterion was met';
  }
  const offending = checks.find((check) => check.decision === decision);
  return offending === undefined
    ? 'gate evidence is unusable'
    : `${offending.label}: ${offending.reason}`;
}

/** Convert one completed (or failed) suite eval into a release decision. */
export function decideEvalGate(input: GateEvalInput): EvalGateDecision {
  const identity = {
    index: input.index,
    inputFile: input.inputFile,
    ...(input.evaluationName ? { evaluationName: input.evaluationName } : {}),
    ...(input.evaluationId ? { evaluationId: input.evaluationId } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.contextType ? { contextType: input.contextType } : {}),
  };

  if (input.status !== 'completed' || input.results === undefined) {
    return {
      ...identity,
      decision: 'ERROR',
      checks: [],
      reason:
        input.error ??
        (input.status === 'execution_failed'
          ? 'eval execution failed'
          : 'eval results could not be fetched'),
      evidence: {
        runMode: 'unknown',
        ...(input.runState ? { runState: input.runState } : {}),
      },
    };
  }

  const results = input.results;

  if (results.contextType !== 'scenario') {
    const payload =
      results.contextType === 'conversation' ? results.conversation : results.agentTrace;
    const checks = sessionChecks(payload, input.policy);
    const decision = isEmptyPolicy(input.policy)
      ? 'INCONCLUSIVE'
      : worstDecision(checks.map((check) => check.decision));
    return {
      ...identity,
      decision,
      checks,
      reason: isEmptyPolicy(input.policy)
        ? 'no metric thresholds are configured for this eval'
        : summarize(decision, checks),
      evidence: {
        runMode: 'single_run',
        ...(input.runState ? { runState: input.runState } : {}),
      },
    };
  }

  const { cells } = scenarioChecks(results, input.policy);
  const { runMode, totalRuns } = detectRunMode(
    input.runStatusRaw,
    cells.map((cell) => cell.evidence),
  );
  const convergence =
    runMode === 'multi_run' ? classifyConvergence(input.runStatusRaw, input.runState) : undefined;

  const checks = cells.map((cell) =>
    runMode === 'multi_run'
      ? checkConfidenceInterval(cell.metric, cell.label, cell.threshold, cell.evidence)
      : checkMean(cell.metric, cell.label, cell.threshold, cell.evidence),
  );

  const evidence: EvalGateEvidence = {
    runMode,
    ...(input.runState ? { runState: input.runState } : {}),
    ...(totalRuns === undefined ? {} : { totalRuns }),
    ...(convergence ? { convergence } : {}),
  };

  if (isEmptyPolicy(input.policy)) {
    return {
      ...identity,
      decision: 'INCONCLUSIVE',
      checks,
      reason: 'no score thresholds are configured for this eval',
      evidence,
    };
  }

  let decision = worstDecision(checks.map((check) => check.decision));
  let reason = summarize(decision, checks);

  if (convergence?.status === 'ERROR') {
    decision = 'ERROR';
    reason = convergence.failureReason ?? 'the multi-run evaluation did not complete successfully';
  } else if (convergence?.status === 'NOT_CONVERGED' && decision !== 'FAIL') {
    decision = 'INCONCLUSIVE';
    reason = 'convergence was enabled but the consistency target was not reached';
  }

  return { ...identity, decision, checks, reason, evidence };
}

/** Roll per-eval decisions up with ERROR > FAIL > INCONCLUSIVE > PASS. */
export function rollUpSuiteDecision(
  perEvalDecisions: readonly EvalGateDecision[],
): SuiteGateReport {
  const counts: Record<GateDecision, number> = {
    PASS: 0,
    FAIL: 0,
    INCONCLUSIVE: 0,
    ERROR: 0,
  };
  for (const entry of perEvalDecisions) counts[entry.decision] += 1;
  return {
    suiteDecision:
      perEvalDecisions.length === 0
        ? 'INCONCLUSIVE'
        : worstDecision(perEvalDecisions.map((entry) => entry.decision)),
    counts,
    perEvalDecisions: [...perEvalDecisions].sort((left, right) => left.index - right.index),
  };
}
