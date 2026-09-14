import { describe, expect, it } from 'vitest';

import type { SuiteSummary } from '../src/actions/suite.js';
import type { EvalGateDecision, SuiteGateReport } from '../src/gate/decision.js';
import { renderFailureClusters } from '../src/output/human.js';
import { clusterExecutionFailures, clusterSuiteFailures } from '../src/suite/reporting.js';
import { VALID_KEY } from './helpers.js';

function decision(overrides: Partial<EvalGateDecision>): EvalGateDecision {
  return {
    index: 0,
    inputFile: './eval.json',
    decision: 'FAIL',
    checks: [],
    reason: 'blocked',
    evidence: { runMode: 'single_run' },
    ...overrides,
  };
}

function report(decisions: readonly EvalGateDecision[]): SuiteGateReport {
  return {
    suiteDecision: 'FAIL',
    counts: { PASS: 0, FAIL: decisions.length, INCONCLUSIVE: 0, ERROR: 0 },
    perEvalDecisions: [...decisions],
  };
}

function failingCheck(metric: string, label: string) {
  return {
    metric,
    label,
    threshold: '>= 4.00',
    actual: '3.10',
    decision: 'FAIL' as const,
    reason: 'score is below the required threshold',
    basis: 'mean' as const,
    evidence: { mean: 3.1 },
  };
}

describe('failure clustering', () => {
  it('groups the same failing metric across evals into one root cause', () => {
    const clusters = clusterSuiteFailures(
      report([
        decision({
          evaluationName: 'Refund',
          checks: [failingCheck('metric:citations', 'Citations')],
        }),
        decision({
          index: 1,
          evaluationName: 'Escalation',
          checks: [failingCheck('metric:citations', 'Citations')],
        }),
        decision({
          index: 2,
          evaluationName: 'Checkout',
          checks: [failingCheck('metric:factuality', 'Factuality')],
        }),
      ]),
    );

    expect(clusters).toHaveLength(2);
    expect(clusters[0]?.count).toBe(2);
    expect(clusters[0]?.category).toBe('threshold');
    expect(clusters[0]?.evals).toEqual(['Refund', 'Escalation']);
    expect(clusters[1]?.count).toBe(1);
  });

  it('collapses upstream errors that differ only by identifier or status detail', () => {
    const clusters = clusterExecutionFailures({
      workspaceId: 'workspace-1',
      total: 3,
      completed: 0,
      failed: 3,
      evals: [
        {
          index: 0,
          inputFile: './a.json',
          status: 'execution_failed',
          error:
            'Autoeval API request failed with HTTP 504 for run 11111111-1111-4111-8111-111111111111',
        },
        {
          index: 1,
          inputFile: './b.json',
          status: 'execution_failed',
          error:
            'Autoeval API request failed with HTTP 502 for run 22222222-2222-4222-8222-222222222222',
        },
        {
          index: 2,
          inputFile: './c.json',
          status: 'result_failed',
          error: 'Result polling timed out after 300s',
        },
      ],
    } as unknown as SuiteSummary);

    expect(clusters).toHaveLength(2);
    expect(clusters[0]?.label).toBe('Upstream 5xx error');
    expect(clusters[0]?.count).toBe(2);
    expect(clusters[1]?.label).toBe('Run or result polling timed out');
  });

  it('separates inconclusive checks from threshold failures', () => {
    const clusters = clusterSuiteFailures(
      report([
        decision({
          evaluationName: 'Trace',
          decision: 'INCONCLUSIVE',
          checks: [
            {
              ...failingCheck('metric:safety', 'Safety'),
              decision: 'INCONCLUSIVE',
              actual: 'Not available',
              reason: 'metric reported has_data: false',
            },
          ],
        }),
      ]),
    );

    expect(clusters[0]?.category).toBe('inconclusive');
    expect(clusters[0]?.label).toContain('has_data');
  });

  it('redacts credentials from retained failure exemplars', () => {
    const clusters = clusterExecutionFailures({
      workspaceId: 'workspace-1',
      total: 1,
      completed: 0,
      failed: 1,
      evals: [
        {
          index: 0,
          inputFile: './a.json',
          status: 'execution_failed',
          error: `Authentication rejected for ${VALID_KEY}`,
        },
      ],
    } as unknown as SuiteSummary);

    expect(clusters[0]?.exemplar).not.toContain(VALID_KEY);
    expect(clusters[0]?.exemplar).toContain('[REDACTED]');
  });

  it('renders nothing when there are no failures', () => {
    expect(renderFailureClusters([])).toBe('');
    expect(renderFailureClusters(clusterSuiteFailures(report([])))).toBe('');
  });

  it('renders a root-cause table with counts', () => {
    const rendered = renderFailureClusters(
      clusterSuiteFailures(
        report([
          decision({
            evaluationName: 'Refund',
            checks: [failingCheck('metric:citations', 'Citations')],
          }),
        ]),
      ),
    );
    expect(rendered).toContain('Failure clusters');
    expect(rendered).toContain('ROOT CAUSE');
    expect(rendered).toContain('Citations');
  });
});
