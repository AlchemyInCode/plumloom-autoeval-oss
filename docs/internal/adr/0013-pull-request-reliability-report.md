# ADR 0013: Report suite reliability evidence in same-repository pull requests

## Status

Accepted

## Context

`autoeval suite gate` already produces the authoritative suite and per-evaluation release
decisions. GitHub Actions users need the context behind those decisions near the pull request, but
scenario trials, frozen conversations, and frozen agent traces support different reliability
evidence. Pooling them into one score would misrepresent the underlying measurements.

Publishing a pull-request comment also introduces a repository-write permission and a new network
operation. Neither may weaken the existing fork guard, expose evaluation payloads, or change the
release decision when GitHub is unavailable.

## Decision

The CLI optionally creates or updates an Autoeval Reliability Report issue comment when all of the
following are true:

- `AUTOEVAL_PR_RELIABILITY_COMMENT=true`;
- the GitHub event is `pull_request` from the same repository;
- `GITHUB_TOKEN` is available with `pull-requests: write`;
- the workflow supplies a stable suite/job/matrix identity.

The report reuses the existing suite verdict and gate checks. A pure renderer presents Standard,
Judgment, and Repeatability evidence at the granularity exposed by the run and results APIs.
Scenario statistics remain scoped to their reported model/scenario/metric records. Frozen
conversation and agent-trace inputs label behavioral repeatability as inapplicable. Missing data is
never inferred from another context or from a current workspace assignment.

The comment body contains a hidden marker derived from repository, manifest, job, and matrix
identity. The CLI lists REST issue comments, updates a matching comment owned by the expected bot,
and creates one only when no match exists. It degrades the report before GitHub's comment-size
limit. Raw prompts, outputs, traces, credentials, anchor contents, and judge rationales are excluded.

Comment resolution, rendering, and REST errors return a non-blocking reporting result. They never
replace the suite verdict or its exit code. Fork pull requests are not eligible, and the workflow
does not use `pull_request_target`.

## Consequences

- Same-repository pull requests can show one current reliability report per suite and matrix cell.
- Matrix workflows must assign a stable, unique `AUTOEVAL_REPORT_MATRIX_ID` to each cell.
- The adopter workflow requires `pull-requests: write` in addition to `contents: read`.
- Fork pull requests continue to skip the secret-backed gate and report comment.
- GitHub comment failures can reduce visibility but cannot make a failing gate pass or a passing
  gate fail.
- A package release containing this implementation is required before copied workflows can use the
  report feature.
