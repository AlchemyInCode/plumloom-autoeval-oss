# ADR 0011: Require an explicit public API base URL

## Status

Accepted.

## Context

The public CLI exposed an internal backend name through its API-origin environment variable and
silently used a compiled-in development origin when that variable was absent. That coupled public
builds to one deployment and made an omitted configuration look valid.

## Decision

Use `AUTOEVAL_API_BASE_URL` as the only public API-origin variable. Require a non-empty value at
startup, validate that it is an HTTPS origin (with the existing localhost HTTP exception), and
provide no compiled-in origin or compatibility alias. Keep the existing internal transport types
and modules because this decision changes public configuration, not the backend boundary.

## Consequences

CLI, MCP, CI, and integration users must provide the Autoeval API origin explicitly. Missing or
empty configuration fails before authentication or network access with an actionable error. This
is a pre-launch breaking change: the previous environment-variable name is not supported.
