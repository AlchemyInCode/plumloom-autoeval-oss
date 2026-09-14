# Autoeval with Codex and Claude Code

Codex and Claude Code both connect to Autoeval as a local **stdio MCP server**. The
server is a thin entry point over the same typed action layer the CLI uses, so an agent
gets the same deterministic evaluation capabilities as the terminal — structured,
redacted tool results instead of human-formatted output. See
[Autoeval MCP server](./mcp.md) for the full tool catalog and semantics; this page is
the client-setup walkthrough.

The MCP server never prompts and never shells out to the CLI. Run tools return identifiers
immediately; the client polls
`get_run_status` until terminal and then calls `get_results`.

## 1. Prerequisites

- Node.js 22.13 or newer, pnpm 11.
- A Plumloom CLI key beginning with `pl_sk_`.
- The Autoeval API origin supplied as `AUTOEVAL_API_BASE_URL`.
- Autoeval built from this repository:

  ```bash
  pnpm install --frozen-lockfile
  pnpm build
  ```

  The server entry point is `packages/cli/dist/mcp.js`. Configure clients with the
  **absolute** path to that file.

## 2. Environment and authentication

The MCP server resolves credentials non-interactively, in this order:

1. `AUTOEVAL_API_KEY`
2. the Autoeval entry in the OS credential store

Either path works:

- Run `autoeval login` once on the machine. The keyring entry is shared with the MCP
  server and no per-client environment configuration is needed.
- Or inject `AUTOEVAL_API_KEY` through the client's secret/environment configuration.
  Never place a real key in a checked-in client configuration file.

The key is used only for Autoeval's authenticated API requests. Tool input, output, errors,
schemas, and descriptions never contain it.

Unlike the key, `AUTOEVAL_API_BASE_URL` is always required and has no built-in default. Pass it in
the MCP process environment regardless of which credential path you use.

## 3. Register the server

### Claude Code

From the project directory:

```bash
claude mcp add plumloom-autoeval \
  -e AUTOEVAL_API_BASE_URL=<autoeval-api-origin> \
  -- node /absolute/path/to/autoeval/packages/cli/dist/mcp.js
```

With an injected key instead of the OS credential store:

```bash
claude mcp add plumloom-autoeval \
  -e AUTOEVAL_API_BASE_URL=<autoeval-api-origin> \
  -e AUTOEVAL_API_KEY=<your-key> \
  -- node /absolute/path/to/autoeval/packages/cli/dist/mcp.js
```

This writes the standard `mcpServers` entry (user or project scope depending on flags).
The equivalent `.mcp.json` form is:

```json
{
  "mcpServers": {
    "plumloom-autoeval": {
      "command": "node",
      "args": ["/absolute/path/to/autoeval/packages/cli/dist/mcp.js"],
      "env": { "AUTOEVAL_API_BASE_URL": "<autoeval-api-origin>" }
    }
  }
}
```

### Codex

Codex reads MCP servers from `~/.codex/config.toml`:

```toml
[mcp_servers.plumloom-autoeval]
command = "node"
args = ["/absolute/path/to/autoeval/packages/cli/dist/mcp.js"]

[mcp_servers.plumloom-autoeval.env]
AUTOEVAL_API_BASE_URL = "<autoeval-api-origin>"
```

With an injected key:

```toml
[mcp_servers.plumloom-autoeval]
command = "node"
args = ["/absolute/path/to/autoeval/packages/cli/dist/mcp.js"]

[mcp_servers.plumloom-autoeval.env]
AUTOEVAL_API_BASE_URL = "<autoeval-api-origin>"
AUTOEVAL_API_KEY = "<your-key>"
```

Prefer your OS secret store or `autoeval login` over a plaintext key in
`config.toml`; if you use the `env` table, treat the file as a secret.

## 4. Verify tool discovery

Restart the client after editing configuration, then confirm the server mounted:

- **Claude Code:** run `/mcp` and check that `plumloom-autoeval` is connected.
- **Codex:** run `codex mcp list` (or ask the agent to list its tools).

Tools appear namespaced as `mcp__plumloom-autoeval__<tool>`. You should see the nine
read-only tools (`get_current_user`, `list_workspaces`, `list_evaluations`,
`get_evaluation`, `list_models`, `get_quality_standard`,
`validate_configured_evaluation`, `get_run_status`, `get_results`) and the seven
state-changing tools (`create_workspace`, `create_evaluation`,
`update_evaluation_title`, `create_quality_standard`, `assign_quality_standard`,
`run_configured_evaluation`, `run_evaluation`).

If the server fails to start, launch it by hand to see the stderr error:

```bash
node packages/cli/dist/mcp.js
```

## 5. Read-only smoke test

Ask the agent to run only read-only tools first — this verifies authentication and
connectivity without creating anything:

1. `get_current_user` — returns the authenticated identity. A failure here means the
   key is missing or invalid; fix auth before continuing.
2. `list_models` — returns the account-enabled evaluation model UUIDs you will need
   for configured runs.
3. `list_workspaces` — confirms workspace scope.

A read-only call that fails returns an `{ "ok": false, "error": { "kind", "code",
"message" } }` envelope with the MCP error flag set and secrets redacted.

## 6. Run an evaluation end to end through MCP

Runs are asynchronous at the MCP boundary. The full sequence:

1. `list_workspaces`, then `list_evaluations` with the workspace UUID (or
   `create_workspace` + `create_evaluation` for a fresh one).
2. Prepare a configured input object using the public JSON examples as a guide —
   `examples/evals/scenario-basic.json` (scenario),
   `examples/evals/conversation-success.json` (frozen transcript), or
   `examples/evals/agent-trace-basic.json` (frozen trajectory). Replace
   placeholder model IDs with real UUIDs from `list_models`.
3. `validate_configured_evaluation` — preflight validation without creating versions
   or spending a run. Judge, primary, and comparison model roles must be distinct.
4. `run_configured_evaluation` — validates, creates new methodology/configuration
   versions, submits, and returns `evaluationId`, `runId`, version IDs, and the
   initial status immediately. (`run_evaluation` instead reuses the evaluation's
   current saved versions.)
5. Poll `get_run_status` with the returned UUIDs until the status is terminal.
6. `get_results` — context-specific results, including the trajectory for agent
   traces.

## 7. Recommended development loop

Use the agent to close the loop between code changes and release evidence:

```text
code -> eval -> inspect -> fix -> rerun -> gate
```

1. **code** — change prompts, tools, or application code.
2. **eval** — ask the agent to re-run the evaluation via `run_configured_evaluation`
   and poll `get_run_status`.
3. **inspect** — read `get_results`: metric scores, failure findings, and for agent
   traces the rendered trajectory.
4. **fix** — adjust and **rerun** the same configured input.
5. **gate** — apply release policy. The MCP server deliberately has no `gate` tool:
   threshold policy lives in a committed manifest reviewed with code, and the
   enforceable verdict is a CI process exit. Run
   `autoeval suite gate --manifest autoeval.suite.yaml` (or `autoeval gate`) in
   CI; see [Release gating for CI](./release-gating.md).

## 8. Codex vs Claude Code: actual differences

Everything else — the server binary, the tools, the auth order, the workflow — is
identical. Only the registration mechanics differ:

| Aspect           | Claude Code                             | Codex                                       |
| ---------------- | --------------------------------------- | ------------------------------------------- |
| Registration     | `claude mcp add` CLI or `.mcp.json`     | `[mcp_servers.*]` in `~/.codex/config.toml` |
| Config format    | JSON (`mcpServers`)                     | TOML                                        |
| Key injection    | `-e AUTOEVAL_API_KEY=...` flag or `env` | `[mcp_servers.*.env]` table                 |
| Discovery check  | `/mcp` in the session                   | `codex mcp list`                            |
| Tool namespacing | `mcp__plumloom-autoeval__<tool>`        | `mcp__plumloom-autoeval__<tool>`            |
| Server transport | stdio                                   | stdio                                       |

Both clients spawn the server per session over stdio, so a build change
(`pnpm build`) takes effect on the next client session — no separate server process
to restart.
