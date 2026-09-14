# Release gating for CI

How Autoeval turns evaluation results into a release decision. Two surfaces share the same evidence model: the single-evaluation gate (`autoeval gate`) for one committed evaluation, and the suite gate (`autoeval suite gate`) for a manifest of eval files. Task walkthroughs live in the [command guide](./commands.md); per-command options live in the [CLI reference](./cli-reference.md).

---

## Single-evaluation gate: `autoeval gate`

The release gate evaluates the scored result for an already-configured Autoeval evaluation and
fails the workflow when that result misses configured thresholds. When the evaluation already has
a completed run, the gate can reuse that run and result, keep the same Run ID, and decide
immediately instead of forcing a new run. If the returned run is not terminal, the CLI polls it
before reading results. The gate reuses the existing evaluation, run, status, and results
capabilities; it introduces no new backend evaluation system.

### Single-evaluation gate versus suite gate

| Aspect           | `autoeval gate <evaluation-id>`                                                          | `autoeval suite gate --manifest <file>`                                                          |
| ---------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Input            | one already-configured evaluation UUID                                                   | a manifest listing eval files and a workspace                                                    |
| Thresholds       | CLI flags or a `--thresholds` JSON file                                                  | `gate` blocks in the manifest, suite-level with per-eval overrides                               |
| Execution        | reuses an existing completed run/result when available; otherwise polls the returned run | three planes: bounded-concurrency execution, off-plane results, pure gate                        |
| Verdict          | `PASS \| FAIL \| INCONCLUSIVE` against the flag thresholds                               | per-eval `PASS \| FAIL \| INCONCLUSIVE \| ERROR`, rolled up `ERROR > FAIL > INCONCLUSIVE > PASS` |
| Missing metric   | scenario: fails; conversation / agent trace: `INCONCLUSIVE`                              | `INCONCLUSIVE` (evidence exists but cannot decide) and still blocks the release                  |
| Session evidence | configured `per_metric.<metric>.score` only                                              | configured `per_metric.<metric>.score` only                                                      |
| Multi-run        | not interval-aware                                                                       | 95% confidence-interval comparison plus convergence classification                               |
| Exit codes       | `0` pass, `1` threshold miss, `5` non-completed run                                      | `0` `PASS`, `1` `FAIL`/`INCONCLUSIVE`, `5` `ERROR`                                               |

Use the single-evaluation gate when one committed evaluation is the release signal. Use the suite
gate when a release depends on a set of eval files reviewed alongside the code.

### Developer workflow

1. Configure the evaluation once (in Plumloom, or locally with `autoeval eval run-configured`).
2. Store the `pl_sk_` key as the repository secret `AUTOEVAL_API_KEY`, the API origin as the
   repository variable `AUTOEVAL_API_BASE_URL`, and the evaluation UUID as the repository variable
   `AUTOEVAL_EVALUATION_ID`.
3. Add the action to a workflow with thresholds.
4. On each pull request the action requests the evaluation's run. If an existing completed run is
   available, the action reuses that Run ID and evaluates its result immediately. If the returned
   run is still active, the action waits for a terminal state. It then compares the results with
   the thresholds, writes a job summary, and passes or fails the job.

Anything CI does is reproducible locally:

```bash
autoeval gate <evaluation-id> --min-overall 4.0 --min-scenario 3.5
autoeval gate <evaluation-id> --metric factuality=4.0 --metric tone=3.5
```

### Pre-flight with `autoeval doctor`

Run `autoeval doctor` before the gate step so a bad key, an unreachable workspace, or a disabled
model ID fails in seconds instead of after a billable run:

```bash
autoeval doctor --workspace <workspace-id> --input ./evals/refund-policy.json
```

It is read-only, reports every problem in one pass with a hint per failure, and exits `2` when the
report is blocked. See [suite execution and release gating](#30-doctor-pre-flight).

### Authentication

The action passes the key to the CLI step as `AUTOEVAL_API_KEY` and the required API origin as
`AUTOEVAL_API_BASE_URL`. The key is never placed on the command line, echoed, or persisted (see
[ADR 0002](../internal/adr/0002-cli-credential-storage.md)). CI needs no credential store; the key
environment variable takes precedence over it.

### Thresholds

| Input                 | CLI flag                | Applies to                                  |
| --------------------- | ----------------------- | ------------------------------------------- |
| `min-overall`         | `--min-overall`         | scenario context                            |
| `min-scenario`        | `--min-scenario`        | scenario context (every scenario and model) |
| `min-judge-agreement` | `--min-judge-agreement` | scenario context                            |
| `metrics`             | `--metric name=score`   | conversation, agent trace (only evidence)   |
| `thresholds-file`     | `--thresholds`          | all contexts                                |

Thresholds can also live in a committed JSON file so they are reviewed alongside code:

```json
{
  "minOverall": 4.0,
  "minScenario": 3.5,
  "minJudgeAgreement": 0.66,
  "metrics": { "factuality": 4.0 }
}
```

Individual flags/inputs override file values (per-metric maps are merged, flag wins per metric). At least one threshold must be set. For scenario evals an unavailable score fails the gate rather than passing silently. For conversation and agent trace an unavailable score, a missing metric, or `has_data: false` is `INCONCLUSIVE` and still blocks the release; it is never coerced to zero.

### Metrics used

- **scenario** — canonical overall, per-scenario minimum, and judge-agreement checks. Overall uses the primary model from model performance, falling back to the comparison summary mean; the per-scenario minimum comes from the scenario comparison reader.
- **conversation** — configured `per_metric.<metric>.score` values only, requiring `has_data: true`. `outcome.achieved` and `outcome.score` come from a separate outcome-judge path and are never gated on.
- **agent trace** — the same per-metric evidence as conversation. Summary/insights, model-performance confidence intervals, and the trajectory score are reported but never gated on.

This is the same evidence model the suite gate uses, so `autoeval gate` and `autoeval suite gate` agree for both session context types.

### Custom gates from JSON results

For policies beyond the built-in threshold flags, capture the structured result payload and apply
your own CI logic:

```bash
autoeval --json results <evaluation-id> <run-id> > autoeval-results.json
```

Branch on `contextType` before reading context-specific evidence. Scenario results expose model
scores and their `mean`, `sample_size`, `std_dev`, and 95% confidence-interval fields under
`modelPerformance.models[].scores`; per-scenario model performance under
`scenarioComparison.scenarios[].model_scores[].score`; and response status, best-run score, and
token, cost, and latency metadata under `modelResponses.outputs[].model_responses[]`. A custom gate
can combine only the fields its policy needs—for example, a metric floor plus a confidence bound
or variability limit—and return a nonzero CI exit code when the policy is not met. Treat missing
data or `has_data: false` explicitly rather than coercing it to a passing score.

### Exit codes

| Code | Meaning                                               |
| ---- | ----------------------------------------------------- |
| 0    | Every configured threshold met                        |
| 1    | A threshold was not met, or the gate was inconclusive |
| 2    | Usage or validation error                             |
| 3    | Authentication, authorization, or plan restriction    |
| 4    | Network, upstream, or timeout                         |
| 5    | The run ended in a non-completed state                |

`fail-on-timeout: 'false'` turns a polling timeout into a neutral (passing) job; the run keeps going server-side and can be inspected with `autoeval status`.

### Job summary

The action appends a markdown summary containing the verdict, evaluation and run UUIDs, context type, duration, and a threshold table with failing rows marked. On infrastructure failures it prints the error message and its remediation hint plus the `autoeval status` command to resume checking. Only the CLI's redacted JSON output is used, so no credentials or raw upstream payloads reach the summary.

### Example workflow

```yaml
name: Autoeval release gate

on:
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  evaluate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/autoeval-gate
        with:
          evaluation-id: ${{ vars.AUTOEVAL_EVALUATION_ID }}
          api-key: ${{ secrets.AUTOEVAL_API_KEY }}
          base-url: ${{ vars.AUTOEVAL_API_BASE_URL }}
          min-overall: '4.0'
          min-scenario: '3.5'
          metrics: |
            factuality=4.0
```

---

## Suite execution and release gating: `autoeval suite gate`

### 1. Three-plane suite architecture

A suite manifest names a workspace and lists eval files. Running it moves each eval through
three planes. Each plane reads only what the previous one produced, so each is separately
testable and no plane re-implements a capability that already exists.

```text
manifest ──► execution plane ──► results plane ──► gate plane ──► CI exit code
 (files)      create/run/poll      fetch results     pure decision
```

#### 1.1 Execution plane

`packages/cli/src/suite/execution.ts` (`runTwoPlaneSuite`) drives a bounded worker pool over
the manifest's eval files. Per eval it calls the injected `execute` callback, which in
`packages/cli/src/actions/suite.ts` composes the existing actions: read and validate the eval
file, `createEvaluation`, then `runConfiguredEvaluation` (which submits the configured run and
polls to a terminal execution state).

- Concurrency: `--concurrency` (default `3`) caps how many evals execute at once.
- Stagger: `--stagger-ms` (default `250`) spaces successive starts so a suite does not
  submit a burst of runs at the same instant.
- A slot is held **only while an eval is executing**. The moment an eval reaches a terminal
  execution state the slot is released and the next queued eval starts.

What it hands off: `SuiteEvalExecution` — evaluation ID and name, context type, run ID,
terminal state, elapsed time, and `statusRaw`, the terminal run-status payload the gate plane
later reads convergence evidence from.

#### 1.2 Results plane

As soon as an eval finishes executing, a result fetch is enqueued **off the execution plane**
with its own concurrency budget (`resultConcurrency`, defaulting to the execution budget). The
fetch calls the existing `getResults` action, which waits for results to become ready and
normalizes the payload per context type.

Because the results plane never occupies an execution slot, result fetching for finished evals
overlaps with evals that are still running. Wall-clock time for a suite is therefore bounded by
execution, not by serialized result retrieval.

#### 1.3 Gate plane

`packages/cli/src/gate/decision.ts` plus `packages/cli/src/actions/suite-gate.ts`. It runs after
both planes are drained and is **pure**: no I/O, no new backend fields. It maps each eval's
terminal status, result payload, and raw run status to `PASS | FAIL | INCONCLUSIVE | ERROR`,
then rolls those up into one suite decision and a process exit code.

#### 1.4 Data flow between planes

| Stage           | Produced by                   | Consumed by     | Payload                                                                   |
| --------------- | ----------------------------- | --------------- | ------------------------------------------------------------------------- |
| eval file paths | manifest parser               | execution plane | absolute paths resolved against the manifest directory                    |
| execution       | `createEvaluation` + run/poll | results, gate   | `evaluationId`, `runId`, `contextType`, `state`, `elapsedMs`, `statusRaw` |
| results         | `getResults`                  | gate            | normalized `EvaluationResults` per context type                           |
| decision        | `decideEvalGate` + roll-up    | output, exit    | per-eval checks, evidence, reason; suite verdict and counts               |

#### 1.5 Failure isolation

Each eval carries its own record with a status of `completed`, `execution_failed`, or
`result_failed`, plus an error message. A failure in either plane is recorded against that eval
only; every other eval keeps going and the suite still produces a complete summary. `suite run`
reports `completed` versus `failed` counts; `suite gate` converts both failure statuses into an
`ERROR` decision for that eval.

#### 1.6 Why execution `COMPLETED` is not a quality `PASS`

`COMPLETED` means the backend finished the run: prompts were sent, judges scored, and results
are available. It says nothing about whether the scores clear the bar a release requires — a
run can complete perfectly and still score 2.1 against a 4.0 threshold, or complete with a
confidence interval too wide to decide anything. Quality is a separate judgement made in the
gate plane against thresholds the developer committed next to the eval files. Missing or
unusable evidence blocks the release rather than passing quietly.

---

### 2. Release-gating logic

Thresholds come from the manifest's `gate` blocks (`packages/cli/src/gate/policy.ts`):
`minOverall`, `minScenario`, and `metrics` (a map of metric name to minimum score). A per-eval
`gate` block overrides the suite default field by field.

#### 2.1 Scenario, single run

Run mode is detected from `progress.totalRuns` in the terminal run status, falling back to
whether the result cells carry confidence intervals. With one run, comparison is a point
estimate:

- `mean >= threshold` → `PASS`
- `mean < threshold` → `FAIL`
- `mean` null / absent, `has_data: false`, or an errored scenario cell → `INCONCLUSIVE`

A missing score is never treated as zero. `minOverall` applies to the primary model's overall
cell; `minScenario` applies to every scenario cell for that primary model.

#### 2.2 Scenario, multiple runs

With more than one run the point estimate is not defensible on its own, so gating compares the
95% confidence interval against the threshold:

| Condition                        | Decision       | Meaning                                 |
| -------------------------------- | -------------- | --------------------------------------- |
| `ci95_lower >= threshold`        | `PASS`         | the whole interval clears the bar       |
| `ci95_upper < threshold`         | `FAIL`         | the whole interval is below the bar     |
| interval straddles the threshold | `INCONCLUSIVE` | evidence cannot separate pass from fail |
| interval bound null/absent       | `INCONCLUSIVE` | required evidence unavailable           |

#### 2.3 Convergence enabled versus fixed-N

`classifyConvergence` reads `evaluationMetrics.autoStopTriggered.reason`,
`achievedConsistency`, `targetConsistency`, `targetConsistencyOperator`, and
`failureDetails.failureReason`:

- `OPTIMAL_CONFIDENCE_REACHED` → `CONVERGED`.
- No consistency target (absent, null, or `<= 0`) → `NOT_APPLICABLE`: convergence was never
  enabled, this is a fixed-N run and interval-only gating applies.
- A target exists → compare `achievedConsistency` using `targetConsistencyOperator`.
  `MAX_RUNS_REACHED` on its own does **not** prove a convergence failure.
- A failure reason, or a non-terminal/failed run state → `ERROR`.
- None of the fields present → `UNKNOWN` with `fieldsUnavailable: true`; gating falls back to
  interval-only and does not claim convergence awareness.

When convergence is `NOT_CONVERGED`, an otherwise-passing eval becomes `INCONCLUSIVE`; an
already-`FAIL` eval stays `FAIL`. `ERROR` convergence makes the eval `ERROR`.

#### 2.4 Conversation per-metric gating

Gates on `per_metric.<metric>.score` for the metrics named in the policy, and nothing else.
Score at or above threshold passes, below fails, and a metric missing from the payload or
carrying `has_data: false` is `INCONCLUSIVE`.

#### 2.5 Agent Trace per-metric gating

Identical rules and identical field path as conversation. Agent Trace model-performance
confidence intervals are not used.

#### 2.6 Decision semantics

| Decision       | Meaning                                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `PASS`         | every configured criterion was met on usable evidence                                                                                    |
| `FAIL`         | evidence is usable and a criterion was not met                                                                                           |
| `INCONCLUSIVE` | evidence exists but cannot decide — missing score, straddling interval, unmet convergence, or **no thresholds configured for this eval** |
| `ERROR`        | execution failed, results could not be fetched, or the run reported a failure                                                            |

An eval with no configured threshold is `INCONCLUSIVE`, never a silent pass.

#### 2.7 Suite roll-up and CI exit codes

Roll-up precedence is `ERROR > FAIL > INCONCLUSIVE > PASS`; an empty suite is `INCONCLUSIVE`.
There is no averaging and no synthetic suite score. Only `PASS` releases.

| Suite decision | Error code                | Exit |
| -------------- | ------------------------- | ---- |
| `PASS`         | —                         | 0    |
| `FAIL`         | `SUITE_GATE_FAIL`         | 1    |
| `INCONCLUSIVE` | `SUITE_GATE_INCONCLUSIVE` | 1    |
| `ERROR`        | `SUITE_GATE_ERROR`        | 5    |

`FAIL` and `INCONCLUSIVE` share exit `1` (both block a release for a quality reason) but stay
distinguishable through the error code, the human report, and the JSON payload.

#### 2.8 Fields explicitly excluded from gating

| Excluded field                      | Why                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| `outcome.achieved`, `outcome.score` | backend defects make these unreliable for conversation and agent trace today   |
| generated summaries and insights    | prose produced by a model; not a stable release signal                         |
| Agent Trace model-performance CI    | not a per-metric quality bar; per-metric scores are the gating surface         |
| judge agreement in suite gating     | belongs to the single-eval `autoeval gate` threshold set, not the suite policy |

---

### 3. CLI usage

#### 3.0 `doctor` pre-flight

```bash
autoeval doctor --manifest autoeval.suite.yaml [--json]
```

A suite costs time and evaluation usage, so the failures worth catching are the ones knowable
before the first run is submitted. `doctor` runs four read-only checks — authentication and scopes,
workspace reachability, the model catalog, and manifest plus eval-file syntax including whether
each declared model ID is actually enabled for the account — and reports all of them in one pass
rather than stopping at the first. It creates nothing and submits no runs.

Each check is `pass`, `fail`, or `skipped` (a check that depends on a failed one is skipped, not
reported as a second failure) and a failing check carries an actionable hint. The report is `ready`
or `blocked`; `blocked` exits `2` with `DOCTOR_BLOCKED`. Run it as the CI step immediately before
`suite gate`.

Implementation: `packages/cli/src/actions/doctor.ts`, tests in `packages/cli/tests/doctor.test.ts`.

#### 3.1 `suite run`

```bash
autoeval suite run --manifest autoeval.suite.yaml [--concurrency 3] [--stagger-ms 250] [--json]
```

Creates and runs every eval in the manifest, then prints a per-eval summary: source file,
evaluation ID, run ID, context type, terminal execution state, status, and fetched results.
Execution-only; it makes no release judgement.

#### 3.2 `suite gate`

```bash
autoeval suite gate --manifest autoeval.suite.yaml [--concurrency 3] [--stagger-ms 250] [--json]
```

Runs the same two planes, then adds the gate plane and exits non-zero for any non-`PASS`
verdict.

#### 3.3 Manifest gate-policy example

```yaml
workspace: ffffffff-ffff-4fff-8fff-ffffffffffff
gate:
  minOverall: 4.0
  minScenario: 3.5
evals:
  - ./evals/refund-policy.autoeval.json # inherits the suite defaults
  - file: ./evals/support-conversation.autoeval.json
    gate:
      metrics:
        factuality: 4.0
        relevance: 3.8
  - file: ./evals/agent-tool-use.autoeval.json
    gate:
      minOverall: 4.5 # overrides the suite default for this eval only
      metrics:
        tool_selection: 4.0
```

YAML and JSON are both accepted; paths resolve relative to the manifest. `gate` blocks are read
by the CLI only and are never sent to the backend.

#### 3.4 Human output

```text
Suite release gate: ERROR
Workspace      ffffffff-ffff-4fff-8fff-ffffffffffff
PASS           1
FAIL           0
INCONCLUSIVE   0
ERROR          1

Blocking evals
- Agent Trace tool use [ERROR]
  context: agent_trace
  run: 66666666-6666-4666-8666-666666666666
  reason: results endpoint returned 500
```

Passing evals are not listed individually; the counts plus the blocking list are what a CI log
reader needs.

#### 3.5 JSON output

`--json` emits exactly one payload:

```json
{
  "workspaceId": "ffffffff-ffff-4fff-8fff-ffffffffffff",
  "suiteDecision": "FAIL",
  "counts": { "PASS": 2, "FAIL": 1, "INCONCLUSIVE": 0, "ERROR": 0 },
  "perEvalDecisions": [
    {
      "index": 0,
      "inputFile": "/repo/evals/refund-policy.autoeval.json",
      "evaluationName": "Refund policy",
      "evaluationId": "…",
      "runId": "…",
      "contextType": "scenario",
      "decision": "FAIL",
      "reason": "Scenario Checkout: score is below the required threshold",
      "checks": [
        {
          "metric": "scenario:Checkout",
          "label": "Scenario Checkout",
          "threshold": ">= 3.50",
          "actual": "3.20",
          "basis": "mean",
          "decision": "FAIL",
          "reason": "score is below the required threshold",
          "evidence": { "mean": 3.2, "ci95Lower": null, "ci95Upper": null }
        }
      ],
      "evidence": { "runMode": "single_run", "runState": "COMPLETED", "totalRuns": 1 }
    }
  ]
}
```

#### 3.6 Failure clustering

A blocked suite usually has fewer causes than failures. `suite gate` therefore ends its report with
a cluster table, and `--json` adds a `failureClusters` array; `suite run` emits the same field for
execution and result-plane errors.

Every blocking eval contributes one seed: an execution or result-plane error, a failed threshold
check, or an inconclusive verdict. Seeds are grouped on a normalized signature — identifiers, UUIDs,
numbers, and magnitudes are stripped — so `HTTP 502` and `HTTP 504` from the same outage collapse
into one cluster instead of two, and one metric failing across ten evals reads as one cause.

```text
Failure clusters
Cause                                             Category      Count  Evals
Metric factuality below threshold                 threshold         4  refund-policy, support-conversation, …
Upstream error while fetching results             execution         2  agent-trace-tool-use, …
No threshold configured                           inconclusive      1  smoke-scenario
```

Each cluster carries a category (`threshold`, `inconclusive`, `execution`), a count, the
contributing eval labels in suite order, and one verbatim exemplar message so the original wording
is never lost. Clusters are ordered by count, so the first row is the one worth fixing first.
Clustering is presentation only: it never changes a per-eval decision, the suite roll-up, or the
exit code.

Implementation: `packages/cli/src/suite/reporting.ts` (`clusterSuiteFailures`,
`clusterExecutionFailures`), rendered by `packages/cli/src/output/human.ts`.

#### 3.7 GitHub Actions usage

```yaml
name: Release gate

on: [pull_request]

permissions:
  contents: read

jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22.13'
      - run: npm install -g @plumloom/cli
      - name: Gate the release on the suite
        env:
          AUTOEVAL_API_KEY: ${{ secrets.AUTOEVAL_API_KEY }}
          AUTOEVAL_API_BASE_URL: ${{ vars.AUTOEVAL_API_BASE_URL }}
        run: autoeval suite gate --manifest autoeval.suite.yaml --json
```

The key is passed as an environment variable only — never on the command line, echoed, or
persisted (see [ADR 0002](../internal/adr/0002-cli-credential-storage.md)). A non-zero exit fails the job;
`FAIL`, `INCONCLUSIVE`, and `ERROR` remain distinguishable in the emitted JSON. The composite
action in `.github/actions/autoeval-gate/` covers the single-evaluation `autoeval gate` flow and
is documented in the [release gate guide](#single-evaluation-gate-autoeval-gate).

---

### 4. Implementation map

| File                                         | Responsibility                                                                                      |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `packages/cli/src/suite/manifest.ts`         | Parse and validate YAML/JSON manifests, resolve eval paths, merge suite and per-eval gate policies. |
| `packages/cli/src/gate/policy.ts`            | `SuiteGatePolicy` schema, emptiness check, field-by-field policy merge.                             |
| `packages/cli/src/suite/execution.ts`        | Generic two-plane engine: bounded execution pool, stagger, off-plane result pool, per-eval records. |
| `packages/cli/src/actions/suite.ts`          | Wires the engine to real actions and produces `SuiteSummary`.                                       |
| `packages/cli/src/gate/decision.ts`          | Pure gate plane: run-mode detection, mean and CI checks, convergence classification, roll-up.       |
| `packages/cli/src/actions/suite-gate.ts`     | Applies policies to a `SuiteSummary`, produces the report and the CI exit error.                    |
| `packages/cli/src/output/human.ts`           | `renderSuiteSummary` and `renderSuiteGateReport`.                                                   |
| `packages/cli/src/commands/program.ts`       | `suite run` / `suite gate` command definitions and option parsing.                                  |
| `packages/cli/src/commands/executor.ts`      | Command dispatch, concurrency/stagger defaults (`3` / `250 ms`), JSON versus human output.          |
| `packages/cli/tests/suite-two-plane.test.ts` | Plane behaviour: concurrency, stagger, off-plane fetching, failure isolation.                       |
| `packages/cli/tests/suite-gate.test.ts`      | Gating contract: every decision rule, roll-up precedence, exit codes, manifest policy merging.      |

#### Reuse of existing paths

Nothing in the suite layer re-implements evaluation lifecycle logic:

- **Create** — `createEvaluation` from `src/actions/evaluations.ts`, including the derived
  `userSystemId` behaviour.
- **Run and poll** — `runConfiguredEvaluation` from `src/actions/configured-runs.ts`, which uses
  the same configured-input validation and polling bounds as `eval create-from --run`.
- **Results** — `getResults` from `src/actions/results.ts`, with the same readiness polling and
  per-context normalization the standalone `results` command uses.
- **Errors and exit codes** — `AutoevalError` kinds map to the established exit-code table; the
  gate adds only the `gate_failed` kind used by `autoeval gate`.

---

### 5. Live validation findings

The gate was exercised end-to-end against the real backend with a suite containing a scenario
single-run eval, a scenario multi-run eval with convergence enabled, a conversation eval, and an
agent-trace eval (`examples/smoke/fixtures/`, including
`smoke-scenario-multirun.json`).

**Real multi-run convergence payload.** The terminal run status reported
`autoStopTriggered.reason: MAX_RUNS_REACHED` together with `achievedConsistency: 0.02`,
`targetConsistency: 0.1`, and `targetConsistencyOperator: "<"`.

**`targetConsistencyOperator` `<`.** The backend reports consistency as a _spread to stay
under_, not a score to exceed. A lower achieved value is therefore a better, converged run.

**Bug found and corrected.** `classifyConvergence` originally assumed higher-is-better and
compared `achieved >= target`, so this genuinely converged run was classified `NOT_CONVERGED`,
which downgraded a legitimately passing eval to `INCONCLUSIVE` and blocked the release.
The fix honours `targetConsistencyOperator` (`<`, `<=`, `>`, default `>=`) and is locked in by
regression tests covering both a met and a missed lower-is-better target.

**Final live suite behaviour.** After the fix the multi-run eval classified as `CONVERGED` and
passed on `ci95_lower >= threshold`; the single-run scenario, conversation, and agent-trace
evals gated on means and per-metric scores as designed; the suite verdict and exit code matched
the per-eval evidence. Result fetching for finished evals overlapped with still-running evals as
intended.

---

### 6. Packaging, CI, and release setup

#### npm publish flow

`@plumloom/cli` is the published package. `publishConfig` marks it public, package metadata
points at `https://github.com/plumloom-org/plumloom-autoeval`, and `prepublishOnly` runs the
public-boundary, build, test, and pack checks so a local publish cannot skip them.
`scripts/check-package-contents.mjs` and `scripts/check-public-boundary.mjs` reject any
closed-surface file that reaches the tarball.

#### Repository CI (`.github/workflows/ci.yml`)

- **Lint, typecheck, test** — `format:check`, `lint`, `typecheck`, `build`, `test` on Node 22.13.
- **Public package boundary** — `pnpm verify:public` builds, tests, and packs `@plumloom/cli`
  alone and fails on any closed-surface leak.
- **CLI smoke** — matrix over `ubuntu-latest`, `macos-latest`, `windows-latest`.

#### Cross-platform smoke tests

The smoke job installs and executes the built binaries so the native keyring dependency is
proven to install and load on every published platform. It runs `--version`, `--help`,
`suite gate --help`, and `eval create-from --help`, then boots the MCP server over stdio.

#### MCP `initialize` smoke test and the dummy key

The MCP stdio server resolves credentials when it boots its action context, before reading the
first JSON-RPC message. A CI runner has no keyring entry (nobody ran `autoeval login`) and no
TTY for the interactive prompt, so the server refuses to start and the step exits `1`.

The step therefore sets `AUTOEVAL_API_KEY: pl_sk_ci_smoke_placeholder` and
`AUTOEVAL_API_BASE_URL: https://api.example.test`: literal dummy values in the workflow YAML,
scoped to that one step. They satisfy startup validation and are never used for a backend request —
the `initialize` handshake returns server capabilities and makes no API call, and the assertion is
only that the response contains `"result"`. They are not secrets and are not stored in GitHub
secrets or repository variables. A real key was rejected as unnecessary credential exposure;
skipping the step would leave the
stdio server untested on Windows and macOS; deferring credential resolution would be a
production behaviour change made to satisfy a smoke test.

#### Release workflow requirements (`.github/workflows/release.yml`)

- Triggered by a `v*` tag push, or manually with a dry-run input.
- Runs in the `npm-publish` environment with `id-token: write` for npm provenance.
- Re-runs `pnpm verify:public` so a failure is attributed to a named step.
- Fails when the tag does not match the `@plumloom/cli` version.
- Publishes with `--access public --provenance --ignore-scripts`, using `NPM_TOKEN`.

---

### 7. Known limitations and follow-ups

- **No retry or resume.** A suite that loses a run to a transient failure must be re-run in
  full; there is no `--from-run-ids` and no resumption from a partially completed suite. Re-runs
  are billable.
- **Convergence evidence depends on the API response.** The gate reads
  `autoStopTriggered.reason`, `achievedConsistency`, `targetConsistency`, and
  `targetConsistencyOperator` from the run status. If the backend stops emitting them, gating
  silently degrades to interval-only (`UNKNOWN`, `fieldsUnavailable: true`) rather than failing
  loudly.
- **`outcome.achieved` excluded.** Conversation and Agent Trace outcome fields are unreliable
  in the current backend, so they are deliberately not gated on. Revisit once the defects are
  fixed; that would be a gating-semantics change and needs an ADR update.
- **No per-eval timeout, and threshold coverage is still unchecked.** A slow eval is bounded only
  by the shared polling timeout. `autoeval doctor` now catches unparseable manifests, invalid eval
  files, and disabled model IDs before any billable run, but it does not check that every eval has
  a threshold — a manifest with no thresholds is still discovered as `INCONCLUSIVE` _after_ the
  runs have executed. Extending `doctor` with that check is the intended follow-up.
- **Remaining GitHub Actions items.** Nothing is failing today. Node 20 deprecation warnings
  from the runner's own actions appear in every job, including passing ones, and are outside
  this repository's control. The release workflow has not yet executed a real tagged publish, so
  the provenance path is verified only through dry runs.
