import { describe, expect, it } from 'vitest';

import { renderNextSteps, renderNextStepsBlock } from '../src/output/next-steps.js';

/** No next-step copy may suggest changing the test to change the verdict. */
function forbidsVerdictGaming(lines: readonly string[]): void {
  const joined = lines.join('\n').toLowerCase();
  expect(joined).not.toContain('lower the threshold');
  expect(joined).not.toContain('lower threshold');
  expect(joined).not.toContain('remove the threshold');
  expect(joined).not.toContain('drop the eval');
  expect(joined).not.toContain('force a pass');
}

describe('renderNextSteps', () => {
  it('suggests gating and broadening after a passing non-gated run', () => {
    const lines = renderNextSteps({ kind: 'passed-no-gate' });
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines.join('\n')).toContain('autoeval gate');
    forbidsVerdictGaming(lines);
  });

  it('suggests fixing the app, never weakening the gate, after a failure', () => {
    const lines = renderNextSteps({ kind: 'failed' });
    expect(lines.join('\n')).toContain('Fix the app');
    forbidsVerdictGaming(lines);
  });

  it('suggests more evidence, never a forced pass, when inconclusive', () => {
    const lines = renderNextSteps({ kind: 'inconclusive' });
    expect(lines.join('\n').toLowerCase()).toContain('evidence');
    forbidsVerdictGaming(lines);
  });

  it('maps a passing first result with a gate to habit-forming guidance', () => {
    const lines = renderNextSteps({ kind: 'first-result', verdict: 'PASS', hasGate: true });
    expect(lines.join('\n')).toContain('pull request');
    forbidsVerdictGaming(lines);
  });

  it('routes a failing first result to the failure guidance', () => {
    expect(renderNextSteps({ kind: 'first-result', verdict: 'FAIL', hasGate: true })).toEqual(
      renderNextSteps({ kind: 'failed' }),
    );
  });

  it('routes an inconclusive first result to the inconclusive guidance', () => {
    expect(
      renderNextSteps({ kind: 'first-result', verdict: 'INCONCLUSIVE', hasGate: false }),
    ).toEqual(renderNextSteps({ kind: 'inconclusive' }));
  });

  it('treats a passing first result without a gate as a non-gated pass', () => {
    expect(renderNextSteps({ kind: 'first-result', verdict: 'COMPLETED', hasGate: false })).toEqual(
      renderNextSteps({ kind: 'passed-no-gate' }),
    );
  });
});

describe('renderNextStepsBlock', () => {
  it('formats a human block with a header', () => {
    const block = renderNextStepsBlock({ kind: 'passed-no-gate' });
    expect(block).toContain('Next steps:');
    expect(block.startsWith('\n')).toBe(true);
  });
});
