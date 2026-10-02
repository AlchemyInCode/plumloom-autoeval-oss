# Autoeval quickstart

By the end of this page you will have an evaluation defined in a file you own, run it once or many
times, read the result, and use that result to decide whether a release goes ahead. That loop is
the whole product: everything else in these docs is a variation on it.

Allow about fifteen minutes. You need a Plumloom CLI key.

## 1. Requirements

- **Node.js 22.13 or newer.**
- **An AI provider connected in Plumloom.** Autoeval runs evaluations through the models your
  Plumloom account can reach, so connect a provider first under **Settings → AI Providers & Models**
  ([app.plumloom.ai/ai-providers](https://app.plumloom.ai/ai-providers)). Plumloom currently supports
  OpenAI and Together.ai keys. Without one, `autoeval models` returns nothing.
- **A Plumloom CLI key.** Create one under **Settings → API Keys**
  ([app.plumloom.ai/api-keys](https://app.plumloom.ai/api-keys)). It starts with `pl_sk_`.
- **pnpm 11, only if you build from source.** Install it with `npm install --global pnpm@11`.
  Current Node releases no longer bundle Corepack, so `corepack enable` does not work on Node 25 and
  later.

## 2. Install

Install the published package:

```bash
npm install --global @plumloom/cli
```

This gives you two commands: `autoeval` for the terminal and `autoeval-mcp` for MCP clients.

To build from source instead (contributors, or to run an unreleased change):

```bash
pnpm install --frozen-lockfile
pnpm build
```

From a checkout, run `node packages/cli/dist/cli.js` wherever these docs say `autoeval`.

## 3. Configure

Do this before running any command, including `--help`:

```bash
export AUTOEVAL_API_BASE_URL="https://api.plumloom.ai"
```

Every Autoeval command requires this variable, and there is no built-in default. It must be an
`https` origin with no path, query, or fragment; plain `http` is accepted only for `localhost`
development.

Then give Autoeval your key. Choose one:

```bash
# Interactive: prompts for the key, validates it, then stores it in the OS credential store.
autoeval login

# CI and scripts: read from the environment on every command. Never written to disk.
export AUTOEVAL_API_KEY="pl_sk_..."
```

Use the environment variable in CI. `autoeval login --key <key>` also works, but it writes the key to
the OS credential store (which a headless runner may not have) and leaves it in your shell history.
[How credentials are resolved](./core-workflows.md#1-authentication-and-credential-resolution)
explains the full order.

## 4. Verify

```bash
autoeval --help
autoeval whoami
```

`--help` confirms the install. `whoami` is the first command that talks to Plumloom, so it confirms
the origin and the key together. If either fails, the
[troubleshooting guide](../../TROUBLESHOOTING.md) lists each error and its fix.

## 5. Create an evaluation from a file

An evaluation is a JSON file that you keep in version control next to your code. Start from one of
the public examples.

Find the model and workspace IDs you will need:

```bash
autoeval models
autoeval workspace list
```

If you have no workspace, create one with `autoeval workspace create --name "My workspace"`.

Copy an example and check it:

```bash
cp examples/evals/scenario-basic.json my-eval.json
autoeval eval validate --input my-eval.json
```

`validate` checks the file's structure and confirms every model it names is enabled on your account.
It makes one read-only request and creates nothing.

Create the evaluation and run it in one step:

```bash
autoeval eval create-from \
  --workspace <workspace-id> \
  --input my-eval.json \
  --judge-model-id <judge-model-uuid> \
  --primary-model-id <primary-model-uuid> \
  --run
```

The two model flags are needed here only because the public examples ship with placeholder UUIDs.
Once your own file contains your own enabled model UUIDs, drop both flags.

The judge must be a different model from the one under test. Autoeval rejects a file where they
match, because a model grading its own answer is not a useful measurement.

`--run` waits for the run to finish and prints the evaluation ID and the Run ID. Keep both; the next
two steps use them.

## 6. Run it: one trial or several

This is the decision that matters most, and it lives in your eval file rather than in a flag.

Language models and the judges that grade them are not deterministic. Run the same evaluation twice
and the score can move. The question is whether you are measuring your system or measuring noise.

**A single trial** executes each scenario once and gives one point-in-time score per scenario, with no
trial-to-trial reliability evidence. It is fast and cheap during development, and it is also a valid
choice when a team accepts a point estimate.

**Multiple trials** execute the same evaluation several times, then aggregate the trials to measure
the variation between them. The result reports reliability statistics, including the confidence
interval. That tells you how consistently your system performs, instead of basing a decision on one
trial that happened to be lucky or unlucky.

Set it with `runsPerScenario` in the file's `methodology` block:

```json
"methodology": {
  "runsPerScenario": 5
}
```

It accepts a whole number from 1 to 10 and defaults to 1 (a single trial) when omitted.

| You want                                              | Setting           |
| ----------------------------------------------------- | ----------------- |
| A fast point estimate, in development or for a gate   | `1` (the default) |
| Reliability evidence, and interval-aware suite gating | more than `1`     |

More trials do not make a result stable. They give you the evidence to judge whether it is stable.
The results show the variation between trials and the confidence interval. A result is convincing when
the variation is low and the interval is narrow enough that a small change in score would not change
the release decision. If the interval is wide, or it straddles your gate threshold, the evidence is
not strong enough for a confident decision. When a consistency target is configured, the results
also report whether the run met it.

The choice also changes how `autoeval suite gate` reads a scenario result, which is the other reason
it matters:

- For a **single trial**, `suite gate` compares the one score against your threshold. A lucky trial
  passes.
- For **multiple trials**, `suite gate` compares the 95% confidence interval against your
  threshold. It passes only when the whole interval clears the threshold, fails when the whole
  interval falls short, and reports `INCONCLUSIVE` when the interval straddles it.

The single-evaluation gate, `autoeval gate <evaluation-id>`, does not use the confidence interval. It
compares the scored result against the thresholds you configure.

Multiple trials apply to **scenario** evaluations, where Autoeval calls a model under test.
Conversation and agent-trace evaluations grade a transcript or trace you supply. The file accepts
`runsPerScenario` for these types too, and Autoeval sends it to the API without a warning, but the
release gate evaluates their per-metric scores directly; multiple-trial reliability logic does not apply.

To run an evaluation that already exists, without changing its file:

```bash
autoeval run <evaluation-id>
```

## 7. Inspect the results

```bash
autoeval results <evaluation-id> <run-id>
```

You get a scorecard: the overall score, per-metric scores, and, for an evaluation with multiple
trials, the interval and consistency evidence. Two variations:

```bash
autoeval results <evaluation-id> <run-id> --show-outputs    # every input and model response
autoeval --json results <evaluation-id> <run-id>            # the complete payload, for scripts
```

While a run is still going, `autoeval status <evaluation-id> <run-id>` shows its progress.

## 8. Gate a release on the result

A gate turns a score into a yes or no that CI can act on:

```bash
autoeval gate <evaluation-id> --min-overall 4.0
```

It exits `0` when every threshold is met and `1` when any is not, so a failing gate stops the
pipeline. Thresholds can also be set per metric, per scenario, or on judge agreement, and read from a
JSON file with `--thresholds`.

To gate a release on several evaluations at once, list them in a suite manifest and run
`autoeval suite gate`. Two rules decide the outcome, and both are there to stop a bad release from
passing quietly:

- **`INCONCLUSIVE` is not a pass.** It exits non-zero, the same as `FAIL`. So does an evaluation
  that has no threshold configured: it is `INCONCLUSIVE`, never a silent pass.
- **The suite takes its worst result.** Outcomes roll up in the order
  `ERROR`, then `FAIL`, then `INCONCLUSIVE`, then `PASS`. There is no averaging, so one failing
  evaluation fails the suite however well the others did.

See [release gating for CI](./release-gating.md).

## Want to see it work first?

`autoeval quickstart` runs a bundled sample end to end with no file of your own. It resolves your
workspace and judge model, grades a recorded agent trace, and prints the result, which makes it a
good way to confirm everything is connected before you write an evaluation.

```bash
autoeval quickstart
```

It saves the evaluation as `Quickstart Baseline - <timestamp>` and prints a ready-to-run
`autoeval results` command.

## Go deeper

- [Architecture overview](./architecture.md): how the CLI and the MCP server share one action layer
- [Core workflows](./core-workflows.md): authentication, the evaluation lifecycle, suites, and MCP,
  step by step
- [Command guide](./commands.md): every command in task order
- [CLI reference](./cli-reference.md): exact options, output, and exit codes
- [Release gating for CI](./release-gating.md)
- [MCP server](./mcp.md)
- [Troubleshooting](../../TROUBLESHOOTING.md)
