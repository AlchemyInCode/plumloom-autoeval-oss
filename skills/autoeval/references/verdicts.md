# Verdicts and exit codes

Source of truth: `docs/public/release-gating.md` and `docs/public/cli-reference.md` in the Autoeval
repository. This file is a short map for agents. When it and those documents disagree, they win.

## Verdicts

| Verdict        | Meaning                                                                                |
| -------------- | -------------------------------------------------------------------------------------- |
| `PASS`         | Every configured threshold was met.                                                    |
| `FAIL`         | The run completed and at least one score is below its threshold.                       |
| `INCONCLUSIVE` | Evidence exists but cannot decide. Blocks a release, the same as a failure.            |
| `ERROR`        | An evaluation could not be executed or its results could not be read. Suite gate only. |

A suite takes the worst per-evaluation decision, in the order `ERROR`, `FAIL`, `INCONCLUSIVE`,
`PASS`. There is no averaging. An empty suite is `INCONCLUSIVE`.

## What makes a result INCONCLUSIVE

- No threshold is configured for the evaluation.
- A required metric is missing, or reports `has_data: false`.
- A required score or confidence interval is unavailable.
- With multiple scenario trials, the 95% confidence interval straddles the threshold.
- Convergence was required and not reached, on a result that would otherwise pass.

One difference to know: with `autoeval gate` on a scenario evaluation, missing scenario evidence
fails its check instead of being inconclusive.

## Exit codes

| Command               | Code | Meaning                                                |
| --------------------- | ---- | ------------------------------------------------------ |
| `autoeval suite gate` | `0`  | `PASS`                                                 |
|                       | `1`  | `FAIL` or `INCONCLUSIVE`                               |
|                       | `5`  | `ERROR`                                                |
| `autoeval gate`       | `0`  | Every threshold was met.                               |
|                       | `1`  | A threshold was not met, or the gate was inconclusive. |
|                       | `5`  | The run ended in a non-completed state.                |
| `autoeval doctor`     | `0`  | Every check passed.                                    |
|                       | `2`  | At least one check failed.                             |
| Any command           | `2`  | Usage error.                                           |
|                       | `3`  | Authentication or authorization error.                 |
|                       | `4`  | Network, upstream or timeout error.                    |

`FAIL` and `INCONCLUSIVE` share exit code `1`. Tell them apart with `--json` or the printed report.

## Reading `suite gate --json`

The payload has `workspaceId`, `suiteDecision`, `counts`, `perEvalDecisions` and `failureClusters`.
Each entry in `perEvalDecisions` carries `checks`, `evidence` and `reason`. Each failure cluster has
a category (`threshold`, `inconclusive` or `execution`), a count, the contributing evaluations and
one verbatim example.
