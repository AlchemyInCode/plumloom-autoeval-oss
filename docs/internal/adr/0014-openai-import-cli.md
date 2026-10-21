# 0014: Server-Side OpenAI Import Through the CLI

## Status

Accepted for the requested CLI surface. Live backend contract verification is a release gate.

## Context

The existing backend supports discovery and import of OpenAI Evals. Terminal users need the
Connect, Review, and Imported workflow without adding provider credentials to the local client.
The requested implementation scope explicitly excludes changes to MCP.

## Decision

Add `autoeval import` backed by validated import actions and the existing authenticated HTTP
client. Call only the Plumloom `/api/v1/import/external/evals` paths. Provider credentials remain
server-side. The backend remains responsible for authorization, OpenAI access, import state,
idempotent skips, workspace creation, cascading deletion, and computed insights.

Validate UUID/source-ID namespaces separately. Bound discovery to 1,000 pages and 25,000
records, files to 1 MiB, and writes to 25 IDs. Retry GETs only. Require explicit confirmation
for removal and never prompt in JSON/noninteractive mode. Preserve backend JSON fields with
existing recursive redaction and sanitize human output before terminal rendering.

## Consequences

No dependency, backend, provider-key, or MCP changes are required. CLI-specific exit codes
include partial import failure (`1`) and cold discovery (`9`). Backend failures can leave earlier
batches committed; clients must not treat a multi-batch import as transactional. Repeating a
selection relies on backend duplicate detection and authorization, not client-side trust.

The specification does not include exact backend response schemas. Expected paths, fields,
methods, and query/body names are recorded in `docs/public/openai-import.md` and covered by
mocked tests. These tests do not establish deployed backend compatibility; confirm the contract
and run the documented authorized smoke tests before release.
