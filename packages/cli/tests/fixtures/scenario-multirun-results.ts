import type { JsonObject } from '../../src/domain/common.js';
import type { ScenarioResults } from '../../src/domain/types.js';

export type ScenarioResultsFixture = ScenarioResults & { status: JsonObject };

/**
 * Synthetic scenario payloads shaped like the backend result endpoints. Values
 * are invented; no account data is embedded.
 */

/** Multi-run evaluation that converged: the consistency target was met. */
export const scenarioMultirunResults: ScenarioResultsFixture = {
  contextType: 'scenario',
  status: {
    evaluationState: 'COMPLETED',
    evaluationMetrics: {
      achievedConsistency: 0.09,
      targetConsistency: 0.1,
      targetConsistencyOperator: '<',
      runsCompleted: 4,
      runsPlanned: 5,
      judgesPerOutput: 3,
      autoStopTriggered: {
        triggered: true,
        reason: 'CONSISTENCY_TARGET_MET',
        atRun: 4,
      },
    },
  },
  modelPerformance: {
    models: [
      {
        display_name: 'Llama 3.3 70B',
        is_primary: true,
        model_key: 'meta-llama/llama-3.3-70b-instruct-turbo',
        n_runs: 12,
        consistency_level: 'low',
        scores: {
          overall: {
            mean: 3.916,
            ci95: 0.224,
            ci95_lower: 3.692,
            ci95_upper: 4.14,
            sample_size: 12,
            has_data: true,
          },
          completeness: { mean: 3.787, ci95: 0.339, sample_size: 12, has_data: true },
          factuality: { mean: 4.12, ci95: 0.212, sample_size: 12, has_data: true },
          fluency: { mean: 4.067, ci95: 0.198, sample_size: 12, has_data: true },
          helpfulness: { mean: 3.898, ci95: 0.276, sample_size: 12, has_data: true },
          relevance: { mean: 3.84, ci95: 0.213, sample_size: 12, has_data: true },
          safety: { mean: 3.787, ci95: 0.205, sample_size: 12, has_data: true },
          hallucination: { has_data: false },
        },
      },
    ],
  },
  scenarioComparison: {
    evaluation_summary: {
      model_count: 1,
      overall_mean: 3.916,
      overall_ci: 0.224,
      overall_ci_lower: 3.692,
      overall_ci_upper: 4.14,
      test_case_count: 3,
      total_evaluations: 3,
    },
    scenarios: [
      {
        scenario_index: 0,
        scenario_name: 'Cosmetic rename PR',
        model_scores: [
          {
            display_name: 'Llama 3.3 70B',
            score: { mean: 3.525, ci95: 0.502, sample_size: 4, has_data: true },
          },
        ],
      },
      {
        scenario_index: 1,
        scenario_name: 'Optional array reduce',
        model_scores: [
          {
            display_name: 'Llama 3.3 70B',
            score: { mean: 4.18, ci95: 0.278, sample_size: 4, has_data: true },
          },
        ],
      },
      {
        scenario_index: 2,
        scenario_name: 'Swallowed error in route',
        model_scores: [
          {
            display_name: 'Llama 3.3 70B',
            score: { mean: 4.042, ci95: 0.136, sample_size: 4, has_data: true },
          },
        ],
      },
    ],
  },
  modelResponses: {
    outputs: [
      {
        scenario_index: 0,
        scenario_name: 'Cosmetic rename PR',
        input: 'Review this rename-only pull request.',
        status: 'successful',
        model_responses: [
          {
            display_name: 'Llama 3.3 70B',
            status: 'success',
            run_count: 4,
            metric_scores: { completeness: 3.6, factuality: 3.9 },
            best_run: {
              run_number: 2,
              overall_score: 3.6,
              response: 'The rename is safe to merge.',
            },
            total_tokens: 820,
            cost: 0.0021,
            latency_ms: 4300,
          },
        ],
      },
      {
        scenario_index: 1,
        scenario_name: 'Optional array reduce',
        input: 'Review this reduce over a possibly empty array.',
        status: 'successful',
        model_responses: [
          {
            display_name: 'Llama 3.3 70B',
            status: 'success',
            run_count: 4,
            metric_scores: { completeness: 4.2, factuality: 4.3 },
            best_run: {
              run_number: 3,
              overall_score: 4.4,
              response: 'The reduce throws on an empty array unless an initial value is supplied.',
            },
            total_tokens: 910,
            cost: 0.0024,
            latency_ms: 5100,
          },
        ],
      },
    ],
  },
};

/** Multi-run evaluation that never converged before the run budget ran out. */
export const scenarioUnstableResults: ScenarioResultsFixture = {
  contextType: 'scenario',
  status: {
    evaluationState: 'COMPLETED',
    evaluationMetrics: {
      achievedConsistency: 0.83,
      targetConsistency: 0.1,
      targetConsistencyOperator: '<',
      runsCompleted: 3,
      runsPlanned: 3,
      autoStopTriggered: {
        triggered: false,
        reason: 'MAX_RUNS_REACHED',
      },
    },
  },
  modelPerformance: {
    models: [
      {
        display_name: 'Llama 3.3 70B',
        is_primary: true,
        model_key: 'meta-llama/llama-3.3-70b-instruct-turbo',
        n_runs: 3,
        scores: {
          overall: {
            mean: 1.92,
            ci95: 3.96,
            ci95_lower: 1,
            ci95_upper: 5,
            sample_size: 3,
            has_data: true,
          },
          completeness: {
            mean: 3.19,
            ci95: 0.51,
            ci95_lower: 2.68,
            ci95_upper: 3.7,
            sample_size: 3,
            has_data: true,
          },
          factuality: {
            mean: 3.22,
            ci95: 1.54,
            ci95_lower: 1.68,
            ci95_upper: 4.76,
            sample_size: 3,
            has_data: true,
          },
          safety: {
            mean: 1.91,
            ci95: 3.9,
            ci95_lower: 1,
            ci95_upper: 5,
            sample_size: 3,
            has_data: true,
          },
        },
      },
    ],
  },
  scenarioComparison: {
    evaluation_summary: {
      model_count: 1,
      overall_mean: 1.92,
      overall_ci: 3.96,
      overall_ci_lower: 1,
      overall_ci_upper: 5,
      test_case_count: 1,
      total_evaluations: 1,
    },
    scenarios: [
      {
        scenario_index: 0,
        scenario_name: 'Ambiguous refund request',
        model_scores: [
          {
            display_name: 'Llama 3.3 70B',
            score: { mean: 1.92, ci95: 3.96, sample_size: 3, has_data: true },
          },
        ],
      },
    ],
  },
  modelResponses: {
    outputs: [
      {
        scenario_index: 0,
        scenario_name: 'Ambiguous refund request',
        input: 'The customer wants a refund outside the policy window.',
        status: 'successful',
        model_responses: [
          {
            display_name: 'Llama 3.3 70B',
            status: 'success',
            run_count: 3,
            metric_scores: { completeness: 3.19, factuality: 3.22, safety: 1.91 },
            best_run: {
              run_number: 1,
              overall_score: 2.4,
              response: 'I can look into an exception for you.',
            },
            total_tokens: 410,
            cost: 0.0009,
            latency_ms: 2600,
          },
        ],
      },
    ],
  },
};

/** Single-run evaluation: no consistency figures, so no reliability signal. */
export const scenarioSingleRunResults: ScenarioResultsFixture = {
  contextType: 'scenario',
  status: {
    evaluationState: 'COMPLETED',
    progress: { percentage: 100, runsCompleted: 1, totalRuns: 1 },
  },
  modelPerformance: {
    models: [
      {
        display_name: 'Llama 3.3 70B',
        is_primary: true,
        model_key: 'meta-llama/llama-3.3-70b-instruct-turbo',
        n_runs: 1,
        scores: {
          overall: { mean: 3.76, sample_size: 1, has_data: true },
          completeness: {
            mean: 3.5,
            sample_size: 1,
            has_data: true,
            insufficient_samples: true,
          },
          factuality: { mean: 4.0, sample_size: 1, has_data: true },
        },
      },
    ],
  },
  scenarioComparison: {
    evaluation_summary: {
      model_count: 1,
      overall_mean: 3.76,
      test_case_count: 2,
      total_evaluations: 2,
    },
    scenarios: [
      {
        scenario_index: 0,
        scenario_name: 'Password reset request',
        model_scores: [
          {
            display_name: 'Llama 3.3 70B',
            score: {
              mean: 3.5,
              sample_size: 1,
              has_data: true,
              insufficient_samples: true,
            },
          },
        ],
      },
      {
        scenario_index: 1,
        scenario_name: 'Locked account',
        model_scores: [
          { display_name: 'Llama 3.3 70B', score: { mean: 4.0, sample_size: 1, has_data: true } },
        ],
      },
    ],
  },
  modelResponses: {
    outputs: [
      {
        scenario_index: 1,
        scenario_name: 'Locked account',
        input: 'I am locked out after too many attempts.',
        status: 'successful',
        model_responses: [
          {
            display_name: 'Llama 3.3 70B',
            status: 'success',
            metric_scores: { completeness: 3.5, factuality: 4.0 },
            best_run: {
              overall_score: 4.0,
              response: 'Accounts unlock automatically after 30 minutes.',
            },
            total_tokens: 300,
            cost: 0.0008,
            latency_ms: 1900,
          },
        ],
      },
    ],
  },
};
