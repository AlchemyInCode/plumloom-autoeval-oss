# Example 1: Grade a recorded agent trace

**When you are done**, you have one scored agent-trace evaluation in your workspace, and you can
read its scorecard. This is the shortest path from a new install to a real result.

**Time:** about five minutes. **Needs:** an installed CLI, an API origin, and a CLI key. If you do
not have these yet, do steps 1 to 3 of the [quickstart](../quickstart.md) first.

---

## 1. Run the bundled sample

```bash
autoeval quickstart
```

`quickstart` does four things in order:

1. **Finds your workspace.** If your account has one workspace, it uses it. If it has more than one,
   it asks you to choose. It never creates a workspace.
2. **Finds a judge model.** If you pass `--judge-model-id`, it uses that model. If your account has
   one enabled model, it uses that model. Otherwise it takes the first small, fast model from a
   fixed preference list that your account has enabled. If none of those is enabled, it asks you.
3. **Runs the sample.** The default sample is a recorded tool-using trace: an agent looks up the
   weather, uses the returned value, and answers. It is the same file as
   [`examples/evals/agent-trace-basic.json`](../../../examples/evals/agent-trace-basic.json), and it
   ships inside the npm package, so it works on a global install with no repository checkout.
4. **Prints the result.**

<!-- M3-PENDING-KEY: paste the real `autoeval quickstart` output here, captured with a test key. -->

```text
OUTPUT PENDING: captured from a real run before this page ships.
```

Keep the evaluation ID and the Run ID from the output. You need them in the next step.

## 2. Read the scorecard

```bash
autoeval results <evaluation-id> <run-id>
```

<!-- M3-PENDING-KEY: paste the real `autoeval results` output here. -->

```text
OUTPUT PENDING: captured from a real run before this page ships.
```

For an agent trace, the evidence that matters is the **per-metric score**. The release gate reads
only the configured `per_metric.<metric>.score` values for agent traces and conversations. It does
not read the overall outcome. Note the metric names on your scorecard: you set thresholds on them
in [Example 3](./gate-a-release-in-ci.md).

To see every input and model response behind the scores:

```bash
autoeval results <evaluation-id> <run-id> --show-outputs
```

## 3. Grade your own trace

Run the same flow on a trace file of your own:

```bash
autoeval quickstart --input ./my-agent-trace.json
```

If your agent runs on DeepSeek Harness, convert a session log into an agent-trace file first. This
step runs locally and needs no key:

```bash
autoeval trace import --from deepseek-harness \
  --session ./session.jsonl \
  --template ./my-template.json \
  --out ./my-agent-trace.json
```

The template supplies the judge and the methodology. The session log supplies the trace.

## What most often goes wrong

**`quickstart` stops with "This account has more than one workspace."** This happens when your
account has more than one workspace and `quickstart` cannot ask you to choose. It cannot ask when
you pass `--yes` or `--json`, or when it does not run in a terminal (for example, in CI or behind a
pipe). The command exits with code `2`:

```text
This account has more than one workspace. Pass --workspace <workspace-id>; run "autoeval workspace list" to see them.
```

Fix: pass the workspace explicitly.

```bash
autoeval workspace list
autoeval quickstart --workspace <workspace-id> --yes
```

## Next

- [Example 2: Write and run your own evaluation file](./write-and-run-your-own-eval.md)
- [Example 3: Gate a release in CI](./gate-a-release-in-ci.md)
