import type { JsonObject } from '../../src/domain/common.js';

/**
 * Scenario reader payloads carrying every field the backend returns, including
 * the ones no renderer reads. They exist so a regression that reintroduces
 * presentation-driven field stripping into `results --json` fails a test.
 *
 * Values are synthetic; no account data is embedded.
 */

export const fullModelPerformance: JsonObject = {
  evaluation_id: '22222222-2222-4222-8222-222222222222',
  generated_at: '2026-09-07T18:29:17.407402Z',
  schema_version: 'v1.0',
  filters_applied: {
    confidence_level: 0.95,
    include_ci: true,
    metrics: ['overall', 'factuality'],
    models: [],
  },
  models: [
    {
      consistency_level: 'low',
      display_name: 'Llama 3.3 70B',
      is_primary: true,
      model_key: 'meta-llama/llama-3.3-70b-instruct-turbo',
      model_name: 'llama-3.3-70b',
      n_runs: 3,
      provider: 'Other',
      provider_key: 'other',
      scores: {
        overall: {
          ci95: 0.829,
          ci95_lower: 3.307,
          ci95_upper: 4.966,
          has_data: true,
          insufficient_samples: false,
          mean: 4.137,
          sample_size: 3,
          std_dev: 0.334,
        },
        factuality: {
          ci95: 0.826,
          ci95_lower: 3.421,
          ci95_upper: 5,
          has_data: true,
          insufficient_samples: false,
          mean: 4.247,
          sample_size: 3,
          std_dev: 0.332,
        },
      },
    },
  ],
};

export const fullScenarioComparison: JsonObject = {
  evaluation_id: '22222222-2222-4222-8222-222222222222',
  generated_at: '2026-09-07T18:29:17.407402Z',
  schema_version: 'v1.0',
  filters_applied: { confidence_level: 0.95, include_ci: true },
  evaluation_summary: {
    model_count: 1,
    overall_ci: 0.829,
    overall_ci_lower: 3.307,
    overall_ci_upper: 4.966,
    overall_mean: 4.137,
    test_case_count: 1,
    total_evaluations: 3,
  },
  scenarios: [
    {
      scenario_id: '77777777-7777-4777-8777-777777777771',
      scenario_index: 0,
      scenario_name: 'Forgot password, simple request',
      color_code: '#1f8f6a',
      model_scores: [
        {
          model_key: 'meta-llama/llama-3.3-70b-instruct-turbo',
          model_name: 'llama-3.3-70b',
          provider_key: 'other',
          score: { ci95: 0.829, mean: 4.137, sample_size: 3, has_data: true },
        },
      ],
    },
  ],
};

export const fullModelResponses: JsonObject = {
  evaluation_id: '22222222-2222-4222-8222-222222222222',
  generated_at: '2026-09-07T18:29:17.407402Z',
  schema_version: 'v1.0',
  outputs: [
    {
      scenario_id: '77777777-7777-4777-8777-777777777771',
      scenario_index: 0,
      scenario_name: 'Forgot password, simple request',
      status: 'successful',
      input: 'I cannot remember my password. Can you help me reset it?',
      actions: {
        view_details_url: 'https://app.example.test/evaluations/demo/runs/demo',
        view_details_label: 'View details',
      },
      model_responses: [
        {
          display_name: 'Llama 3.3 70B',
          model_key: 'meta-llama/llama-3.3-70b-instruct-turbo',
          model_name: 'llama-3.3-70b',
          provider_key: 'other',
          status: 'success',
          best_run: {
            execution_id: '88888888-8888-4888-8888-888888888881',
            run_number: 2,
            overall_score: 4.137,
            response: 'I can help you reset your password.',
            metadata: {
              cost: 0.0123,
              input_tokens: 412,
              output_tokens: 268,
              tokens: 680,
              total_tokens: 680,
              latency_ms: 1840,
            },
          },
          metric_scores: { factuality: 4.247 },
        },
      ],
    },
  ],
  pagination: {
    has_next: false,
    has_previous: false,
    limit: 50,
    page: 1,
    total: 1,
    total_pages: 1,
  },
};

/** Sentinel paths that must survive `results --json` untouched. */
export const preservedSentinelKeys = [
  'evaluation_id',
  'generated_at',
  'schema_version',
  'filters_applied',
  'provider_key',
  'model_name',
  'scenario_id',
  'color_code',
  'actions',
  'view_details_url',
  'execution_id',
  'metadata',
  'pagination',
  'consistency_level',
] as const;
