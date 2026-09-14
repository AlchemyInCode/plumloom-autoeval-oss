# ADR 0009: Suite release gating as a third plane

## Status

Accepted.

## Context

Suite execution already runs in two planes: an execution plane with bounded concurrency, and an off-plane results fetcher. Execution reaching `COMPLETED` says nothing about quality, so CI needs a separate step that turns fetched results into a release decision.

## Decision

Add a gate plane that runs after the results plane and reads only payloads the CLI already receives.

- `src/gate/decision.ts` is pure: it maps one eval's terminal status, result payload, and raw run status to `PASS | FAIL | INCONCLUSIVE | ERROR`, then rolls eval decisions up with precedence `ERROR > FAIL > INCONCLUSIVE > PASS`. No averaging, no synthetic suite score.
- Scenario single-run gating compares configured thresholds against means. Scenario multi-run gating compares 95% confidence intervals: `ci95_lower >= threshold` passes, `ci95_upper < threshold` fails, a straddling interval is inconclusive.
- Convergence is classified from `evaluationMetrics.autoStopTriggered.reason`, `achievedConsistency`, `targetConsistency`, and `failureDetails.failureReason`. `MAX_RUNS_REACHED` alone does not prove a convergence failure, so a missing consistency target means convergence was not enabled and interval-only gating applies. The consistency comparison honours `targetConsistencyOperator`: the backend reports consistency as a spread to stay under (`<`), so a lower achieved value can be a converged run. When none of those fields are present, gating falls back to interval-only and does not claim convergence awareness.
- Conversation and Agent Trace gate on `per_metric.<metric>.score` for configured metrics only. `outcome.achieved`, `outcome.score`, generated summaries and insights, and Agent Trace model-performance CI are deliberately unused.
- Thresholds are declared in the suite manifest, at suite level and optionally per eval; per-eval values override suite defaults. An eval with no configured threshold is `INCONCLUSIVE`, never a silent pass.
- `autoeval suite gate --manifest <file>` reuses the existing create/run/poll and result-fetch paths, prints a human report or a single `--json` payload, and exits non-zero for `FAIL`, `INCONCLUSIVE`, and `ERROR`, keeping the three distinguishable through the error code.

## Validation

Exercised end to end against the real backend with a suite containing a scenario single-run eval,
a scenario multi-run eval with convergence enabled, a conversation eval, and an agent-trace eval.
The live multi-run status reported `autoStopTriggered.reason: MAX_RUNS_REACHED` with
`achievedConsistency: 0.02`, `targetConsistency: 0.1`, and `targetConsistencyOperator: "<"` — the
backend reports consistency as a spread to stay under, so a lower achieved value is the converged
outcome. `classifyConvergence` originally assumed higher-is-better and misclassified that
genuinely converged run as `NOT_CONVERGED`, downgrading a passing eval to `INCONCLUSIVE`. The fix
honours the operator and is locked in by regression tests for both a met and a missed
lower-is-better target.

## Consequences

Gating adds no backend fields or endpoints and stays independently testable without network access. Missing or unusable evidence blocks a release rather than passing quietly, which will surface as inconclusive builds until thresholds and run modes are configured deliberately.

Detailed reference: [suite execution and release gating](../../public/release-gating.md).
