# Contributing to Plumloom Autoeval

Thank you for helping improve Autoeval. Keep changes focused, reviewable, and secure at every input and network boundary.

## Prerequisites

- Node.js 22.13 or newer
- pnpm 11

Install the locked dependencies:

```bash
pnpm install --frozen-lockfile
```

## Before making changes

Read `AGENTS.md`, `CODING_STANDARDS.md`, `README.md`, and the relevant files under `docs/`. Consequential changes to authentication, public interfaces, dependencies, network boundaries, data models, or operating cost require an approved plan and an ADR under `docs/internal/adr/`.

Evaluation and account actions may call only the configured Autoeval API. Do not add direct
model-provider or evaluation-service integrations, and do not invent an API endpoint to complete a
client feature.

## Development guidelines

- Use strict TypeScript and avoid `any`.
- Validate CLI input and every external payload at its trust boundary.
- Keep command parsing, shared actions, transport, polling, domain values, credentials, and rendering separate.
- Preserve existing public names and behavior unless a breaking change is explicitly approved.
- Do not add a dependency when Node or an existing maintained dependency solves the need clearly.
- Never commit a real credential, private payload, or production data.
- Keep normal tests deterministic and network-free.

Use `apply_patch` or focused edits; do not reformat unrelated files.

## Required checks

Run all checks before requesting review:

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm boundary:check
pnpm package:check
pnpm audit
```

Tests must cover success, failure, validation, permission/security behavior, and regressions relevant to the change. Mock API responses for normal tests.

## Live smoke tests

The optional live test targets the shell-provided Autoeval API origin and runs only when both
`AUTOEVAL_API_BASE_URL` and `AUTOEVAL_API_KEY` are already present:

```bash
pnpm test:live
```

Never place a key in a test file, fixture, command-line option, committed `.env`, log, or issue. The live test must not save the environment credential.

## Pull requests

Describe:

- what changed and why;
- files and public behavior affected;
- commands run and actual results;
- security-relevant decisions;
- known limitations or required API gaps.

Do not weaken tests, validation, authentication, redaction, resource bounds, or error handling to make a check pass.
