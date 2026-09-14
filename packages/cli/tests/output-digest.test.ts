import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  MAX_DIGEST_CHARS,
  buildInterpretationMessage,
  fallbackInterpretation,
  scenarioConvergence,
  scenarioHeadline,
  scenarioMetricScores,
  scenarioModelScores,
  scenarioReliability,
  scenarioTestCaseScores,
  summarizeEvaluationConfiguration,
  summarizeScenarioResults,
} from '../src/output/digest.js';
import type { JsonObject } from '../src/domain/common.js';
import {
  scenarioMultirunResults,
  scenarioSingleRunResults,
  scenarioUnstableResults,
} from './fixtures/scenario-multirun-results.js';
import type { Evaluation, ScenarioResults } from '../src/domain/types.js';
import { IDS } from './helpers.js';

function fixture(name: string): JsonObject {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/api/${name}.json`, import.meta.url), 'utf8'),
  ) as JsonObject;
}

const scenarioResults: ScenarioResults = {
  contextType: 'scenario',
  modelPerformance: fixture('scenario-model-performance'),
  scenarioComparison: fixture('scenario-comparison'),
  modelResponses: fixture('scenario-model-responses'),
};

function evaluation(configuration: JsonObject): Evaluation {
  return {
    version: 1,
    evaluationId: IDS.evaluation,
    methodologyVersionId: IDS.methodology,
    configVersionId: IDS.config,
    isCurrent: true,
    contextType: 'scenario',
    raw: {},
    configuration,
  };
}

describe('evaluation configuration digest', () => {
  it('surfaces scenarios, models, quality standard, and runs per scenario', () => {
    const digest = summarizeEvaluationConfiguration(
      evaluation({
        display_name: 'Support Scenario Test',
        judge_model: 'gpt-5-mini',
        primary_model: 'gpt-5.6-luna',
        comparison_models: ['gpt-5.6-sol', 'gpt-5.6-terra'],
        runs_per_scenario: 3,
        temperature: 0.2,
        selected_metrics: ['factuality', 'fluency'],
        evaluator_instructions: JSON.stringify({
          type: 'qs_v1',
          judge_instructions: 'Compare the primary and comparison models for correctness.',
          anchors: [],
        }),
        scenarios: [
          { id: 'comparison-1', name: 'One-sentence summary', prompt: 'Summarize in one sentence' },
          { id: 'comparison-2', name: 'Three-item checklist', expected: 'Exactly three lines' },
        ],
      }),
    );

    expect(digest).toContain('Judge model: gpt-5-mini');
    expect(digest).toContain('Primary model: gpt-5.6-luna');
    expect(digest).toContain('Comparison models: gpt-5.6-sol, gpt-5.6-terra');
    expect(digest).not.toContain('Runs per scenario');
    expect(digest).toContain('Selected metrics: factuality, fluency');
    expect(digest).toContain('Judge rubric: Compare the primary and comparison models');
    expect(digest).toContain('Scenarios (2):');
    expect(digest).toContain('1. One-sentence summary (comparison-1)');
    expect(digest).toContain('Expected: Exactly three lines');
  });

  it('omits details the payload does not contain instead of inventing them', () => {
    const digest = summarizeEvaluationConfiguration(evaluation({}));

    expect(digest).toContain('Context: scenario');
    expect(digest).not.toContain('Judge model');
    expect(digest).not.toContain('Scenarios');
    expect(digest).not.toContain('Judge rubric');
  });

  it('surfaces judge model from evaluator instructions JSON when top-level field is absent', () => {
    const digest = summarizeEvaluationConfiguration(
      evaluation({
        evaluator_instructions: JSON.stringify({
          judge_model: 'gpt-5-mini',
          name: 'Support returns rubric',
          anchors: [{ score: 1 }],
          judge_instructions: 'Score factuality, relevance, and completeness.',
        }),
      }),
    );

    expect(digest).toContain('Judge model: gpt-5-mini');
    expect(digest).toContain('Quality standard: Support returns rubric');
    expect(digest).toContain('Quality standard anchors: 1');
  });

  it('surfaces judge model and quality standard from object-form evaluator instructions', () => {
    const digest = summarizeEvaluationConfiguration(
      evaluation({
        evaluator_instructions: {
          judge_model: 'gpt-5-mini',
          name: 'Support returns rubric',
          anchors: [{ score: 1 }],
        },
      }),
    );

    expect(digest).toContain('Judge model: gpt-5-mini');
    expect(digest).toContain('Quality standard: Support returns rubric');
    expect(digest).toContain('Quality standard anchors: 1');
  });

  it('keeps the digest bounded for oversized configurations', () => {
    const digest = summarizeEvaluationConfiguration(
      evaluation({
        prompt_text: 'p'.repeat(10_000),
        scenarios: Array.from({ length: 200 }, (_, index) => ({
          id: `scenario-${index}`,
          name: `Scenario ${index}`,
          prompt: 'q'.repeat(500),
        })),
      }),
    );

    expect(digest.length).toBeLessThanOrEqual(MAX_DIGEST_CHARS + 1);
  });
});

describe('scenario results digest', () => {
  it('reports model ranking, scenario spread, and response coverage', () => {
    const digest = summarizeScenarioResults(scenarioResults);

    expect(digest).toContain('DeepSeek V4 Pro — overall mean 4.163');
    expect(digest).toContain('primary');
    expect(digest).toContain('Best: DeepSeek V4 Pro (4.163); weakest: GPT-5 (3.937)');
    expect(digest).toContain('Overall mean across models: 4.05');
    expect(digest).toContain('Scenario comparison (3 scenarios):');
    expect(digest).toContain('Cosmetic rename PR — DeepSeek V4 Pro 4.26, GPT-5 3.43 (gap 0.83)');
    expect(digest).toContain('Model responses (3 scenarios):');
    expect(digest).toContain('Statuses: successful 3');
  });

  it('states when payloads carry no scores rather than guessing', () => {
    const digest = summarizeScenarioResults({
      contextType: 'scenario',
      modelPerformance: {},
      scenarioComparison: {},
      modelResponses: {},
    });

    expect(digest).toContain('Model performance: no scored models were returned');
    expect(digest).toContain('Scenario comparison: no scored scenarios were returned');
    expect(digest).toContain('Model responses: none were returned');
  });

  it('drops models whose overall score has no data', () => {
    expect(
      scenarioModelScores({
        models: [
          { display_name: 'No data', scores: { overall: { mean: 0, has_data: false } } },
          { display_name: 'Scored', n_runs: 2, scores: { overall: { mean: 3.5, has_data: true } } },
        ],
      }),
    ).toEqual([{ name: 'Scored', mean: 3.5, runs: 2 }]);
  });
});

describe('interpretation turn helpers', () => {
  it('keeps the user question and appends the gathered digests', () => {
    const message = buildInterpretationMessage(
      'What is this eval about and how did it do?',
      ['Evaluation inputs:\n  Context: scenario', 'Evaluation results:\n  Overall score: 2.7'],
      4_000,
    );

    expect(message).toContain('What is this eval about and how did it do?');
    expect(message).toContain('Context: scenario');
    expect(message).toContain('Overall score: 2.7');
  });

  it('never exceeds the planner message budget', () => {
    const message = buildInterpretationMessage('Question?', ['x'.repeat(9_000)], 500);

    expect(message.length).toBeLessThanOrEqual(500);
  });

  it('falls back to headline digest facts when the planner returns nothing usable', () => {
    const answer = fallbackInterpretation([
      'Configuration summary:\n  Context: scenario\n  Judge rubric: Be accurate',
      'Results:\n  Overall score: 2.7\n  Weakest: factuality (2.1)',
    ]);

    expect(answer).toContain('Judge rubric: Be accurate');
    expect(answer).toContain('Overall score: 2.7');
  });

  it('returns nothing when there is no digest to summarise', () => {
    expect(fallbackInterpretation([])).toBeUndefined();
  });
});

describe('scenario digest', () => {
  const results = scenarioMultirunResults;

  it('reads the headline score, interval, runs, and test cases from the payload', () => {
    expect(scenarioHeadline(results.modelPerformance, results.scenarioComparison)).toEqual({
      mean: 3.916,
      ci95: 0.224,
      ci95Lower: 3.692,
      ci95Upper: 4.14,
      runs: 12,
      testCases: 3,
      primaryModel: 'Llama 3.3 70B',
    });
  });

  it('lists primary metrics alphabetically and drops metrics without data', () => {
    const [primary] = scenarioMetricScores(results.modelPerformance);

    expect(primary?.isPrimary).toBe(true);
    expect(primary?.metrics.map((metric) => metric.metric)).toEqual([
      'completeness',
      'factuality',
      'fluency',
      'helpfulness',
      'relevance',
      'safety',
    ]);
  });

  it('keeps test cases in backend order with their intervals', () => {
    expect(
      scenarioTestCaseScores(results.scenarioComparison).map((row) => [
        row.name,
        row.scores[0]?.ci95,
      ]),
    ).toEqual([
      ['Cosmetic rename PR', 0.502],
      ['Optional array reduce', 0.278],
      ['Swallowed error in route', 0.136],
    ]);
  });

  it('reads the reported consistency figures instead of recomputing them', () => {
    expect(scenarioReliability(results.status)).toEqual({
      multiRun: true,
      achievedConsistency: 0.09,
      targetConsistency: 0.1,
      targetOperator: '<',
      stable: true,
      runsCompleted: 4,
      runsPlanned: 5,
      stoppedAtRun: 4,
      autoStopTriggered: true,
    });
  });

  it('calls a run unstable when the reported figure misses the target', () => {
    const reliability = scenarioReliability(scenarioUnstableResults.status);

    expect(reliability.stable).toBe(false);
    expect(reliability.maxRunsReached).toBe(true);
    expect(reliability.stoppedAtRun).toBe(3);
  });

  it('reports no multi-run reliability when the status carries no consistency figure', () => {
    expect(scenarioReliability(scenarioSingleRunResults.status)).toEqual({ multiRun: false });
    expect(scenarioReliability(undefined)).toEqual({ multiRun: false });
  });

  it('reads convergence detail from a status payload without recomputing it', () => {
    expect(
      scenarioConvergence({
        convergence: {
          is_stable: true,
          consistency_target: 'CV < 0.1',
          observed_variation: 0.09,
          auto_stop_run: 4,
          runs_planned: 5,
          judges_per_output: 3,
        },
      }),
    ).toEqual({
      consistencyTarget: 'CV < 0.1',
      observedVariation: 0.09,
      autoStopRun: 4,
      runsPlanned: 5,
      judgesPerOutput: 3,
      targetMet: true,
    });
  });
});
