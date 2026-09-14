# DeepSeek Harness integration

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) is a plugin-based agent harness
("everything is a plugin", built on Cordis). It can consume external MCP servers, and it records
each agent session as an append-only trajectory. Autoeval integrates at two levels:

| Level                   | What you get                                                       | Code required     |
| ----------------------- | ------------------------------------------------------------------ | ----------------- |
| MCP server              | The Harness agent calls Autoeval tools directly                    | None, config only |
| `autoeval trace import` | A Harness session becomes an `agent_trace` evaluation you can gate | None, CLI command |

The Harness is a developer preview (`dsh-v0.1.x`) and states that compatibility-breaking changes
will happen. Both levels below are pinned to that line.

## Level 1: connect Autoeval as an MCP server

Build Autoeval and authenticate once:

```bash
pnpm install --frozen-lockfile
pnpm build
autoeval login
```

Add one config row per MCP server to the profile's `cordis.patch.yml`
(`$DSH_HOME/profiles/<profile>/cordis.patch.yml`), or copy
[`examples/integrations/deepseek-harness/cordis.patch.yml`](../../examples/integrations/deepseek-harness/cordis.patch.yml):

```yaml
- id: mcp-autoeval
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: autoeval
    transport: stdio
    command: node
    args: ['/absolute/path/to/autoeval/packages/cli/dist/mcp.js']
    env:
      AUTOEVAL_API_BASE_URL: !!js process.env.AUTOEVAL_API_BASE_URL
      AUTOEVAL_API_KEY: !!js process.env.AUTOEVAL_API_KEY
    toolCallTimeoutMs: 120000
```

Three details matter:

- **The API origin must be passed explicitly.** Set `AUTOEVAL_API_BASE_URL` in the Harness host
  environment; Autoeval has no built-in origin.
- **The key must be re-injected explicitly.** For stdio servers the Harness starts the child from a
  scrubbed parent environment: ambient names matching `KEY|PASSWORD|SECRET|TOKEN` and `DSH_*` are
  dropped. `AUTOEVAL_API_KEY` therefore does not pass through implicitly. Never put a real key in a
  committed config file — reference the ambient variable, or use the client's secret mechanism.
  If the Harness host has an OS credential-store entry from `autoeval login`, the `env:` block can
  be omitted entirely.
- **Raise the tool-call timeout.** The default is 60s. Submitting a run returns immediately, but
  `get_results` can exceed 60s on a large evaluation.
- **Tools are namespaced.** They appear to the model as `mcp__autoeval__<tool>`, the same shape
  Claude Code and Codex use.

Verify the row is mounted with `dsh --profile web --dump-config`.

### Agent workflow

The tools are the same ones documented in [MCP server](./mcp.md). A typical agent sequence:

1. `mcp__autoeval__get_current_user` — confirm authentication.
2. `mcp__autoeval__list_models` — obtain enabled model UUIDs.
3. `mcp__autoeval__list_workspaces`, then `mcp__autoeval__list_evaluations`.
4. `mcp__autoeval__validate_configured_evaluation` — validate input before spending a run.
5. `mcp__autoeval__run_configured_evaluation` — submit; returns identifiers immediately.
6. Poll `mcp__autoeval__get_run_status` until terminal, then `mcp__autoeval__get_results`.

Runs are asynchronous at the MCP boundary. The Harness client owns polling, exactly as every other
MCP client does.

## Level 2: evaluate a Harness trajectory

The Harness writes each session as JSONL — one typed `SessionEvent` per line: `turn/start`,
`assistant/message`, `tool/call`, `tool/result`, `turn/end`, and others. Autoeval's `agent_trace`
context evaluates an OTLP export annotated with OpenInference span kinds. `autoeval trace import`
converts one into the other:

```bash
autoeval trace import \
  --from deepseek-harness \
  --session ~/.dsh/projects/<project>/<session>.jsonl \
  --template examples/evals/agent-trace-basic.json \
  --out imported-session.autoeval.json
```

Then create and run it, or chain both steps:

```bash
autoeval eval create-from --workspace <workspace-id> --input imported-session.autoeval.json --run
# or
autoeval trace import --from deepseek-harness --session <session.jsonl> \
  --template <template.json> --out imported.json --workspace <workspace-id> --run
```

### What the template supplies

The trajectory supplies only the artifact. The judge model, evaluator instructions, expected
behavior, and metrics are review-time decisions and come from `--template`, which is an ordinary
configured-run file (start from `examples/evals/agent-trace-basic.json`). Its `artifact` is replaced by
the converted trace; everything else is preserved. `--name` overrides the evaluation name so
imported sessions stay distinguishable in the UI.

The importer refuses to overwrite an existing `--out` file. Session input is limited to 32 MiB
and 100,000 events, templates to 1 MiB, and generated output to 64 MiB so malformed or unexpectedly
large local logs cannot consume unbounded resources.

### Mapping

| Harness                                             | Autoeval span                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `session` header                                    | root `AGENT` span, first user message -> `input.value`, last assistant message -> `output.value` |
| `assistant/message`                                 | child `LLM` span (reasoning text included)                                                       |
| `assistant/message` holding only a `tool-call` part | child `LLM` span rendered as `→ tool(args)` so the step is not lost                              |
| `tool/call` + `tool/result`                         | child `TOOL` span with `tool.name`, raw arguments, result                                        |
| `tool/result` carrying `error` or an `isError` part | span status set to error                                                                         |

Calls and results are joined on the call id wherever the Harness records it: top level on
`tool/call`, and under `message.source.callId` or the `tool-result` part on `tool/result`.

Plugin-authored runtime-context messages are recorded with `role: "user"` but are skipped, so the
trajectory's input is the developer's prompt rather than a sandbox-policy snapshot.

Harness events carry no timestamps; only the header's `createdAt` does. Spans are anchored at that
wall-clock start and ordered by log position, so durations are ordering-only and the import says so.

Reported but not merged: a tool call with no matching result becomes a failed span and is counted;
subagent events are counted and skipped, because subagents log to their own child sessions.

### Verified against real sessions

The converter is regression-tested against unmodified logs from the upstream Harness snapshot suite
(`packages/cli/tests/fixtures/deepseek-harness/real-*.jsonl`, MIT, attributed in the README next to
them), covering a web-search round and a rejected-tool retry loop. The hand-written fixture alone
was not evidence: against real logs the converter silently produced a degraded trace. The real
shapes it missed, each now pinned by a test:

| Real shape                                                             | What broke before                                        |
| ---------------------------------------------------------------------- | -------------------------------------------------------- |
| The session header is a typed `session` event, not a bare first object | the header was skipped, so the root span lost its anchor |
| No event carries a timestamp; only the header has `createdAt`          | spans were anchored at import time, not session time     |
| `tool/result` names its call under `message.source.callId` or the part | calls and results did not join, every tool span unpaired |
| `tool-result` text nests one content level deeper than other parts     | tool results rendered empty                              |
| An assistant turn that invokes a tool has no text content              | the step vanished; now rendered as `→ tool(args)`        |
| Plugin-authored runtime context is written with `role: "user"`         | a sandbox-policy snapshot was imported as the prompt     |

End-to-end validation: a real web-search session was converted, created, and run as an `agent_trace`
evaluation, and the rendered trajectory preserved every LLM and tool step in log order with correct
parent/child nesting.

Refresh the fixtures only by re-copying from an upstream snapshot — an edited fixture stops being
evidence of the real format.

### Known limits

- **Raw JSONL only.** The Harness persists sessions as concatenated Zstandard frames by default.
  Configure the JSONL persistence plugin to write raw lines, or decompress before importing; a
  compressed log is rejected with that hint rather than a JSON parse error.
- **Root session only.** Subagent sessions are separate logs; import them individually.
- **Trajectories carry prompt and tool-output content**, and importing uploads them for evaluation.
  Import is always explicit — never automatic — and converted text passes through Autoeval's
  redaction waterfall. Review what a session contains before importing it.

## Native Harness plugin

A native plugin (`session/event` hook -> convert -> submit) is deliberately not shipped yet. See
[ADR 0010](../internal/adr/0010-deepseek-harness-integration.md) for the reasoning: the conversion is the
only real logic, it belongs in the CLI where it is testable without the Harness, and a
version-pinned plugin against a pre-1.0 harness is maintenance to take on only once these two
levels have real usage.
