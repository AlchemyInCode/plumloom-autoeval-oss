![architecture](https://github.com/user-attachments/assets/6b10f903-03df-4048-8ac6-f69482601bfd)# Plumloom Autoeval

**The release-confidence layer for AI-agent changes.**

Autoeval is an open-source CLI and MCP server that turns committed evaluation files into versioned, gated checks on AI-agent behavior, scored by the Plumloom backend. It supports scenario, conversation, and agent-trace evaluation contexts from development through CI.

LLM outputs and judge scores can vary between runs. For scenario evaluations, Autoeval supports multiple trials and reports reliability evidence such as confidence intervals and consistency statistics. This helps developers judge whether a release decision is supported by evidence beyond a single score.

## Architecture

![Uploading architecture.<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1760 600" width="1760" height="600" role="img" aria-label="How Autoeval works: a developer or agent writes eval files and a suite manifest; Autoeval (CLI or MCP) submits a run to the Plumloom backend, which scores it; scored results feed a release gate whose exit code is enforced in CI.">
<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1,1 L9,5 L1,9" fill="none" stroke="context-stroke" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>
<rect x="10" y="10" width="1740" height="580" rx="20" fill="#F7F7F5" stroke="#E3E3DD" stroke-width="1.5"/>
<text x="48" y="58" font-family="system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif" font-size="15" font-weight="700" letter-spacing="3" fill="#136D8C">HOW AUTOEVAL WORKS</text>
<line x1="266" y1="172" x2="412" y2="172" stroke="#8A8A82" stroke-width="1.7" marker-end="url(#ah)"/>
<line x1="670" y1="172" x2="822" y2="172" stroke="#8A8A82" stroke-width="1.7" marker-end="url(#ah)"/>
<line x1="1040" y1="152" x2="1432" y2="152" stroke="#8A8A82" stroke-width="1.7" marker-end="url(#ah)"/>
<line x1="1440" y1="194" x2="1048" y2="194" stroke="#8A8A82" stroke-width="1.7" marker-end="url(#ah)"/>
<line x1="935" y1="224" x2="935" y2="402" stroke="#8A8A82" stroke-width="1.7" marker-end="url(#ah)"/>
<line x1="1040" y1="462" x2="1132" y2="462" stroke="#8A8A82" stroke-width="1.7" marker-end="url(#ah)"/>
<line x1="1396" y1="462" x2="1478" y2="462" stroke="#8A8A82" stroke-width="1.7" marker-end="url(#ah)"/>
<text x="339" y="160" text-anchor="middle" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace" font-size="13" fill="#6E6E68">writes</text>
<text x="746" y="160" text-anchor="middle" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace" font-size="13" fill="#6E6E68">runs</text>
<text x="1236" y="140" text-anchor="middle" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace" font-size="13" fill="#6E6E68">submits run</text>
<text x="1244" y="212" text-anchor="middle" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace" font-size="13" fill="#6E6E68">returns results</text>
<text x="1086" y="450" text-anchor="middle" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace" font-size="13" fill="#6E6E68">thresholds</text>
<text x="1437" y="450" text-anchor="middle" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace" font-size="13" fill="#6E6E68">exit code</text>
<rect x="56" y="120" width="210" height="104" rx="12" fill="#ECECE7" stroke="#C9C9C1" stroke-width="1.5"/>
<g transform="translate(125.0,138.0) scale(1.1667)" fill="none" stroke="#44443F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></g>
<g transform="translate(169.0,138.0) scale(1.1667)" fill="none" stroke="#44443F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></g>
<text x="161" y="188" text-anchor="middle" font-family="system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif" font-size="16" font-weight="600" fill="#44443F">Developer or agent</text>
<text x="161" y="208" text-anchor="middle" font-family="system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif" font-size="12.5" fill="#6E6E68">you · Claude Code · Codex</text>
<circle cx="78" cy="142" r="14" fill="#136D8C"/>
<text x="78" y="147" text-anchor="middle" font-family="system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif" font-size="15" font-weight="700" fill="#FFFFFF">1</text>
<rect x="420" y="120" width="250" height="104" rx="12" fill="#ECECE7" stroke="#C9C9C1" stroke-width="1.5"/>
<text x="545" y="168" text-anchor="middle" font-family="system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif" font-size="17" font-weight="600" fill="#44443F">Eval files + manifest</text>
<text x="545" y="192" text-anchor="middle" font-family="system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif" font-size="13" fill="#6E6E68">JSON + YAML, in your repo</text>
<circle cx="442" cy="142" r="14" fill="#136D8C"/>
<text x="442" y="147" text-anchor="middle" font-family="system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif" font-size="15" font-weight="700" fill="#FFFFFF">2</text>
<rect x="830" y="120" width="210" height="104" rx="12" fill="#E1EDF1" stroke="#136D8C" stroke-width="1.5"/>
<text x="935" y="168" text-anchor="middle" font-family="system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif" font-size="17" font-weight="600" fill="#0E5468">Autoeval</text>
<text x="935" y="192" text-anchor="middle" font-family="system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif" font-size="13" fill="#2A7590">CLI · MCP server</text>
<circle cx="852" cy="142" r="14" fill="#136D8C"/>
<text x="852" y="147" text-anchor="middle" font-family="system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif" font-size="15" font-weight="700" fill="#FFFFFF">3</text>
<rect x="1440" y="120" width="252" height="104" rx="12" fill="#F1E5EE" stroke="#8C3074" stroke-width="1.5"/>
<text x="1566" y="168" text-anchor="middle" font-family="system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif" font-size="17" font-weight="600" fill="#6E265A">Plumloom backend</text>
<text x="1566" y="192" text-anchor="middle" font-family="system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif" font-size="13" fill="#9A4A82">runs &amp; scores the eval</text>
<circle cx="1462" cy="142" r="14" fill="#136D8C"/>
<text x="1462" y="147" text-anchor="middle" font-family="system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif" font-size="15" font-weight="700" fill="#FFFFFF">4</text>
<rect x="830" y="410" width="210" height="104" rx="12" fill="#ECECE7" stroke="#C9C9C1" stroke-width="1.5"/>
<text x="935" y="458" text-anchor="middle" font-family="system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif" font-size="17" font-weight="600" fill="#44443F">Scored results</text>
<text x="935" y="482" text-anchor="middle" font-family="system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif" font-size="13" fill="#6E6E68">+ reliability evidence</text>
<circle cx="852" cy="432" r="14" fill="#136D8C"/>
<text x="852" y="437" text-anchor="middle" font-family="system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif" font-size="15" font-weight="700" fill="#FFFFFF">5</text>
<rect x="1140" y="410" width="256" height="104" rx="12" fill="#EEF0DC" stroke="#6B740F" stroke-width="1.5"/>
<text x="1268" y="458" text-anchor="middle" font-family="system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif" font-size="17" font-weight="600" fill="#51580B">Release gate</text>
<text x="1268" y="482" text-anchor="middle" font-family="system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif" font-size="13" fill="#7E8718">PASS · FAIL · INCONCLUSIVE</text>
<circle cx="1162" cy="432" r="14" fill="#136D8C"/>
<text x="1162" y="437" text-anchor="middle" font-family="system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif" font-size="15" font-weight="700" fill="#FFFFFF">6</text>
<rect x="1486" y="410" width="206" height="104" rx="12" fill="#E1EDF1" stroke="#136D8C" stroke-width="1.5"/>
<text x="1589" y="458" text-anchor="middle" font-family="system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif" font-size="17" font-weight="600" fill="#0E5468">CI / terminal</text>
<text x="1589" y="482" text-anchor="middle" font-family="system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif" font-size="13" fill="#2A7590">exit code blocks merge</text>
<circle cx="1508" cy="432" r="14" fill="#136D8C"/>
<text x="1508" y="437" text-anchor="middle" font-family="system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif" font-size="15" font-weight="700" fill="#FFFFFF">7</text>
<circle cx="56" cy="552" r="7" fill="#136D8C"/>
<text x="72" y="557" font-family="system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif" font-size="13" fill="#6E6E68">Autoeval — you run it</text>
<circle cx="360" cy="552" r="7" fill="#8C3074"/>
<text x="376" y="557" font-family="system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif" font-size="13" fill="#6E6E68">Plumloom — hosted</text>
<circle cx="640" cy="552" r="7" fill="#6B740F"/>
<text x="656" y="557" font-family="system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif" font-size="13" fill="#6E6E68">Gate → CI exit code</text>
</svg>svg…]()


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
autoeval login
autoeval quickstart
```

`quickstart` resolves a workspace and judge model, grades a bundled sample end to end, and prints the result. See the [quickstart guide](docs/public/quickstart.md).

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

- Privacy policy: <!-- TODO(Plumloom): link to the privacy policy -->
- Support: <!-- TODO(Plumloom): support link or email -->

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
