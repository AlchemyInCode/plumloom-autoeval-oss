# Autoeval command guide

A task-oriented guide to every command in the deterministic CLI. For the
per-command contract (exact options, human vs JSON output), see
[`cli-reference.md`](./cli-reference.md).

## Install and invoke

Installing, authenticating, and running a first evaluation are covered in
[`quickstart.md`](./quickstart.md). Every example below is written as
`autoeval <command>`; substitute `node packages/cli/dist/cli.js <command>` when
running from a checkout without a global link.

If a command rejects a flag with `unknown option` but the flag appears in these
docs, a locally linked binary is stale — rebuild it with
`pnpm --filter @plumloom/cli build`.

## Global options

Global options go before the command:

```bash
autoeval [--json] [--debug] <command>
```

- `--json` — machine-readable JSON on stdout (errors as JSON on stderr). Use in CI.
- `--debug` — redacted request diagnostics on stderr. Never prints keys, headers, or bodies.
- `--help` / `--version`.

## Environment

| Variable                | Purpose                                                      |
| ----------------------- | ------------------------------------------------------------ |
| `AUTOEVAL_API_KEY`      | CLI key (`pl_sk_…`), used instead of the OS credential store |
| `AUTOEVAL_API_BASE_URL` | Required Autoeval API origin (https, no path)                |

See `.env.example`. Never commit a real key.

## Exit codes

`0` success · `1` gate threshold not met · `2` usage error · `3` auth error ·
`4` network/upstream/timeout · `5` run ended in a non-completed state.

For `suite gate`: `0` `PASS` · `1` `FAIL` (`SUITE_GATE_FAIL`) and `INCONCLUSIVE`
(`SUITE_GATE_INCONCLUSIVE`) · `5` `ERROR` (`SUITE_GATE_ERROR`). `FAIL` and `INCONCLUSIVE` share
exit `1` because both block a release for a quality reason, and stay distinguishable through the
error code, the human report, and `--json`.

---

## 0. First result in one command

```bash
autoeval quickstart
```

Quickstart resolves the workspace and judge model, grades a bundled recorded agent trajectory,
waits for it, and prints the result. `--sample scenario` runs the scenario sample instead and also
resolves a model under test. Overrides are available through `--workspace`,
`--judge-model-id`, `--primary-model-id`, and `--input`; `--yes` disables prompts. See the
[quickstart](./quickstart.md) for the complete selection rules.

---

## 1. Authenticate

```bash
autoeval login                          # guided: shows where to get a key, then prompts (masked)
autoeval login --key "$AUTOEVAL_API_KEY"  # non-interactive form
autoeval whoami                         # show the authenticated identity
autoeval logout                         # remove the local credential (does not revoke the key)
```

`autoeval login` with no key available prints the recovery path first:

```text
No valid Autoeval CLI key was found.

  1. Go to https://app.plumloom.ai
  2. Create a CLI key
  3. Copy the key starting with pl_sk_

Paste it below — it will be verified and saved to your OS credential store.

Autoeval CLI key: ********
```

Resolution order: `--key`, then `AUTOEVAL_API_KEY`, then the credential store,
then a masked prompt. A prompted or `--key` credential is persisted only after
the server validates it. An invalid stored key is removed and you are
re-prompted; an invalid `AUTOEVAL_API_KEY` is reported as an environment
problem. With `--json`, `login` never prompts — pass `--key` or set
`AUTOEVAL_API_KEY`.

## 2. Find where things live

```bash
autoeval workspace list
autoeval workspace create --name "Release gating" [--description "..."]

autoeval eval list --workspace <workspace-id>
autoeval eval versions <evaluation-id>
autoeval eval show <evaluation-id>
autoeval eval show <evaluation-id> --version <number>
```

`eval versions` lists saved versions. `eval show` resolves either the current
version or the explicit `--version` value and prints that saved configuration.

## 3. Discover models

```bash
autoeval models
```

Lists the models enabled for your key, with UUID, provider, and display name.
Copy the UUIDs into the `judgeModelId`, `primaryModelId`, and
`comparisonModelIds` fields of an eval file, or pass judge/primary UUIDs as
`eval create-from` and suite command overrides.

## 4. Write an eval file

An eval file is a committed JSON file with two top-level objects:

```jsonc
{
  "methodology": {
    "judgeModel": "GPT-5-mini",
    "judgeModelId": "<model-uuid>",
    "evaluatorInstructions": "Rubric the judge model grades against…",
  },
  "configuration": {
    "evaluationName": "Purchasing — guest checkout",
    "contextName": "Purchasing",
    "primaryModelId": "<model-uuid>",
    "comparisonModelIds": [],
    "promptText": "System prompt for the primary model…",
    "scenarios": [{ "id": "s-1", "name": "Guest checkout", "prompt": "…", "expected": "…" }],
    "selectedMetrics": ["policy_adherence", "completeness", "factuality"],
  },
}
```

Context types:

- **scenario** — `scenarios[]` plus `promptText`.
- **conversation** — a single transcript artifact.
- **agent_trace** — a single OTLP trace artifact.

`runsPerScenario` is validated as an integer from 1 to 10, preserved, and sent to the API as
`runs_per_scenario`; it defaults to 1 when omitted. Legacy `autoStopEnabled` is accepted for
compatibility but ignored and not forwarded; automatic stopping is controlled by the evaluation
service.

Large inputs stay out of the eval file and are referenced by path, resolved
relative to the eval file:

```jsonc
"configuration": {
  "artifactFile": "./data/conversation.json",
  "referenceDocumentFiles": ["./policy/escalation.md"]
}
```

Raw OTLP exports (`resourceSpans` at the top level) are wrapped automatically.
Working examples live in [`examples/`](../../examples).

## 4b. Check everything before you spend a run

```bash
autoeval doctor --manifest autoeval.suite.yaml
autoeval doctor --workspace <workspace-id> --input ./evals/refund-policy.json
```

`doctor` is the pre-flight pass: it confirms the CLI key authenticates, the
workspace is reachable, the model catalog is available, the manifest parses, and
every eval file is schema-valid with model IDs that are actually enabled for the
account. It creates nothing and submits no runs. It reports every problem in one
pass and exits `2` when anything is blocking, so CI can run it as a fast gate
before the expensive suite step.

## 4c. Import an agent trajectory

If your agent runs under [DeepSeek Harness](./integration-deepseek-harness.md),
turn a recorded session into an `agent_trace` eval file instead of hand-writing
spans:

```bash
autoeval trace import --from deepseek-harness \
  --session ~/.dsh/projects/demo/session.jsonl \
  --template examples/evals/agent-trace-basic.json \
  --out imported.autoeval.json
```

The session supplies the trace artifact only. The judge model, evaluator
instructions, expected behavior, and metrics stay in the committed template.

Options: `--name <evaluation-name>` overrides the evaluation name,
`--service-name <service-name>` sets the trace's `service.name` resource
attribute, and `--workspace <workspace-id>` with `--run` creates and runs the
imported evaluation immediately (`--run` requires `--workspace`).

## 5. Validate before spending a run

```bash
autoeval eval validate --input examples/evals/scenario-basic.json
```

Read-only: checks required fields, context-specific artifacts, enabled model
IDs, role conflicts, and duplicate comparisons. No versions are
created and no run is started.

## 6. Create and run

Create an evaluation from a file and run it in one step — the common case:

```bash
autoeval models

autoeval eval create-from \
  --workspace <workspace-id> \
  --input examples/evals/scenario-purchasing-checkout.json \
  --judge-model-id <judge-model-id> \
  --primary-model-id <primary-model-id> \
  --run
```

The model UUIDs inside the committed sample JSON are synthetic placeholders, so both override
flags are required for this example. The CLI validates them against the enabled catalog and
applies them in memory — the file is not edited. Eval files that already carry your own enabled
model UUIDs need neither flag. See [3. Discover models](#3-discover-models).

Other creation paths:

```bash
autoeval eval create --workspace <workspace-id> [--name "Refund policy"]   # empty draft
autoeval eval run-configured --evaluation <evaluation-id> --input <file>   # version + run an existing eval
autoeval run <evaluation-id>                                               # run the saved versions, create none
```

`run-configured` creates new methodology/configuration versions; `run` does not.

Rename and refresh a listing:

```bash
autoeval eval update-title --workspace <workspace-id> --evaluation <evaluation-id> \
  --name "Refund policy v2" --user-system-id <user-system-id>
```

## 7. Read results

`<run-id>` is the **Run ID** printed by `autoeval run` (and by `autoeval status`)
under the `Run ID` label. Copy it from there — `autoeval run` also prints the two
follow-up commands below with the IDs already filled in.

```bash
autoeval status  <evaluation-id> <run-id>
autoeval results <evaluation-id> <run-id>
autoeval results <evaluation-id> <run-id> --show-outputs
autoeval --json results <evaluation-id> <run-id>
```

`autoeval eval show <evaluation-id>` is a different lookup: it reports the
evaluation's configuration plus its version information — the evaluation version
number and the methodology / config version IDs behind it.

```text
Evaluation: Refund policy (<evaluation-id>)
Context: scenario

Evaluation version: 2 (current)
  Methodology version ID: <uuid>
  Config version ID:      <uuid>
```

`results` resolves the evaluation's context and returns the matching readers:
scenario runs return model performance, scenario comparison, and model
responses; conversation and agent-trace runs return outcome, overall score,
judge agreement, and per-metric scores. Scenario human output leads with backend-reported
reliability, then shows rubric and test-case breakdowns and the best response. Use
`--show-outputs` to expand every test-case input and model response. `--json` emits only the full
validated context-tagged payload after output redaction.

## 8. Gate a release

```bash
autoeval gate <evaluation-id> --min-overall 4.0 --min-scenario 3.5
```

Options: `--min-overall`, `--min-scenario`, and `--min-judge-agreement` (scenario evals),
`--metric <name=score>` (repeatable; conversation and agent-trace evals), and
`--thresholds <json-file>` (flags win over file values). At least one threshold
is required.

Conversation and agent-trace evals gate **only** on configured
`per_metric.<metric>.score` values, exactly like `autoeval suite gate`. The
outcome judge (`outcome.achieved` / `outcome.score`) is never used. A missing
metric, a null score, or `has_data: false` is `INCONCLUSIVE` and blocks the
release; it is never treated as zero. For scenario evals a missing score with a
configured threshold still **fails** the gate. Exit code `1` means the gate did
not pass.

See [`release-gating.md`](./release-gating.md) for the GitHub Actions wiring.

## 9. Run the individual developer smoke workflow

The macOS/Linux and Windows PowerShell reference scripts exercise the same individual workflow:
authenticate, create a fresh workspace, run one Scenario, Conversation, and Agent Trace example,
and fetch each result in both human and JSON modes.

These scripts mutate the configured backend, retain the created workspace and evaluations, and may
incur evaluation charges. They require enabled model UUIDs at runtime and never write them into the
public fixtures.

```bash
JUDGE_MODEL_ID=<judge-model-uuid> \
PRIMARY_MODEL_ID=<primary-model-uuid> \
./examples/smoke/smoke.sh
```

```powershell
$env:JUDGE_MODEL_ID = '<judge-model-uuid>'
$env:PRIMARY_MODEL_ID = '<primary-model-uuid>'
.\examples\smoke\smoke.ps1
```

Both scripts use the files under `examples/smoke/fixtures/`. They rely on `eval create-from --run`
and `results`, so they do not implement their own run or result polling.

## 10. Run a suite in CI

A suite manifest is the CI unit of work — one file listing the eval files a
release is gated on. YAML or JSON; paths resolve relative to the manifest.

```yaml
# autoeval.suite.yaml
workspace: ffffffff-ffff-4fff-8fff-ffffffffffff
evals:
  - ./evals/refund-policy.autoeval.json
  - ./evals/support-conversation.autoeval.json
```

```bash
autoeval suite run --manifest autoeval.suite.yaml [--workspace <workspace-id>] [--judge-model-id <uuid>] [--primary-model-id <uuid>] [--concurrency 3] [--stagger-ms 250]
```

`--workspace` overrides the manifest's `workspace` without editing the file — this is how the
committed smoke manifest, [`examples/suite/autoeval.suite.yaml`](../../examples/suite/autoeval.suite.yaml), is
pointed at a fresh workspace. That manifest lists the three sanitized smoke fixtures and carries
synthetic placeholder IDs, so a live run also needs `--judge-model-id` and `--primary-model-id`:

```bash
autoeval suite run --manifest examples/suite/autoeval.suite.yaml \
  --workspace "$WORKSPACE_ID" \
  --judge-model-id "$JUDGE_MODEL_ID" \
  --primary-model-id "$PRIMARY_MODEL_ID"
```

The suite runs in two planes. The **execution plane** runs evals with bounded
concurrency (`--concurrency`) and a start stagger (`--stagger-ms`); a slot is
held only while an eval is executing, so the next queued eval starts the moment
one reaches a terminal state. The **results plane** then fetches and normalizes
that eval's results while other evals are still executing — result fetching
never consumes an execution slot.

The command prints a suite summary: per eval, its source file, evaluation ID,
run ID, context type, terminal execution state, status
(`completed` / `execution_failed` / `result_failed`), and the fetched result
payloads. One eval failing to run or to return results does not stop the rest.
Add `--json` for the machine-readable summary.

### Gate a release on a suite

`suite gate` runs the same two planes, then adds a **gate plane** that turns
each completed eval into a release decision and rolls them into one verdict.
Execution `COMPLETED` is not a quality `PASS`.

Thresholds live in the manifest, at suite level and optionally per eval:

```yaml
workspace: ffffffff-ffff-4fff-8fff-ffffffffffff
gate:
  minOverall: 4.0
  minScenario: 3.5
evals:
  - ./evals/refund-policy.autoeval.json
  - file: ./evals/support-conversation.autoeval.json
    gate:
      metrics:
        factuality: 4.0
        relevance: 3.8
```

```bash
autoeval suite gate --manifest autoeval.suite.yaml [--workspace <workspace-id>] [--judge-model-id <uuid>] [--primary-model-id <uuid>] [--concurrency 3] [--json]
```

When the gate blocks, the report ends with **failure clusters**: the distinct
root causes behind every blocking eval, most frequent first, with a count, the
evals affected, and one exemplar message. One regressed metric across twelve
evals reads as one cluster, not twelve failures.

What each context type is gated on:

- **Scenario, single run** — primary-model overall mean and each configured
  per-scenario mean.
- **Scenario, multiple runs** — 95% confidence intervals. `ci95_lower` at or
  above the threshold passes, `ci95_upper` below it fails, an interval that
  crosses the threshold is inconclusive. When convergence was enabled but not
  reached, the eval is inconclusive rather than passing; convergence is read
  from the run status, including the direction of the consistency target.
- **Conversation and Agent Trace** — `per_metric.<metric>.score` for the
  configured metrics only. `outcome.*`, summaries, and insights are not used.

Per-eval decisions are `PASS`, `FAIL`, `INCONCLUSIVE` (evidence exists but is
insufficient), or `ERROR` (execution, result fetch, or required evidence
unusable). The suite verdict takes the worst one:
`ERROR > FAIL > INCONCLUSIVE > PASS`. Only `PASS` exits `0`; the other three
exit non-zero and stay distinguishable in the output and in `--json`, which
emits a single payload with `suiteDecision`, `counts`, and `perEvalDecisions`.

One eval failing to run or to return results does not stop the others: that eval is recorded as
`ERROR` and the rest of the suite is still decided.

Example human output:

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

Passing evals are not listed individually — the counts plus the blocking list are what a CI log
reader needs.

In GitHub Actions, pass the key as an environment variable only:

```yaml
- run: npm install -g @plumloom/cli
- name: Gate the release on the suite
  env:
    AUTOEVAL_API_KEY: ${{ secrets.AUTOEVAL_API_KEY }}
    AUTOEVAL_API_BASE_URL: ${{ vars.AUTOEVAL_API_BASE_URL }}
  run: autoeval suite gate --manifest autoeval.suite.yaml --json
```

See [suite execution and release gating](./release-gating.md)
for the three-plane architecture, the full decision rules, and CI wiring.

## 11. Quality standards

```bash
autoeval qs create --input <file> [--workspace <workspace-id>]
autoeval qs show <qs-id>
autoeval --json qs show <qs-id>
autoeval qs update <qs-id> --input <file>
autoeval qs assign <qs-id> --workspace <workspace-id>
autoeval qs workspace --workspace <workspace-id>
```

If a workspace has no assigned quality standard, `autoeval qs workspace` prints:

```text
No Quality Standard assigned to this workspace.
```

Short workflow: create -> inspect -> update -> check workspace assignment

```bash
autoeval qs create --input <file> --workspace <workspace-id>
autoeval qs show <qs-id>
autoeval qs update <qs-id> --input <file>
autoeval qs workspace --workspace <workspace-id>
```

## MCP server

The same deterministic surface is exposed over stdio for MCP clients:

```bash
node packages/cli/dist/mcp.js
```

Configure your client with the absolute path to `packages/cli/dist/mcp.js` and
`AUTOEVAL_API_BASE_URL` in its environment. Provide `AUTOEVAL_API_KEY` there as well when the
client cannot use the OS credential store. See [`mcp.md`](./mcp.md).

## Troubleshooting

| Symptom                              | Cause and fix                                                                                             |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `Evaluation <id> not found`          | `run-configured` and `run` need an existing evaluation. Use `eval create-from` to create one from a file. |
| Auth error (exit `3`)                | Key missing, expired, or scoped to another account. Re-run `autoeval login` or check `AUTOEVAL_API_KEY`.  |
| Model ID rejected by `eval validate` | The ID is not enabled for your key. Re-check with `autoeval models`.                                      |
| Timeout (exit `4`)                   | Upstream or network issue. Re-run `autoeval status <evaluation-id> <run-id>`; the run may still complete. |

More detail in [`../TROUBLESHOOTING.md`](../../TROUBLESHOOTING.md).
