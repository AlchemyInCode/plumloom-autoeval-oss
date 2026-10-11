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

For GitHub Actions, copy
[`autoeval-suite-gate.yml.example`](../../.github/workflows/autoeval-suite-gate.yml.example), commit
the manifest and referenced fixture, and configure the secret and repository variables documented
at the top of that workflow.
