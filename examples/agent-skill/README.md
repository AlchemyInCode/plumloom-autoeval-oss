# Agent skill examples

Three suite manifests that show the verdicts the Autoeval agent skill reports. They reuse the
sanitized conversation fixtures in `../evals/`, so there are no new fixtures to keep in sync.

| Manifest                  | Eval file                   | Gate                                                          | Verdict        | Exit                            |
| ------------------------- | --------------------------- | ------------------------------------------------------------- | -------------- | ------------------------------- |
| `pass.suite.yaml`         | `conversation-success.json` | `factuality ≥ 3.5`, `completeness ≥ 3.5`, `helpfulness ≥ 3.5` | `PASS`         | `0`                             |
| `fail.suite.yaml`         | `conversation-failure.json` | `completeness ≥ 3.5`, `helpfulness ≥ 3.5`                     | `FAIL`         | `1` (`SUITE_GATE_FAIL`)         |
| `inconclusive.suite.yaml` | `conversation-success.json` | none                                                          | `INCONCLUSIVE` | `1` (`SUITE_GATE_INCONCLUSIVE`) |

PASS gates factuality as well as completeness and helpfulness. Its transcript states that the class
is two weeks away, keeps the existing confirmation number without inventing its value, and follows
the reference guide's fee, schedule and email rules. FAIL demonstrates the original completeness
and helpfulness policy against a transcript that contradicts its guide. INCONCLUSIVE has no
threshold at all, and Autoeval never treats that as a pass.

## Pre-flight

The workspace in these manifests and the judge model ID in the fixtures are synthetic placeholders,
so `doctor` needs the same overrides the gate will use. Copy an enabled judge UUID from
`autoeval models`:

```bash
autoeval models
autoeval doctor --manifest examples/agent-skill/pass.suite.yaml \
  --workspace "$WORKSPACE_ID" \
  --judge-model-id "$JUDGE_MODEL_ID"
```

`doctor` is read-only. With the two overrides it reports five passing checks (auth, manifest,
workspace, models, eval file) and exits `0`. Without them it reports the placeholder workspace and
judge ID as not found and exits `2`, by design: the files stay portable, and the skill stops on a
failed `doctor` instead of editing them.

## Run them

Each run creates an evaluation and a run in your workspace and uses evaluation credits:

```bash
autoeval --json suite gate --manifest examples/agent-skill/pass.suite.yaml \
  --workspace "$WORKSPACE_ID" \
  --judge-model-id "$JUDGE_MODEL_ID"
```

Use `fail.suite.yaml` or `inconclusive.suite.yaml` the same way.

## With the skill installed

Ask your coding agent, from the repository root:

- "Run the agent-skill pass example and tell me the verdict."
- "Run the fail example. What failed?"
- "Run the inconclusive example and explain why it's inconclusive."

The skill should name the command and what it creates before each run, then report the verdict
token, the exit code, and the evaluation and run IDs.

## Notes

- PASS and FAIL depend on the judge model's scores. The runs recorded for this repository, with the
  judge model used, are in [the agent skill integration guide](../../docs/public/integration-agent-skill.md).
- `inconclusive.suite.yaml` still runs its evaluation before the gate reports `INCONCLUSIVE`,
  because `doctor` does not check threshold coverage yet.
