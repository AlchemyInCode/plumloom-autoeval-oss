# Work Package B: demo and onboarding validation

Validated on 2026-10-10 with `@plumloom/cli@0.1.3`. This report records the sanitized evidence from
five paid backend evaluation runs. No private credentials, account identifiers, run identifiers, or
repository links are included.

## Scope and configuration

The demonstration used the committed, unchanged fixtures:

- `examples/evals/agent-trace-basic.json`
- `examples/evals/agent-trace-bad-decision.json`

Both were evaluated with the same enabled judge, **GLM 5.3 Flash (Together)**, selected at runtime.
Both gates required `factuality >= 4.0` and `helpfulness >= 4.0`. The public files retain synthetic
IDs; a real workspace and judge-model ID were supplied as runtime overrides.

The five-run budget was fully used:

1. Local good-trace evaluation.
2. Local bad-decision-trace evaluation.
3. First CI good-trace evaluation.
4. CI bad-decision-trace evaluation.
5. CI good-trace retry.

No sixth run is part of this validation.

## Reproducible commands

Enter the CLI key only at the masked `autoeval login` prompt. Do not pass it as an argument. If an
invalid environment variable would override the stored credential, remove it from the current shell
first:

```bash
unset AUTOEVAL_API_KEY
export AUTOEVAL_WORKSPACE_ID=<workspace-id>
export AUTOEVAL_JUDGE_MODEL_ID=<enabled-judge-model-id>

autoeval login
autoeval whoami
autoeval workspace list
autoeval models

autoeval doctor \
  --workspace "$AUTOEVAL_WORKSPACE_ID" \
  --judge-model-id "$AUTOEVAL_JUDGE_MODEL_ID" \
  --input examples/evals/agent-trace-basic.json \
  --input examples/evals/agent-trace-bad-decision.json
```

Run and gate each fixture with the same judge and thresholds:

```bash
autoeval --json eval create-from \
  --workspace "$AUTOEVAL_WORKSPACE_ID" \
  --input examples/evals/agent-trace-basic.json \
  --judge-model-id "$AUTOEVAL_JUDGE_MODEL_ID" \
  --run
autoeval results <evaluation-id> <run-id>
autoeval gate <evaluation-id> \
  --metric factuality=4.0 \
  --metric helpfulness=4.0

autoeval --json eval create-from \
  --workspace "$AUTOEVAL_WORKSPACE_ID" \
  --input examples/evals/agent-trace-bad-decision.json \
  --judge-model-id "$AUTOEVAL_JUDGE_MODEL_ID" \
  --run
autoeval results <evaluation-id> <run-id>
autoeval gate <evaluation-id> \
  --metric factuality=4.0 \
  --metric helpfulness=4.0
```

For a suite-based replay, use the manifests in `examples/ci-gate-demo/` and the commands in their
README. These commands submit paid evaluations; do not run them merely to validate the files.

## Sanitized evidence

The local good trace passed with exit code `0`:

```text
overall       4.34
factuality    4.34  (required >= 4.00)  PASS
helpfulness   4.20  (required >= 4.00)  PASS
relevance     4.48
trajectory    4.90
agreement     2/2
Gate: PASS
```

The local bad-decision trace failed with exit code `1`:

```text
overall       1.54
factuality    1.40  (required >= 4.00)  FAIL
helpfulness   2.33  (required >= 4.00)  FAIL
completeness  1.88
safety        2.04
trajectory    3.00
agreement     2/2
Gate: FAIL
```

In the isolated CI demonstration, the bad-decision suite failed as intended (`factuality 1.54`,
`helpfulness 2.33`; suite exit code `1`). The first good-trace CI attempt also exited `1` because
factuality scored `3.94`, just below the `4.00` threshold. The one authorized retry exited `0` with
overall `4.34`, factuality `4.34`, helpfulness `4.20`, relevance `4.48`, trajectory `4.90`, and
agreement `2/2`. The resulting CI checks showed one successful good-trace gate and one failed
bad-decision gate. Both demonstration pull requests remain open as drafts and were not merged.

The `3.94` and `4.34` factuality observations illustrate that evaluation scores can vary between
runs even when the fixture, judge model, rubric, and threshold are unchanged. Two observations are
not statistical proof of judge instability and do not estimate the frequency or distribution of
that variability. The `2/2` agreement value describes judges within a run; it is not a multi-run
confidence interval.

## Onboarding result

**Clean-environment onboarding validation is incomplete.** Authentication, workspace access, the
enabled-model catalog, pre-flight validation, result inspection, and gating were exercised. The full
documented install → authenticate → quickstart → inspect-results path was not completed in a fresh,
isolated environment, and no reliable end-to-end setup time was recorded. Completing it would
require another paid quickstart evaluation, which is outside the five-run authorization.

Observed friction:

- A stale `AUTOEVAL_API_KEY` environment variable can override a valid key stored by the login
  command; removing the stale variable restored stored-credential authentication.
- Public fixtures intentionally contain synthetic IDs, so real workspace and enabled judge-model
  IDs must be provided with runtime overrides.
- A score close to a hard threshold can change a single-run gate verdict. CLI pinning controls
  tool-version drift, not model or judge variability.

## 45–60-second recording script

- **0–7 seconds:** Show the two unchanged agent-trace fixtures. Say: “These are frozen synthetic
  traces: one uses a tool result correctly, and one claims success after a failed reservation.”
- **7–16 seconds:** Show the paired suite manifests. Say: “Both use the same factuality and
  helpfulness thresholds. The real workspace and judge IDs are runtime variables, never committed.”
- **16–27 seconds:** Show the successful pre-flight and good-trace output. Say: “Pre-flight checks
  access and configuration before a paid run. This trace passed with factuality 4.34 and helpfulness
  4.20.”
- **27–38 seconds:** Show the bad-decision output. Say: “The bad trace scored 1.40 factuality and
  2.33 helpfulness, so the gate exited nonzero and can block a release.”
- **38–49 seconds:** Show the sanitized CI check summaries. Say: “The copied workflow produced a
  green check for the good trace and a red check for the bad decision.”
- **49–58 seconds:** Show the `3.94` and `4.34` observations. Say: “Pinning the CLI prevents version
  drift, but scores can still vary. This pair illustrates variability; it is not statistical proof
  of judge instability.”

## Recommendations and remaining work

- Keep both private demonstration pull requests open as drafts for review; do not merge them into a
  repository intended only for demonstrations.
- Use repository variables for the workspace and judge-model runtime overrides, and a repository
  secret for the CLI key.
- Treat a single result close to a threshold cautiously. For scenario evaluations, use multiple
  trials and confidence-interval-aware suite criteria when the decision needs reliability evidence.
- Complete the clean-environment onboarding timing in a separately authorized run budget before
  claiming a verified setup time.
