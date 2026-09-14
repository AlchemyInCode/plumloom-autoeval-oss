# Examples

Runnable, sanitized examples for the Plumloom Autoeval CLI. Every identifier here is a synthetic
placeholder — pass your own workspace and model UUIDs on the command line.

```
examples/
├── evals/         runnable eval files, one per context type
├── suite/         suite manifest for CI release gating
├── smoke/         end-to-end reference script and its fixtures
├── integrations/  third-party wiring (DeepSeek Harness via MCP)
├── quality-standards/  quality-standard input examples
└── reference/     placeholder catalogs: models, workspace, bulk eval export
```

## `evals/` — start here

| File                                | Context type | Shows                                     |
| ----------------------------------- | ------------ | ----------------------------------------- |
| `scenario-basic.json`               | scenario     | one prompt, judged against a rubric       |
| `scenario-grounded.json`            | scenario     | reference documents supplied to the judge |
| `scenario-model-comparison.json`    | scenario     | one prompt across comparison models       |
| `scenario-purchasing-checkout.json` | scenario     | a longer, domain-specific rubric          |
| `conversation-success.json`         | conversation | a multi-turn transcript that goes well    |
| `conversation-failure.json`         | conversation | the same shape, with weak agent behavior  |
| `agent-trace-basic.json`            | agent_trace  | a recorded tool-using trajectory          |
| `agent-trace-bad-decision.json`     | agent_trace  | a trajectory with a bad tool decision     |

Run one:

```bash
autoeval eval create-from \
  --workspace <workspace-id> \
  --input examples/evals/scenario-basic.json \
  --judge-model-id <model-uuid> \
  --primary-model-id <model-uuid> \
  --run
```

The two model flags are needed for these public files only, because they carry placeholder model
UUIDs. Copy enabled UUIDs from `autoeval models`.

## `suite/` — CI release gating

```bash
autoeval suite gate --manifest examples/suite/autoeval.suite.yaml \
  --workspace <workspace-id> \
  --judge-model-id <model-uuid> \
  --primary-model-id <model-uuid>
```

See [Release gating](../docs/public/release-gating.md).

## `smoke/` — end-to-end reference script

`smoke/smoke.sh` and `smoke/smoke.ps1` walk auth → workspace → one evaluation per context type →
results, using the fixtures in `smoke/fixtures/`. They are reference implementations, not product
features.

## `quality-standards/` — workspace evaluation policy

`quality-standards/qs-basic.json` is a synthetic binary-anchor input for `autoeval qs create`.

## `reference/` — placeholder catalogs

Model catalog, sample workspace record, and a bulk eval export used while testing. See
[`reference/README.md`](./reference/README.md).
