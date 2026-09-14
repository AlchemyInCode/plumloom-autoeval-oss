# @plumloom/cli

Deterministic, file-driven terminal client and MCP server for Plumloom Autoeval.

Licensed under Apache-2.0. This package is self-contained: it builds, tests, and runs on its own.

## Install

```bash
npm install -g @plumloom/cli
autoeval --help
```

Requires Node.js 22.13 or newer. To build from a checkout instead:

```bash
pnpm install --frozen-lockfile
pnpm --filter @plumloom/cli build
node packages/cli/dist/cli.js --help
```

## What is in this package

- Deterministic commands: `login`, `whoami`, `models`, `workspace`, `eval`, `status`, `results`,
  `gate`, `suite run`, `suite gate`
- File-driven eval inputs (`src/configured-run/file-inputs.ts`) and suite manifests
  (`src/suite/manifest.ts`)
- The file-driven guide (`src/guide/eval-guide.ts`): scope, file selection, run confirmation
- Rendering: tables, scorecards, markdown answers, progress, trends, digests
- The local stdio MCP server (`dist/mcp.js`)

## Release gating in CI

`suite gate` runs every eval in a manifest, compares the fetched results with the thresholds
declared in that manifest, and exits non-zero for any verdict other than `PASS`:

```bash
autoeval suite gate --manifest autoeval.suite.yaml
autoeval suite gate --manifest autoeval.suite.yaml --json
```

Eval decisions roll up with precedence `ERROR > FAIL > INCONCLUSIVE > PASS`, so an eval with no
configured threshold blocks the release as `INCONCLUSIVE` rather than passing silently. For a
single evaluation, `autoeval gate <evaluation-id>` applies flag-based thresholds instead.

## Documentation

- [Quickstart](https://github.com/plumloom-org/plumloom-autoeval/blob/main/docs/public/quickstart.md) —
  authenticate and run a first evaluation without copying UUIDs
- [Command guide](https://github.com/plumloom-org/plumloom-autoeval/blob/main/docs/public/commands.md) — every command,
  with file and suite examples
- [CLI reference](https://github.com/plumloom-org/plumloom-autoeval/blob/main/docs/public/cli-reference.md)
- [Release gating for CI](https://github.com/plumloom-org/plumloom-autoeval/blob/main/docs/public/release-gating.md)
- [Local MCP server](https://github.com/plumloom-org/plumloom-autoeval/blob/main/docs/public/mcp.md)
- [ADRs](https://github.com/plumloom-org/plumloom-autoeval/tree/main/docs/internal/adr)
- [Security policy](https://github.com/plumloom-org/plumloom-autoeval/blob/main/SECURITY.md)

## Extending the program

`src/run.ts` exports `runCli({ extend })`. A distribution that composes additional commands
supplies them through that hook; this package registers only the deterministic commands and
carries no knowledge of any other surface.

## Verification

```bash
pnpm --filter @plumloom/cli boundary:check
pnpm --filter @plumloom/cli build
pnpm --filter @plumloom/cli test
pnpm --filter @plumloom/cli package:check
```
