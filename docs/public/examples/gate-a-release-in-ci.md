# Example 3: Gate a release in CI

**When you are done**, a pull request cannot merge unless your evaluations pass. You have a suite
manifest with thresholds, a pre-flight check that catches setup errors in seconds, and a CI job you
can copy.

**Needs:** one or more evaluation files that pass `autoeval eval validate`
([Example 2](./write-and-run-your-own-eval.md)), a workspace ID, a CLI key, and the API origin.

---

## 1. Write a suite manifest, with thresholds

A suite manifest lists the evaluation files a release depends on, and the scores each one must
reach. It is a small YAML (or JSON) file that you commit next to the evaluation files:

```yaml
# evals/autoeval.suite.yaml
workspace: <workspace-id>
gate:
  minOverall: 4.0 # default for every scenario eval below
evals:
  - ./freezing-point.autoeval.json
  - file: ./refund-conversation.autoeval.json
    gate:
      metrics:
        factuality: 4.0 # conversation and agent-trace evals gate on per-metric scores
```

How it reads:

- **Paths** resolve relative to the manifest, not to the directory you run the command from.
- The top-level **`gate`** block is the default for every evaluation. A `gate` block on one entry
  overrides it, field by field.
- **Scenario** evaluations gate on `minOverall` and `minScenario`. **Conversation** and
  **agent-trace** evaluations gate on `metrics`, one minimum score per metric name. Use the metric
  names you saw on the scorecard in [Example 1](./grade-a-recorded-agent-trace.md#2-read-the-scorecard).
- The `gate` blocks never go to the backend. They only decide the release.
- The keys are strict. A misspelled key fails at once with exit code `2`, for example
  `gate: Unrecognized key: "min_overall".` Run `autoeval doctor` (step 2) to catch this before CI.

For a scenario evaluation with `runsPerScenario` above `1`, the gate compares the 95% confidence
interval with your threshold. A result whose interval straddles the threshold is `INCONCLUSIVE`,
and it blocks the release.

## 2. Pre-flight with `doctor`

```bash
autoeval doctor --workspace <workspace-id> --manifest evals/autoeval.suite.yaml
```

`doctor` is read-only and starts no run. It checks your key, your access to the workspace, your
enabled models, and the manifest and its evaluation files. It reports every problem in one pass. If
any check blocks, it exits with code `2`. A bad key or a disabled model then fails the job in
seconds, before a run you pay for.

<!-- M3-PENDING-KEY: paste a real passing `doctor` report and one real blocked report here. -->

```text
OUTPUT PENDING: captured from a real run before this page ships.
```

## 3. Run the gate locally

```bash
autoeval suite gate --manifest evals/autoeval.suite.yaml
```

The gate runs every evaluation in the manifest, reads the results, and gives each evaluation a
verdict. The suite verdict is the worst of them, in this order: `ERROR`, then `FAIL`, then
`INCONCLUSIVE`, then `PASS`.

| Suite verdict  | Exit code | Meaning                                                            |
| -------------- | --------- | ------------------------------------------------------------------ |
| `PASS`         | `0`       | Every evaluation met its thresholds. The release may proceed.      |
| `FAIL`         | `1`       | At least one evaluation missed a threshold.                        |
| `INCONCLUSIVE` | `1`       | The evidence cannot decide. It blocks, the same as a failure.      |
| `ERROR`        | `5`       | At least one evaluation did not complete. Rerun before you decide. |

Only `PASS` exits `0`. On any other verdict, the command prints a line like this, and the error
code (`SUITE_GATE_FAIL`, `SUITE_GATE_INCONCLUSIVE` or `SUITE_GATE_ERROR`) tells the three apart:

```text
Suite release gate: FAIL. 0 error, 1 failed, 0 inconclusive of 2 evals.
```

<!-- M3-PENDING-KEY: paste the real `suite gate` report for a passing and a failing suite here. -->

```text
OUTPUT PENDING: captured from a real run before this page ships.
```

## 4. Add the CI job

Store the key as the repository **secret** `AUTOEVAL_API_KEY` and the API origin as the repository
**variable** `AUTOEVAL_API_BASE_URL`. The CLI reads both from the environment, so the key never
appears on the command line or on disk.

```yaml
# .github/workflows/autoeval-suite-gate.yml
name: Autoeval suite gate

on:
  pull_request:

permissions:
  contents: read

jobs:
  gate:
    # Pull requests from forks do not receive repository secrets.
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    env:
      AUTOEVAL_API_KEY: ${{ secrets.AUTOEVAL_API_KEY }}
      AUTOEVAL_API_BASE_URL: ${{ vars.AUTOEVAL_API_BASE_URL }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install --global @plumloom/cli
      - name: Pre-flight
        run: autoeval doctor --manifest evals/autoeval.suite.yaml
      - name: Release gate
        run: autoeval suite gate --manifest evals/autoeval.suite.yaml
```

The job fails when either step exits with a code other than `0`, and that blocks the merge if you
make the check required in your branch protection settings.

<!-- M3-PENDING-KEY: run this workflow once against a real workspace and confirm it passes and fails as described. -->

If your release depends on **one** evaluation that is already configured, you can use the
single-evaluation gate instead. This repository runs it with its own action; see
[Release gating](../release-gating.md).

## What most often goes wrong

**The manifest has no thresholds, so the gate never passes.** With no `gate` block, the gate has
nothing to compare a score with. It marks every evaluation `INCONCLUSIVE`, even one that scores 4.9
out of 5, and the suite exits with code `1` on every run. The sample manifest at
[`examples/suite/autoeval.suite.yaml`](../../../examples/suite/autoeval.suite.yaml) has no `gate`
block, so copy the manifest in step 1 instead, or add thresholds before you use the sample in CI.

## Next

- [Release gating](../release-gating.md): the complete gate reference.
- [Core workflows](../core-workflows.md#3-suite-execution-and-release-gating): how a suite run works
  inside the CLI.
