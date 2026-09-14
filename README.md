# Plumloom Autoeval

**The release-confidence layer for AI-agent changes.**

Autoeval is an open-source CLI and MCP server for evaluating AI applications, inspecting reliability evidence, and gating releases from development and CI workflows.

Follow this path from a repository visit to a repeatable release gate:

1. Meet the requirements and configure Plumloom.
2. Install Autoeval.
3. Log in and run the quickstart.
4. Run your first file-driven evaluation.
5. Add a suite gate to CI.
6. Inspect results, refine evaluations, and repeat.

## Requirements

- Node.js 22.13 or newer
- pnpm 11
- A Plumloom API key beginning with `pl_sk_`
- `AUTOEVAL_API_BASE_URL`
- A supported OS credential store for interactive login persistence

## 1. Configure Plumloom

Complete these two setup steps in Plumloom before running Autoeval.

### Connect an AI provider

Autoeval needs access to a model to run evaluations.

In Plumloom, go to:

**Profile avatar → Settings → AI Providers & Models**

https://app.plumloom.ai/ai-providers

Plumloom currently supports **OpenAI** and **Together.ai** API keys. More providers are coming soon.

### Create a Plumloom API key

In Plumloom, go to:

**Profile avatar → Settings → API Keys**

https://app.plumloom.ai/api-keys

Create an API key for Autoeval. Use it to authenticate from your terminal, CI, or other development tools.

## 2. Install Autoeval

Install from npm:

```bash
npm install --global @plumloom/cli
```

Or build from source:

```bash
pnpm install --frozen-lockfile
pnpm build
node packages/cli/dist/cli.js --help
```

The examples below use the installed `autoeval` binary. When running directly from this repository, replace `autoeval` with:

```bash
node packages/cli/dist/cli.js
```

## 3. Log in and run the quickstart

```bash
export AUTOEVAL_API_BASE_URL="https://api.plumloom.ai"
autoeval login
autoeval quickstart
```

When you are ready to use your own evaluation files, run:

```bash
autoeval models
```

Then continue with the [file-driven workflow](#file-driven-evaluations) below.

## 4. Run your first file-driven evaluation

An evaluation file uses the configured-run JSON accepted by `autoeval eval validate`. Conversation and agent-trace files can keep their artifacts and reference documents in separate files:

```json
{
  "methodology": { "judgeModelId": "<judge-model-id>", "evaluatorInstructions": "..." },
  "configuration": {
    "contextName": "Support conversation",
    "contextType": "conversation",
    "artifactFile": "./data/conversation.json",
    "referenceDocumentFiles": ["./policy/refunds.md"]
  }
}
```

For `conversation`, `artifactFile` is a transcript. For `agent_trace`, it is an OpenTelemetry trace; a raw `resourceSpans` export is wrapped in the required trace shape. `referenceDocumentFiles` are loaded as text. All paths resolve relative to the evaluation file.

Create one evaluation from a validated file:

```bash
autoeval eval create-from --workspace <workspace-id> --input support.autoeval.json
```

To create and run it immediately:

```bash
autoeval eval create-from --workspace <workspace-id> --input support.autoeval.json \
  --judge-model-id <judge-model-uuid> --primary-model-id <primary-model-uuid> --run
```

Model ID fields accept UUIDs only. For sanitized public fixtures, copy enabled UUIDs from `autoeval models` and pass `--judge-model-id`; scenario files also need `--primary-model-id`.

The CLI applies overrides in memory and validates them against the enabled model catalog without changing the file. With `--run`, the command waits for completion, then prints the evaluation ID, run ID, and the `autoeval results` commands used to fetch backend result payloads.

## 5. Add a CI release gate

### Define a suite

A YAML or JSON suite manifest names a workspace, lists one or more evaluation files, and can declare the thresholds that gate a release:

```yaml
workspace: <workspace-id>
gate:
  minOverall: 4.0
  minScenario: 3.5
evals:
  - ./evals/refund-policy.autoeval.json # inherits the suite gate defaults
  - file: ./evals/support-conversation.autoeval.json
    gate:
      metrics:
        factuality: 4.0
        relevance: 3.8
```

### Run pre-flight diagnostics

```bash
autoeval doctor --manifest examples/suite/autoeval.suite.yaml
autoeval doctor --workspace <workspace-id> --input ./evals/refund-policy.json [--json]
```

`doctor` performs a read-only check that:

- the key authenticates;
- the workspace is reachable;
- the model catalog loads;
- the manifest parses; and
- every evaluation file is schema-valid and uses model IDs enabled for the account.

It creates nothing and submits no runs. Each check reports `pass | fail | skipped` with an actionable hint. A blocking report exits `2`, making `doctor` a cheap CI step before the more expensive suite step.

### Run or gate the suite

```bash
autoeval suite run  --manifest autoeval.suite.yaml [--workspace <uuid>] [--judge-model-id <uuid>] [--primary-model-id <uuid>] [--concurrency 3] [--stagger-ms 250] [--json]
autoeval suite gate --manifest autoeval.suite.yaml [--workspace <uuid>] [--judge-model-id <uuid>] [--primary-model-id <uuid>] [--concurrency 3] [--stagger-ms 250] [--json]
```

`suite run` executes every listed evaluation and retrieves its results without making a release judgment.

`suite gate` applies the configured thresholds and exits non-zero for any verdict other than `PASS`:

- `FAIL` or `INCONCLUSIVE` → exit `1`
- `ERROR` → exit `5`

Failures are isolated per evaluation, so one failure never stops the others. Execution status `COMPLETED` is not automatically a quality `PASS`. An evaluation with no configured threshold is `INCONCLUSIVE`, not a silent pass.

Blocking failures are grouped by root cause to make suite reports easier to inspect.

A smoke manifest is available at [`examples/suite/autoeval.suite.yaml`](examples/suite/autoeval.suite.yaml). It lists the three sanitized smoke fixtures. Its `workspace` and the fixtures’ model IDs are synthetic placeholders, so pass `--workspace`, `--judge-model-id`, and `--primary-model-id` for a live run.

See [suite execution and release gating](docs/public/release-gating.md) for the full reference.

## 6. Inspect results and repeat

Autoeval resolves the current evaluation context before selecting result readers:

- `scenario`: a reliability-first scorecard built from model performance, scenario comparison, model responses, and backend-reported run-status reliability detail
- `conversation`: conversation results
- `agent_trace`: agent-trace results and trajectory, when available

Scenario output starts with the reported overall score and stability evidence, then shows rubric and test-case breakdowns plus the best response. Pass `--show-outputs` to print every test-case input and model response. `--json` remains machine-readable and applies Autoeval’s output redaction to the full validated result wrapper.

For a custom release policy, use `autoeval --json results` to [build your own gate over the structured evaluation evidence](docs/public/release-gating.md#custom-gates-from-json-results).

## Authentication and credential behavior

Credentials resolve in this order:

1. `--key` for `autoeval login`
2. `AUTOEVAL_API_KEY`
3. the OS credential store
4. a masked prompt for interactive `autoeval login`

```bash
autoeval login
autoeval login --key "$AUTOEVAL_API_KEY"
autoeval whoami
autoeval logout
```

Login validates the key with Plumloom before saving a prompted or explicitly supplied credential.

- Environment-provided credentials are never persisted.
- An invalid stored credential is removed before an interactive replacement is requested.
- Logout removes only Autoeval’s local credential-store entry. It does not revoke the server-side key or change the environment.
- In CI, prefer `AUTOEVAL_API_KEY` from a secret store so credentials do not appear in process arguments.

## Smoke workflows

The repository includes equivalent Bash and PowerShell workflows under [`examples/smoke/`](examples/smoke/). They verify authentication, create a fresh workspace, run one Scenario, Conversation, and Agent Trace evaluation, and retrieve human and JSON results.

These workflows create persistent backend resources and may incur evaluation charges. Created resources are retained for inspection.

### Bash

```bash
JUDGE_MODEL_ID=<judge-model-uuid> \
PRIMARY_MODEL_ID=<primary-model-uuid> \
./examples/smoke/smoke.sh
```

### PowerShell

```powershell
$env:JUDGE_MODEL_ID = '<judge-model-uuid>'
$env:PRIMARY_MODEL_ID = '<primary-model-uuid>'
.\examples\smoke\smoke.ps1
```

For the separate batch/suite path, use [`examples/suite/autoeval.suite.yaml`](examples/suite/autoeval.suite.yaml) with `autoeval suite run` or `autoeval suite gate`. The scripts do not modify the committed example JSON files or the suite manifest.

## Public example configurations

These small, sanitized examples show realistic configured-input shapes:

| Example                                                                           | Demonstrates                                                                      |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [`scenario-basic.json`](examples/evals/scenario-basic.json)                       | One factual QA test case                                                          |
| [`scenario-grounded.json`](examples/evals/scenario-grounded.json)                 | Grounded and unavailable-information answers using a synthetic reference document |
| [`scenario-model-comparison.json`](examples/evals/scenario-model-comparison.json) | A primary model, two comparison models, and three test cases                      |
| [`conversation-success.json`](examples/evals/conversation-success.json)           | A successful multi-turn support interaction grounded in a synthetic guide         |
| [`conversation-failure.json`](examples/evals/conversation-failure.json)           | A multi-turn interaction that contradicts an important synthetic requirement      |
| [`agent-trace-basic.json`](examples/evals/agent-trace-basic.json)                 | A root agent span with planning, tool lookup/result, and grounded response spans  |
| [`agent-trace-bad-decision.json`](examples/evals/agent-trace-bad-decision.json)   | A multi-step trace whose decision and final response contradict two tool results  |

Evaluation files carry no account identity; the CLI derives it from your authenticated session. Model values are deliberately non-account placeholders. Run `autoeval models`, then replace the judge, primary, and comparison IDs as applicable.

The judge must differ from the primary and comparison models, and comparison models must be unique.

`runsPerScenario`:

- is validated as an integer from 1 to 10;
- is preserved and sent to the API as `runs_per_scenario`; and
- defaults to 1 when omitted.

Legacy `autoStopEnabled` is accepted for compatibility but ignored and not forwarded. The evaluation service controls automatic stopping.

Validate and run any example with:

```bash
autoeval eval validate --input examples/evals/<example-file>.json
autoeval eval run-configured --evaluation <evaluation-id> --input examples/evals/<example-file>.json
```

## Command reference

```text
autoeval login
autoeval logout
autoeval whoami
autoeval quickstart [--sample <trace|scenario>]

autoeval workspace list
autoeval workspace create --name <name> [--description <description>]

autoeval eval list --workspace <workspace-id>
autoeval eval create --workspace <workspace-id> [--name <evaluation-name>]
autoeval eval create-from --workspace <workspace-id> --input <json-file> [--run]
autoeval eval show <evaluation-id>
autoeval eval versions <evaluation-id>
autoeval eval validate --input <json-file>
autoeval eval run-configured --evaluation <evaluation-id> --input <json-file>
autoeval eval update-title --workspace <workspace-id> --evaluation <evaluation-id> --name <evaluation-name> --user-system-id <user-system-id> [--description <description>] [--page <page>] [--size <size>]

autoeval suite run --manifest <yaml-or-json-file> [--concurrency <n>] [--stagger-ms <ms>]
autoeval suite gate --manifest <yaml-or-json-file> [--concurrency <n>] [--stagger-ms <ms>]

autoeval doctor [--workspace <workspace-id>] [--manifest <yaml-or-json-file>] [--input <json-file>...]

autoeval trace import --from deepseek-harness --session <jsonl-file> --template <json-file> --out <json-file> [--name <text>] [--workspace <workspace-id>] [--run]

autoeval models

autoeval qs create --input <file> [--workspace <workspace-id>]
autoeval qs update <qs-id> --input <file>
autoeval qs assign <qs-id> --workspace <workspace-id>
autoeval qs workspace --workspace <workspace-id>
autoeval qs show <qs-id>
autoeval --json qs show <qs-id>

autoeval run <evaluation-id>
autoeval status <evaluation-id> <run-id>
autoeval results <evaluation-id> <run-id> [--show-outputs]
```

IDs must be UUIDs.

`run` resolves the current evaluation configuration, submits one idempotent run request, and polls within a fixed time budget. Human-readable output labels the returned run identifier as `Run ID` and prints the `status` and `results` commands that use it. If polling fails, Autoeval does not submit another run.

`eval validate` checks scenario, conversation, and agent-trace input files without creating methodology or configuration versions and without starting a run. It validates:

- context-specific artifact fields;
- account-enabled model IDs;
- model-role conflicts; and
- duplicate comparison models.

`eval run-configured` performs the same pre-flight checks before creating or updating evaluation resources.

Add `--json` before a deterministic command for machine-readable output:

```bash
autoeval --json status <evaluation-id> <run-id>
```

`--debug` emits redacted request metadata to stderr. It never emits authorization headers, request bodies, or the CLI key.

`gate` evaluates the scored result for one already-configured evaluation and exits non-zero when results miss thresholds passed as flags or in a thresholds file. It may reuse an existing completed run and result with the same Run ID. If the returned run is still active, the CLI polls it before evaluating results. See the [release gate guide](docs/public/release-gating.md).

`suite gate` is the multi-evaluation equivalent: thresholds come from the manifest, every evaluation is decided independently, and the suite verdict is the worst per-evaluation decision. See [suite execution and release gating](docs/public/release-gating.md).

Start with the [quickstart](docs/public/quickstart.md). See the [command guide](docs/public/commands.md) for a task-oriented walkthrough of every command and the complete [CLI reference](docs/public/cli-reference.md) for required options, behavior, and output details.

## MCP server

Autoeval includes a local stdio MCP server for coding agents and MCP clients. It exposes the same typed action layer as deterministic commands and returns structured, redacted tool results instead of CLI-formatted output. It does not shell out to the CLI.

MCP run tools return run and version identifiers immediately after successful submission. Clients poll `get_run_status` until terminal completion and then call `get_results`. Deterministic CLI run commands continue waiting within their configured polling bounds.

The MCP process uses the same credential order as non-interactive deterministic commands:

1. `AUTOEVAL_API_KEY`
2. the OS credential store

It never prompts. Run `autoeval login` first or provide the environment variable through the MCP client’s secret configuration.

See the [MCP server guide](docs/public/mcp.md) for client configuration, available tool categories, write classifications, and an example workflow. For client-specific setup, see [Autoeval with Codex and Claude Code](docs/public/integration-codex-and-claude-code.md).

## Agent harness integrations

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) mounts the Autoeval MCP server as one configuration row. `autoeval trace import --from deepseek-harness` converts a recorded Harness session into an `agent_trace` evaluation you can gate.

See the [DeepSeek Harness integration guide](docs/public/integration-deepseek-harness.md).

## Configuration

| Variable                | Purpose                                         | Default  |
| ----------------------- | ----------------------------------------------- | -------- |
| `AUTOEVAL_API_KEY`      | Non-persisted Plumloom CLI credential           | unset    |
| `AUTOEVAL_API_BASE_URL` | Autoeval API origin (`https://api.plumloom.ai`) | required |

The Autoeval API URL must use HTTPS. Plain HTTP is accepted only for an explicit `localhost`, `127.0.0.1`, or `[::1]` development origin. Paths, embedded credentials, query strings, and fragments are rejected.

## Repository verification

Normal tests use mocked API responses and require no credentials or network access.

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm boundary:check
pnpm package:check
pnpm audit
```

An opt-in development smoke test runs only when a key is already available in the environment:

```bash
AUTOEVAL_API_BASE_URL='https://api.plumloom.ai' \
AUTOEVAL_API_KEY='<secret from your shell or secret manager>' \
pnpm test:live
```

Do not paste a real credential into source, documentation, test fixtures, terminal transcripts, or issue reports.

See the [developer guide](docs/public/developer-guide.md) for lifecycle details, configured versus existing runs, result behavior, and security constraints.

## Documentation

- [Documentation home](docs/public/docs-home.md)
- [Quickstart](docs/public/quickstart.md)
- [Command guide](docs/public/commands.md)
- [Deterministic CLI developer guide](docs/public/developer-guide.md)
- [Deterministic command reference](docs/public/cli-reference.md)
- [MCP server guide](docs/public/mcp.md)
- [Codex and Claude Code integration](docs/public/integration-codex-and-claude-code.md)
- [DeepSeek Harness integration](docs/public/integration-deepseek-harness.md)
- [Release gating for CI](docs/public/release-gating.md)
- [Troubleshooting](TROUBLESHOOTING.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
