# ADR 0010: DeepSeek Harness integration is MCP first, with trajectory conversion in the CLI

- Status: Accepted
- Date: 2026-08-29

## Context

DeepSeek Harness is a plugin-based agent harness (MIT, TypeScript, developer preview `dsh-v0.1.x`)
that consumes external MCP servers through `@deepseek-ai/dsh-mcp-client` and records each agent
session as an append-only JSONL log of typed `SessionEvent`s. Two integration levels are possible:
consume Autoeval over MCP, or write a native Harness plugin with access to session and trajectory
data.

Autoeval's `agent_trace` context evaluates an OTLP export annotated with OpenInference span kinds.
That is not the Harness event shape, so any trajectory-based integration needs a conversion step.

## Decision

Integration ships in two levels and defers a third.

1. **MCP is the primary integration and is configuration only.** Autoeval's existing stdio MCP
   server mounts as one `@deepseek-ai/dsh-mcp-client` config row. No Autoeval runtime code changes.
   The documented row re-injects `AUTOEVAL_API_KEY` explicitly, because the Harness scrubs ambient
   names matching `KEY|PASSWORD|SECRET|TOKEN` before spawning a stdio server, and raises
   `toolCallTimeoutMs` above the 60s default because result reads can exceed it.

2. **Trajectory conversion lives in the OSS CLI, not in a Harness plugin.** `autoeval trace import
--from deepseek-harness` converts a session JSONL into a validated `agent_trace` configured-run
   file. Judge model, evaluator instructions, expected behavior, and metrics come from a committed
   template file, never from the trajectory. Output is validated against `configuredRunFileSchema`
   before it is written.

3. **A native Harness plugin is deferred** behind an explicit go/no-go.

## Consequences

- The conversion is unit-testable and usable without the Harness installed, and any future plugin
  is a thin caller of it rather than a second implementation.
- The API-only client boundary is unchanged: the importer touches files only, and
  submission reuses the existing `eval create-from` path.
- Autoeval takes on no dependency on a pre-1.0 harness whose docs warn of compatibility-breaking
  changes. The event-name mapping is pinned to `dsh-v0.1.x` in one module.
- Import is explicit, never automatic. Trajectories contain prompt and tool-output content, so
  converted span text passes through the existing redaction waterfall and the docs state that
  importing uploads that content for evaluation.
- Only the root session is imported; subagents log to their own child sessions and are counted and
  reported rather than merged. Zstandard-framed logs (the Harness default) are rejected with the
  setting that produces raw lines, because decompression is not bundled.
