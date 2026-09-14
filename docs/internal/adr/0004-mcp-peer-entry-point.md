# ADR 0004: MCP as a peer entry point to shared actions

- Status: Accepted
- Date: 2026-08-13

## Context

Coding agents need deterministic Autoeval capabilities through Model Context Protocol without creating another evaluation implementation or weakening the API-only trust boundary.

## Decision

Autoeval provides a local stdio MCP server built with the official TypeScript MCP server SDK. MCP tools validate their arguments, call the existing typed action layer, and return structured, redacted results.

The CLI and MCP server share non-interactive credential resolution and API client construction. The MCP server does not invoke Commander, shell out to the CLI, use terminal renderers, call the evaluation service, or call model providers. State-changing tools are marked as such but do not add a terminal confirmation prompt; the MCP tool call itself is the deterministic operation.

Configured-evaluation tools reuse the existing parser and preflight validation. Scenario repeat-run behavior and conversation/agent-trace single-shot behavior remain unchanged.

## Consequences

- CLI behavior and JSON contracts remain stable.
- MCP clients receive schemas and structured action/domain results instead of human-formatted CLI output.
- Credentials remain confined to authenticated API requests and are resolved from `AUTOEVAL_API_KEY` or the OS credential store without prompting.
- Tool failures are returned as redacted, machine-understandable error envelopes.
- Stdio is the only initial transport; a network-hosted MCP deployment would require a separate authentication and transport decision.
