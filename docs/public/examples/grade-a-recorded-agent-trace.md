# Example 1: Grade a recorded agent trace

**When you are done**, you have one scored agent-trace evaluation in your workspace. This is the
shortest path from a new install to grading a recorded agent trace and reading its scorecard.

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

```text
Workspace   Default Workspace (ffffffff-ffff-4fff-8fff-ffffffffffff)
Judge       Llama 3.3 70B (aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa)
Sample      examples/evals/agent-trace-basic.json (bundled)
Evaluation  Quickstart Baseline - 2026-09-30T22:59:37Z (dddddddd-dddd-4ddd-8ddd-dddddddddddd)
Overall score

█ █     █ █ ███
█ █     █ █   █
███     ███ ███
  █       █   █
  █  █    █ ███  / 5 overall
────────────────────────────────────────────────────────────────────────────────────────────────────
Context          agent_trace
Judge agreement  2/2
Metrics scored   8

SESSION EVALUATION
METRIC                      SCORE
helpfulness                  4.14
relevance                    4.44
factuality                   4.72

TRAJECTORY EVALUATION
Trajectory score  4.7 / 5
Judge agreement   2/2

DIMENSION                            SCORE
Logical progression                    4.2
Appropriate sequence of actions        4.5
Decision consistency across steps      4.8
Repeated calls or loops                  5
Unnecessary detours                      5

Use --json for full reliability detail and the untouched backend payload

Re-read this run any time:
  autoeval results dddddddd-dddd-4ddd-8ddd-dddddddddddd eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee
Run with --json for full reliability detail
```

`quickstart` prints the command to read this run again at the end. Keep the evaluation ID and the Run
ID from it: you need them in the next step.

## 2. Read the scorecard

```bash
autoeval results <evaluation-id> <run-id>
```

```text
Overall score

█ █     █ █ ███
█ █     █ █   █
███     ███ ███
  █       █   █
  █  █    █ ███  / 5 overall
────────────────────────────────────────────────────────────────────────────────────────────────────
Context          agent_trace
Judge agreement  2/2
Metrics scored   8

SESSION EVALUATION
METRIC                      SCORE
helpfulness                  4.14
relevance                    4.44
factuality                   4.72

TRAJECTORY EVALUATION
Trajectory score  4.7 / 5
Judge agreement   2/2

DIMENSION                            SCORE
Logical progression                    4.2
Appropriate sequence of actions        4.5
Decision consistency across steps      4.8
Repeated calls or loops                  5
Unnecessary detours                      5

Use --json for full reliability detail and the untouched backend payload
```

The scorecard has two parts:

- **Session evaluation** gives one score per metric: here `helpfulness`, `relevance`, and
  `factuality`. These are the scores a release gate can use. The gate reads only these per-metric
  scores for agent traces and conversations, and only for the metrics you give a threshold. Note
  the names: you set thresholds on them in [Example 3](./gate-a-release-in-ci.md).
- **Trajectory evaluation** scores how the agent got there: its planning, its order of actions, and
  any loops or detours. It is diagnostic evidence about the path the agent took, and it helps explain
  why a trace succeeded or failed. The release evidence for an agent-trace evaluation is its session
  metrics, so trajectory scores do not currently take part in the gate decision.

For the complete result, use JSON. For an agent trace, `--json` returns the full validated result
payload: the session scores, judge agreement, the trajectory evaluation, and the underlying backend
fields. An agent trace is graded as a fixed input, so this is not evidence from repeated trials:

```bash
autoeval --json results <evaluation-id> <run-id>
```

`--show-outputs` adds every input and model response for **scenario** evaluations. An agent-trace
scorecard does not change with it, because the trace you supplied is the input.

## 3. Grade your own trace

Run the same flow on a trace of your own. `--input` expects an Autoeval agent-trace evaluation file,
the same shape as `examples/evals/agent-trace-basic.json`. It does not accept a raw OpenTelemetry
trace or a harness session log:

```bash
autoeval quickstart --input ./my-agent-trace.json
```

If you start from a DeepSeek Harness session, convert the raw session into that evaluation file
first. This step runs locally and needs no key:

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
