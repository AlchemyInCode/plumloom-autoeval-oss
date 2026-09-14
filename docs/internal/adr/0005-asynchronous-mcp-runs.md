# ADR 0005: Asynchronous MCP run submission

## Status

Accepted

## Context

Evaluation runs can outlast an MCP client's request timeout. Holding `run_evaluation` or `run_configured_evaluation` open until terminal completion caused clients to report a timeout even when the API had accepted and successfully completed the run. Increasing one client's timeout would not make the server reliable across MCP hosts.

## Decision

MCP run tools return immediately after successful API submission. Their structured result contains the evaluation, run, methodology-version, and configuration-version identifiers plus the initial run status. MCP clients poll `get_run_status` and call `get_results` after completion.

The shared action layer exposes submission-only operations. Deterministic CLI workflows retain their bounded wait-to-terminal behavior by composing submission with polling. Autoeval continues to submit runs only through the API, uses an idempotency key for the run request, and does not retry run creation automatically.

Progress notifications are not part of this decision.

## Consequences

- MCP calls do not remain open for the duration of an evaluation run.
- A client receives the run identifier before it begins polling, avoiding an ambiguous client-timeout state after successful submission.
- MCP clients are responsible for bounded status polling and for requesting results only after completion.
- Deterministic CLI behavior and API/evaluation-service contracts remain unchanged.
