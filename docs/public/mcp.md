# Autoeval MCP server

The Autoeval MCP server lets local coding agents and MCP clients use the same deterministic evaluation capabilities as the CLI.

The server uses Autoeval's shared action layer and returns structured MCP results. It does not
execute shell commands or call model providers directly.

## Build and launch

Requirements are the same as the CLI: Node.js 22.13 or newer, pnpm 11, and a Plumloom CLI key.

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm mcp
```

`pnpm mcp` runs `node packages/cli/dist/mcp.js`. An installed public package also exposes the
`autoeval-mcp` executable. The process reads MCP messages from stdin and reserves stdout for
protocol responses.

## Authentication

The server resolves credentials non-interactively in this order:

1. `AUTOEVAL_API_KEY`
2. the Autoeval entry in the OS credential store

Autoeval connects to [https://api.plumloom.ai](https://api.plumloom.ai) automatically. No API URL configuration is required.
The MCP server never prompts and never persists an environment credential. Authenticate once with `autoeval login`, or
inject `AUTOEVAL_API_KEY` through the MCP client's secret/environment configuration. Never place a
real key in a checked-in MCP configuration.

The key is used only for Autoeval's authenticated API requests. Tool input, output, errors, schemas, and descriptions do not contain it.

## MCP client configuration

Build Autoeval first, then configure a client to spawn the server with an absolute path. For Codex and Claude Code specifically, including verification and an end-to-end workflow, see [Autoeval with Codex and Claude Code](./integration-codex-and-claude-code.md). A typical local configuration is:

```json
{
  "mcpServers": {
    "plumloom-autoeval": {
      "command": "node",
      "args": ["/absolute/path/to/autoeval/packages/cli/dist/mcp.js"]
    }
  }
}
```

When an OS credential-store entry is unavailable, configure `AUTOEVAL_API_KEY` using the client's secret mechanism. Do not copy a real key into a repository file.

## Tools

Read-only tools may query the API but do not create or update evaluation resources:

| Tool                                                      | Purpose                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------ |
| `get_current_user`                                        | Return the authenticated identity                                  |
| `list_workspaces`                                         | List accessible workspaces                                         |
| `list_evaluations`                                        | List evaluations in a workspace                                    |
| `get_evaluation`                                          | Read the current configured evaluation version                     |
| `list_models`                                             | List account-enabled evaluation models                             |
| `get_quality_standard`                                    | Read a quality standard                                            |
| `validate_configured_evaluation`                          | Validate configured input without creating versions or a run       |
| `get_run_status`                                          | Read a run's current status                                        |
| `get_results`                                             | Read context-specific results, including trajectory when available |
| `import_get_status` (`import_status`)                     | Check external provider key presence, access readiness, and cache  |
| `import_review`                                           | Review cached external evaluations without importing               |
| `import_list_workspaces`                                  | List workspaces dedicated to imported external evaluations         |
| `import_list_workspace_evaluations` (`import_list_evals`) | List evaluations in an import workspace                            |
| `import_get_evaluation` (`import_show_eval`)              | Read imported evaluation detail, graders, run history, and outputs |
| `import_get_insights` (`import_insights`)                 | Read readiness, pass-rate trends, and grader reliability insights  |

State-changing tools execute deterministically when called. The MCP server does not add an interactive confirmation prompt:

| Tool                                              | Purpose                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `create_workspace`                                | Create a workspace                                                                          |
| `create_evaluation`                               | Create an evaluation draft                                                                  |
| `update_evaluation_title`                         | Update an evaluation title and refresh its workspace listing                                |
| `create_quality_standard`                         | Create a quality standard                                                                   |
| `assign_quality_standard`                         | Associate a quality standard with a workspace                                               |
| `run_configured_evaluation`                       | Validate, create methodology/configuration versions, submit, and return the run identifiers |
| `run_evaluation`                                  | Submit the current saved configuration and return the run identifiers                       |
| `import_connect`                                  | Validate external provider access and refresh discovery cache                               |
| `import_disconnect`                               | Clear external discovery cache                                                              |
| `import_evaluations` (`import_run`)               | Import selected or all-new external evaluations in batches                                  |
| `import_remove_evaluation` (`import_remove_eval`) | Delete an imported evaluation from the workspace (requires explicit confirmation)           |

Every ID argument is a UUID, except external evaluation source IDs which use `eval_...`. Tool schemas reject unknown fields. Results use an `{ "ok": true, "data": ... }` envelope. Failures use `{ "ok": false, "error": { "kind", "code", "message" } }`, set the MCP error flag, and redact recognized secret fields and CLI-key patterns.

## Configured evaluation semantics

`validate_configured_evaluation` and `run_configured_evaluation` accept the configured input object directly, not a local file path. They reuse the CLI's configured-run parser and preflight validation.

- `scenario` requires an enabled primary model and permits distinct comparison models.
- `conversation` evaluates a frozen transcript.
- `agent_trace` evaluates a frozen trajectory; results can include both session and trajectory structures.
- Judge, primary, and comparison model roles must remain distinct, and comparison IDs must be unique.

`runsPerScenario` is validated as an integer from 1 to 10, preserved, and sent to the API as
`runs_per_scenario`; it defaults to 1 when omitted. Legacy `autoStopEnabled` is accepted for
compatibility but ignored and not forwarded; automatic stopping is controlled by the evaluation
service.

`run_configured_evaluation` creates new methodology and configuration versions before submitting a run. `run_evaluation` uses the evaluation's current saved versions and does not create new versions.

Both run tools are asynchronous at the MCP boundary. They return immediately after the API accepts the run, with `evaluationId`, `runId`, `methodologyVersionId`, `configVersionId`, and the initial `status`. They do not wait for terminal completion. Poll `get_run_status` with the returned identifiers until the run is terminal, then call `get_results`.

## Example workflow

1. Call `get_current_user` to verify authentication.
2. Call `list_models` to obtain enabled model UUIDs.
3. Call `list_workspaces`, then `list_evaluations` with the selected workspace UUID.
4. Prepare a configured input object using the public JSON examples as a guide.
5. Call `validate_configured_evaluation`.
6. After the client/user decides to proceed, call `run_configured_evaluation` with the evaluation UUID and validated input.
7. Poll `get_run_status` with the returned evaluation and run UUIDs until the run is terminal.
8. Call `get_results` after completion.

## Suites and release gating are not MCP tools

The MCP server exposes single-evaluation actions only. There is no `run_suite` and no `gate` tool,
by design:

- Suite execution is a CLI orchestration concern (bounded-concurrency execution plane, off-plane
  results plane) over actions the MCP server already exposes one at a time.
- The gate plane is pure local policy over payloads MCP clients already receive. Thresholds live
  in a committed manifest reviewed alongside code, not in tool arguments supplied by an agent.
- Release decisions belong to CI, where a non-zero process exit blocks a merge. MCP has no
  equivalent, so a gate tool would return a verdict nothing enforces.

An MCP client that needs suite behaviour submits runs with `run_configured_evaluation`, polls
`get_run_status`, reads `get_results`, and applies its own policy — or a CI job runs
`autoeval suite gate --manifest <file>`. Nothing in the gate plane depends on MCP, and MCP
expectations are unchanged by it. See
[suite execution and release gating](./release-gating.md).

## CI smoke test of this server

Repository CI boots this server over stdio on Linux, macOS, and Windows and asserts an
`initialize` response. The server resolves credentials when it constructs its action context —
before reading the first JSON-RPC message — and a CI runner has no keyring entry and no TTY to
prompt, so the step sets a literal dummy `AUTOEVAL_API_KEY` scoped to that step. The key satisfies
format validation only: the `initialize` handshake returns server capabilities and makes no API
call, so the placeholder is not used for a request. It is not a secret and is not stored in GitHub
secrets or variables.

HTTPS enforcement, redirect rejection, response-size limits, request timeouts, API response validation, and result routing are inherited from the shared Autoeval implementation. MCP clients own run-status polling; deterministic CLI commands retain Autoeval's bounded internal polling.
