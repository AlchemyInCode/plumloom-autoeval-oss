# Example 3: Gate a release in CI

**When you are done**, your pull request has an Autoeval CI check that can block the merge when you
configure it as a required check. You have a suite manifest with release criteria, a pre-flight
check that catches setup errors in seconds, and a CI job you can copy.

**Needs:** one or more evaluation files that pass `autoeval eval validate`
([Example 2](./write-and-run-your-own-eval.md)), a workspace ID, a CLI key, and the API origin.

---

## 1. Write a suite manifest, with release criteria

A suite manifest lists the evaluation files a release depends on, and the release criteria each one
must satisfy. The criteria are a release policy, not one score cutoff: overall and per-scenario
thresholds for scenario evaluations, per-metric thresholds for conversation and agent-trace
evaluations, and, for scenarios with more than one trial, decisions that use the confidence
interval. The manifest is a small YAML (or JSON) file that you commit next to the evaluation files:

```yaml
# evals/autoeval.suite.yaml
workspace: <workspace-id>
gate:
  minOverall: 3.5 # default for every scenario eval below
evals:
  - ./freezing-point.autoeval.json
  - file: ./weather-trace.autoeval.json
    gate:
      metrics:
        factuality: 4.0 # conversation and agent-trace evals gate on per-metric scores
```

How it reads:

- **Paths** resolve relative to the manifest, not to the directory you run the command from.
- The top-level **`gate`** block is the default for every evaluation, and a `gate` block on one entry
  overrides it, field by field. Every evaluation inherits the suite-level settings, but it uses only
  the thresholds that apply to its context type. In the manifest above, the scenario evaluation uses
  `minOverall`, and the agent-trace evaluation uses its `metrics` threshold.
- **Scenario** evaluations test a one-shot prompt against the model under test. Their results show
  Model Performance, Scenario Performance, and the Model Response. `minOverall` gates the primary
  model's overall score from Model Performance. `minScenario` gates each scenario (test case) score
  from Scenario Performance, so a strong overall score cannot hide one weak scenario.
- **Conversation** and **agent-trace** evaluations gate on `metrics`, one minimum score per metric
  name. Use the metric names you saw on the scorecard in
  [Example 1](./grade-a-recorded-agent-trace.md#2-read-the-scorecard).
- Judge agreement can be gated separately with `autoeval gate --min-judge-agreement`. The suite
  manifest's `gate` block has no judge-agreement field.
- **The evaluation file and the `gate` block do different jobs.** The evaluation file defines what
  gets run and scored. The `gate` block defines the release policy that the CLI applies to those
  results. The gate configuration is not part of the evaluation request sent to the backend.
- The keys are strict. A misspelled key fails at once with exit code `2`, for example
  `gate: Unrecognized key: "min_overall".` Run `autoeval doctor` (step 2) to catch this before CI.

This applies to the scenario thresholds above. For a scenario evaluation with more than one trial
(`runsPerScenario` above `1`), `minOverall` is evaluated against the 95% confidence interval for the
primary model's overall score, and `minScenario` is evaluated against the confidence interval for
each scenario score. If an interval crosses its threshold, that check is `INCONCLUSIVE`, and it
blocks the release.

## 2. Pre-flight with `doctor`

```bash
autoeval doctor --workspace <workspace-id> --manifest evals/autoeval.suite.yaml
```

`doctor` is read-only and starts no run. It checks your key, your access to the workspace, your
enabled models, and the manifest and its evaluation files. It reports every problem in one pass. If
any check blocks, it exits with code `2`. A bad key or a disabled model then fails the job in
seconds, before a run you pay for.

```text
• Pre-flight checks passed. This configuration is ready to run.
Passed   6
Failed   0
Skipped  0

CHECK                                        STATUS    DETAIL
Auth and scopes                              pass      Authenticated with a valid CLI identity.
Manifest syntax                              pass      evals/autoeval.suite.yaml lists 2 eval
                                                       file(s).
Workspace scope                              pass      The selected workspace is reachable.
Model catalog                                pass      12 of 12 model(s) are usable.
/repo/evals/freezing-point.autoev…  pass      scenario eval is valid; 2 model(s) enabled
                                                       for this account.
/repo/evals/weather-trace.autoeva…  pass      agent_trace eval is valid; 1 model(s)
                                                       enabled for this account.
```

A blocked report names each problem and how to fix it. Here the manifest points at a public example
that still has placeholder model IDs:

```text
• Pre-flight checks failed. Fix the items below before running the suite.
Passed   4
Failed   1
Skipped  0

CHECK                                     STATUS    DETAIL
Auth and scopes                           pass      Authenticated with a valid CLI identity.
Manifest syntax                           pass      evals/blocked.suite.yaml lists 1 eval file(s).
Workspace scope                           pass      The selected workspace is reachable.
Model catalog                             pass      12 of 12 model(s) are usable.
/repo/evals/scenario-basic.json  FAIL      Judge model ID
                                                    11111111-1111-4111-8111-111111111111 is not
                                                    enabled for this account. Run "autoeval
                                                    models" and choose an enabled model ID

How to fix
- /repo/evals/scenario-basic.json: Run "autoeval models" and use an enabled model ID.
Error: Pre-flight check failed: 1 of 5 checks did not pass.
Hint: Run the command with --help to see required options and examples
```

## 3. Run the gate locally

```bash
autoeval suite gate --manifest evals/autoeval.suite.yaml
```

The gate runs every evaluation in the manifest, reads the results, and gives each evaluation a
verdict. The suite verdict is the worst of them, in this order: `ERROR`, then `FAIL`, then
`INCONCLUSIVE`, then `PASS`.

| Suite verdict  | Exit code | Meaning                                                                                    |
| -------------- | --------- | ------------------------------------------------------------------------------------------ |
| `PASS`         | `0`       | Every evaluation met its release criteria. The release may proceed.                        |
| `FAIL`         | `1`       | At least one evaluation missed a threshold.                                                |
| `INCONCLUSIVE` | `1`       | The evidence cannot decide. It blocks, the same as a failure.                              |
| `ERROR`        | `5`       | At least one evaluation could not complete successfully, or its results could not be read. |

Only `PASS` exits `0`. With `--json`, the error code (`SUITE_GATE_FAIL`,
`SUITE_GATE_INCONCLUSIVE`, or `SUITE_GATE_ERROR`) tells the three apart.

```text
• Suite release gate: PASS
Workspace     ffffffff-ffff-4fff-8fff-ffffffffffff
PASS          2
FAIL          0
INCONCLUSIVE  0
ERROR         0

Every eval in the suite met its configured release criteria.
```

The same suite with `minOverall: 4.8` fails, names the evaluation that blocked the release, and
exits `1`:

```text
• Suite release gate: FAIL
Workspace     ffffffff-ffff-4fff-8fff-ffffffffffff
PASS          1
FAIL          1
INCONCLUSIVE  0
ERROR         0

Blocking evals
- Basic factual questions [FAIL]
  context: scenario
  run: eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee
  Primary model overall score: 4.30 required >= 4.80 -> FAIL
    reason: score is below the required threshold
  reason: Primary model overall score: score is below the required threshold

Failure clusters
1 failure(s) grouped into 1 root cause(s).

ROOT CAUSE                                            CATEGORY      COUNT  EVALS
Primary model overall score below threshold (>=       threshold         1  Basic factual questions
4.80)

- Primary model overall score below threshold (>= 4.80): Primary model overall score: 4.30 required >= 4.80 — score is below the require…
Error: Suite release gate: FAIL. 0 error, 1 failed, 0 inconclusive of 2 evals.
Hint: Inspect the failing metric with `autoeval results <evaluation-id> <run-id>`, then adjust the evaluation or the thresholds
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
      - run: npm install --global @plumloom/cli@0.1.2
      - name: Pre-flight
        run: autoeval doctor --manifest evals/autoeval.suite.yaml
      - name: Release gate
        run: autoeval suite gate --manifest evals/autoeval.suite.yaml
```

The CLI version is pinned on purpose. A release gate must give the same answer on every run, and an
unpinned install would let a new CLI release change gate behavior with no change in your repository.
Update the version deliberately, in its own pull request.

The job fails when either step exits with a code other than `0`. The workflow by itself does not
block a merge: the check blocks it only when you make it a required check in your branch protection
settings.

Choose the gate by what you want:

- **A simple threshold check on one evaluation that is already configured:** use
  `autoeval gate <evaluation-id>`. It compares the scored result with the thresholds you configure.
  This repository runs it with its own action; see [Release gating](../release-gating.md).
- **Confidence-interval-aware gating for a scenario with more than one trial:** use
  `autoeval suite gate`, even if the suite contains only one evaluation.

## What most often goes wrong

**The manifest has no thresholds, so the gate never passes.** With no `gate` block, the gate has
nothing to compare a score with. It marks every evaluation `INCONCLUSIVE`, however well it scores,
and the suite exits with code `1` on every run:

```text
• Suite release gate: INCONCLUSIVE
Workspace     ffffffff-ffff-4fff-8fff-ffffffffffff
PASS          0
FAIL          0
INCONCLUSIVE  1
ERROR         0

Blocking evals
- Basic factual questions [INCONCLUSIVE]
  context: scenario
  run: eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee
  reason: no score thresholds are configured for this eval

Failure clusters
1 failure(s) grouped into 1 root cause(s).

ROOT CAUSE                                        CATEGORY      COUNT  EVALS
no score thresholds are configured for this eval  inconclusive      1  Basic factual questions

- no score thresholds are configured for this eval: no score thresholds are configured for this eval
Error: Suite release gate: INCONCLUSIVE. 0 error, 0 failed, 1 inconclusive of 1 evals.
Hint: Inspect the failing metric with `autoeval results <evaluation-id> <run-id>`, then adjust the evaluation or the thresholds
```

The sample manifest at
[`examples/suite/autoeval.suite.yaml`](../../../examples/suite/autoeval.suite.yaml) includes a `gate`
block, so you can copy it as a working starting point.

## Next

- [Release gating](../release-gating.md): the complete gate reference.
- [Core workflows](../core-workflows.md#3-suite-execution-and-release-gating): how a suite run works
  inside the CLI.
