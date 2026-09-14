import { describe, expect, it } from 'vitest';

import { evaluateGate, extractGateMetrics } from '../src/actions/gate.js';
import type { JsonObject } from '../src/domain/common.js';
import type { EvaluationResults } from '../src/domain/types.js';
import { renderGateReport } from '../src/output/human.js';
import { AutoevalError } from '../src/errors/autoeval-error.js';
import { parseMetricThresholds, parseThresholdNumber } from '../src/commands/program.js';

const scenarioResults: EvaluationResults = {
  contextType: 'scenario',
  modelPerformance: {
    models: [
      { display_name: 'Alt', is_primary: false, scores: { overall: { mean: 4.9 } } },
      { display_name: 'GPT-5', is_primary: true, scores: { overall: { mean: 4.1 } } },
    ],
  },
  scenarioComparison: {
    evaluation_summary: { overall_mean: 4.5 },
    scenarios: [
      {
        scenario_name: 'Cosmetic rename PR',
        model_scores: [
          { model_key: 'openai/gpt-5', score: { mean: 3.4 } },
          { model_key: 'alt/model', score: { mean: 4.2 } },
        ],
      },
      {
        scenario_name: 'Swallowed error',
        model_scores: [{ model_key: 'openai/gpt-5', score: { mean: 4.15 } }],
      },
    ],
  },
  modelResponses: {},
};

const conversationResults: EvaluationResults = {
  contextType: 'conversation',
  conversation: {
    outcome: { achieved: false, score: 2, has_data: true },
    overall: 3.2,
    per_metric: {
      factuality: { score: 4.2, has_data: true },
      tone: { score: 3.9, has_data: true },
    },
    judge_agreement: { pass: 2, total: 4 },
  },
};

const agentTraceResults: EvaluationResults = {
  contextType: 'agent_trace',
  agentTrace: {
    outcome: { achieved: true, score: 5, has_data: true },
    overall: 4.6,
    per_metric: {
      tool_use: { score: 4.4, has_data: true },
      planning: { score: 4.0, has_data: true },
    },
    judge_agreement: { pass: 3, total: 3 },
  },
  trajectory: { trajectory_score: 4.2, judge_agreement: { agreed: 3, total: 3 }, dimensions: [] },
};

describe('extractGateMetrics', () => {
  it('prefers the primary model overall score for scenario runs', () => {
    const metrics = extractGateMetrics(scenarioResults);
    expect(metrics.overall).toBe(4.1);
    expect(metrics.scenarioMinimum).toEqual({
      score: 3.4,
      scenarioName: 'Cosmetic rename PR',
      modelKey: 'openai/gpt-5',
    });
  });

  it('falls back to the comparison summary when model performance has no score', () => {
    const metrics = extractGateMetrics({
      ...scenarioResults,
      modelPerformance: {},
    });
    expect(metrics.overall).toBe(4.5);
  });

  it('reads conversation overall and judge agreement but never the outcome judge', () => {
    const metrics = extractGateMetrics(conversationResults);
    expect(metrics.overall).toBe(3.2);
    expect(metrics.judgeAgreement).toEqual({ agreed: 2, total: 4, ratio: 0.5 });
    expect('outcome' in metrics).toBe(false);
  });

  it('reads the trajectory score for agent trace runs', () => {
    expect(extractGateMetrics(agentTraceResults).trajectoryScore).toBe(4.2);
  });

  it('omits judge agreement when the total is missing or zero', () => {
    const metrics = extractGateMetrics({
      contextType: 'conversation',
      conversation: {
        outcome: { achieved: true, score: 5, has_data: true },
        overall: 4,
        per_metric: {},
        judge_agreement: { pass: 0, total: 0 },
      },
    });
    expect(metrics.judgeAgreement).toBeUndefined();
  });
});

describe('evaluateGate', () => {
  it('passes when every configured threshold is met', () => {
    const report = evaluateGate(scenarioResults, { minOverall: 4, minScenario: 3 });
    expect(report.passed).toBe(true);
    expect(report.decision).toBe('PASS');
    expect(report.advisory).toBe(false);
    expect(report.checks.map((check) => check.metric)).toEqual(['overall', 'scenario-minimum']);
  });

  it('fails when the lowest scenario score is under the threshold', () => {
    const report = evaluateGate(scenarioResults, { minScenario: 3.5 });
    expect(report.passed).toBe(false);
    const check = report.checks[0];
    expect(check?.actual).toBe('3.4');
    expect(check?.detail).toBe('Cosmetic rename PR · openai/gpt-5');
  });

  it('fails a scenario overall threshold that has no score instead of silently passing', () => {
    const report = evaluateGate(
      { ...scenarioResults, modelPerformance: {}, scenarioComparison: {} },
      { minOverall: 4 },
    );
    expect(report.decision).toBe('FAIL');
    expect(report.checks[0]?.actual).toBe('Not available');
  });

  it('preserves canonical Scenario judge-agreement gating', () => {
    const report = evaluateGate(scenarioResults, { minJudgeAgreement: 0.5 });
    expect(report.decision).toBe('FAIL');
    expect(report.passed).toBe(false);
    expect(report.checks[0]?.metric).toBe('judge-agreement');
    expect(report.checks[0]?.actual).toBe('Not available');
  });

  it('preserves canonical advisory Scenario behavior when no threshold is configured', () => {
    const report = evaluateGate(scenarioResults, {});
    expect(report.advisory).toBe(true);
    expect(report.decision).toBe('PASS');
    expect(report.passed).toBe(true);
  });

  it('is inconclusive when a session eval has no metric thresholds', () => {
    const report = evaluateGate(conversationResults, { minOverall: 3 });
    expect(report.advisory).toBe(true);
    expect(report.decision).toBe('INCONCLUSIVE');
    expect(report.passed).toBe(false);
  });
});

/**
 * Conversation and agent trace share one evidence model: configured
 * `per_metric.<metric>.score` only. `outcome.achieved` / `outcome.score` must
 * never move the decision, matching the suite gate plane.
 */
describe.each([
  ['conversation', conversationResults, 'factuality', 'tone'] as const,
  ['agent trace', agentTraceResults, 'tool_use', 'planning'] as const,
])('single-eval gate for %s', (_label, baseResults, metricA, metricB) => {
  const withPayload = (
    perMetric: JsonObject,
    outcome: JsonObject | undefined,
  ): EvaluationResults =>
    baseResults.contextType === 'conversation'
      ? {
          contextType: 'conversation',
          conversation: {
            ...baseResults.conversation,
            per_metric: perMetric,
            ...(outcome === undefined ? {} : { outcome }),
          },
        }
      : {
          contextType: 'agent_trace',
          agentTrace: {
            ...baseResults.agentTrace,
            per_metric: perMetric,
            ...(outcome === undefined ? {} : { outcome }),
          },
          trajectory: {
            trajectory_score: 1,
            judge_agreement: { agreed: 1, total: 1 },
            dimensions: [],
          },
        };

  const passingMetrics = {
    [metricA]: { score: 4.2, has_data: true },
    [metricB]: { score: 4.0, has_data: true },
  };

  it('passes when outcome.achieved is false but every configured metric passes', () => {
    const report = evaluateGate(
      withPayload(passingMetrics, { achieved: false, score: 1, has_data: true }),
      { metrics: { [metricA]: 4, [metricB]: 3.5 } },
    );
    expect(report.decision).toBe('PASS');
    expect(report.passed).toBe(true);
  });

  it('fails when outcome.achieved is true but a configured metric is below threshold', () => {
    const report = evaluateGate(
      withPayload(passingMetrics, { achieved: true, score: 5, has_data: true }),
      { metrics: { [metricA]: 4.5 } },
    );
    expect(report.decision).toBe('FAIL');
    expect(report.checks[0]?.actual).toBe('4.2');
  });

  it('is inconclusive when a required metric is missing', () => {
    const report = evaluateGate(
      withPayload(passingMetrics, { achieved: true, score: 5, has_data: true }),
      { metrics: { missing_metric: 3 } },
    );
    expect(report.decision).toBe('INCONCLUSIVE');
    expect(report.checks[0]?.reason).toMatch(/missing/u);
  });

  it('is inconclusive when a required metric score is null', () => {
    const report = evaluateGate(
      withPayload({ [metricA]: { score: null, has_data: true } }, undefined),
      { metrics: { [metricA]: 3 } },
    );
    expect(report.decision).toBe('INCONCLUSIVE');
    expect(report.checks[0]?.actual).toBe('Not available');
  });

  it('is inconclusive when a required metric reports has_data false', () => {
    const report = evaluateGate(
      withPayload({ [metricA]: { score: 4.9, has_data: false } }, undefined),
      { metrics: { [metricA]: 3 } },
    );
    expect(report.decision).toBe('INCONCLUSIVE');
    expect(report.checks[0]?.reason).toMatch(/has_data/u);
  });

  it('ignores the outcome judge entirely when deciding', () => {
    const achieved = evaluateGate(
      withPayload(passingMetrics, { achieved: true, score: 5, has_data: true }),
      { metrics: { [metricA]: 4 } },
    );
    const notAchieved = evaluateGate(
      withPayload(passingMetrics, { achieved: false, score: 0, has_data: true }),
      { metrics: { [metricA]: 4 } },
    );
    expect(achieved.decision).toBe(notAchieved.decision);
  });
});

describe('renderGateReport', () => {
  const run = {
    evaluationId: '22222222-2222-4222-8222-222222222222',
    runId: '44444444-4444-4444-8444-444444444444',
    status: 'COMPLETED',
    configVersionId: 'cfg',
    methodologyVersionId: 'meth',
  };

  it('renders an aligned pass report', () => {
    const report = evaluateGate(scenarioResults, { minOverall: 4 });
    const text = renderGateReport({ report, run, elapsedMs: 12_000 });
    expect(text).toContain('Gate: PASS');
    expect(text).toMatch(/Finished in\s+12s/u);
    expect(text).toContain('METRIC');
  });

  it('marks failing rows', () => {
    const report = evaluateGate(scenarioResults, { minScenario: 3.5 });
    expect(renderGateReport({ report, run, elapsedMs: 1_000 })).toContain('FAIL');
  });
});

describe('parseThresholdNumber', () => {
  it('parses numeric input', () => {
    expect(parseThresholdNumber('--min-overall', '4.25')).toBe(4.25);
  });

  it('rejects non-numeric input as a usage error', () => {
    try {
      parseThresholdNumber('--min-overall', 'high');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AutoevalError);
      expect((error as AutoevalError).kind).toBe('usage');
    }
  });

  it('parses repeatable per-metric thresholds', () => {
    expect(parseMetricThresholds(['factuality=4', 'tone=3.5'])).toEqual({
      factuality: 4,
      tone: 3.5,
    });
  });

  it('rejects a per-metric threshold without a name', () => {
    expect(() => parseMetricThresholds(['=4'])).toThrow(/name=score/u);
  });

  it('preserves Scenario judge-agreement ratio validation', () => {
    expect(() => parseThresholdNumber('--min-judge-agreement', '1.1')).toThrow(/between 0 and 1/u);
  });
});

describe('gate exit code', () => {
  it('maps gate failures to exit code 1', () => {
    const error = new AutoevalError('Gate failed', {
      kind: 'gate_failed',
      code: 'GATE_THRESHOLD_NOT_MET',
    });
    expect(error.exitCode).toBe(1);
  });
});
