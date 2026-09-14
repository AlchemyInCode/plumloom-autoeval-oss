import { describe, expect, it } from 'vitest';

import {
  renderCreatedEvaluation,
  renderCreatedWorkspace,
  renderEvaluationSummaryList,
  renderEvaluationVersions,
  renderWorkspaceSummaryList,
  renderConfiguredRunValidation,
  renderEvaluation,
  renderEvaluations,
  renderLogin,
  renderLogout,
  renderModels,
  renderQualityStandard,
  renderResults,
  renderResultsSummary,
  renderRunExecution,
  renderWorkspaces,
} from '../src/output/human.js';
import { OutputWriter, type OutputStream } from '../src/output/writer.js';
import {
  scenarioMultirunResults,
  scenarioSingleRunResults,
  scenarioUnstableResults,
} from './fixtures/scenario-multirun-results.js';
import { IDENTITY, IDS, VALID_KEY } from './helpers.js';

class MemoryStream implements OutputStream {
  value = '';

  write(chunk: string): boolean {
    this.value += chunk;
    return true;
  }
}

describe('safe output', () => {
  it('redacts CLI keys from JSON, errors, and diagnostics', () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    const writer = new OutputWriter(stdout, stderr);

    writer.writeResult({ nested: VALID_KEY }, '', true);
    writer.writeError(`failed: ${VALID_KEY}`, false, 'FAILED');
    writer.writeDiagnostic({
      method: 'GET',
      path: `/api/v1/example/${VALID_KEY}`,
      durationMs: 1,
      attempt: 1,
    });

    expect(`${stdout.value}${stderr.value}`).not.toContain(VALID_KEY);
    expect(`${stdout.value}${stderr.value}`).toContain('[REDACTED]');
  });

  it('keeps JSON on stdout and errors on stderr', () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    const writer = new OutputWriter(stdout, stderr);

    writer.writeResult({ ok: true }, 'ok\n', true);
    writer.writeError('bad', true, 'BAD');

    expect(JSON.parse(stdout.value)).toEqual({ ok: true });
    expect(JSON.parse(stderr.value)).toEqual({ error: { message: 'bad', code: 'BAD' } });
  });

  it('renders deterministic success output without trailing periods', () => {
    expect(renderCreatedWorkspace({ id: IDS.workspace, name: 'Product launch' })).toBe(
      `Created workspace Product launch (${IDS.workspace})\n`,
    );
    expect(
      renderCreatedEvaluation({
        evaluationId: IDS.evaluation,
        workspaceId: IDS.workspace,
        evaluationName: 'Support quality',
      }),
    ).toBe(
      `Created evaluation Support quality (${IDS.evaluation}) in workspace ${IDS.workspace}\n`,
    );

    const outputs = [
      renderLogin({ identity: IDENTITY, source: 'prompt', wasPersisted: true }),
      renderLogout(true),
      renderWorkspaces({
        items: [{ id: IDS.workspace, name: 'Workspace', evaluationCount: 1 }],
        total: 1,
        page: 1,
        size: 100,
        totalPages: 1,
      }),
      renderEvaluations({
        items: [{ id: IDS.evaluation, name: 'Evaluation', workspaceId: IDS.workspace }],
        total: 1,
        page: 1,
        size: 100,
        totalPages: 1,
      }),
      renderEvaluation({
        version: 1,
        evaluationId: IDS.evaluation,
        methodologyVersionId: IDS.methodology,
        configVersionId: IDS.config,
        isCurrent: true,
        contextType: 'scenario',
        raw: {},
        configuration: {},
      }),
      renderEvaluationVersions({
        evaluationId: IDS.evaluation,
        contextType: 'scenario',
        currentVersion: 2,
        versions: [
          {
            version: 1,
            methodologyVersionId: IDS.methodology,
            configVersionId: IDS.config,
            isCurrent: false,
            createdAt: '2026-09-01T00:00:00Z',
          },
          {
            version: 2,
            methodologyVersionId: IDS.methodology,
            configVersionId: IDS.config,
            isCurrent: true,
            createdAt: '2026-09-02T00:00:00Z',
          },
        ],
        raw: {},
      }),
      renderModels([]),
      renderResults({
        contextType: 'scenario',
        modelPerformance: {},
        scenarioComparison: {},
        modelResponses: {},
      }),
    ];

    for (const output of outputs) {
      expect(
        output
          .split('\n')
          .filter(Boolean)
          .every((line) => !line.endsWith('.')),
      ).toBe(true);
    }
  });

  it('renders configured-input validation with model names and IDs', () => {
    expect(
      renderConfiguredRunValidation({
        valid: true,
        contextType: 'scenario',
        artifactCount: 3,
        models: {
          judge: {
            id: IDS.model,
            provider: 'openai',
            displayName: 'GPT-5-mini',
            apiModelId: 'gpt-5-mini',
            isDeprecated: false,
            isLocked: false,
          },
          primary: {
            id: IDS.config,
            provider: 'openai',
            displayName: 'GPT-5',
            apiModelId: 'gpt-5',
            isDeprecated: false,
            isLocked: false,
          },
          comparisons: [],
        },
      }),
    ).toContain(`Judge: GPT-5-mini (${IDS.model})`);
  });

  it('renders every quality-standard field and labels binary anchors', () => {
    expect(
      renderQualityStandard(
        {
          id: IDS.methodology,
          name: 'Support quality',
          judge_model: IDS.model,
          rubric: 'First rubric line.\nSecond rubric line.',
          anchors: [
            {
              input: 'accepted input',
              response: 'accepted response',
              reference: 'accepted reference',
              score: 5,
              reasoning: 'accepted reasoning',
            },
            {
              input: 'rejected input',
              response: 'rejected response',
              reference: 'rejected reference',
              score: 1,
              reasoning: 'rejected reasoning',
            },
          ],
        },
        IDS.methodology,
      ),
    ).toBe(
      [
        'Quality Standard',
        '',
        'Name: Support quality',
        `QS ID: ${IDS.methodology}`,
        `Judge model: ${IDS.model}`,
        '',
        'Rubric',
        '  First rubric line.',
        '  Second rubric line.',
        '',
        'Anchors (2)',
        '',
        '1. Accept (5)',
        '   Input',
        '     accepted input',
        '   Response',
        '     accepted response',
        '   Reference',
        '     accepted reference',
        '   Reasoning',
        '     accepted reasoning',
        '',
        '2. Reject (1)',
        '   Input',
        '     rejected input',
        '   Response',
        '     rejected response',
        '   Reference',
        '     rejected reference',
        '   Reasoning',
        '     rejected reasoning',
        '',
      ].join('\n'),
    );
  });

  it('leads conversational resource lists with names while retaining IDs', () => {
    expect(
      renderWorkspaceSummaryList({
        items: [{ id: IDS.workspace, name: 'Support QA', evaluationCount: 2 }],
        total: 1,
        page: 1,
        size: 100,
        totalPages: 1,
      }),
    ).toContain(IDS.workspace);
    expect(
      renderEvaluationSummaryList({
        items: [{ id: IDS.evaluation, name: 'Support Quality' }],
        total: 1,
        page: 1,
        size: 100,
        totalPages: 1,
      }),
    ).toContain(IDS.evaluation);
  });

  it('summarizes conversation results in human output', () => {
    const output = renderResults({
      contextType: 'conversation',
      conversation: {
        outcome: { achieved: false, score: 2.4, has_data: true },
        overall: 2.7,
        judge_agreement: { pass: 2, total: 3 },
        per_metric: {
          factuality: { score: 2.1, has_data: true },
          safety: { score: 4.5, has_data: true },
        },
        turns: [],
      },
    });

    expect(output).toContain('Context');
    expect(output).toContain('conversation');
    expect(output).toContain('factuality');
    expect(output).toContain('2.1');
    expect(output).toContain('[ FAIL ]');
    expect(output).not.toContain('Watch');
    expect(output).not.toContain('STATUS');
    expect(output).toContain('full reliability detail and the untouched backend payload');
    expect(output).toContain('Use --json');

    expect(
      renderResultsSummary({
        contextType: 'conversation',
        conversation: {
          outcome: { achieved: false, score: 2.4, has_data: true },
          overall: 2.7,
          judge_agreement: { pass: 2, total: 3 },
          per_metric: { factuality: { score: 2.1, has_data: true } },
          turns: [],
        },
      }),
    ).toContain('Overall score: 2.7');
  });

  it('summarizes agent session and trajectory results in human output', () => {
    const output = renderResults({
      contextType: 'agent_trace',
      agentTrace: {
        outcome: { achieved: true, score: 4.1, has_data: true },
        overall: 4.2,
        judge_agreement: { pass: 3, total: 3 },
        per_metric: { helpfulness: { score: 4, has_data: true } },
        steps: [],
      },
      trajectory: {
        trajectory_score: 3.8,
        judge_agreement: { agreed: 2, total: 3 },
        dimensions: [
          {
            key: 'logical_progression',
            label: 'Logical progression',
            score: 4.1,
            step_ids: [],
          },
          {
            key: 'unnecessary_detours',
            label: 'Unnecessary detours',
            score: 3.5,
            step_ids: [],
          },
        ],
        steps: [],
      },
    });

    expect(output).toContain('agent_trace');
    expect(output).toContain('SESSION EVALUATION');
    expect(output).toContain('TRAJECTORY EVALUATION');
    expect(output).toContain('3.8');
    expect(output).toContain('Logical progression');
    expect(output).toContain('[ PASS ]');
    expect(output).not.toContain('STATUS');
    expect(output).toContain('Use --json');
  });

  it('does not invent a verdict for scenario results', () => {
    const output = renderResults({
      contextType: 'scenario',
      modelPerformance: {
        models: [{ display_name: 'Example model', scores: { overall: { mean: 4.8 } } }],
      },
      scenarioComparison: { scenarios: [] },
      modelResponses: {},
    });

    expect(output).not.toContain('Pass');
    expect(output).not.toContain('Fail');
    expect(output).not.toContain('Watch');
    expect(output).not.toContain('STATUS');
  });
});

describe('identifier labelling', () => {
  it('separates the evaluation version number from the version IDs', () => {
    const text = renderEvaluation({
      version: 2,
      evaluationId: IDS.evaluation,
      methodologyVersionId: IDS.methodology,
      configVersionId: IDS.config,
      isCurrent: true,
      contextType: 'scenario',
      raw: {},
      configuration: {},
    });

    expect(text).toContain('Evaluation version: 2 (current)');
    expect(text).toContain('Methodology version ID:');
    expect(text).toContain('Config version ID:');
    expect(text).not.toContain('Config version:');
  });

  it('labels the run identifier and prints copy-pasteable follow-ups', () => {
    const text = renderRunExecution({
      outcome: {
        status: {
          evaluationId: IDS.evaluation,
          runId: IDS.run,
          state: 'COMPLETED',
          raw: {},
        },
        elapsedMs: 1_000,
      },
    } as Parameters<typeof renderRunExecution>[0]);

    expect(text).toContain('Run ID');
    expect(text).toContain(`autoeval status  ${IDS.evaluation} ${IDS.run}`);
    expect(text).toContain(`autoeval results ${IDS.evaluation} ${IDS.run}`);
  });
});

describe('scenario scorecard', () => {
  it('leads with the big score when the run met its consistency target', () => {
    const output = renderResults(scenarioMultirunResults, {
      scenarioStatus: scenarioMultirunResults.status,
    });

    expect(output).toContain('/ 5 overall · stable');
    expect(output).toContain('95% CI 3.69–4.14');
    expect(output).toContain('CV 0.09 (target <0.10)');
    expect(output).toContain('auto-stopped at run 4 of 5');
    expect(output).toContain('Llama 3.3 70B (primary)');
    expect(output).toContain('3 test cases');
    // The coarse consistency enum contradicts the reported figure, so it is
    // never rendered.
    expect(output).not.toContain('consistency_level');
    // Metrics are alphabetical, overall is pinned last, and metrics without
    // data are left out.
    expect(output.indexOf('completeness')).toBeLessThan(output.indexOf('factuality'));
    expect(output.indexOf('safety')).toBeLessThan(output.lastIndexOf('overall'));
    expect(output).not.toContain('hallucination');
    // Test cases keep backend order, and the widest interval is marked.
    expect(output.indexOf('Cosmetic rename PR')).toBeLessThan(
      output.indexOf('Optional array reduce'),
    );
    expect(output).toMatch(/Cosmetic rename PR.*±0\.50.*← widest/u);
    expect(output).toContain('RUBRIC FIT');
    expect(output).toContain('TEST CASES');
  });

  it('promotes the best response and labels the best-run footer totals', () => {
    const output = renderResults(scenarioMultirunResults, {
      scenarioStatus: scenarioMultirunResults.status,
    });

    expect(output).toContain('BEST RESPONSE');
    expect(output).toContain(
      'Llama 3.3 70B · run 3 · scored 4.4 / 5 · best of 4 for this test case',
    );
    expect(output).not.toMatch(/best of 12/u);
    expect(output).toContain('The reduce throws on an empty array');
    expect(output).toContain('12 runs');
    expect(output).toContain('best run per test case: 1730 tokens');
    expect(output).toContain('model time');
    expect(output).toContain('--show-outputs for full responses · --json for the raw payload');
  });

  it('demotes the number and leads with the warning when the run never stabilized', () => {
    const output = renderResults(scenarioUnstableResults, {
      scenarioStatus: scenarioUnstableResults.status,
    });

    expect(output).toContain('Unreliable — score did not stabilize across 3 runs');
    expect(output).toContain('overall 1.92');
    expect(output).toContain('95% CI spans 1–5');
    expect(output).toContain('CV 0.83 (target <0.10)');
    expect(output).toContain('stopped at run 3 of 3 (max)');
    expect(output).toContain('Add runs or fix the prompt/judge, then re-run.');
    // No block digits for a score that cannot be trusted.
    expect(output).not.toContain('███');
    // Wide intervals are flagged; a full-scale interval says so.
    expect(output).toMatch(/factuality.*±1\.54\s+⚠/u);
    expect(output).toMatch(/safety.*±3\.90\s+⚠ spans the scale/u);
    // A single test case has nothing to be widest of.
    expect(output).not.toContain('← widest');
  });

  it('states the missing reliability signal for a single-run evaluation', () => {
    const output = renderResults(scenarioSingleRunResults, {
      scenarioStatus: scenarioSingleRunResults.status,
    });

    expect(output).toContain('3.76 / 5 overall');
    expect(output).toContain('Single run — no reliability signal');
    expect(output).toContain('Run a multi-run evaluation to see confidence intervals');
    expect(output).not.toContain('███');
    expect(output).not.toContain('95% CI');
    expect(output).not.toContain('CV ');
    expect(output).not.toContain('best of');
    expect(output).not.toContain('(few samples)');
    expect(output.match(/300 tokens · \$0\.0008 · 1\.9s/gu)).toHaveLength(1);
    expect(output).toContain('(this run)');
    expect(output).not.toContain('model time');
    expect(output).not.toContain('best run per test case');
  });

  it('keeps the single-run tables aligned with multi-run minus confidence columns', () => {
    const output = renderResults(scenarioSingleRunResults, {
      scenarioStatus: scenarioSingleRunResults.status,
    });

    expect(output).toMatch(/RUBRIC FIT[\s\S]*METRIC\s+MEAN/u);
    expect(output).toMatch(/TEST CASES[\s\S]*TEST CASE\s+MEAN/u);
    expect(output.indexOf('RUBRIC FIT')).toBeLessThan(output.indexOf('TEST CASES'));
    expect(output.indexOf('TEST CASES')).toBeLessThan(output.indexOf('BEST RESPONSE'));
  });

  it('expands every response behind --show-outputs', () => {
    const output = renderResults(scenarioMultirunResults, {
      showOutputs: true,
      scenarioStatus: scenarioMultirunResults.status,
    });

    expect(output).toContain('BEST RESPONSE — EVERY TEST CASE');
    expect(output).toContain('Review this rename-only pull request');
    expect(output).toContain('The rename is safe to merge');
    expect(output).toContain('RUBRIC FIT');
    expect(output).toContain('TEST CASES');
  });
});
