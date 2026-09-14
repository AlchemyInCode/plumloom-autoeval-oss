# Deterministic CLI developer guide

Plumloom Autoeval is a TypeScript command-line client for managing and running Plumloom evaluations from a terminal or script. The deterministic commands cover authentication, workspaces, evaluations, account-enabled models, quality standards, input validation, configured runs, existing runs, status, and context-aware results.

Autoeval uses the configured API origin for authenticated evaluation and account requests. The CLI
does not accept provider API keys, browser sessions, or evaluation-service credentials, and it does
not call model providers directly.

## Setup

Requirements:

- Node.js 22.13 or newer
- pnpm 11
- a Plumloom CLI key beginning with `pl_sk_`
- an OS credential store supported by the keyring dependency when saving interactive credentials

Install and build:

```bash
pnpm install --frozen-lockfile
pnpm build
node packages/cli/dist/cli.js --help
```

The examples below use `autoeval` for readability. When running directly from this repository,
replace it with `node packages/cli/dist/cli.js`.

## Authentication

Credential lookup order is:

1. `AUTOEVAL_API_KEY`
2. the OS credential store
3. a masked interactive prompt used by `autoeval login`

`login` validates the key with Plumloom before storing a prompted key. An environment-provided key is never persisted. `logout` removes only the local credential-store entry; it does not revoke the key or unset `AUTOEVAL_API_KEY`.

```bash
autoeval login
autoeval whoami
autoeval logout
```

There is no `--key` option. Use a shell or CI secret store for `AUTOEVAL_API_KEY` and never place a real key in a configuration file, command argument, fixture, log, or issue.

## Supported evaluation contexts

Configured input supports three context types:

- `scenario`: runs test-case scenarios against a primary model and optional comparison models
- `conversation`: evaluates a supplied transcript as a single-shot ingest evaluation
- `agent_trace`: evaluates a supplied OTLP trace as a single-shot ingest evaluation and retrieves both session and trajectory evaluation when available

The public examples are intentionally synthetic:

| Example                                                                                 | What it teaches                                                                         |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [`scenario-basic.json`](../../examples/evals/scenario-basic.json)                       | Minimal factual QA methodology, prompt, test case, expected answer, and metrics         |
| [`scenario-grounded.json`](../../examples/evals/scenario-grounded.json)                 | Grounding answers in a small reference document and handling missing information        |
| [`scenario-model-comparison.json`](../../examples/evals/scenario-model-comparison.json) | Primary-versus-comparison evaluation, multiple test cases, and repeated scenario runs   |
| [`conversation-success.json`](../../examples/evals/conversation-success.json)           | A successful multi-turn transcript evaluated against a synthetic guide                  |
| [`conversation-failure.json`](../../examples/evals/conversation-failure.json)           | A failed transcript that contradicts and omits requirements from a synthetic guide      |
| [`agent-trace-basic.json`](../../examples/evals/agent-trace-basic.json)                 | OTLP resource/scope spans for an agent root, LLM plan, tool result, and final response  |
| [`agent-trace-bad-decision.json`](../../examples/evals/agent-trace-bad-decision.json)   | Parent/child spans showing an incorrect decision and response after failed tool results |

Before validation or execution, replace:

- `methodology.judgeModel` with the selected enabled model's display name;
- `methodology.judgeModelId` with its UUID from `autoeval models`;
- `configuration.primaryModelId` in scenario examples with a distinct enabled model UUID;
- every UUID in `configuration.comparisonModelIds` with distinct enabled model UUIDs, or use an empty array when no comparison is needed.

The judge cannot also be the primary or a comparison model. The primary cannot also be a comparison model, and comparison UUIDs must be unique.

## Typical lifecycle

Authenticate and inspect account-enabled models:

```bash
autoeval login
autoeval models
```

Create a workspace and evaluation:

```bash
autoeval workspace create --name "CLI example" --description "Created from Autoeval"
autoeval eval create --workspace <workspace-id> --name "Example evaluation"
```

Copy a public example, replace its model placeholders, validate it, then configure and run the evaluation:

```bash
autoeval eval validate --input examples/evals/scenario-basic.json
autoeval eval run-configured --evaluation <evaluation-id> --input examples/evals/scenario-basic.json
```

The configured-run command waits for a terminal state and prints the run ID. Use that ID for later lookups:

```bash
autoeval status <evaluation-id> <run-id>
autoeval results <evaluation-id> <run-id>
autoeval results <evaluation-id> <run-id> --show-outputs
autoeval --json results <evaluation-id> <run-id>
```

Scenario human output uses backend-reported score, interval, and convergence evidence. It shows a
compact best-response preview by default; `--show-outputs` expands all test-case inputs and model
responses. JSON mode keeps the full validated wrapper and applies the standard output redaction.

## Workspaces and evaluations

Workspace commands list accessible workspaces and create new ones. Evaluation commands list evaluations in a workspace, create an evaluation draft, inspect its current configuration, update its title, validate an input file, and perform a configured run.

Resource-oriented human output keeps UUIDs visible and includes names when the API returns them. Use `--json` for stable machine-readable output.

See the [CLI reference](./cli-reference.md) for every command and option.

## Models and quality standards

`autoeval models` reads the authenticated account's enabled model catalog. Configured-input validation uses the same catalog. Scenario validation requires distinct judge and primary models, forbids either model in comparisons, and rejects duplicate comparison models.

Quality-standard commands can create a quality standard from JSON, optionally associate it with a workspace, explicitly associate an existing standard, and retrieve a standard by ID.

## Validation and configured runs

`eval validate` reads and validates an input JSON file without creating methodology/configuration versions or starting a run. It checks:

- required methodology and configuration fields;
- the artifact structure for the selected context type;
- account-enabled judge, primary, and comparison IDs where those roles are present in the input;
- judge/primary/comparison role conflicts;
- duplicate comparison models;

The configured-run parser validates `runsPerScenario` as an integer from 1 to 10, preserves it,
and sends it to the API as `runs_per_scenario`; it defaults to 1 when omitted. Legacy
`autoStopEnabled` is accepted for compatibility but ignored and not forwarded; automatic stopping
is controlled by the evaluation service.

Validation needs authentication because enabled models are account-specific. It makes one read-only API model-catalog request and no write request.

`eval run-configured` performs the same preflight before creating or updating evaluation resources.
On success it:

1. creates a methodology version;
2. creates a matching configuration version;
3. submits one run with an idempotency key;
4. polls within the configured bounds until the run reaches a terminal state.

The CLI never automatically submits a second run if submission or polling fails.

### `eval run-configured` versus top-level `run`

Use:

```bash
autoeval eval run-configured --evaluation <evaluation-id> --input <json-file>
```

when the JSON file should create new methodology and configuration versions immediately before running.

Use:

```bash
autoeval run <evaluation-id>
```

when the evaluation is already configured. This command resolves the evaluation's current methodology/configuration version, submits a run for that saved version, and waits for completion. It does not read an input file or create new versions.

## Status and results

`status` retrieves the current run state and bounded progress values.

`results` first resolves the evaluation context, then retrieves the matching result data:

- scenario: model performance, scenario comparison, and model responses;
- conversation: conversation scorecard and transcript results;
- agent trace: session scorecard plus trajectory evaluation when available.

Human conversation output includes outcome, overall score, judge agreement, and per-metric scores. Agent-trace output includes the session outcome/score/agreement/metrics and the trajectory score/agreement/dimensions. Use `--json` when full payloads, responses, turns, or trace steps are needed.

## JSON and debug output

Place `--json` before a deterministic command:

```bash
autoeval --json workspace list
autoeval --json eval validate --input examples/evals/scenario-basic.json
autoeval --json status <evaluation-id> <run-id>
```

Successful JSON goes to stdout. JSON errors go to stderr. Existing result contracts are passed through the command result writer without adding human formatting.

`--debug` emits bounded, redacted request metadata to stderr. It excludes authorization headers and request bodies. It can be combined with `--json` without mixing diagnostics into stdout:

```bash
autoeval --json --debug results <evaluation-id> <run-id>
```

## Environment configuration

| Variable                | Purpose                               | Default  |
| ----------------------- | ------------------------------------- | -------- |
| `AUTOEVAL_API_KEY`      | Non-persisted Plumloom CLI credential | unset    |
| `AUTOEVAL_API_BASE_URL` | Autoeval API origin                   | required |

The Autoeval API URL must use HTTPS. Plain HTTP is accepted only for an explicit localhost development origin. Paths, credentials, query strings, and fragments are rejected.

## MCP and release gates

Run `pnpm mcp` after building. MCP tools call shared actions directly; run tools submit and return a
handle immediately, then clients poll `get_run_status` and retrieve `get_results`. See
[`mcp.md`](./mcp.md) for client configuration.

`autoeval gate` evaluates the scored result for an existing configured evaluation. It may reuse an
existing completed run and result with the same Run ID; if the returned run is still active, the CLI
polls it before evaluating local thresholds. The command emits terminal run status in JSON and exits
non-zero on a failed gate. The composite GitHub Action writes the same checks to the workflow
summary. See [release gating for CI](./release-gating.md).

MCP exposes no suite or gate tools. Suites and release decisions are CLI-side concerns: the gate
plane is pure local logic over payloads the action layer already returns, so an MCP client that
wants gating polls `get_run_status`/`get_results` and applies its own policy, or shells out to
`autoeval suite gate` from CI.

## Suites

`autoeval suite run --manifest <file>` executes every eval file named by a manifest, and
`autoeval suite gate --manifest <file>` adds a release decision on top. Both accept
`--concurrency` (default `3`) and `--stagger-ms` (default `250`).

Implementation, all inside the public `packages/cli`:

| File                                      | Responsibility                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| `src/suite/manifest.ts`                   | Parse/validate YAML or JSON manifests, resolve eval paths, merge gate policies           |
| `src/gate/policy.ts`                      | `SuiteGatePolicy` schema, emptiness check, field-by-field merge                          |
| `src/suite/execution.ts`                  | Generic two-plane engine: bounded pool, stagger, off-plane result pool, per-eval records |
| `src/actions/suite.ts`                    | Wires the engine to real actions, produces `SuiteSummary`                                |
| `src/gate/decision.ts`                    | Pure gate plane: run-mode detection, mean/CI checks, convergence, roll-up                |
| `src/actions/suite-gate.ts`               | Applies policies to a `SuiteSummary`, produces report and CI exit error                  |
| `src/output/human.ts`                     | `renderSuiteSummary`, `renderSuiteGateReport`                                            |
| `src/commands/program.ts` / `executor.ts` | Command definitions, option parsing, concurrency/stagger defaults, JSON vs human         |
| `tests/suite-two-plane.test.ts`           | Concurrency, stagger, off-plane fetching, failure isolation                              |
| `tests/suite-gate.test.ts`                | Every decision rule, roll-up precedence, exit codes, policy merging                      |

The suite layer re-implements nothing: it calls `createEvaluation`,
`runConfiguredEvaluation`, and `getResults`, and reuses the established `AutoevalError` kinds and
exit-code table. When extending it, keep `src/gate/decision.ts` pure — no network, no new backend
fields — so gating stays unit-testable offline.

See [suite execution and release gating](./release-gating.md).
