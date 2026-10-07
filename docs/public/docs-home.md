# Autoeval documentation

Autoeval turns agent behaviors into versioned evaluations that block regressions in CI.

## What Autoeval is

Autoeval is a terminal-first tool for defining, running, and gating LLM evaluations. It connects to the Plumloom backend and supports three evaluation contexts:

- **Scenario** — grade a model's response to a prompt against a rubric.
- **Conversation** — evaluate a multi-turn conversation outcome.
- **Agent Trace** — evaluate an agent trajectory against expected behavior.

Evaluations are defined in committed JSON files, run from the CLI or an MCP client, and gated in CI with explicit PASS / FAIL / INCONCLUSIVE verdicts.

## Core concepts

| Concept        | What it means                                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Workspace**  | The project container that holds evaluations.                                                                                 |
| **Evaluation** | A configured test: methodology (judge model + rubric) + configuration (model + scenarios/traces).                             |
| **Run**        | One execution of an evaluation. A run returns scores, reliability detail, and a verdict where applicable.                     |
| **Suite**      | A manifest that groups multiple evaluations for release gating.                                                               |
| **Gate**       | A CI check that returns `PASS`, `FAIL`, or `INCONCLUSIVE` and exits with a non-zero code when the release should not proceed. |
| **Trial**      | One execution of a scenario inside a run. Several trials give confidence intervals; the scorecard calls them "runs".          |

## Reliability

LLM evaluation is noisy because both the model under test and the judge can vary between runs.
Autoeval surfaces the evidence needed to decide whether a score is trustworthy:

- **Calibrated Quality Standards** — a workspace-level rubric with binary Accept (5) and Reject
  (1) anchors gives the judge explicit reference points.
- **Judge agreement** — result payloads report when graders diverge.
- **Repeated-run statistics** — when the evaluation service plans multiple Scenario trials, results include
  confidence intervals, standard deviation, and consistency detail.

`runsPerScenario` is validated as an integer from 1 to 10, preserved, and sent to the API as
`runs_per_scenario`; it defaults to 1 when omitted. Legacy `autoStopEnabled` is accepted for
compatibility but ignored and not forwarded; automatic stopping is controlled by the evaluation
service. Use
`autoeval --json results <evaluation-id> <run-id>` to inspect the complete reliability payload.

## Who it is for

Autoeval is for teams shipping LLM-powered features who want automated, version-controlled regression checks before merge.

## Where to start

- **[Quickstart](./quickstart.md)** — install, configure, write an evaluation file, run it, read the result, and gate a release on it.
- **[Command guide](./commands.md)** — every command in task order.
- **[CLI reference](./cli-reference.md)** — exact options, human and JSON output, and exit codes per command.

## Deeper topics

- **[Architecture overview](./architecture.md)** — how the CLI and the MCP server share one action layer, and how to add a command or an MCP tool.
- **[Core workflows](./core-workflows.md)** — authentication, the evaluation lifecycle, suites, and MCP, step by step with diagrams.
- **End-to-end examples**: three walkthroughs you can run, each with the result you get, the commands, and the most common failure.
  - [Grade a recorded agent trace](./examples/grade-a-recorded-agent-trace.md)
  - [Write and run your own evaluation file](./examples/write-and-run-your-own-eval.md)
  - [Gate a release in CI](./examples/gate-a-release-in-ci.md)
- **[Release gating for CI](./release-gating.md)** — `autoeval gate` and `autoeval suite gate`, suite mechanics, and the manifest format.
- **[MCP server](./mcp.md)** — invoke Autoeval from coding agents over stdio.
- **[Agent skill](./integration-agent-skill.md)** — install the Autoeval skill in Claude Code, Codex, Cursor, Gemini CLI or Kiro, and what the trigger tests showed. Gemini CLI is skill-only for now: install and trigger, no MCP server.
- **[Agent skill security and permissions](./agent-skill-security.md)** — what the skill package can do, organized against the OWASP Agentic Skills Top 10.
- **[Troubleshooting](../../TROUBLESHOOTING.md)** — common errors and recovery.

## What Autoeval is not

Autoeval is an evaluation runner and release gate. It is not a monitoring, dashboarding, or alerting platform.
