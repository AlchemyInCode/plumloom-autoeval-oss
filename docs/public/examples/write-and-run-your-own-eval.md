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

```text
NAME                    PROVIDER  MODEL ID                              FLAGS
DeepSeek V4 Flash 0731  together  55555555-5555-4555-8555-555555555555
DeepSeek V4 Pro 0813    together  44444444-4444-4444-8444-444444444444
GLM 5.2                 together  11111111-1111-4111-8111-111111111111
GLM 5.3                 together  22222222-2222-4222-8222-222222222222
GLM 5.3 Flash           together  33333333-3333-4333-8333-333333333333
Inkling FP4             together  88888888-8888-4888-8888-888888888888
Inkling Small           together  77777777-7777-4777-8777-777777777777
Kimi K3                 together  99999999-9999-4999-8999-999999999999
Llama 3.3 70B           together  aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
MiniMax M3              together  bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb
Muse Glimmer 30B        together  cccccccc-cccc-4ccc-8ccc-cccccccccccc
Qwen3.8 2.4T A95B       together  66666666-6666-4666-8666-666666666666

Showing 12 models
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

```text
Valid scenario evaluation input
Judge: Llama 3.3 70B (aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa)
Primary: GLM 5.3 Flash (33333333-3333-4333-8333-333333333333)
Scenarios: 1
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
  "runsPerScenario": 3,
  "evaluatorInstructions": "..."
}
```

- Leave it out (single-run) while you iterate on the prompt or the rubric. It is fast and cheap.
- Set it above `1` (multi-run) for any evaluation you will gate a release on. More runs do not make
  the score stable. They give you the evidence to judge whether it is stable: the run-to-run
  variation and a 95% confidence interval. `autoeval suite gate` then compares that interval with
  your threshold instead of trusting one run.

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

```text
Created "Basic factual questions" (dddddddd-dddd-4ddd-8ddd-dddddddddddd) from freezing-point.autoeval.json
  Run eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee finished in 4s

  Fetch the results with:
    autoeval results dddddddd-dddd-4ddd-8ddd-dddddddddddd eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee

  Add --json for machine-readable output.
```

The evaluation is titled "Basic factual questions" because the file has no `evaluationName`, so
Autoeval uses its `contextName`. Add `"evaluationName"` to the `configuration` block to choose the
title yourself.

`create-from` does not print the scores. Read them with the command it prints:

```bash
autoeval results <evaluation-id> <run-id>
```

A multi-run result adds the reliability evidence to the scorecard: a 95% confidence interval for
each score, the coefficient of variation (CV) against the consistency target, and a stability
label. This is the same file with `"runsPerScenario": 3`:

```text

█ █     ███ ███
█ █     █ █   █
███     █ █ ███
  █     █ █   █
  █  █  ███ ███  / 5 overall · stable
95% CI 4.03–4.03 · CV 0.00 (target <0.10)
────────────────────────────────────────────────────────────────────────────────────────────────────
Context  scenario · GLM 5.3 Flash (primary) · 1 test case · 2 runs · 3 metrics

RUBRIC FIT
METRIC                       MEAN    95% CI
factuality                   4.30     ±0.00
fluency                      4.20     ±0.00
relevance                    3.60     ±0.00
overall                      4.03     ±0.00

TEST CASES
TEST CASE                    MEAN    95% CI
Freezing point               4.03     ±0.00

BEST RESPONSE
GLM 5.3 Flash · run 3 · scored 4.03 / 5
"At standard atmospheric pressure, what is the freezing point of pure water in degrees Celsius?"  →
"The freezing point of pure water at standard atmospheric pressure is 0 °C (32 °F)."
factuality 4.3 · fluency 4.2 · relevance 3.6
100 tokens · $0.0005 · 3.3s  (this run)

2 runs
best run per test case: 100 tokens · $0.0005 · 3.3s model time

--show-outputs for full responses · --json for the raw payload
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
