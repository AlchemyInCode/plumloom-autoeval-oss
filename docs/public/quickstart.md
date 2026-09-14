# Autoeval quickstart

From a Plumloom CLI key to a finished evaluation result in three commands. Requires Node.js 22.13
or newer.

## 1. Build from this repository

The package is not currently published to npm.

```bash
pnpm install --frozen-lockfile
pnpm --filter @plumloom/cli build
node packages/cli/dist/cli.js --help
```

The examples below use `autoeval` for readability. Replace it with
`node packages/cli/dist/cli.js` when running from the checkout. To use the short command, link the
local build once from `packages/cli` and rebuild after pulling changes.

## 2. Authenticate

```bash
export AUTOEVAL_API_BASE_URL="<autoeval-api-origin>"
autoeval login
```

`AUTOEVAL_API_BASE_URL` is required and has no built-in default. `login` accepts a `pl_sk_…` key.
For non-interactive use, set `AUTOEVAL_API_KEY` in the
environment or pass `autoeval login --key "$AUTOEVAL_API_KEY"`. The key is stored in the OS
credential store only after Plumloom validates it and is never printed.

## 3. Run your first evaluation

```bash
autoeval quickstart
```

That single command resolves your workspace and judge model, grades a bundled recorded agent
trajectory, waits for it to finish, and prints the result. No UUID copy-paste is needed in the
normal path.

- **Sample** — the default is an agent trace: a recorded run of a tool-using agent. It is graded by
  the judge alone, so there is no model under test to choose.
- **Workspace** — if you have one, it is used. With several, you pick from a numbered list, or pass
  `--workspace <workspace-id>`. Quickstart never invents a default workspace and never creates a
  demo workspace. With no workspace, run `autoeval workspace create --name "My workspace"`.
- **Judge model** — a single enabled model is selected automatically. With several, quickstart uses
  its curated fast-model preferences, then asks you to choose if no preference is available.
- **Scenario instead** — `autoeval quickstart --sample scenario` calls a model under test and
  grades its answer. A single enabled model is selected automatically; otherwise the same curated
  preference and picker rules apply.
- **Overrides** — pin the choices with `--judge-model-id`, `--primary-model-id`, or
  `--workspace`.
- **Non-interactive** — `--yes`, `--json`, and non-TTY sessions never prompt; they fail with the
  flag required to resolve an ambiguous choice.
- **Your own file** — `autoeval quickstart --input my-eval.json`.

The evaluation is saved as `Quickstart Baseline - <timestamp>`, and the output includes a
ready-to-run `autoeval results` command.

## 4. Read the result again

```bash
autoeval results <evaluation-id> <run-id>
autoeval --json results <evaluation-id> <run-id>
```

Human output is a scorecard; `--json` carries the full reliability detail and validated backend
payload. Use `autoeval status <evaluation-id> <run-id>` while a run is still in progress.

For a custom release policy, use `autoeval --json results` to [build your own gate over the
structured evaluation evidence](./release-gating.md#custom-gates-from-json-results).

## Run an eval file yourself

Once past the first result, drive evaluations from files you keep in version control:

```bash
autoeval workspace list
autoeval models
autoeval eval validate --input examples/evals/scenario-basic.json

autoeval eval create-from \
  --workspace <workspace-id> \
  --input examples/evals/scenario-basic.json \
  --judge-model-id <model-uuid> \
  --primary-model-id <model-uuid> \
  --run
```

The model override flags are needed for public samples because they carry synthetic placeholder
UUIDs. Files containing your own enabled model UUIDs need neither flag. `runsPerScenario` is
validated as an integer from 1 to 10, preserved, and sent to the API as `runs_per_scenario`; it
defaults to 1 when omitted. Legacy `autoStopEnabled` is accepted for compatibility but ignored and
not forwarded; automatic stopping is controlled by the evaluation service.

## Go deeper

- [Command guide](./commands.md) — commands in task order
- [CLI reference](./cli-reference.md) — options, output, and exit codes
- [Release gating for CI](./release-gating.md) — `autoeval gate` and `autoeval suite gate`
- [MCP server](./mcp.md) — the same action layer over stdio
- [Examples](../../examples)
- [Troubleshooting](../../TROUBLESHOOTING.md)
