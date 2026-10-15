import { describe, expect, it } from 'vitest';

import type { SuiteGateResult } from '../src/actions/suite-gate.js';
import type { SuiteEvalEntry, SuiteSummary } from '../src/actions/suite.js';
import type { JsonObject } from '../src/domain/common.js';
import type { EvaluationContextType, EvaluationResults } from '../src/domain/types.js';
import {
  createReliabilityReportMarker,
  renderReliabilityReport,
} from '../src/github/reliability-report.js';
import { extractRunStandardEvidence } from '../src/reliability/evidence.js';
import { IDS } from './helpers.js';

const standard = {
  rubricApplied: true,
  judgeModel: 'Judge Model',
  judgeModelPinned: true,
  qualityStandardStatus: 'applied' as const,
  qualityStandardName: 'Support v2',
  qualityStandardVersion: '2',
  anchorCount: 3,
};

function execution(index: number, contextType: EvaluationContextType, statusRaw: JsonObject = {}) {
  return {
    evaluationId: `${index + 2}2222222-2222-4222-8222-222222222222`,
    evaluationName: `Evaluation ${index + 1}`,
    contextType,
    runId: `${index + 4}4444444-4444-4444-8444-444444444444`,
    state: 'COMPLETED',
    elapsedMs: 1_000,
    statusRaw,
    standard,
  };
}

function entry(
  index: number,
  contextType: EvaluationContextType,
  results: EvaluationResults,
  statusRaw: JsonObject = {},
): SuiteEvalEntry {
  return {
    index,
    inputFile: `eval-${index + 1}.json`,
    status: 'completed',
    execution: execution(index, contextType, statusRaw),
    results,
  };
}

function decision(
  index: number,
  contextType: EvaluationContextType | undefined,
  gateDecision: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'ERROR',
): SuiteGateResult['perEvalDecisions'][number] {
  return {
    index,
    inputFile: `eval-${index + 1}.json`,
    evaluationName: `Evaluation ${index + 1}`,
    evaluationId: IDS.evaluation,
    runId: IDS.run,
    ...(contextType ? { contextType } : {}),
    decision: gateDecision,
    checks: [
      {
        metric: 'overall',
        label: 'Primary model overall score',
        threshold: '>= 4.00',
        actual: gateDecision === 'PASS' ? '4.30 95% CI 4.10-4.50' : '3.80 95% CI 3.60-4.00',
        decision: gateDecision,
        reason: gateDecision === 'PASS' ? 'criterion met' : 'criterion did not meet the threshold',
        basis: 'confidence-interval',
        evidence: { mean: 4.3, ci95Lower: 4.1, ci95Upper: 4.5 },
      },
    ],
    reason: gateDecision === 'PASS' ? 'every configured criterion was met' : 'gate blocked',
    evidence: { runMode: contextType === 'scenario' ? 'multi_run' : 'single_run' },
  };
}

function mixedFixture(): { gate: SuiteGateResult; summary: SuiteSummary } {
  const scenario = entry(
    0,
    'scenario',
    {
      contextType: 'scenario',
      modelPerformance: {
        models: [
          {
            display_name: 'Primary',
            is_primary: true,
            scores: {
              overall: {
                mean: 4.3,
                std_dev: 0.2,
                ci95_lower: 4.1,
                ci95_upper: 4.5,
                sample_size: 5,
                has_data: true,
              },
              factuality: {
                mean: 4.2,
                std_dev: 0.25,
                ci95_lower: 3.9,
                ci95_upper: 4.5,
                sample_size: 5,
                has_data: true,
              },
            },
          },
        ],
      },
      scenarioComparison: {
        scenarios: [
          {
            scenario_name: 'Refund request',
            model_scores: [
              {
                display_name: 'Primary',
                score: { mean: 4.1, ci95: 0.3, sample_size: 5, has_data: true },
              },
            ],
          },
        ],
      },
      modelResponses: { outputs: [{ response: 'must never appear' }] },
    },
    {
      evaluationMetrics: {
        runsCompleted: 5,
        runsPlanned: 6,
        judgesPerOutput: 2,
      },
    },
  );
  const conversation = entry(1, 'conversation', {
    contextType: 'conversation',
    conversation: {
      judge_agreement: { pass: 2, total: 3 },
      per_metric: { factuality: { score: 4.2, has_data: true } },
      turns: [{ content: 'private conversation must never appear' }],
    },
  });
  const trace = entry(2, 'agent_trace', {
    contextType: 'agent_trace',
    agentTrace: {
      judge_agreement: { pass: 1, total: 1 },
      per_metric: { tool_use: { score: 2.5, has_data: true } },
      trace: { secret: 'private trace must never appear' },
    },
    trajectory: { judge_agreement: { agreed: 2, total: 3 } },
  });
  return {
    summary: {
      workspaceId: IDS.workspace,
      total: 3,
      completed: 3,
      failed: 0,
      evals: [scenario, conversation, trace],
    },
    gate: {
      workspaceId: IDS.workspace,
      suiteDecision: 'FAIL',
      counts: { PASS: 1, FAIL: 1, INCONCLUSIVE: 1, ERROR: 0 },
      perEvalDecisions: [
        decision(0, 'scenario', 'INCONCLUSIVE'),
        decision(1, 'conversation', 'PASS'),
        decision(2, 'agent_trace', 'FAIL'),
      ],
    },
  };
}

describe('PR reliability report evidence', () => {
  it('distinguishes an applied Quality Standard, verified absence, and unavailable metadata', () => {
    const configuredRun = {
      methodology: {
        judgeModel: 'Judge Model',
        judgeModelId: IDS.model,
        evaluatorInstructions: 'Evaluate against the rubric.',
      },
      configuration: {
        contextName: 'Support',
        contextType: 'conversation' as const,
        artifact: { messages: [{ role: 'user', content: 'hello' }] },
        expected: 'Helpful answer',
        selectedMetrics: ['factuality'],
      },
    };

    expect(
      extractRunStandardEvidence(configuredRun, {
        quality_standard: { name: 'Support v2', version: '2', anchors: [{}, {}, {}] },
      }),
    ).toMatchObject({
      qualityStandardStatus: 'applied',
      qualityStandardName: 'Support v2',
      qualityStandardVersion: '2',
      anchorCount: 3,
    });
    expect(
      extractRunStandardEvidence(configuredRun, {
        quality_standard_name: 'Support',
        quality_standard_version: '2',
      }),
    ).toMatchObject({
      qualityStandardStatus: 'applied',
      qualityStandardName: 'Support',
      qualityStandardVersion: '2',
    });
    expect(extractRunStandardEvidence(configuredRun, { quality_standard: null })).toMatchObject({
      qualityStandardStatus: 'not_configured',
    });
    expect(extractRunStandardEvidence(configuredRun)).toMatchObject({
      qualityStandardStatus: 'not_available',
    });
  });

  it('renders each context in manifest order without cross-context repeatability rollups', () => {
    const fixture = mixedFixture();
    const rendered = renderReliabilityReport({
      ...fixture,
      actionsRunUrl: 'https://github.com/example/repo/actions/runs/123',
      marker: createReliabilityReportMarker('suite\njob\ndefault'),
    });

    expect(rendered.detailLevel).toBe('full');
    expect(rendered.markdown).toContain('Autoeval Reliability Report — FAIL');
    expect(rendered.markdown).toContain(
      '1 live scenario · 1 frozen conversation · 1 frozen agent trace',
    );
    expect(rendered.markdown.indexOf('Evaluation 1')).toBeLessThan(
      rendered.markdown.indexOf('Evaluation 2'),
    );
    expect(rendered.markdown.indexOf('Evaluation 2')).toBeLessThan(
      rendered.markdown.indexOf('Evaluation 3'),
    );
    expect(rendered.markdown).toContain('5 trials; statistics available');
    expect(rendered.markdown).toContain('SD 0\\.2');
    expect(rendered.markdown).toContain('95% CI 4\\.1–4\\.5');
    expect(rendered.markdown).toContain('K=2; agreement evidence Not available');
    expect(rendered.markdown).toContain('K=3; 2/3 pass votes');
    expect(rendered.markdown).toContain('K=1; Agreement not measured');
    expect(rendered.markdown).toContain('K=3; 2/3 assessments agreed');
    expect(
      rendered.markdown.match(/N\/A: frozen input; behavioral repeatability not measured/gu),
    ).toHaveLength(4);
    expect(rendered.markdown).not.toContain('reliability percentage');
    expect(rendered.markdown).not.toContain('must never appear');
    expect(rendered.markdown).not.toContain('private conversation');
    expect(rendered.markdown).not.toContain('private trace');
  });

  it('reports insufficient scenario evidence and never invents an unknown context', () => {
    const fixture = mixedFixture();
    const scenario = fixture.summary.evals[0];
    if (!scenario?.execution || scenario.results?.contextType !== 'scenario') {
      throw new Error('Expected scenario fixture.');
    }
    scenario.execution.statusRaw = { progress: { runsCompleted: 1, totalRuns: 1 } };
    scenario.results.modelPerformance = {
      models: [
        {
          display_name: 'Primary',
          scores: {
            overall: {
              mean: 4,
              sample_size: 1,
              insufficient_samples: true,
              has_data: true,
            },
          },
        },
      ],
    };
    fixture.gate.perEvalDecisions.push({
      index: 3,
      inputFile: 'unknown.json',
      evaluationName: 'Unknown context',
      decision: 'ERROR',
      checks: [],
      reason: 'execution failed',
      evidence: { runMode: 'unknown' },
    });
    fixture.gate.counts.ERROR = 1;
    fixture.summary.evals.push({
      index: 3,
      inputFile: 'unknown.json',
      status: 'execution_failed',
      error: 'execution failed',
    });

    const rendered = renderReliabilityReport({
      ...fixture,
      marker: createReliabilityReportMarker('unknown'),
    }).markdown;
    expect(rendered).toContain('1 trial; Insufficient evidence');
    expect(rendered).toContain('Unknown context');
    expect(rendered).toContain('Authoritative context: Not available');
    expect(rendered).not.toContain('Unknown context | Live scenario');
  });

  it('escapes HTML without adding literal Markdown escapes to summary headings', () => {
    const fixture = mixedFixture();
    const decision = fixture.gate.perEvalDecisions[0];
    const execution = fixture.summary.evals[0]?.execution;
    if (!decision || !execution) throw new Error('Expected scenario fixture.');
    decision.evaluationName = '[Scenario] Sign in (multi-run) <unsafe>';
    execution.evaluationName = decision.evaluationName;

    const rendered = renderReliabilityReport({
      ...fixture,
      marker: createReliabilityReportMarker('summary-heading'),
    }).markdown;

    const summaryLine = rendered
      .split('\n')
      .find((line) => line.startsWith('<summary>INCONCLUSIVE'));
    expect(summaryLine).toBe(
      '<summary>INCONCLUSIVE — [Scenario] Sign in (multi-run) &lt;unsafe&gt; (Live scenario)</summary>',
    );
    expect(summaryLine).not.toContain('\\[Scenario\\]');
    expect(summaryLine).not.toContain('\\(multi-run\\)');
    expect(summaryLine).not.toContain('<unsafe>');
  });

  it('redacts credentials and removes details before truncating a row', () => {
    const fixture = mixedFixture();
    const template = fixture.gate.perEvalDecisions[0];
    const summaryTemplate = fixture.summary.evals[0];
    const executionTemplate = summaryTemplate?.execution;
    if (!template || !summaryTemplate || !executionTemplate) {
      throw new Error('Expected fixture entries.');
    }
    fixture.gate.perEvalDecisions = Array.from({ length: 800 }, (_, index) => ({
      ...template,
      index,
      inputFile: `eval-${index}.json`,
      evaluationName:
        index === 799
          ? `pl_sk_syntheticReportSecret12345 ${'very-long-name-'.repeat(30)}${index}`
          : `${'very-long-name-'.repeat(30)}${index}`,
      decision: index === 799 ? 'FAIL' : 'PASS',
    }));
    fixture.gate.counts = { PASS: 799, FAIL: 1, INCONCLUSIVE: 0, ERROR: 0 };
    fixture.summary.evals = Array.from({ length: 800 }, (_, index) => ({
      ...summaryTemplate,
      index,
      inputFile: `eval-${index}.json`,
      execution: {
        ...executionTemplate,
        evaluationName: index === 0 ? 'pl_sk_syntheticReportSecret12345' : `Evaluation ${index}`,
      },
    }));
    fixture.summary.total = 800;
    fixture.summary.completed = 800;

    const rendered = renderReliabilityReport({
      ...fixture,
      marker: createReliabilityReportMarker('large'),
    });
    expect(rendered.markdown.length).toBeLessThanOrEqual(65_000);
    expect(rendered.detailLevel).toBe('critical');
    expect(rendered.markdown).toContain('Detailed evidence was omitted');
    expect(rendered.markdown.match(/\| \*\*FAIL\*\* \|/gu)).toHaveLength(1);
    expect(rendered.markdown).toContain('pl\\_sk\\_\\[REDACTED\\]');
    expect(rendered.markdown).not.toContain('pl_sk_syntheticReportSecret12345');
  });
});
