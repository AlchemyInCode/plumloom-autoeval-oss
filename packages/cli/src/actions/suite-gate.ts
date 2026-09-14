import {
  decideEvalGate,
  rollUpSuiteDecision,
  type EvalGateDecision,
  type SuiteGateReport,
} from '../gate/decision.js';
import type { SuiteGatePolicy } from '../gate/policy.js';
import { AutoevalError } from '../errors/autoeval-error.js';
import type { SuiteSummary } from './suite.js';

/**
 * Gate plane entry point. It runs after the execution and results planes and
 * only reads what they already produced, so gating stays deterministic and
 * independently testable.
 */
export type SuiteGateInput = {
  summary: SuiteSummary;
  /** Policy per eval file, as declared in the suite manifest. */
  policyByFile: ReadonlyMap<string, SuiteGatePolicy>;
};

export type SuiteGateResult = SuiteGateReport & {
  workspaceId: string;
};

export function gateSuite(input: SuiteGateInput): SuiteGateResult {
  const decisions: EvalGateDecision[] = input.summary.evals.map((entry) => {
    const execution = entry.execution;
    return decideEvalGate({
      index: entry.index,
      inputFile: entry.inputFile,
      status: entry.status,
      policy: input.policyByFile.get(entry.inputFile) ?? {},
      ...(entry.error === undefined ? {} : { error: entry.error }),
      ...(entry.results === undefined ? {} : { results: entry.results }),
      ...(execution === undefined
        ? {}
        : {
            evaluationId: execution.evaluationId,
            evaluationName: execution.evaluationName,
            runId: execution.runId,
            contextType: execution.contextType,
            runState: execution.state,
            runStatusRaw: execution.statusRaw,
          }),
    });
  });

  return { workspaceId: input.summary.workspaceId, ...rollUpSuiteDecision(decisions) };
}

/**
 * CI exit decision. PASS is the only allowed release; FAIL, INCONCLUSIVE, and
 * ERROR all block, and stay distinguishable through the error code.
 */
export function suiteGateExitError(result: SuiteGateResult): AutoevalError | undefined {
  if (result.suiteDecision === 'PASS') return undefined;
  const { counts } = result;
  return new AutoevalError(
    `Suite release gate: ${result.suiteDecision}. ${counts.ERROR} error, ${counts.FAIL} failed, ${counts.INCONCLUSIVE} inconclusive of ${result.perEvalDecisions.length} evals.`,
    {
      kind: result.suiteDecision === 'ERROR' ? 'run_failed' : 'gate_failed',
      code: `SUITE_GATE_${result.suiteDecision}`,
    },
  );
}
