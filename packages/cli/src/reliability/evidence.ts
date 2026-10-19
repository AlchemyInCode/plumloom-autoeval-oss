import type { ParsedConfiguredRunInput } from '../configured-run/validation.js';
import type { EvaluationContextType, EvaluationResults } from '../domain/types.js';
import type { JsonObject } from '../domain/common.js';

export type QualityStandardStatus = 'applied' | 'not_configured' | 'not_available';

export type RunStandardEvidence = {
  rubricApplied: boolean;
  judgeModel?: string;
  judgeModelPinned: boolean;
  qualityStandardStatus: QualityStandardStatus;
  qualityStandardName?: string;
  qualityStandardVersion?: string;
  anchorCount?: number;
};

export type JudgmentEvidence = {
  scope: string;
  assessmentCount?: number;
  passVotes?: number;
  agreedAssessments?: number;
};

export type RepeatabilityStatistic = {
  scope: string;
  mean?: number;
  standardDeviation?: number;
  ci95Lower?: number;
  ci95Upper?: number;
  ci95HalfWidth?: number;
  sampleSize?: number;
  hasData?: boolean;
  insufficientEvidence?: boolean;
};

export type ScenarioRepeatabilityEvidence = {
  completedTrials?: number;
  plannedTrials?: number;
  statistics: RepeatabilityStatistic[];
};

const MAX_STATISTICS = 500;

function asObject(input: unknown): Record<string, unknown> | undefined {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : undefined;
}

function asArray(input: unknown): unknown[] {
  return Array.isArray(input) ? input : [];
}

function finiteNumber(input: unknown): number | undefined {
  return typeof input === 'number' && Number.isFinite(input) ? input : undefined;
}

function nonNegativeInteger(input: unknown): number | undefined {
  const value = finiteNumber(input);
  return value !== undefined && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function nonEmptyText(input: unknown): string | undefined {
  return typeof input === 'string' && input.trim() !== '' ? input.trim() : undefined;
}

function parsedObject(input: unknown): Record<string, unknown> | undefined {
  const direct = asObject(input);
  if (direct) return direct;
  const text = nonEmptyText(input);
  if (!text) return undefined;
  try {
    return asObject(JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

function hasOwn(source: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function qualityStandardSource(
  configuredRun: ParsedConfiguredRunInput,
  exactConfiguration?: JsonObject,
): {
  source?: Record<string, unknown>;
  status: QualityStandardStatus;
} {
  const configuration = asObject(exactConfiguration) ?? {};
  const direct = asObject(configuration.quality_standard);
  if (direct) return { source: direct, status: 'applied' };

  const exactInstructions = parsedObject(configuration.evaluator_instructions);
  if (
    exactInstructions &&
    (nonEmptyText(exactInstructions.quality_standard_id) !== undefined ||
      nonEmptyText(exactInstructions.quality_standard_name) !== undefined ||
      nonEmptyText(exactInstructions.name) !== undefined ||
      asArray(exactInstructions.anchors).length > 0 ||
      exactInstructions.type === 'qs_v1')
  ) {
    return { source: exactInstructions, status: 'applied' };
  }

  const submittedInstructions = parsedObject(configuredRun.methodology.evaluatorInstructions);
  if (
    submittedInstructions &&
    (nonEmptyText(submittedInstructions.quality_standard_id) !== undefined ||
      nonEmptyText(submittedInstructions.quality_standard_name) !== undefined ||
      nonEmptyText(submittedInstructions.name) !== undefined ||
      asArray(submittedInstructions.anchors).length > 0 ||
      submittedInstructions.type === 'qs_v1')
  ) {
    return { source: submittedInstructions, status: 'applied' };
  }

  const explicitAssignmentFields =
    hasOwn(configuration, 'quality_standard') || hasOwn(configuration, 'quality_standard_id');
  if (
    explicitAssignmentFields &&
    (configuration.quality_standard === null || configuration.quality_standard_id === null)
  ) {
    return { status: 'not_configured' };
  }
  if (nonEmptyText(configuration.quality_standard_id) !== undefined) {
    return { source: configuration, status: 'applied' };
  }
  if (nonEmptyText(configuration.quality_standard_name) !== undefined) {
    return { source: configuration, status: 'applied' };
  }
  return { status: 'not_available' };
}

/**
 * Extract only public-safe standard metadata from the exact configuration used
 * by the run. Rubric prose and anchor contents are deliberately never retained.
 */
export function extractRunStandardEvidence(
  configuredRun: ParsedConfiguredRunInput,
  exactConfiguration?: JsonObject,
): RunStandardEvidence {
  const qualityStandard = qualityStandardSource(configuredRun, exactConfiguration);
  const source = qualityStandard.source;
  const anchors = asArray(source?.anchors);
  const version =
    nonEmptyText(source?.version) ??
    nonEmptyText(source?.version_number) ??
    nonEmptyText(source?.quality_standard_version) ??
    (finiteNumber(source?.versionNumber) === undefined
      ? undefined
      : String(finiteNumber(source?.versionNumber)));
  const name =
    nonEmptyText(source?.quality_standard_name) ??
    nonEmptyText(source?.name) ??
    nonEmptyText(source?.qs_name);

  return {
    rubricApplied: configuredRun.methodology.evaluatorInstructions.trim() !== '',
    judgeModel: configuredRun.methodology.judgeModel,
    judgeModelPinned: configuredRun.methodology.judgeModelId.trim() !== '',
    qualityStandardStatus: qualityStandard.status,
    ...(name === undefined ? {} : { qualityStandardName: name }),
    ...(version === undefined ? {} : { qualityStandardVersion: version }),
    ...(qualityStandard.status === 'applied' && anchors.length > 0
      ? { anchorCount: anchors.length }
      : {}),
  };
}

function judgmentFromPayload(payload: unknown, scope: string): JudgmentEvidence | undefined {
  const agreement = asObject(asObject(payload)?.judge_agreement);
  if (!agreement) return undefined;
  const assessmentCount = nonNegativeInteger(agreement.total);
  const passVotes = nonNegativeInteger(agreement.pass);
  const agreedAssessments = nonNegativeInteger(agreement.agreed);
  if (assessmentCount === undefined && passVotes === undefined && agreedAssessments === undefined) {
    return undefined;
  }
  return {
    scope,
    ...(assessmentCount === undefined ? {} : { assessmentCount }),
    ...(passVotes === undefined ? {} : { passVotes }),
    ...(agreedAssessments === undefined ? {} : { agreedAssessments }),
  };
}

function scenarioJudgeCount(statusRaw: JsonObject | undefined): number | undefined {
  const status = asObject(statusRaw);
  const nestedStatus = asObject(status?.status);
  for (const root of [status, nestedStatus]) {
    if (!root) continue;
    const metrics = asObject(root.evaluationMetrics) ?? asObject(root.evaluation_metrics);
    const count =
      nonNegativeInteger(metrics?.judgesPerOutput) ??
      nonNegativeInteger(metrics?.judges_per_output) ??
      nonNegativeInteger(metrics?.judge_count);
    if (count !== undefined) return count;
  }
  return undefined;
}

export function extractJudgmentEvidence(
  contextType: EvaluationContextType | undefined,
  results: EvaluationResults | undefined,
  statusRaw: JsonObject | undefined,
): JudgmentEvidence[] {
  if (contextType === 'scenario') {
    const assessmentCount = scenarioJudgeCount(statusRaw);
    return assessmentCount === undefined ? [] : [{ scope: 'Each system output', assessmentCount }];
  }
  if (contextType === 'conversation' && results?.contextType === 'conversation') {
    const evidence = judgmentFromPayload(results.conversation, 'Frozen conversation');
    return evidence ? [evidence] : [];
  }
  if (contextType === 'agent_trace' && results?.contextType === 'agent_trace') {
    return [
      judgmentFromPayload(results.agentTrace, 'Agent session'),
      judgmentFromPayload(results.trajectory, 'Trajectory'),
    ].filter((entry): entry is JudgmentEvidence => entry !== undefined);
  }
  return [];
}

function statistic(scope: string, cellInput: unknown): RepeatabilityStatistic | undefined {
  const cell = asObject(cellInput);
  if (!cell) return undefined;
  const mean = finiteNumber(cell.mean);
  const standardDeviation = finiteNumber(cell.std_dev) ?? finiteNumber(cell.standard_deviation);
  const ci95Lower = finiteNumber(cell.ci95_lower);
  const ci95Upper = finiteNumber(cell.ci95_upper);
  const ci95HalfWidth = finiteNumber(cell.ci95);
  const sampleSize = nonNegativeInteger(cell.sample_size);
  const hasData = typeof cell.has_data === 'boolean' ? cell.has_data : undefined;
  const insufficientEvidence =
    typeof cell.insufficient_samples === 'boolean' ? cell.insufficient_samples : undefined;
  if (
    mean === undefined &&
    standardDeviation === undefined &&
    ci95Lower === undefined &&
    ci95Upper === undefined &&
    ci95HalfWidth === undefined &&
    sampleSize === undefined &&
    hasData === undefined &&
    insufficientEvidence === undefined
  ) {
    return undefined;
  }
  return {
    scope,
    ...(mean === undefined ? {} : { mean }),
    ...(standardDeviation === undefined ? {} : { standardDeviation }),
    ...(ci95Lower === undefined ? {} : { ci95Lower }),
    ...(ci95Upper === undefined ? {} : { ci95Upper }),
    ...(ci95HalfWidth === undefined ? {} : { ci95HalfWidth }),
    ...(sampleSize === undefined ? {} : { sampleSize }),
    ...(hasData === undefined ? {} : { hasData }),
    ...(insufficientEvidence === undefined ? {} : { insufficientEvidence }),
  };
}

function trialCounts(statusRaw: JsonObject | undefined): {
  completedTrials?: number;
  plannedTrials?: number;
} {
  const status = asObject(statusRaw);
  const nestedStatus = asObject(status?.status);
  for (const root of [status, nestedStatus]) {
    if (!root) continue;
    const metrics = asObject(root.evaluationMetrics) ?? asObject(root.evaluation_metrics);
    const progress = asObject(root.progress);
    const completedTrials =
      nonNegativeInteger(metrics?.runsCompleted) ??
      nonNegativeInteger(metrics?.runs_completed) ??
      nonNegativeInteger(progress?.runsCompleted) ??
      nonNegativeInteger(progress?.runs_completed);
    const plannedTrials =
      nonNegativeInteger(metrics?.runsPlanned) ??
      nonNegativeInteger(metrics?.runs_planned) ??
      nonNegativeInteger(metrics?.maxRuns) ??
      nonNegativeInteger(progress?.totalRuns) ??
      nonNegativeInteger(progress?.total_runs);
    if (completedTrials !== undefined || plannedTrials !== undefined) {
      return {
        ...(completedTrials === undefined ? {} : { completedTrials }),
        ...(plannedTrials === undefined ? {} : { plannedTrials }),
      };
    }
  }
  return {};
}

/** Report backend statistics at their native model/metric and scenario/model grain. */
export function extractScenarioRepeatabilityEvidence(
  results: EvaluationResults | undefined,
  statusRaw: JsonObject | undefined,
): ScenarioRepeatabilityEvidence {
  const counts = trialCounts(statusRaw);
  if (results?.contextType !== 'scenario') return { ...counts, statistics: [] };

  const statistics: RepeatabilityStatistic[] = [];
  for (const modelInput of asArray(results.modelPerformance.models)) {
    if (statistics.length >= MAX_STATISTICS) break;
    const model = asObject(modelInput);
    if (!model) continue;
    const modelLabel = nonEmptyText(model.display_name) ?? nonEmptyText(model.model_key) ?? 'Model';
    const scores = asObject(model.scores);
    if (!scores) continue;
    for (const [metric, cell] of Object.entries(scores)) {
      const entry = statistic(`${modelLabel} / ${metric}`, cell);
      if (entry) statistics.push(entry);
      if (statistics.length >= MAX_STATISTICS) break;
    }
  }

  for (const scenarioInput of asArray(results.scenarioComparison.scenarios)) {
    if (statistics.length >= MAX_STATISTICS) break;
    const scenario = asObject(scenarioInput);
    if (!scenario) continue;
    const scenarioLabel =
      nonEmptyText(scenario.scenario_name) ??
      (finiteNumber(scenario.scenario_index) === undefined
        ? 'Scenario'
        : `Scenario ${finiteNumber(scenario.scenario_index)}`);
    for (const scoreInput of asArray(scenario.model_scores)) {
      const score = asObject(scoreInput);
      if (!score) continue;
      const modelLabel =
        nonEmptyText(score.display_name) ?? nonEmptyText(score.model_key) ?? 'Model';
      const entry = statistic(`${scenarioLabel} / ${modelLabel}`, score.score);
      if (entry) statistics.push(entry);
      if (statistics.length >= MAX_STATISTICS) break;
    }
  }
  return { ...counts, statistics };
}
