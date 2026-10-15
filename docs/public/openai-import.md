# Import OpenAI Evaluations

This CLI-only workflow copies OpenAI evaluations into the account's **Imported from OpenAI**
workspace using the existing Plumloom backend. No OpenAI key is entered, stored, or sent by the
CLI. Configure that key in the Plumloom UI under **AI Providers & Models**. Authenticate with
`autoeval login` or an existing `AUTOEVAL_API_KEY` (a Plumloom `pl_sk_` key).

## Commands

All commands support `autoeval --json import ...`; global flags also work after the command.
JSON results go to stdout, errors to stderr. Existing credential-field and CLI-key redaction
applies recursively, including `raw_json`. Human output neutralizes terminal control characters.
Evaluation content may still contain sensitive user data: treat exported records as private.

| Command                                                                              | Behavior                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `import status`                                                                      | Cheap server-side key/access/cache check; does not discover evaluations.                                                                                                                                                           |
| `import connect`                                                                     | Validate provider access, discover evaluations, and cache the list.                                                                                                                                                                |
| `import connect --refresh`                                                           | Force a fresh discovery pull after new OpenAI activity.                                                                                                                                                                            |
| `import review [--search <text>] [--page 1] [--size 50] [--all]`                     | Read discovery only. Shows actual `already_imported` flags. Run counts and dates can remain unknown until backfilled.                                                                                                              |
| `import run --eval <eval_id> [--eval <eval_id> ...]`                                 | Import explicit OpenAI source IDs.                                                                                                                                                                                                 |
| `import run --input <file>`                                                          | Import one OpenAI source ID per UTF-8 line.                                                                                                                                                                                        |
| `import run --all-new`                                                               | Discover all pages, select records with `already_imported=false`, and import in batches.                                                                                                                                           |
| `import list`                                                                        | List import workspaces and evaluation counts.                                                                                                                                                                                      |
| `import evals --workspace <uuid> [--search <text>] [--page 1] [--size 50]`           | List imported evaluations and both Plumloom/source IDs.                                                                                                                                                                            |
| `import show <uuid> [--run <openai-run-id>] [--show-outputs] [--page 1] [--size 50]` | Detail, graders, run history, and paginated results. Defaults to newest run. JSON retains `raw_json`. Blank expected values omit the expected column.                                                                              |
| `import insights --workspace <uuid>`                                                 | Totals, migration readiness, stale evaluations, pass-rate trends, and flaky graders, labeled **Derived by Plumloom**. Null pass rates are unknown, not zero. JSON retains the full envelope and `flaky_graders[].evals[].eval_id`. |
| `import remove <uuid> [--yes]`                                                       | Delete the Plumloom copy and its runs/results. Interactive default is no. JSON/noninteractive use requires `--yes`. Does not delete anything in OpenAI.                                                                            |
| `import disconnect`                                                                  | Clear discovery only. Retains provider key and imported evaluations.                                                                                                                                                               |

Use `eval_...` IDs for source selection. Use Plumloom UUIDs for workspace options and for
`show`/`remove`. Run selection accepts OpenAI `evalrun_...` or `run_...` IDs, not Plumloom UUIDs.

## Limits and Failure Handling

- Page numbers: 1-1,000; size: 1-100, default 50. Discovery ordering comes from the backend.
- `review --all` starts at page 1 even when `--page` is supplied. It preserves the first page's
  envelope and aggregates/deduplicates both the backend `items` list and normalized `evals` list.
- All-pages discovery and explicit selections are capped at 25,000 unique evaluations.
  Explicit input is validated before deduplication and may contain at most 25,000 lines/IDs.
- ID files must be regular UTF-8 files of at most 1 MiB. BOM, CRLF, whitespace, empty lines,
  and repeated IDs are supported. Malformed IDs and invalid UTF-8 fail before a write.
- `--eval`, `--input`, and `--all-new` are mutually exclusive. Empty explicit selections fail.
- Each write contains at most 25 unique IDs. Batch progress goes to stderr in human mode.
  Per-evaluation failures are collected; subsequent batches continue. An all-new selection
  with no new evaluations succeeds without a write.
- GETs use the existing bounded retry policy. Import writes and deletions are never retried
  automatically. Transport/authentication failures stop subsequent batches. Earlier successful
  batches remain imported: rerun the selection to have the backend skip existing copies.
- Stalled/empty intermediate discovery pages fail rather than silently importing a partial list.
- Discovery uses `GET /api/v1/import/external/evals` directly, with `page`, `page_size`, and
  `search` (empty when omitted). CLI `--size` maps to backend `page_size`; the URL does not
  repeat `/evals`. Review never calls connect, refresh, or an import write. HTTP `409` exits `9`
  with a connect hint; the CLI does not guess alternative routes.
- If the discovery route does not support GET, the CLI reports `IMPORT_METHOD_NOT_ALLOWED` with exit `4`
  and a route-compatibility hint instead of suggesting an ineffective retry.
- HTTP timeouts, response-size bounds, cancellation, fixed API origin, and redirect rejection
  follow the existing client. No direct OpenAI network call is made.

| Exit | Meaning                                                                                         |
| ---- | ----------------------------------------------------------------------------------------------- |
| `0`  | Ready, successful read/write, or all selected evaluations imported/skipped.                     |
| `1`  | At least one selected evaluation failed to import.                                              |
| `2`  | Invalid arguments/file/ID, conflicting selectors, or missing removal confirmation.              |
| `3`  | Missing Plumloom auth, or provider `NO_KEY` / `INVALID_KEY`.                                    |
| `4`  | Not ready, `EVALS_FORBIDDEN`, `OPENAI_UNREACHABLE`, network error, or invalid backend response. |
| `9`  | Cold discovery cache (HTTP 409); run `autoeval import connect` first.                           |

## Backend Compatibility

All paths below are relative to `/api/v1/import/external/evals`. Authentication is always the
existing Plumloom bearer credential. These are client expectations based on the import spec;
verify them against the deployed backend before release. No backend schema or live import
fixture is shipped with this repository.

| Operation       | Method/path                       | Client contract                                                                                                                                                                                                                                                 |
| --------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status          | `GET /connect/status`             | `key_present`, optional masked `key_suffix`, nullable `evals_access` (`ready`, `forbidden`, `unreachable`), nullable `cache_status` (`warm`, `cold`). Also accepts coded key-presence responses as described below.                                             |
| Connect/refresh | `POST /connect`, `POST /refresh`  | Success requires a nonnegative integer count in `total`, `eval_count`, or `total_evals`, including zero. Missing/invalid counts fail validation instead of printing a false connection success.                                                                 |
| Discovery       | `GET` collection URL (no suffix) | Query `page`, `page_size`, `search`; envelope `items`, `total`, `page`, `page_size`, optional `already_imported_count`. Each item has `openai_eval_id`, `name`, `created_at`, `already_imported`, nullable `run_count`/`last_run_at`. JSON retains these fields and adds normalized `evals`/`size` aliases. |
| Commit          | `POST /run`                       | Body `{ "eval_ids": ["eval_synthetic"] }`; response `imported`, `skipped` (item lists or counts), `failed` (list), optional `workspace_id`. Single-batch fields are retained; multiple batches aggregate counts/lists and retain each envelope under `batches`. |
| Workspaces      | `GET /workspaces`                 | Workspace array or `{ "workspaces": [...] }`.                                                                                                                                                                                                                   |
| Imported evals  | `GET /workspaces/{uuid}`          | Query `page`, `size`, optional `search`; envelope `evals`, `total`.                                                                                                                                                                                             |
| Detail          | `GET /evaluations/{uuid}`         | Query `page`, `size`, optional `run_id`; detail object, optionally nested under `evaluation`, plus `runs`, `results`, and `raw_json`.                                                                                                                           |
| Insights        | `GET /workspaces/{uuid}/insights` | JSON envelope with `derived_by: "Plumloom"`; no client recomputation. Human panels read `totals`, `migration_readiness`, `going_stale`, `pass_rate_trend`, and `flaky_graders`.                                                                                 |
| Remove          | `DELETE /evaluations/{uuid}`      | JSON object or empty success.                                                                                                                                                                                                                                   |
| Disconnect      | `POST /disconnect`                | JSON object or empty success.                                                                                                                                                                                                                                   |

Empty removal/disconnect responses become `{ "removed": true, "eval_id": "..." }` or
`{ "disconnected": true }` in JSON. Provider error codes are mapped to fixed actionable hints;
untrusted upstream error text is not printed by the import actions.

Provider errors (`NO_KEY`, `INVALID_KEY`, `EVALS_FORBIDDEN`, `OPENAI_UNREACHABLE`) are handled
even when the backend returns HTTP `200`. Connect and refresh never print **Connected** or an
eval count for these error envelopes; they return actionable errors with exits `3`, `3`, `4`,
and `4`, respectively. Refresh uses `POST /refresh` with the same validation and error handling.
Status still renders supported no-key, forbidden, and unreachable envelopes as status states.

Status maps the backend's `key_last4` to `key_suffix` and boolean `cache_warm` to
`cache_status` (`warm` / `cold`). It also accepts `KEY_PRESENT`, `NO_KEY`, `EVALS_FORBIDDEN`, and
`OPENAI_UNREACHABLE` using the existing error-code envelope reader (`code`, `error_code`, or
supported nested error/detail fields). If the backend omits `evals_access`, a present key and
warm discovery cache indicate cached readiness (`ready`, exit `0`); a missing or cold cache
indicates `not_ready` (displayed as **not ready**, exit `4` when a key is present). A missing
key exits `3`. Key presence alone never means ready. An explicit forbidden or unreachable
result takes precedence over cached readiness and exits `4`.

Readiness inferred from a warm cache reflects previously completed discovery, not a fresh
OpenAI permissions probe. Status makes no additional request or OpenAI eval pull. Explicit
access/cache fields remain validated and preserved. Responses with no cache information retain
`null` / **unknown** cache state; the CLI does not invent a warm or cold state. Run
`autoeval import connect` to validate access and populate discovery, or `connect --refresh`
to force a fresh validation and pull.

Human status shows one actionable hint: add a key under **AI Providers & Models** when missing,
run `autoeval import connect` when access/cache readiness is unknown or the cache is cold, enable
Evals permissions when forbidden, or retry later when OpenAI is unreachable. A missing key also
points to `autoeval import status --json`; no UI URL is inferred from the API origin. Unknown codes
or invalid field values still fail validation without printing the backend response body.

The human **Cached list** line and its review suggestion are shown only when a key is present
and Evals access is ready. They are omitted for a missing key, not-ready access, forbidden
access, or an unreachable provider, even when stale discovery data remains warm. JSON retains
the backend cache state for scripting; hiding the human line does not clear discovery data.

## Local Verification

From the repository root (no provider access or real credentials required):

```bash
pnpm install --frozen-lockfile
pnpm --filter @plumloom/cli exec vitest run tests/external-import.test.ts
pnpm typecheck
pnpm lint
pnpm format:check
pnpm check:public-data
pnpm test
pnpm build
pnpm boundary:check
pnpm package:check
pnpm audit
node packages/cli/dist/cli.js import --help
node packages/cli/dist/cli.js import run --help
```

## Manual Backend Smoke Test

Run only against an account where importing records and deleting a test copy are authorized.
These commands make real Plumloom requests; `run` persists copies. Replace angle-bracket IDs
with values from your own command output. Never put an OpenAI key in the terminal.

```bash
node packages/cli/dist/cli.js login
node packages/cli/dist/cli.js import status
node packages/cli/dist/cli.js --json import status
node packages/cli/dist/cli.js import connect
node packages/cli/dist/cli.js import connect --refresh
node packages/cli/dist/cli.js import review
node packages/cli/dist/cli.js import review --search rubric --page 1 --size 10
node packages/cli/dist/cli.js --json import review --all
node packages/cli/dist/cli.js import run --eval <openai-eval-id>
node packages/cli/dist/cli.js import run --eval <openai-eval-id> --eval <another-openai-eval-id>
node packages/cli/dist/cli.js import run --input eval-ids.txt
node packages/cli/dist/cli.js import run --all-new
node packages/cli/dist/cli.js import list
node packages/cli/dist/cli.js import evals --workspace <workspace-uuid> --page 1 --size 10
node packages/cli/dist/cli.js import evals --workspace <workspace-uuid> --search rubric
node packages/cli/dist/cli.js import show <plumloom-eval-uuid>
node packages/cli/dist/cli.js import show <plumloom-eval-uuid> --show-outputs
node packages/cli/dist/cli.js import show <plumloom-eval-uuid> --run <openai-run-id> --page 1 --size 10
node packages/cli/dist/cli.js --json import show <plumloom-eval-uuid>
node packages/cli/dist/cli.js import insights --workspace <workspace-uuid>
node packages/cli/dist/cli.js --json import insights --workspace <workspace-uuid>
node packages/cli/dist/cli.js import remove <disposable-plumloom-eval-uuid>
node packages/cli/dist/cli.js import remove <another-disposable-plumloom-eval-uuid> --yes
node packages/cli/dist/cli.js import disconnect
node packages/cli/dist/cli.js import review
```

The last command should exit `9`. `connect` should restore discovery without losing imports.
Verify repeating an import skips existing copies, review's imported flags change after commit,
unknown run counts backfill, mixed valid/inaccessible source IDs report partial failures, and
removal does not affect the original OpenAI evaluation. Check `$LASTEXITCODE` in PowerShell
or `$?` in Bash immediately after each command.

To test missing-key, invalid-key, forbidden, and unreachable states, use mocked tests or an
isolated test account with deliberately restricted configuration. Do not alter production keys.
