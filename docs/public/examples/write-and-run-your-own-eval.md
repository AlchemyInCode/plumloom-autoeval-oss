# Example 2: Write and run your own evaluation file

**When you are done**, you have an evaluation file of your own that passes validation, a created
evaluation in your workspace, and a scored run. The file is the thing you commit and review, so this
is the loop you repeat every time you add or change an evaluation.

**Needs:** an installed and configured CLI (steps 1 to 3 of the [quickstart](../quickstart.md)) and
a workspace ID (`autoeval workspace list`).

---

## 1. Start from a working file

Copy the smallest scenario example:

```bash
cp examples/evals/scenario-basic.json ./freezing-point.autoeval.json
```

The file has two blocks:

```json
{
  "methodology": {
    "judgeModel": "GLM 5.2",
    "judgeModelId": "11111111-1111-4111-8111-111111111111",
    "evaluatorInstructions": "Score factual accuracy, relevance, and clarity. Penalize unsupported details."
  },
  "configuration": {
    "contextName": "Basic factual questions",
    "primaryModelId": "22222222-2222-4222-8222-222222222222",
    "comparisonModelIds": [],
    "promptText": "Answer the user's factual question directly in one or two sentences.",
    "scenarios": [
      {
        "id": "basic-qa-1",
        "name": "Freezing point",
        "prompt": "At standard atmospheric pressure, what is the freezing point of pure water in degrees Celsius?",
        "expected": "The answer states 0 degrees Celsius."
      }
    ],
    "referenceDocuments": [],
    "selectedMetrics": ["factuality", "relevance", "fluency"],
    "temperatureContext": 0
  }
}
```

- **`methodology`** is how the answer is graded: the judge model and its instructions.
- **`configuration`** is what is tested: the model under test (`primaryModelId`), the system prompt,
  the scenarios, and the metrics.

## 2. Put in real model IDs

The two UUIDs above are synthetic placeholders. Every public example uses them, so no real
identifier is ever committed. Replace them with models your account has enabled:

```bash
autoeval models
```

<!-- M3-PENDING-KEY: paste a real (redacted if needed) `autoeval models` output here. -->

```text
OUTPUT PENDING: captured from a real run before this page ships.
```

You can edit the file, or keep the placeholders and override them on the command line with
`--judge-model-id` and `--primary-model-id`. Editing the file is better for an evaluation you will
commit, because the file then records which models it was graded with.

Choose **different** models for the judge and the model under test. A model cannot grade its own
answers (see step 3).

## 3. Validate before you run

```bash
autoeval eval validate --input ./freezing-point.autoeval.json
```

Validation creates nothing and runs nothing. It checks the file structure, and it fetches your
enabled models to confirm every model ID in the file. That is why it needs a CLI key, even though
it does not start a run.

<!-- M3-PENDING-KEY: paste the real passing `eval validate` output here. -->

```text
OUTPUT PENDING: captured from a real run before this page ships.
```

When validation fails, the command exits with code `2` and names the problem. These are the
messages you are most likely to see:

| Problem                                         | Message                                                                                                                                      |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| A model ID is not enabled for your account      | `Judge model ID <uuid> is not enabled for this account. Run "autoeval models" and choose an enabled model ID` (or `Primary model ID ...`)    |
| The judge and the model under test are the same | `The judge model cannot also be the primary model. Choose a different model ID for that role`                                                |
| A required block is missing or malformed        | `Configured run input is invalid: configuration: Invalid input. Fix the listed fields and run "autoeval eval validate --input <file>" again` |

A file that still has the placeholder UUIDs fails on the first row, because the placeholders are not
real models. Validation checks the judge first, so the message names the judge.

## 4. Choose single-run or multi-run

For a scenario evaluation, decide how many trials to run. Add `runsPerScenario` to the
`methodology` block:

```json
"methodology": {
  "judgeModel": "...",
  "judgeModelId": "...",
  "runsPerScenario": 5,
  "evaluatorInstructions": "..."
}
```

- Leave it out (single-run) while you iterate on the prompt or the rubric. It is fast and cheap.
- Set it above `1` (multi-run) for any evaluation you will gate a release on. Autoeval then reports
  the run-to-run variation, and the gate compares a 95% confidence interval with your threshold
  instead of trusting one run.

The [quickstart](../quickstart.md#6-run-it-single-run-or-multi-run) explains how the gate reads each
mode.

## 5. Create and run it

```bash
autoeval eval create-from \
  --workspace <workspace-id> \
  --input ./freezing-point.autoeval.json \
  --run
```

With `--run`, `create-from` validates the file again, creates the evaluation, starts a run, and
waits for the result. Because it validates first, a bad file fails before anything is created.

Without `--run`, `create-from` only creates the evaluation, and it does **not** validate the file.
Always run `eval validate` first if you create without `--run`. You can start the run later with
`autoeval run <evaluation-id>`.

<!-- M3-PENDING-KEY: paste the real `eval create-from --run` output here, single-run and multi-run. -->

```text
OUTPUT PENDING: captured from a real run before this page ships.
```

Then read the result, as in [Example 1](./grade-a-recorded-agent-trace.md#2-read-the-scorecard):

```bash
autoeval results <evaluation-id> <run-id>
```

## What most often goes wrong

**You run a public example file as it is.** Every file under `examples/` carries synthetic model
UUIDs. This is on purpose: public files never contain a real identifier. Until you replace the IDs,
or pass `--judge-model-id` and `--primary-model-id`, the file fails:

- `eval validate` reports that the judge model ID is not enabled for this account.
- `eval create-from --run` and `suite` stop earlier, with exit code `2` and this message:

```text
This eval file contains a synthetic judge model UUID. Run "autoeval models" and pass --judge-model-id <uuid>
```

## Next

- [Example 3: Gate a release in CI](./gate-a-release-in-ci.md)
