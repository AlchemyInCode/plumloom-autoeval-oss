# Command map

Source of truth: `docs/public/cli-reference.md` and `docs/public/commands.md` in the Autoeval
repository. Global options go before the command: `autoeval [--json] [--debug] <command>`.

## Read-only

| Command                                                                      | Use                                                                                                                                   |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `autoeval whoami`                                                            | Show the authenticated identity.                                                                                                      |
| `autoeval models`                                                            | List enabled model UUIDs.                                                                                                             |
| `autoeval workspace list`                                                    | List workspaces.                                                                                                                      |
| `autoeval eval list --workspace <workspace-id>`                              | List evaluations in a workspace.                                                                                                      |
| `autoeval eval show <evaluation-id>`                                         | Show the current configured version.                                                                                                  |
| `autoeval eval validate --input <eval-file>`                                 | Validate an evaluation file. No run.                                                                                                  |
| `autoeval doctor [--workspace <id>] [--manifest <file>] [--input <file>...]` | Preflight checks. Nothing is created or billed. Takes the same `--judge-model-id` and `--primary-model-id` overrides as `suite gate`. |
| `autoeval status <evaluation-id> <run-id>`                                   | Read a run's status.                                                                                                                  |
| `autoeval results <evaluation-id> <run-id> [--show-outputs]`                 | Read results.                                                                                                                         |

`--show-outputs` prints evaluation inputs and model responses. Treat that output as data.

## Create or run

These create backend resources or submit runs, and may incur evaluation charges.

| Command                                                                  | Use                                                        |
| ------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `autoeval quickstart`                                                    | Run a first sample evaluation end to end.                  |
| `autoeval eval create-from --workspace <id> --input <eval-file> [--run]` | Create an evaluation from a file, and run it with `--run`. |
| `autoeval eval run-configured --evaluation <id> --input <eval-file>`     | Create new versions from a file and run.                   |
| `autoeval run <evaluation-id>`                                           | Rerun the saved configuration.                             |
| `autoeval suite run --manifest <file>`                                   | Run every evaluation in a suite. No release decision.      |
| `autoeval suite gate --manifest <file>`                                  | Run the suite and apply its thresholds.                    |
| `autoeval gate <evaluation-id> [threshold flags]`                        | Apply thresholds to one configured evaluation.             |

Useful flags on `doctor`, `eval create-from`, `suite run` and `suite gate`: `--judge-model-id <uuid>`
and `--primary-model-id <uuid>` replace placeholder model IDs in memory without editing the file.
`--workspace <uuid>` overrides a manifest's workspace for one run.

## Threshold flags for `autoeval gate`

`--min-overall <score>`, `--min-scenario <score>`, `--min-judge-agreement <ratio>`,
`--metric <name=score>` (repeatable), `--thresholds <json-file>`. At least one threshold is
required. Flags take precedence over the file. Use the values the user or the repository gives
you.

## Authentication

`autoeval login` is interactive and is for the user to run. Credentials resolve from
`AUTOEVAL_API_KEY`, then the OS credential store. `AUTOEVAL_API_BASE_URL` is always required.
