# Plumloom Autoeval

**The release-confidence layer for AI-agent changes.**

Autoeval is an open-source CLI and MCP server that turns committed evaluation files into versioned, gated checks on AI-agent behavior, scored by the Plumloom backend. It supports scenario, conversation, and agent-trace evaluation contexts from development through CI.

LLM outputs and judge scores can vary between runs. For scenario evaluations, Autoeval supports multiple trials and reports reliability evidence such as confidence intervals and consistency statistics. This helps developers judge whether a release decision is supported by evidence beyond a single score.

## Architecture

<img width="1766" height="606" alt="image" src="https://github.com/user-attachments/assets/4dfac43a-3934-463d-a8d8-4516fd625004" />

Eval files and the suite manifest are the only inputs you author and commit; Autoeval submits runs to Plumloom, reads back scored results, and the gate turns them into a CI pass/fail.

## Requirements

- Node.js 22.13 or newer
- A Plumloom CLI key beginning with `pl_sk_`

pnpm 11 is needed only to build from source.

## Install

```bash
npm install --global @plumloom/cli
```

To build from source, run `pnpm install --frozen-lockfile && pnpm build`. In the examples below, replace `autoeval` with `node packages/cli/dist/cli.js` when running from this repository.

## Configure Plumloom

1. [Connect an AI provider](https://app.plumloom.ai/ai-providers) so Plumloom can run evaluations. OpenAI and Together.ai are supported.
2. [Create a Plumloom API key](https://app.plumloom.ai/api-keys) for authentication from your terminal, CI, or development tools.

Autoeval connects to [https://api.plumloom.ai](https://api.plumloom.ai) automatically. No API URL configuration is required.

## Quickstart

```bash
autoeval init
```

`init` takes you from install to a first finished evaluation: it resolves a workspace and the models to use, installs a starter pack into the current directory, runs it end to end, prints the result, and — once the evaluation finishes successfully — saves your choices as defaults so later commands need fewer flags. It signs you in first if needed. If the evaluation fails to run, `init` reports the failure, exits non-zero, and does not save defaults. Add `--yes` to accept the first available workspace and models without prompting (useful in scripts).

To grade a single bundled sample without writing any files, use `autoeval quickstart`. See the [quickstart guide](docs/public/quickstart.md).

### Saved defaults

`init` records non-secret defaults (workspace and model IDs) in a settings file so commands such as `quickstart`, `pack run`, `suite run`, `suite gate`, and `doctor` can omit those flags. Your API key is never written to this file; it stays in the OS keyring or the `AUTOEVAL_API_KEY` environment variable. Credential-shaped values are rejected in every settings field, including when an existing file is loaded. Explicit flags always override saved defaults.

```bash
autoeval config show                        # print saved defaults (no secrets)
autoeval config set-workspace <workspace-id>
autoeval config set-judge-model <model-id>
autoeval config set-primary-model <model-id> # model under test, scenario evals
autoeval config clear                        # remove the settings file
```

The file lives at `$XDG_CONFIG_HOME/autoeval/settings.json` (defaulting to `~/.config/autoeval/settings.json`) with owner-only permissions.

### Starter packs

Starter packs are ready-to-run evaluation files you can install, run, and then adapt.

```bash
autoeval pack list                 # show the built-in packs
autoeval pack add support-bot      # install into ./autoeval/support-bot
autoeval pack run support-bot      # install if needed, then run
```

Available packs:

- `support-bot` — support bot answer quality (conversation)
- `rag-answer-quality` — RAG answer quality (scenario)
- `coding-agent` — coding agent decision quality (agent_trace)
- `agent-trace` — agent trace grounding (agent_trace)

Each pack installs an `autoeval.suite.yaml` manifest plus its eval file and fixtures. Pack evals contain synthetic model placeholders; `init` and `pack run` replace them in memory with enabled models and use the resolved workspace. Scenario packs require two distinct enabled models, one judge and one model under test.

`pack run` reuses an installed pack only while its bundled files and manifest execution policy still match the shipped pack. To adapt a pack, copy or edit it and run the resulting manifest explicitly with `autoeval suite run --manifest <file>` (or `suite gate`). This prevents `init` and `pack run` from silently executing pre-existing or tampered files.

## File-driven evaluation

An evaluation file uses the configured-run JSON accepted by `autoeval eval validate`. Artifact and reference-document paths resolve relative to the evaluation file.

```json
{
  "methodology": { "judgeModelId": "<judge-model-id>", "evaluatorInstructions": "..." },
  "configuration": {
    "contextName": "Support conversation",
    "contextType": "conversation",
    "artifactFile": "./data/conversation.json",
    "referenceDocumentFiles": ["./policy/refunds.md"]
  }
}
```

```bash
autoeval eval validate --input support.autoeval.json
autoeval eval create-from --workspace <workspace-id> --input support.autoeval.json --run
```

Model-ID fields take UUIDs; copy enabled IDs from `autoeval models`. See [Write and run your own evaluation file](docs/public/examples/write-and-run-your-own-eval.md) for the full walkthrough.

## Add a CI release gate

A suite manifest names a workspace, lists evaluation files, and declares release thresholds. Paths resolve relative to the manifest.

```yaml
workspace: <workspace-id>
gate:
  minOverall: 4.0
  minScenario: 3.5
evals:
  - ./evals/refund-policy.autoeval.json
  - file: ./evals/support-conversation.autoeval.json
    gate:
      metrics:
        factuality: 4.0
        relevance: 3.8
```

Commit the manifest, every referenced eval file, and any artifacts or reference documents those evals load. Start from [`examples/suite/autoeval.suite.yaml`](examples/suite/autoeval.suite.yaml) and its fixtures under [`examples/smoke/fixtures/`](examples/smoke/fixtures/), then use `autoeval workspace list` and `autoeval models` to replace the synthetic workspace and model IDs in your own copies.

```bash
autoeval doctor --manifest autoeval.suite.yaml
autoeval suite run --manifest autoeval.suite.yaml
autoeval suite gate --manifest autoeval.suite.yaml
```

`doctor` checks credentials, files, workspace access, and model IDs without creating resources. `suite run` executes the listed evaluations without a release judgment. `suite gate` applies the manifest thresholds: `PASS`=0, `FAIL`/`INCONCLUSIVE`=1, and `ERROR`=5.

Copy [`.github/workflows/autoeval-suite-gate.yml.example`](.github/workflows/autoeval-suite-gate.yml.example) into your repository for a ready-to-use adopter workflow. See [Gate a release in CI](docs/public/examples/gate-a-release-in-ci.md) and [Release gating for CI](docs/public/release-gating.md) for setup and policy details.

For same-repository pull requests, the example workflow also updates one context-aware Autoeval
Reliability Report comment per suite and matrix job. It shows the existing gate verdict alongside
available Standard, Judgment, and Repeatability evidence; comment failures never replace the gate
verdict or exit code. Fork pull requests remain excluded because they do not receive repository
secrets.

Common commands include:

```text
autoeval workspace list
autoeval models
autoeval results <evaluation-id> <run-id>
autoeval --json results <evaluation-id> <run-id>
```

The [command guide](docs/public/commands.md) and [CLI reference](docs/public/cli-reference.md) cover the full command surface. For environment and credential behavior, see the [developer guide](docs/public/developer-guide.md) and [`.env.example`](.env.example). Runnable smoke workflows live under [`examples/smoke/`](examples/smoke/), additional sanitized configurations live under [`examples/evals/`](examples/evals/), and reliability semantics are documented in the [documentation home](docs/public/docs-home.md#reliability).

## MCP server

Autoeval includes a local stdio MCP server that exposes the same action layer as the CLI. It resolves credentials from `AUTOEVAL_API_KEY` and then the OS credential store, and it never prompts. See the [MCP server guide](docs/public/mcp.md) and [Autoeval with Codex and Claude Code](docs/public/integration-codex-and-claude-code.md).

## Agent skill

Install the package from the Claude Code marketplace:

```bash
claude plugin marketplace add AlchemyInCode/plumloom-autoeval-oss
claude plugin install plumloom-autoeval@plumloom
```

Install the Gemini CLI extension:

```bash
gemini extensions install https://github.com/AlchemyInCode/plumloom-autoeval-oss
```

Gemini CLI is skill-only for now: install and trigger are supported, but end-to-end Autoeval execution is not. See the [agent skill guide](docs/public/integration-agent-skill.md) and [agent skill security and permissions](docs/public/agent-skill-security.md).

- Privacy policy: [Plumloom Privacy Policy](https://plumloom.ai/privacy-policy)
- Support: [support@plumloom.ai](mailto:support@plumloom.ai)

<!-- Kiro's power registry asks for a privacy policy link and a support contact in the README. -->

## Documentation

- [Documentation home](docs/public/docs-home.md)
- [Quickstart](docs/public/quickstart.md)
- [Command guide](docs/public/commands.md)
- [Deterministic CLI developer guide](docs/public/developer-guide.md)
- [Deterministic command reference](docs/public/cli-reference.md)
- [MCP server guide](docs/public/mcp.md)
- [Codex and Claude Code integration](docs/public/integration-codex-and-claude-code.md)
- [Agent skill for coding agents](docs/public/integration-agent-skill.md)
- [Agent skill security and permissions](docs/public/agent-skill-security.md)
- [DeepSeek Harness integration](docs/public/integration-deepseek-harness.md)
- [Release gating for CI](docs/public/release-gating.md)
- [Troubleshooting](TROUBLESHOOTING.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
