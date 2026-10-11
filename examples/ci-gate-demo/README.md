# PASS and FAIL CI gate demonstration

These two suite manifests apply the same release criteria to two frozen, synthetic agent traces:

- `pass.suite.yaml` references `../evals/agent-trace-basic.json`, where the agent uses a weather
  lookup result in its response.
- `fail.suite.yaml` references `../evals/agent-trace-bad-decision.json`, where the agent claims a
  reservation succeeded after the tool reports that it failed.

Both require `factuality >= 4.0` and `helpfulness >= 4.0`. Their committed workspace and judge-model
IDs are synthetic. Supply real, accessible IDs at runtime instead of editing the fixtures:

```bash
export AUTOEVAL_WORKSPACE_ID=<workspace-id>
export AUTOEVAL_JUDGE_MODEL_ID=<enabled-model-id>

autoeval doctor \
  --manifest examples/ci-gate-demo/pass.suite.yaml \
  --workspace "$AUTOEVAL_WORKSPACE_ID" \
  --judge-model-id "$AUTOEVAL_JUDGE_MODEL_ID"

autoeval suite gate \
  --manifest examples/ci-gate-demo/pass.suite.yaml \
  --workspace "$AUTOEVAL_WORKSPACE_ID" \
  --judge-model-id "$AUTOEVAL_JUDGE_MODEL_ID"

autoeval suite gate \
  --manifest examples/ci-gate-demo/fail.suite.yaml \
  --workspace "$AUTOEVAL_WORKSPACE_ID" \
  --judge-model-id "$AUTOEVAL_JUDGE_MODEL_ID"
```

The FAIL command exits `1` when either metric misses its threshold. A PASS is not guaranteed on
every run: pinning the CLI prevents CLI-version drift, but model and judge behavior can still vary.
Use the same enabled judge model for both manifests when comparing the two traces.

## Copy one demonstration into an adopter repository

The generic workflow reads `evals/autoeval.suite.yaml`. Copy
`.github/workflows/autoeval-suite-gate.yml.example` to
`.github/workflows/autoeval-suite-gate.yml`, then copy one matching manifest and fixture pair:

| Verdict | Copy from                                      | Copy to                               |
| ------- | ---------------------------------------------- | ------------------------------------- |
| PASS    | `examples/ci-gate-demo/pass.suite.yaml`        | `evals/autoeval.suite.yaml`           |
| PASS    | `examples/evals/agent-trace-basic.json`        | `evals/agent-trace-basic.json`        |
| FAIL    | `examples/ci-gate-demo/fail.suite.yaml`        | `evals/autoeval.suite.yaml`           |
| FAIL    | `examples/evals/agent-trace-bad-decision.json` | `evals/agent-trace-bad-decision.json` |

The source manifests refer to fixtures relative to `examples/ci-gate-demo/`. After copying, update
the one `evals` entry to be relative to the adopter's `evals/` directory:

```yaml
# PASS
evals:
  - ./agent-trace-basic.json

# FAIL
evals:
  - ./agent-trace-bad-decision.json
```

Configure the required secret and repository variables documented at the top of
[`autoeval-suite-gate.yml.example`](../../.github/workflows/autoeval-suite-gate.yml.example).
`AUTOEVAL_PRIMARY_MODEL_ID` is optional and should remain unset for these agent-trace suites. If a
different suite contains scenario evaluations with primary-model IDs that need replacement, set it
to an enabled model ID; the workflow then passes `--primary-model-id` to both pre-flight and the
release gate.
