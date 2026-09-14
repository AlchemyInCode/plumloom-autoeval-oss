import { describe, expect, it } from 'vitest';

import { gateSuite, suiteGateExitError } from '../src/actions/suite-gate.js';
import type { SuiteSummary } from '../src/actions/suite.js';
import type { JsonObject } from '../src/domain/common.js';
import type { EvaluationResults } from '../src/domain/types.js';
import {
  decideEvalGate,
  rollUpSuiteDecision,
  type EvalGateDecision,
  type GateEvalInput,
} from '../src/gate/decision.js';
import type { SuiteGatePolicy } from '../src/gate/policy.js';
import { renderSuiteGateReport } from '../src/output/human.js';
import { OutputWriter } from '../src/output/writer.js';
import { parseSuiteManifest } from '../src/suite/manifest.js';

const PRIMARY = 'openai/gpt-5';

type Cell = {
  mean?: number | null;
  ci95_lower?: number | null;
  ci95_upper?: number | null;
  error?: string;
};

function scenarioResults(overall: Cell, scenarios: Record<string, Cell> = {}): EvaluationResults {
  return {
    contextType: 'scenario',
    modelPerformance: {
      models: [
        { display_name: 'GPT-5', model_key: PRIMARY, is_primary: true, scores: { overall } },
      ],
    } as unknown as JsonObject,
    scenarioComparison: {
      scenarios: Object.entries(scenarios).map(([scenario_name, score]) => ({
        scenario_name,
        model_scores: [{ model_key: PRIMARY, is_primary: true, score }],
      })),
    } as unknown as JsonObject,
    modelResponses: {},
  };
}

function sessionResults(
  contextType: 'conversation' | 'agent_trace',
  perMetric: Record<string, { score: number | null; has_data?: boolean }>,
): EvaluationResults {
  const payload = {
    outcome: { achieved: true, score: 5, has_data: true },
    overall: 4.9,
    per_metric: perMetric,
  } as unknown as JsonObject;
  return contextType === 'conversation'
    ? { contextType, conversation: payload }
    : { contextType, agentTrace: payload };
}

function singleRunStatus(): JsonObject {
  return { evaluationState: 'COMPLETED', progress: { totalRuns: 1 } };
}

function multiRunStatus(input: {
  autoStopReason?: string;
  achieved?: number | null;
  target?: number | null;
  operator?: string;
  failureReason?: string;
}): JsonObject {
  return {
    evaluationState: 'COMPLETED',
    progress: { totalRuns: 5 },
    evaluationMetrics: {
      autoStopTriggered: { reason: input.autoStopReason ?? null },
      achievedConsistency: input.achieved ?? null,
      targetConsistency: input.target ?? null,
      ...(input.operator ? { targetConsistencyOperator: input.operator } : {}),
    },
    ...(input.failureReason ? { failureDetails: { failureReason: input.failureReason } } : {}),
  };
}

function decide(input: {
  results?: EvaluationResults;
  policy: SuiteGatePolicy;
  runStatusRaw?: JsonObject;
  status?: GateEvalInput['status'];
  error?: string;
}): EvalGateDecision {
  return decideEvalGate({
    index: 0,
    inputFile: './eval.json',
    evaluationId: '22222222-2222-4222-8222-222222222222',
    runId: '55555555-5555-4555-8555-555555555555',
    status: input.status ?? 'completed',
    policy: input.policy,
    ...(input.results ? { results: input.results } : {}),
    ...(input.runStatusRaw ? { runStatusRaw: input.runStatusRaw, runState: 'COMPLETED' } : {}),
    ...(input.error ? { error: input.error } : {}),
  });
}

describe('scenario single-run gating', () => {
  const policy: SuiteGatePolicy = { minOverall: 4.0, minScenario: 3.5 };

  it('passes when the mean and every scenario mean meet the thresholds', () => {
    const decision = decide({
      results: scenarioResults({ mean: 4.2 }, { Checkout: { mean: 3.8 } }),
      policy,
      runStatusRaw: singleRunStatus(),
    });
    expect(decision.decision).toBe('PASS');
    expect(decision.evidence.runMode).toBe('single_run');
    expect(decision.checks.every((check) => check.basis === 'mean')).toBe(true);
  });

  it('fails when a scenario mean is below the threshold', () => {
    const decision = decide({
      results: scenarioResults({ mean: 4.2 }, { Checkout: { mean: 3.2 } }),
      policy,
      runStatusRaw: singleRunStatus(),
    });
    expect(decision.decision).toBe('FAIL');
    expect(decision.checks.find((check) => check.metric === 'scenario:Checkout')?.decision).toBe(
      'FAIL',
    );
  });

  it('is inconclusive when a required mean is missing, and never treats null as zero', () => {
    const decision = decide({
      results: scenarioResults({ mean: null }, { Checkout: { mean: 4.9 } }),
      policy,
      runStatusRaw: singleRunStatus(),
    });
    expect(decision.decision).toBe('INCONCLUSIVE');
    expect(decision.checks[0]?.actual).toBe('Not available');
  });

  it('is inconclusive for an errored scenario cell', () => {
    const decision = decide({
      results: scenarioResults({ mean: 4.5 }, { Checkout: { mean: null, error: 'judge failed' } }),
      policy,
      runStatusRaw: singleRunStatus(),
    });
    expect(decision.decision).toBe('INCONCLUSIVE');
  });
});

describe('scenario multi-run gating', () => {
  const policy: SuiteGatePolicy = { minOverall: 4.0 };

  it('passes when the lower bound clears the threshold and the run converged', () => {
    const decision = decide({
      results: scenarioResults({ mean: 4.35, ci95_lower: 4.15, ci95_upper: 4.55 }),
      policy,
      runStatusRaw: multiRunStatus({ autoStopReason: 'OPTIMAL_CONFIDENCE_REACHED' }),
    });
    expect(decision.decision).toBe('PASS');
    expect(decision.evidence.convergence?.status).toBe('CONVERGED');
    expect(decision.checks[0]?.basis).toBe('confidence-interval');
  });

  it('treats the backend consistency-target reason as converged', () => {
    const decision = decide({
      results: scenarioResults({ mean: 4.35, ci95_lower: 4.15, ci95_upper: 4.55 }),
      policy,
      runStatusRaw: multiRunStatus({ autoStopReason: 'CONSISTENCY_TARGET_MET' }),
    });

    expect(decision.evidence.convergence?.status).toBe('CONVERGED');
    expect(decision.decision).toBe('PASS');
  });

  it('fails when the upper bound is below the threshold', () => {
    const decision = decide({
      results: scenarioResults({ mean: 3.7, ci95_lower: 3.5, ci95_upper: 3.9 }),
      policy,
      runStatusRaw: multiRunStatus({ autoStopReason: 'OPTIMAL_CONFIDENCE_REACHED' }),
    });
    expect(decision.decision).toBe('FAIL');
  });

  it('is inconclusive when the interval straddles the threshold', () => {
    const decision = decide({
      results: scenarioResults({ mean: 4.1, ci95_lower: 3.9, ci95_upper: 4.3 }),
      policy,
      runStatusRaw: multiRunStatus({ autoStopReason: 'OPTIMAL_CONFIDENCE_REACHED' }),
    });
    expect(decision.decision).toBe('INCONCLUSIVE');
    expect(decision.checks[0]?.reason).toContain('crosses release threshold');
  });

  it('never passes when convergence was enabled but not reached', () => {
    const decision = decide({
      results: scenarioResults({ mean: 4.4, ci95_lower: 4.2, ci95_upper: 4.6 }),
      policy,
      runStatusRaw: multiRunStatus({
        autoStopReason: 'MAX_RUNS_REACHED',
        achieved: 0.62,
        target: 0.8,
      }),
    });
    expect(decision.evidence.convergence?.status).toBe('NOT_CONVERGED');
    expect(decision.decision).toBe('INCONCLUSIVE');
  });

  // Live backend payload: consistency is reported as a spread to stay under,
  // so `achieved < target` with `MAX_RUNS_REACHED` is a converged run.
  it('honours a lower-is-better consistency target', () => {
    const decision = decide({
      results: scenarioResults({ mean: 4.24, ci95_lower: 4.025, ci95_upper: 4.455 }),
      policy,
      runStatusRaw: multiRunStatus({
        autoStopReason: 'MAX_RUNS_REACHED',
        achieved: 0.02,
        target: 0.1,
        operator: '<',
      }),
    });
    expect(decision.evidence.convergence?.status).toBe('CONVERGED');
    expect(decision.evidence.convergence?.targetConsistencyOperator).toBe('<');
    expect(decision.decision).toBe('PASS');
  });

  it('still reports NOT_CONVERGED when a lower-is-better target is missed', () => {
    const decision = decide({
      results: scenarioResults({ mean: 4.24, ci95_lower: 4.025, ci95_upper: 4.455 }),
      policy,
      runStatusRaw: multiRunStatus({
        autoStopReason: 'MAX_RUNS_REACHED',
        achieved: 0.42,
        target: 0.1,
        operator: '<',
      }),
    });
    expect(decision.evidence.convergence?.status).toBe('NOT_CONVERGED');
    expect(decision.decision).toBe('INCONCLUSIVE');
  });

  it('passes fixed-N runs on the interval alone when convergence is disabled', () => {
    const decision = decide({
      results: scenarioResults({ mean: 4.4, ci95_lower: 4.2, ci95_upper: 4.6 }),
      policy,
      runStatusRaw: multiRunStatus({ autoStopReason: 'MAX_RUNS_REACHED', target: null }),
    });
    expect(decision.evidence.convergence?.status).toBe('NOT_APPLICABLE');
    expect(decision.decision).toBe('PASS');
  });

  it('is inconclusive when a required confidence interval is null', () => {
    const decision = decide({
      results: scenarioResults({ mean: 4.4, ci95_lower: null, ci95_upper: null }),
      policy,
      runStatusRaw: multiRunStatus({ autoStopReason: 'OPTIMAL_CONFIDENCE_REACHED' }),
    });
    expect(decision.decision).toBe('INCONCLUSIVE');
  });

  it('falls back to interval-only gating when convergence fields are unavailable', () => {
    const decision = decide({
      results: scenarioResults({ mean: 4.4, ci95_lower: 4.2, ci95_upper: 4.6 }),
      policy,
      runStatusRaw: { evaluationState: 'COMPLETED', progress: { totalRuns: 5 } },
    });
    expect(decision.evidence.convergence?.fieldsUnavailable).toBe(true);
    expect(decision.evidence.convergence?.status).toBe('UNKNOWN');
    expect(decision.decision).toBe('PASS');
  });
});

describe.each(['conversation', 'agent_trace'] as const)('%s metric gating', (contextType) => {
  const policy: SuiteGatePolicy = {
    metrics: { factuality: 4.0, relevance: 4.0, completeness: 3.5 },
  };

  it('passes when every configured metric clears its threshold', () => {
    const decision = decide({
      results: sessionResults(contextType, {
        factuality: { score: 4.2 },
        relevance: { score: 4.3 },
        completeness: { score: 3.8 },
      }),
      policy,
      runStatusRaw: singleRunStatus(),
    });
    expect(decision.decision).toBe('PASS');
  });

  it('fails when a configured metric misses its threshold', () => {
    const decision = decide({
      results: sessionResults(contextType, {
        factuality: { score: 3.6 },
        relevance: { score: 4.3 },
        completeness: { score: 3.8 },
      }),
      policy,
      runStatusRaw: singleRunStatus(),
    });
    expect(decision.decision).toBe('FAIL');
    expect(decision.reason).toContain('factuality');
  });

  it('is inconclusive for a missing metric or has_data:false', () => {
    const missing = decide({
      results: sessionResults(contextType, {
        relevance: { score: 4.3 },
        completeness: { score: 3.8 },
      }),
      policy,
      runStatusRaw: singleRunStatus(),
    });
    expect(missing.decision).toBe('INCONCLUSIVE');

    const noData = decide({
      results: sessionResults(contextType, {
        factuality: { score: null, has_data: false },
        relevance: { score: 4.3 },
        completeness: { score: 3.8 },
      }),
      policy,
      runStatusRaw: singleRunStatus(),
    });
    expect(noData.decision).toBe('INCONCLUSIVE');
  });

  it('ignores outcome fields entirely', () => {
    const decision = decide({
      results: sessionResults(contextType, { factuality: { score: 4.5 } }),
      policy: { metrics: { factuality: 4.0 } },
      runStatusRaw: singleRunStatus(),
    });
    expect(decision.decision).toBe('PASS');
    expect(JSON.stringify(decision.checks)).not.toContain('outcome');
  });
});

describe('unusable evidence', () => {
  it('reports ERROR when result fetching failed', () => {
    const decision = decide({
      status: 'result_failed',
      error: 'results endpoint returned 500',
      policy: { minOverall: 4 },
    });
    expect(decision.decision).toBe('ERROR');
    expect(decision.reason).toContain('500');
  });

  it('reports ERROR when execution failed', () => {
    const decision = decide({ status: 'execution_failed', policy: { minOverall: 4 } });
    expect(decision.decision).toBe('ERROR');
  });
});

describe('suite roll-up', () => {
  const make = (decision: EvalGateDecision['decision'], index: number): EvalGateDecision => ({
    index,
    inputFile: `./eval-${index}.json`,
    decision,
    checks: [],
    reason: 'test',
    evidence: { runMode: 'single_run' },
  });

  it('blocks on any ERROR, then FAIL, then INCONCLUSIVE', () => {
    expect(
      rollUpSuiteDecision([make('PASS', 0), make('ERROR', 1), make('FAIL', 2)]).suiteDecision,
    ).toBe('ERROR');
    expect(
      rollUpSuiteDecision([make('PASS', 0), make('FAIL', 1), make('INCONCLUSIVE', 2)])
        .suiteDecision,
    ).toBe('FAIL');
    expect(rollUpSuiteDecision([make('PASS', 0), make('INCONCLUSIVE', 1)]).suiteDecision).toBe(
      'INCONCLUSIVE',
    );
  });

  it('passes only when every eval passes, and counts each decision', () => {
    const report = rollUpSuiteDecision([make('PASS', 0), make('PASS', 1)]);
    expect(report.suiteDecision).toBe('PASS');
    expect(report.counts).toEqual({ PASS: 2, FAIL: 0, INCONCLUSIVE: 0, ERROR: 0 });
  });
});

describe('CI exit behaviour', () => {
  const result = (decision: EvalGateDecision['decision']) => ({
    workspaceId: 'ws',
    suiteDecision: decision,
    counts: { PASS: 0, FAIL: 0, INCONCLUSIVE: 0, ERROR: 0, [decision]: 1 } as Record<
      EvalGateDecision['decision'],
      number
    >,
    perEvalDecisions: [],
  });

  it('exits zero only for PASS', () => {
    expect(suiteGateExitError(result('PASS'))).toBeUndefined();
    expect(suiteGateExitError(result('FAIL'))?.exitCode).toBe(1);
    expect(suiteGateExitError(result('INCONCLUSIVE'))?.exitCode).toBe(1);
    expect(suiteGateExitError(result('ERROR'))?.exitCode).toBe(5);
  });

  it('keeps FAIL, INCONCLUSIVE, and ERROR distinguishable', () => {
    expect(suiteGateExitError(result('FAIL'))?.code).toBe('SUITE_GATE_FAIL');
    expect(suiteGateExitError(result('INCONCLUSIVE'))?.code).toBe('SUITE_GATE_INCONCLUSIVE');
    expect(suiteGateExitError(result('ERROR'))?.code).toBe('SUITE_GATE_ERROR');
  });
});

describe('suite gate plane over a suite summary', () => {
  const summary: SuiteSummary = {
    workspaceId: '11111111-1111-4111-8111-111111111111',
    total: 2,
    completed: 1,
    failed: 1,
    evals: [
      {
        index: 0,
        inputFile: '/repo/evals/scenario.json',
        status: 'completed',
        execution: {
          evaluationId: '22222222-2222-4222-8222-222222222222',
          evaluationName: 'Scenario regression',
          contextType: 'scenario',
          runId: '55555555-5555-4555-8555-555555555555',
          state: 'COMPLETED',
          elapsedMs: 1_000,
          statusRaw: singleRunStatus(),
        },
        results: scenarioResults({ mean: 4.6 }, { Checkout: { mean: 4.1 } }),
      },
      {
        index: 1,
        inputFile: '/repo/evals/trace.json',
        status: 'result_failed',
        error: 'results endpoint returned 500',
        execution: {
          evaluationId: '33333333-3333-4333-8333-333333333333',
          evaluationName: 'Agent Trace tool use',
          contextType: 'agent_trace',
          runId: '66666666-6666-4666-8666-666666666666',
          state: 'COMPLETED',
          elapsedMs: 2_000,
          statusRaw: singleRunStatus(),
        },
      },
    ],
  };

  const policyByFile = new Map<string, SuiteGatePolicy>([
    ['/repo/evals/scenario.json', { minOverall: 4.0, minScenario: 3.5 }],
    ['/repo/evals/trace.json', { metrics: { factuality: 4.0 } }],
  ]);

  it('produces one decision per eval and blocks the release', () => {
    const result = gateSuite({ summary, policyByFile });
    expect(result.suiteDecision).toBe('ERROR');
    expect(result.counts).toEqual({ PASS: 1, FAIL: 0, INCONCLUSIVE: 0, ERROR: 1 });
    expect(result.perEvalDecisions.map((entry) => entry.decision)).toEqual(['PASS', 'ERROR']);
  });

  it('emits exactly one structured payload with --json', () => {
    const chunks: string[] = [];
    const stream = { write: (chunk: string) => (chunks.push(chunk), true) };
    const writer = new OutputWriter(stream, stream);
    const result = gateSuite({ summary, policyByFile });
    writer.writeResult(result, renderSuiteGateReport(result), true);

    expect(chunks).toHaveLength(1);
    const payload = JSON.parse(chunks[0] ?? '') as typeof result;
    expect(payload.suiteDecision).toBe('ERROR');
    expect(payload.counts.PASS).toBe(1);
    expect(payload.perEvalDecisions[0]).toMatchObject({
      contextType: 'scenario',
      runId: '55555555-5555-4555-8555-555555555555',
      decision: 'PASS',
    });
  });

  it('renders a human report naming the blocking eval', () => {
    const text = renderSuiteGateReport(gateSuite({ summary, policyByFile }));
    expect(text).toContain('Suite release gate: ERROR');
    expect(text).toContain('Agent Trace tool use');
  });
});

describe('suite manifest gate policies', () => {
  it('merges suite defaults with per-eval overrides', () => {
    const manifest = parseSuiteManifest(
      [
        'workspace: 11111111-1111-4111-8111-111111111111',
        'gate:',
        '  minOverall: 4.0',
        'evals:',
        '  - ./a.json',
        '  - file: ./b.json',
        '    gate:',
        '      minOverall: 4.5',
        '      metrics:',
        '        factuality: 4.0',
        '',
      ].join('\n'),
      '/repo/autoeval.suite.yaml',
    );
    expect(manifest.entries[0]?.gate).toEqual({ minOverall: 4 });
    expect(manifest.entries[1]?.gate).toEqual({ minOverall: 4.5, metrics: { factuality: 4 } });
    expect(
      manifest.evalFiles.map((path) => path.replace(/^[A-Za-z]:/, '').replaceAll('\\', '/')),
    ).toEqual(['/repo/a.json', '/repo/b.json']);
  });

  it('is inconclusive when an eval has no configured thresholds', () => {
    const decision = decide({
      results: scenarioResults({ mean: 4.9 }),
      policy: {},
      runStatusRaw: singleRunStatus(),
    });
    expect(decision.decision).toBe('INCONCLUSIVE');
  });
});
