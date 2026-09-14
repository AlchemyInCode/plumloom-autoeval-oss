# Autoeval CLI reference

The per-command contract for the deterministic CLI: options, human and JSON output, and exit
codes. It documents deterministic commands only. For the task-oriented walkthrough see
[`commands.md`](./commands.md); to get started see [`quickstart.md`](./quickstart.md).

## Global options

Global options precede the command:

```text
autoeval [--json] [--debug] <command>
```

- `--json`: emit the command result as machine-readable JSON on stdout; errors are emitted as JSON on stderr. For `login`, JSON mode does not open an interactive prompt, so a key must already be available from the environment or credential store.
- `--debug`: emit redacted request diagnostics on stderr. Authorization headers, request bodies, and CLI keys are excluded.
- `--help`: show help for the selected command.
- `--version`: show the CLI version.

Unless noted otherwise, every deterministic command supports `--json` through the global option.

## Authentication

### `autoeval login`

Validates a `pl_sk_` key with Plumloom. Credential resolution order: `--key`, then `AUTOEVAL_API_KEY`, then the credential store, then a masked interactive prompt. Prompted and `--key` credentials are persisted only after successful validation. An invalid stored key is removed and the user is re-prompted; an invalid `AUTOEVAL_API_KEY` fails with an environment-specific message.

Options:

- `--key <key>`: non-interactive login with an explicit CLI key.

Interactive output first prints guidance for obtaining a key (https://app.plumloom.ai → create CLI key → copy the `pl_sk_` value) before prompting. Human output shows the authenticated identity and whether the key was persisted. JSON output contains the identity, credential source, and persistence status; it never contains the key.

### `autoeval logout`

Removes Autoeval's locally stored credential. It does not revoke a key or unset `AUTOEVAL_API_KEY`.

Human output states whether a local credential was removed and warns when an environment credential remains active. JSON output contains the removal and environment-credential status.

### `autoeval whoami`

Retrieves the authenticated Plumloom identity.

Human output shows the email and optional display name. JSON output contains the validated identity fields.

## Quickstart

### `autoeval quickstart [--sample <trace|scenario>] [--workspace <workspace-id>] [--judge-model-id <uuid>] [--primary-model-id <uuid>] [--input <json-file>] [--yes]`

Runs a first evaluation end to end. Quickstart resolves the workspace (the only one, or a numbered
choice), resolves the judge (the only enabled model, then a curated preference list, then a
numbered choice), creates a timestamped evaluation, waits for the run, and prints its result.

The default `trace` sample is a recorded trajectory graded by the judge alone. `--sample scenario`
also resolves a model under test. `--input` uses another configured-run file and resolves a primary
model only when that file is a Scenario evaluation.

`--yes`, `--json`, and non-TTY sessions never prompt. Ambiguous workspace or model selection then
fails with the override flag to pass. Quickstart never creates or assumes a workspace.

Human output prints the resolved plan, scorecard, and a prefilled `autoeval results` command. JSON
output contains the workspace, evaluation, run, selected model IDs, and results.

## Workspaces

### `autoeval workspace list`

Lists accessible workspaces.

Human output shows each workspace name, UUID, and evaluation count, followed by pagination totals. JSON output contains the normalized workspace page.

### `autoeval workspace create --name <name> [--description <description>]`

- Required: `--name <name>`
- Optional: `--description <description>`

Creates a workspace.

Human output shows the workspace name and UUID. JSON output contains the created normalized workspace.

## Evaluations

### `autoeval eval list --workspace <workspace-id>`

- Required: `--workspace <workspace-id>`

Lists evaluations in a workspace.

Human output shows each evaluation name and UUID, followed by pagination totals. JSON output contains the normalized evaluation page.

### `autoeval eval create --workspace <workspace-id> [--name <evaluation-name>]`

- Required: `--workspace <workspace-id>`
- Optional: `--name <evaluation-name>`; default `Untitled`

Creates an evaluation draft and registers it in the workspace.

Human output shows the evaluation name/UUID and workspace UUID. JSON output contains the evaluation, workspace, and name fields returned by the shared action.

### `autoeval eval versions <evaluation-id>`

- Required argument: `<evaluation-id>`

Lists saved configuration versions for an evaluation.

Human output shows a version table with version number, config version UUID, created timestamp when available, and a current-version marker. JSON output contains the normalized version history payload.

### `autoeval eval show <evaluation-id> [--version <number>]`

- Required argument: `<evaluation-id>`
- Optional: `--version <number>`; show a specific saved version instead of the current version

Resolves the selected methodology/configuration version and retrieves the configuration.

Human output shows the evaluation name when available, UUID, selected version number, context type, methodology version UUID, and configuration version UUID. JSON output contains the normalized version metadata and validated raw configuration.

### `autoeval eval validate --input <json-file>`

- Required: `--input <json-file>`

Validates scenario, conversation, or agent-trace configured-run input without creating versions or starting a run. The command validates required fields, context-specific artifacts, enabled model IDs, role conflicts, and duplicate comparisons.

Human output shows the context type, model names and UUIDs, and artifact count. JSON output contains `{ valid, contextType, artifactCount, models }`. This command makes a read-only enabled-model API request and no write request.

For example:

```bash
autoeval eval validate --input examples/evals/scenario-basic.json
```

### `autoeval eval run-configured --evaluation <evaluation-id> --input <json-file>`

- Required: `--evaluation <evaluation-id>`
- Required: `--input <json-file>`

Preflights the input, creates methodology/configuration versions, submits one run, and waits for a terminal state.

Human output labels the run identifier as `Run ID` and prints ready-to-paste `status` and `results` commands. JSON output contains the run handle and polling outcome, including methodology/configuration UUIDs.

For example, after replacing the documented placeholders:

```bash
autoeval eval run-configured --evaluation <evaluation-id> --input examples/evals/scenario-basic.json
```

`runsPerScenario` is validated as an integer from 1 to 10, preserved, and sent to the API as
`runs_per_scenario`; it defaults to 1 when omitted. Legacy `autoStopEnabled` is accepted for
compatibility but ignored and not forwarded; automatic stopping is controlled by the evaluation
service.

### `autoeval eval create-from --workspace <workspace-id> --input <json-file> [--judge-model-id <uuid>] [--primary-model-id <uuid>] [--run]`

Creates an evaluation from a configured-run file and optionally runs it. Model ID fields are
UUID-only. The override flags replace the file's judge and scenario primary UUIDs in memory before
validation; the source file is not modified. Supplied UUIDs must be enabled for the authenticated
account. Sanitized public fixtures require these flags and direct developers to `autoeval models`
when an override is missing.

### `autoeval eval update-title --workspace <workspace-id> --evaluation <evaluation-id> --name <evaluation-name> --user-system-id <user-system-id> [--description <description>] [--page <page>] [--size <size>]`

- Required: `--workspace <workspace-id>`
- Required: `--evaluation <evaluation-id>`
- Required: `--name <evaluation-name>`
- Required: `--user-system-id <user-system-id>`
- Optional: `--description <description>`
- Optional: `--page <page>`; default `1`
- Optional: `--size <size>`; default `50`

Updates the evaluation title, synchronizes its evaltool listing, and retrieves a refreshed, creation-date-sorted evaluation page.

Human output shows the refreshed evaluation list. JSON output contains the updated evaluation/workspace/name fields and refreshed page.

## Diagnostics

### `autoeval doctor [--workspace <workspace-id>] [--manifest <yaml-or-json-file>] [--input <json-file>...]`

- Optional: `--workspace <workspace-id>`, `--manifest <yaml-or-json-file>`, `--input <json-file>` (repeatable)

Pre-flight checks that run before any evaluation is created or any run is submitted. Nothing is
created, submitted, or billed.

Checks, in order:

- **Auth and scopes** — resolves the CLI key and calls the identity endpoint.
- **Manifest syntax** — parses the suite manifest and its gate policy blocks. Skipped without `--manifest`.
- **Workspace scope** — verifies the workspace is reachable by this key. The workspace comes from
  `--workspace`, otherwise from the manifest. Skipped when neither supplies one.
- **Model catalog** — lists the models enabled for the account.
- **Eval files** — every manifest entry plus each `--input` file is read, expanded, schema-checked,
  and probed against the enabled model catalog (judge, primary, and comparison model IDs).

A failing check never aborts the remaining checks, so one command reports every problem. Checks that
depend on a failed prerequisite are reported as `skipped`, not as failures.

Human output shows a status table followed by a remediation line per failure. JSON output contains
`status` (`ready` or `blocked`), `counts`, and `checks` (each with `id`, `label`, `status`, `detail`,
and `hint` for failures).

Exit codes: `0` when every check passes; `2` (`DOCTOR_BLOCKED`) when any check fails.

```bash
autoeval doctor --manifest autoeval.suite.yaml
autoeval doctor --workspace ffffffff-ffff-4fff-8fff-ffffffffffff --input ./evals/refund-policy.json --json
```

## Traces

### `autoeval trace import --from deepseek-harness --session <jsonl-file> --template <json-file> --out <json-file> [--name <text>] [--service-name <service-name>] [--workspace <workspace-id>] [--run]`

- Required: `--from` (currently `deepseek-harness` only), `--session`, `--template`, `--out`
- Optional: `--name` overrides the evaluation name; `--service-name` sets the trace's
  `service.name` resource attribute; `--workspace` plus `--run` creates and runs the
  imported evaluation immediately (`--run` requires `--workspace`)

Converts a DeepSeek Harness session log into an `agent_trace` configured-run file. The trajectory
supplies only the artifact; the judge model, evaluator instructions, expected behavior, and metrics
come from `--template` (any `agent_trace` configured-run file, e.g. `examples/evals/agent-trace-basic.json`).
Output is validated against the configured-run schema before it is written. The command refuses to
overwrite an existing output file. Session input is limited to 32 MiB and 100,000 events, templates
to 1 MiB, and generated output to 64 MiB.

Human output reports the Harness schema, events read, spans written, and notes for unpaired tool
calls, skipped subagent events, or synthetic timestamps. JSON output contains the same fields plus
`outputFile`.

Session logs must be raw JSONL; Zstandard-framed logs (the Harness default) are rejected with a
hint. See [DeepSeek Harness integration](./integration-deepseek-harness.md).

```bash
autoeval trace import --from deepseek-harness \
  --session ~/.dsh/projects/demo/session.jsonl \
  --template examples/evals/agent-trace-basic.json \
  --out imported.autoeval.json
```

## Models

### `autoeval models`

Lists models enabled for the authenticated account.

Human output shows each enabled model's UUID, provider, and display name, with locked/deprecated markers if returned. JSON output contains the normalized model array.

## Quality standards

Use `autoeval qs --help` to view the full quality-standard workflow and examples. Each subcommand also supports `--help` with command-specific usage and examples.

### `autoeval qs create --input <file> [--workspace <workspace-id>]`

- Required: `--input <file>`
- Optional: `--workspace <workspace-id>`

Creates a quality standard from canonical or supported draft JSON. When `--workspace` is supplied, the command also associates the new quality standard with that workspace.

Validation rules for the input JSON:

- Top-level required fields: `name`, `judge_model`, `rubric`, `anchors`
- `anchors` is required and must contain at least 1 item and at most 5 items
- Every anchor must include all required fields: `input`, `score`, `response`, `reasoning`, `reference`
- `score` only allows `1.0` or `5.0` (any other value is rejected)

Human output shows the quality-standard name and UUID and, when applicable, the workspace UUID. JSON output contains the created quality-standard result; it does not replace the result with human-formatted association text.

If a quality standard is already assigned to the target workspace, create with `--workspace` fails with guidance to use update for that existing quality-standard ID.

```bash
autoeval qs create --input <file> --workspace <workspace-id>
```

### `autoeval qs update <qs-id> --input <file>`

- Required argument: `<qs-id>`
- Required: `--input <file>`

Updates an existing quality standard by UUID.

Validation rules are the same as `qs create`.

Human output shows the quality-standard name and UUID. JSON output contains the updated quality-standard payload.

```bash
autoeval qs update <qs-id> --input <file>
```

### `autoeval qs assign <qs-id> --workspace <workspace-id>`

- Required argument: `<qs-id>`
- Required: `--workspace <workspace-id>`

Associates an existing quality standard with a workspace.

Human output shows both UUIDs. JSON output contains the validated API association response.

```bash
autoeval qs assign <qs-id> --workspace <workspace-id>
```

### `autoeval qs show <qs-id>`

- Required argument: `<qs-id>`

Retrieves a quality standard by UUID.

Human output shows the quality-standard name and UUID, judge model, rubric, and every anchor with its Accept/Reject label, input, response, reference, and reasoning. JSON output contains the validated API quality-standard payload unchanged.

```bash
autoeval qs show <qs-id>
autoeval --json qs show <qs-id>
```

### `autoeval qs workspace --workspace <workspace-id>`

- Required: `--workspace <workspace-id>`

Retrieves the quality standard currently assigned to a workspace.

Human output shows the assigned quality standard and workspace UUID. When the API returns HTTP 200 with `null`, Autoeval treats it as a valid unassigned state and prints `No Quality Standard assigned to this workspace.`. JSON output contains the validated API workspace-assignment payload (`null` or an object).

```bash
autoeval qs workspace --workspace <workspace-id>
```

End-to-end workflow (short):

```bash
autoeval qs create --input <file> --workspace <workspace-id>
autoeval qs show <qs-id>
autoeval qs update <qs-id> --input <file>
autoeval qs workspace --workspace <workspace-id>
```

## Runs

### `autoeval run <evaluation-id>`

- Required argument: `<evaluation-id>`

Runs an already-configured evaluation. The command resolves the evaluation's current saved versions, submits one idempotent run request, and waits for a terminal state. It does not create methodology or configuration versions.

Human output labels the run identifier as `Run ID`, shows the evaluation UUID, terminal state, and progress when available, and prints ready-to-paste `status` and `results` commands. The Run ID returned by this command is the value those commands use. JSON output contains the run handle and polling outcome.

### `autoeval status <evaluation-id> <run-id>`

- Required argument: `<evaluation-id>`
- Required argument: `<run-id>`

Retrieves the current run status.

Human output shows both UUIDs, state, progress, and any failure code. JSON output contains normalized status fields plus the validated raw API response.

### `autoeval results <evaluation-id> <run-id> [--show-outputs]`

- Required argument: `<evaluation-id>`
- Required argument: `<run-id>`
- Optional: `-v, --show-outputs`; for scenario results, print every test-case input and model
  response instead of only the highest-scoring response

Resolves the evaluation context and retrieves the matching result readers.

Human output is a readable scorecard and behavior depends on context:

- scenario: shows the reported overall score, stability evidence when available, rubric and
  test-case breakdowns, and the best response; `--show-outputs` expands every response;
- conversation: shows outcome, overall score, judge agreement, and per-metric scores;
- agent trace: shows session outcome/score/agreement/metrics and trajectory score/agreement/dimensions when available.

`--json` contains only the full validated context-tagged result wrapper after output redaction,
with no banner or human text. The display does not recompute reliability: confidence and
convergence values are shown only when the backend reports them.

`--show-outputs` may print evaluation inputs and model-generated content. Treat captured terminal
output as evaluation data and avoid publishing it without review.

### `autoeval gate <evaluation-id> [--min-overall <score>] [--min-scenario <score>] [--min-judge-agreement <ratio>] [--metric <name=score>...] [--thresholds <json-file>]`

- Required argument: `<evaluation-id>`
- Optional: `--min-overall <score>`; minimum overall score
- Optional: `--min-scenario <score>`; minimum score for every scenario and model (scenario context)
- Optional: `--min-judge-agreement <ratio>`; canonical Scenario judge-agreement threshold between 0 and 1
- Optional: `--metric <name=score>`; repeatable minimum for `per_metric.<name>.score` (conversation, agent trace). These metrics are the only release evidence for those contexts; `outcome.achieved` and `outcome.score` are never used.
- Optional: `--thresholds <json-file>`; JSON file with `minOverall`, `minScenario`, `minJudgeAgreement`, and a `metrics` map. Flags take precedence over file values.

Evaluates the scored result for an already-configured evaluation. The gate may reuse an existing
completed run and result with the same Run ID; if the returned run is still active, the CLI polls it
to a terminal state before retrieving results and applying the configured thresholds. It creates no
methodology or configuration versions.

At least one threshold is required. Missing Scenario evidence fails its configured check. Missing,
null, or `has_data: false` session metric evidence is `INCONCLUSIVE` and blocks the gate.

Human output shows the verdict, evaluation UUID, run UUID, context type, duration, and an aligned threshold table. JSON output contains `{ report, run, elapsedMs }`; `run.status` is the final polled terminal state.

Exit codes: `0` when every threshold is met, `1` when a threshold is not met, `2` for usage errors, `3` for authentication or authorization errors, `4` for network, upstream, or timeout errors, and `5` when the run itself ends in a non-completed state.

```bash
autoeval gate <evaluation-id> --min-overall 4.0 --min-scenario 3.5
```

## Suites

A suite manifest is a YAML or JSON file naming a workspace, listing evaluation files, and
optionally declaring gate thresholds. Eval paths resolve relative to the manifest file. `gate`
blocks are read by the CLI only and are never sent to the backend.

```yaml
workspace: <workspace-id>
gate: # suite defaults
  minOverall: 4.0
  minScenario: 3.5
evals:
  - ./evals/refund-policy.autoeval.json
  - file: ./evals/support-conversation.autoeval.json
    gate: # merged field by field over the suite defaults
      metrics:
        factuality: 4.0
        relevance: 3.8
```

Policy fields: `minOverall` (scenario context), `minScenario` (scenario cells), and `metrics`
(map of metric name to minimum score, used by conversation and agent trace).

### `autoeval suite run --manifest <yaml-or-json-file> [--workspace <workspace-id>] [--judge-model-id <uuid>] [--primary-model-id <uuid>] [--concurrency <n>] [--stagger-ms <ms>]`

- Required: `--manifest <file>`; YAML or JSON suite manifest
- Optional: `--workspace <workspace-id>`; overrides the manifest's `workspace` for this run
- Optional: `--judge-model-id <uuid>`; overrides every eval's judge model with an enabled model UUID
- Optional: `--primary-model-id <uuid>`; overrides every scenario primary model with an enabled
  model UUID
- Optional: `--concurrency <n>`; maximum evals executing at once (default `3`)
- Optional: `--stagger-ms <ms>`; delay between successive eval starts (default `250`)

Creates and runs every eval in the manifest through the same deterministic
create/configure/run/poll path as `eval create-from --run`, then fetches results. Execution runs
in a bounded pool; result fetching runs off the execution plane so it overlaps with evals that
are still running. Execution only — it makes no release judgement.

Human output lists, per eval: source file, evaluation ID, run ID, context type, terminal
execution state, status (`completed`, `execution_failed`, `result_failed`), elapsed time, and the
fetched result payload. JSON output contains the same `SuiteSummary` with per-eval records and
completed/failed counts. A failure is recorded against a single eval; the rest of the suite
continues.

Exit codes: `0` when the suite finished (including with per-eval failures recorded), otherwise
the standard usage, auth, network, and run-failure codes.

### `autoeval suite gate --manifest <yaml-or-json-file> [--workspace <workspace-id>] [--judge-model-id <uuid>] [--primary-model-id <uuid>] [--concurrency <n>] [--stagger-ms <ms>]`

Same options as `suite run`. Runs the same execution and results planes, then applies the pure
gate plane and exits non-zero for any non-`PASS` verdict.

Per-eval decision rules:

- **Scenario, single run** — `mean >= threshold` passes, `mean < threshold` fails, a null or
  absent mean, `has_data: false`, or an errored scenario cell is `INCONCLUSIVE`. A missing score
  is never treated as zero.
- **Scenario, multiple runs** — `ci95_lower >= threshold` passes, `ci95_upper < threshold` fails,
  a straddling interval or an absent bound is `INCONCLUSIVE`. Run mode comes from
  `progress.totalRuns`, falling back to whether result cells carry intervals.
- **Convergence** — classified from `autoStopTriggered.reason`, `achievedConsistency`,
  `targetConsistency`, `targetConsistencyOperator`, and `failureDetails.failureReason`. No
  consistency target means fixed-N and interval-only gating. `NOT_CONVERGED` downgrades an
  otherwise-passing eval to `INCONCLUSIVE`; it never rescues a `FAIL`.
- **Conversation and Agent Trace** — `per_metric.<metric>.score` for configured metrics only;
  a missing metric or `has_data: false` is `INCONCLUSIVE`.
- Evals with no configured threshold are `INCONCLUSIVE`, never a silent pass.

Suite roll-up precedence is `ERROR > FAIL > INCONCLUSIVE > PASS`; an empty suite is
`INCONCLUSIVE`. There is no averaging and no synthetic suite score.

Human output shows the suite verdict, workspace, per-decision counts, a blocking-eval list
with context type, run ID, and reason, and a **failure cluster** table. JSON output emits one
payload with `workspaceId`, `suiteDecision`, `counts`, `perEvalDecisions` (each with `checks`,
`evidence`, and `reason`), and `failureClusters`.

Failure clustering groups everything that blocked the release by normalized root cause — the same
metric failing across evals, or one upstream outage reported once per eval — so a long failure list
collapses to the few causes that need fixing. Each cluster reports its category
(`threshold`, `inconclusive`, or `execution`), a count, the contributing evals, and one verbatim
exemplar. Identifiers and magnitudes are normalized out of the signature, so `HTTP 502` and
`HTTP 504` cluster as one upstream failure. `suite run` emits the same `failureClusters` field for
execution and result-plane errors.

Exit codes: `0` for `PASS`; `1` for `FAIL` (`SUITE_GATE_FAIL`) and `INCONCLUSIVE`
(`SUITE_GATE_INCONCLUSIVE`); `5` for `ERROR` (`SUITE_GATE_ERROR`).

```bash
autoeval suite run  --manifest autoeval.suite.yaml --concurrency 3 --stagger-ms 250
autoeval suite gate --manifest autoeval.suite.yaml --json
```

Full reference: [suite execution and release gating](./release-gating.md).
