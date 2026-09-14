import { z } from 'zod';

/**
 * Release-gate policy for one eval in a suite.
 *
 * The policy is authored by the developer next to the suite manifest; it adds
 * no backend fields. Scenario evals gate on score thresholds, conversation and
 * agent-trace evals gate on configured `per_metric.<metric>.score` thresholds.
 */
export type SuiteGatePolicy = {
  /** Minimum primary-model overall score. */
  minOverall?: number;
  /** Minimum score for every configured scenario cell of the primary model. */
  minScenario?: number;
  /** Per-metric minimums for conversation and agent-trace evals. */
  metrics?: Readonly<Record<string, number>>;
};

export const suiteGatePolicySchema = z
  .object({
    minOverall: z.number().optional(),
    minScenario: z.number().optional(),
    metrics: z.record(z.string().min(1), z.number()).optional(),
  })
  .strict();

export function isEmptyPolicy(policy: SuiteGatePolicy | undefined): boolean {
  if (policy === undefined) return true;
  if (policy.minOverall !== undefined || policy.minScenario !== undefined) return false;
  return Object.keys(policy.metrics ?? {}).length === 0;
}

/** Per-eval policy wins over the suite-level default, field by field. */
type LoosePolicy = {
  minOverall?: number | undefined;
  minScenario?: number | undefined;
  metrics?: Record<string, number> | undefined;
};

export function mergePolicies(
  base: LoosePolicy | undefined,
  override: LoosePolicy | undefined,
): SuiteGatePolicy {
  const metrics = { ...(base?.metrics ?? {}), ...(override?.metrics ?? {}) };
  const minOverall = override?.minOverall ?? base?.minOverall;
  const minScenario = override?.minScenario ?? base?.minScenario;
  return {
    ...(minOverall === undefined ? {} : { minOverall }),
    ...(minScenario === undefined ? {} : { minScenario }),
    ...(Object.keys(metrics).length === 0 ? {} : { metrics }),
  };
}
