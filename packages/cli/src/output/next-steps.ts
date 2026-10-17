import type { GateVerdict } from '../actions/gate.js';

/**
 * Contextual guidance shown after a terminal result (run, suite run, gate,
 * init). These lines extend the human next-step surface only; they are plain
 * text, carry no secrets, and are suppressed under `--json`.
 *
 * They must respect the verdict rule (ADR 0012): a suggestion never changes an
 * outcome by changing the test. We therefore never advise lowering a threshold,
 * adding a threshold to force a pass, or dropping a failing case. We also only
 * reference commands that ship today.
 */
export type NextStepContext =
  | { kind: 'first-result'; verdict: GateVerdict | 'COMPLETED'; hasGate: boolean }
  | { kind: 'passed-no-gate' }
  | { kind: 'failed' }
  | { kind: 'inconclusive' };

export function renderNextSteps(context: NextStepContext): string[] {
  switch (context.kind) {
    case 'first-result':
      return firstResultSteps(context.verdict, context.hasGate);
    case 'passed-no-gate':
      return passedNoGateSteps();
    case 'failed':
      return failedSteps();
    case 'inconclusive':
      return inconclusiveSteps();
  }
}

function firstResultSteps(verdict: GateVerdict | 'COMPLETED', hasGate: boolean): string[] {
  if (verdict === 'FAIL') return failedSteps();
  if (verdict === 'INCONCLUSIVE') return inconclusiveSteps();
  if (hasGate) return passedGateSteps();
  return passedNoGateSteps();
}

function passedNoGateSteps(): string[] {
  return [
    'Turn it into a release gate: autoeval gate <evaluation-id> --min-overall 4.0',
    'Run the whole pack as a suite: autoeval suite gate --manifest <manifest-file>',
    'Add more cases: edit the pack eval file and run it again',
  ];
}

function passedGateSteps(): string[] {
  return [
    'Make it a habit: open a pull request so the gate runs on every change',
    'Add more cases: edit the pack eval file to broaden coverage',
  ];
}

function failedSteps(): string[] {
  return [
    'Fix the app or prompt and run the evaluation again',
    'Inspect the failing metric: autoeval results <evaluation-id> <run-id>',
  ];
}

function inconclusiveSteps(): string[] {
  return [
    'Add more cases or trials so the result has enough evidence to decide',
    'Inspect the evidence: autoeval results <evaluation-id> <run-id>',
  ];
}

/** Formats the lines as an appended human block, or '' when there are none. */
export function renderNextStepsBlock(context: NextStepContext): string {
  const lines = renderNextSteps(context);
  if (lines.length === 0) return '';
  return ['', 'Next steps:', ...lines.map((line) => `  ${line}`), ''].join('\n');
}
