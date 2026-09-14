# Test data

Fixtures for manual testing of eval files. Nothing here is required by the CLI at runtime.

Workspace identifiers here are **synthetic placeholders** — repeated-character UUIDs such
as `ffffffff-ffff-4fff-8fff-ffffffffffff`. Substitute a workspace from your own account
(`autoeval workspace list`) before running anything.

Model ID fields are UUID-only. Public eval files use synthetic UUID placeholders so account-specific
IDs are never committed. Run `autoeval models`, then pass `--judge-model-id <uuid>` and, for
scenario evals, `--primary-model-id <uuid>` to `eval create-from`, `suite run`, or `suite gate`.
Overrides are validated against the enabled catalog and applied in memory; fixture files stay unchanged.

## `sample-workspace.json`

A placeholder workspace to target when running the evals below:

| Field          | Value                                  |
| -------------- | -------------------------------------- |
| Workspace name | `EXAMPLE-WORKSPACE`                    |
| Workspace ID   | `ffffffff-ffff-4fff-8fff-ffffffffffff` |

Pass your own workspace on the CLI: `--workspace <workspace-id>`.

## `models.json`

Model catalog entries used while testing, with placeholder IDs. Copy an `id` into an
eval file's `configuration.primaryModelId`, `configuration.comparisonModelIds`, or
`methodology.judgeModelId`, then swap it for a real ID from `autoeval models`.

| Name                   | Provider | Model ID                               |
| ---------------------- | -------- | -------------------------------------- |
| GLM 5.2                | together | `11111111-1111-4111-8111-111111111111` |
| GLM 5.3                | together | `22222222-2222-4222-8222-222222222222` |
| GLM 5.3 Flash          | together | `33333333-3333-4333-8333-333333333333` |
| DeepSeek V4 Pro 0813   | together | `44444444-4444-4444-8444-444444444444` |
| DeepSeek V4 Flash 0731 | together | `55555555-5555-4555-8555-555555555555` |
| Qwen3.8 2.4T A95B      | together | `66666666-6666-4666-8666-666666666666` |
| Inkling Small          | together | `77777777-7777-4777-8777-777777777777` |
| Inkling FP4            | together | `88888888-8888-4888-8888-888888888888` |
| Kimi K3                | together | `99999999-9999-4999-8999-999999999999` |
| Llama 3.3 70B          | together | `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa` |
| MiniMax M3             | together | `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb` |
| Muse Glimmer 30B       | together | `cccccccc-cccc-4ccc-8ccc-cccccccccccc` |

Deprecated models (the older DeepSeek V4 Pro build, Kimi K2.6, Kimi K2.7 Code,
nemotron-3-ultra-550b, GLM 5.1, Qwen3-32B) have been removed from this catalog.

Availability depends on your API key: run `autoeval models` to confirm which of
these are enabled for your account before using them in a run.

## `evals-sample.json`

A bulk fixture of 93 sample configured-run evals (31 scenario, 31 conversation,
31 agent_trace) converted from a platform export. Model IDs reference
`models.json` above: **GLM 5.2** is the judge for every eval, and scenario
primary models cycle through the remaining together-provider models.

Each entry in the `evals` array is a standalone configured-run object that the
CLI accepts — extract one to its own file and run it:

```bash
# Pull the first scenario eval into its own file, then validate / run it
jq '.evals[0]' examples/reference/evals-sample.json > /tmp/eval.json
autoeval eval validate --input /tmp/eval.json
autoeval eval create-from --workspace <workspace-id> --input /tmp/eval.json \
  --judge-model-id <judge-model-uuid> --primary-model-id <primary-model-uuid> --run
```

Eval files carry no account identity; the CLI derives it from your
authenticated session, so point them at a workspace of your own. Scenario evals use the legacy scenario shape
(`primaryModelId`, `promptText`, `scenarios`); conversation and agent_trace
evals use the normalized `contextType` + `artifact` shape.
