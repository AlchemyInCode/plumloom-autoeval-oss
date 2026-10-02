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
- **`configuration`** defines the evaluation inputs and the scoring setup for the model under test:
  the primary model (`primaryModelId`), the prompt, the scenarios (test cases), the selected
  metrics, and related context settings.

## 2. Put in real model IDs

The two UUIDs above are synthetic placeholders. The public examples use synthetic model IDs so they
stay portable and are not tied to a specific Plumloom account or enabled-model configuration.
Replace them with models your account has enabled:

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

You can edit the file, or keep the placeholders and pass `--judge-model-id` and
`--primary-model-id` to the commands that accept them (`eval create-from`, `suite run`, and
`suite gate`). `eval validate` does not accept these overrides, so replace the IDs in the file
before you validate. Editing the file is better for an evaluation you will commit, because the file
then records which models the evaluation is configured to use.

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

## 4. Choose how many trials to run

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

- **A single trial** (`runsPerScenario: 1`, the default) gives one point-in-time score, with no
  trial-to-trial reliability evidence. It is faster and cheaper during development, and it is also a
  valid choice when a team accepts a point estimate. A release gate on a single trial compares that
  one score with the threshold.
- **Multiple trials** (`runsPerScenario` above `1`) give you reliability evidence across trials, and
  they let `autoeval suite gate` compare a 95% confidence interval with your threshold instead of
  one sample. More trials do not make the score stable. They give you the evidence to judge whether
  it is stable.

The [quickstart](../quickstart.md#6-run-it-one-trial-or-several) explains how the gate reads a
single trial and multiple trials.

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

A scenario with multiple trials does more than return one score. Autoeval runs the same scenario
several times and summarizes the trial results into reliability evidence:

- **Mean score:** the average score across the trials. This is the central result, but by itself it
  does not tell you how stable the behavior was.
- **95% confidence interval:** the uncertainty around that mean. A narrow interval means the trials
  give a consistent estimate. A wide interval means the result is still uncertain.
- **Coefficient of variation (CV):** the variation across the trial scores, relative to the mean.
  A lower CV means the trials agree more closely with one another.
- **Consistency target:** when one is configured, Autoeval compares the observed variation with
  that target and reports whether the target was met.

The point of multiple trials is not to make the score more stable. It is to give you evidence about
how stable the result actually is, so a release decision does not depend on one sample. This is the
same file with `"runsPerScenario": 3`. The overall interval (±0.39) and the warning on `fluency`
(±1.15) show real variation across the three trials. The scorecard labels each trial as a run, so
"3 runs" means three trials inside one run:

```text
█ █     ███  █
█ █       █  █
███     ███  █
  █     █    █
  █  █  ███  █   / 5 overall · stable
95% CI 3.82–4.6 · CV 0.04 (target <0.10)
────────────────────────────────────────────────────────────────────────────────────────────────────
Context  scenario · GLM 5.3 Flash (primary) · 1 test case · 3 runs · 3 metrics

RUBRIC FIT
METRIC                       MEAN    95% CI
factuality                   4.30     ±0.00
fluency                      4.73     ±1.15  ⚠
relevance                    3.60     ±0.00
overall                      4.21     ±0.39

TEST CASES
TEST CASE                    MEAN    95% CI
Freezing point               4.21     ±0.39

BEST RESPONSE
GLM 5.3 Flash · run 3 · scored 4.3 / 5
"At standard atmospheric pressure, what is the freezing point of pure water in degrees Celsius?"  →
"The freezing point of pure water at standard atmospheric pressure is **0 °C**."
factuality 4.3 · fluency 5 · relevance 3.6
85 tokens · $0.0005 · 4.5s  (this run)

3 runs
best run per test case: 85 tokens · $0.0005 · 4.5s model time

--show-outputs for full responses · --json for the raw payload
```

## What most often goes wrong

**You run a public example file as it is.** Every file under `examples/` uses synthetic model IDs,
so it is portable and not tied to one account. What you must do depends on the command:

- **`eval validate`** validates the model IDs stored in the file, and it does not accept
  `--judge-model-id` or `--primary-model-id`. Replace the placeholder IDs in the file first.
  Otherwise it reports that the judge model ID is not enabled for this account.
- **`eval create-from --run`** and the **`suite`** commands accept the command-line overrides. Without
  them, they stop with exit code `2` and this message:

```text
This eval file contains a synthetic judge model UUID. Run "autoeval models" and pass --judge-model-id <uuid>
```

## Next

- [Example 3: Gate a release in CI](./gate-a-release-in-ci.md)
