# Agent skill security and permissions

This page covers the Autoeval agent skill package: the skill in `skills/autoeval/`, the host
manifests at the repository root, and the MCP server entry they declare. It applies to Claude Code,
Codex, Cursor, Gemini CLI and Kiro. Risks are organized against the
[OWASP Agentic Skills Top 10](https://owasp.org/www-project-agentic-skills-top-10/) (version 1.0,
2026).

The short version: the package is plain text, carries no key, runs nothing at install time, and
fetches no outside instructions. What it can do is what the `autoeval` CLI and the Autoeval MCP
server can do with the key you give them, so the controls that matter most are the key you use and
the tool calls you approve.

## What the package contains

| File                                                            | Purpose                                           |
| --------------------------------------------------------------- | ------------------------------------------------- |
| `skills/autoeval/SKILL.md`                                      | The skill: rules, workflow and reporting          |
| `skills/autoeval/references/verdicts.md`, `commands.md`         | Decision rules and the command list               |
| `plugin.json`, `mcp.json`                                       | Agent Plugins manifest (Codex, Cursor, Kiro)      |
| `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | Claude Code plugin and marketplace                |
| `.cursor-plugin/plugin.json`                                    | Cursor plugin listing                             |
| `gemini-extension.json`                                         | Gemini CLI extension                              |
| `.agents/plugins/marketplace.json`                              | Codex install from this repository                |
| `assets/logo.svg`                                               | Listing icon (no scripts, no external references) |

The package contains no hooks, commands, agents, rules, executables or settings files. Hosts load
those from fixed folders at the package root (Claude Code: `commands/`, `agents/`,
`hooks/hooks.json`, `.mcp.json`, `.lsp.json`, `output-styles/`, `workflows/`, `themes/`,
`monitors/`, `bin/`, `settings.json`; Cursor: `rules/`, `agents/`, `commands/`, `hooks/hooks.json`;
Gemini CLI: `commands/`, a context file such as `GEMINI.md`), and this repository has none of them
at its root. A host therefore loads two things: the skill and the MCP server entry. On
2026-10-06, `claude plugin details plumloom-autoeval` listed one skill, one MCP server, and no
agents, hooks or LSP servers; `gemini extensions list`, Kiro's power page and the Codex plugin page
showed the same skill and the same MCP entry.

Installing the package runs nothing: it has no install scripts and no hooks. When a session starts,
the host launches the MCP server, the `autoeval-mcp` executable from `@plumloom/cli`, which you
install yourself beforehand (`npm install --global @plumloom/cli`). No package is downloaded when
the agent starts.

One host-specific point: Claude Code runs a dependency install when it caches a plugin whose root
holds a `package.json` next to an npm or Bun lockfile. This repository's root holds `package.json`
next to `pnpm-lock.yaml`, which Claude Code does not install from, so no install runs and
`claude plugin list` notes it on the plugin. If the lockfile ever changes to `package-lock.json`,
installing the plugin would run `npm install` of this repository's development dependencies on the
user's machine.

The ZIP submitted to the Codex directory leaves out `mcp.json`, so that listing is skills-only. An
install from the repository itself, through a marketplace entry like the one in
`.agents/plugins/marketplace.json`, reads the root `plugin.json` and `mcp.json` like the other Agent
Plugins hosts: in the Codex test on 2026-10-06 it listed and started the MCP server.

## Credentials

The package carries no key, and its tests fail if a manifest does. The CLI and the MCP server read
the key from `AUTOEVAL_API_KEY` or, failing that, from the OS credential store entry that
`autoeval login` creates.

- The skill tells the agent never to ask for a key in the conversation, never to put one on a
  command line, and never to print, log or store one. If authentication fails, the agent asks you to
  run `autoeval login` yourself.
- The MCP server uses the key only for Autoeval API requests. Tool input, output, errors, schemas
  and descriptions do not contain it, and error output redacts recognized secret fields and CLI-key
  patterns.
- Gemini CLI passes an extension's MCP server only standard variables such as `HOME` and `PATH`,
  plus variables the extension declares. A key exported in your shell does not reach the server
  there. Use `autoeval login` instead.
- Never put a real key in a manifest or any checked-in MCP configuration.

## Actions that create resources or cost money

The MCP server has nine read-only tools and seven that change state:

- Read-only: `get_current_user`, `list_workspaces`, `list_evaluations`, `get_evaluation`,
  `list_models`, `get_quality_standard`, `validate_configured_evaluation`, `get_run_status`,
  `get_results`.
- State-changing: `create_workspace`, `create_evaluation`, `update_evaluation_title`,
  `create_quality_standard`, `assign_quality_standard`, `run_configured_evaluation`,
  `run_evaluation`.

The server runs state-changing tools as soon as they are called; it has no confirmation step of
its own. The skill tells the agent to name the command and what it creates before starting any run,
because runs create backend resources and may incur evaluation charges. The enforcement point is
your host's tool approval. Do not auto-approve the state-changing tools.

The server has no gate tool and no suite tool. Thresholds live in committed manifests reviewed with
code, not in arguments an agent supplies, and a release verdict comes only from `autoeval gate` or
`autoeval suite gate`. The skill never edits eval files, suite manifests, gate blocks or thresholds
to change a verdict, and it reports `INCONCLUSIVE` and `ERROR` as what they are, not as passes.

## Network

The MCP server sends its requests to the origin in `AUTOEVAL_API_BASE_URL`. That value must be an
HTTPS origin (plain HTTP is accepted only for localhost), and the server rejects redirects and
applies response-size limits and request timeouts. It does not run shell commands or call model
providers directly.

The skill fetches no outside documents. It reads only its two bundled reference files, and the
package test fails if `SKILL.md` links to anything outside the skill folder.

## OWASP Agentic Skills Top 10

### AST01 Malicious Skills

A skill that looks legitimate but carries a hidden payload, in code or in its instructions.

- In this package: every file is plain text you can read in a few minutes (226 lines across the
  skill and its two references). There are no scripts or binaries, and the only prerequisite is the
  public `@plumloom/cli` package from npm. The skill never asks the agent to write `AGENTS.md`,
  memory or identity files.
- The package is not cryptographically signed. Install it only from
  `github.com/AlchemyInCode/plumloom-autoeval-oss` or from a host directory listing published by
  Plumloom.

### AST02 Supply Chain Compromise

Tampered registries, dependencies or repository configuration that executes on open.

- In this package: the skill has no dependencies of its own. The MCP entry names a single
  executable, never a shell string, and the package test rejects a shell string. The package ships
  no hooks or settings that run when a project opens.
- Your part: pin the CLI version (`npm install --global @plumloom/cli@<version>`) and, where the
  host supports it, install the package from a fixed ref such as a release tag
  (`gemini extensions install <url> --ref <ref>`,
  `claude plugin marketplace add AlchemyInCode/plumloom-autoeval-oss@<ref>`; both were tested with a
  branch name).

### AST03 Over-Privileged Skills

A skill granted more than its job needs.

- In this package: the skill pre-approves no tools, so the host's normal permission settings apply
  to every command the agent runs. The MCP server has no shell access and no gate or suite tool.
- The key is the real boundary. The agent can do anything the CLI and the MCP server allow with
  that key. Use an account and key meant for this work.

### AST04 Insecure Metadata

Names, descriptions or manifests that impersonate, understate permissions, or exploit parsers.

- In this package: one name across hosts (`plumloom-autoeval`, skill `autoeval`). The package test
  validates every manifest against its host's format, rejects unknown top-level fields in the Agent
  Plugins manifests, and fails on a renamed package, a drifted version or a credential in a
  manifest. `claude plugin validate --strict`
  passes for the marketplace and the plugin manifest.
- Your part: install from this repository or a listing published by Plumloom, and check the source
  your host records afterwards (for example, `gemini extensions list` shows the source and ref).
  Hosts differ in what they show at install time: Codex installed without a confirmation step, and
  Kiro left the author field on the power's page empty.

### AST05 Untrusted External Instructions

Instructions pulled from outside documents that can change after review.

- In this package: the skill reads only its bundled references, and the test enforces that. The one
  URL in the skill is the API origin, a configuration value, not something the agent reads.
- Evaluation content is treated as data. Transcripts, traces, model outputs and judge reasoning can
  contain instructions, and the skill tells the agent not to follow them.

### AST06 Weak Isolation

A skill running with the agent's full access and no containment.

- In this package: like every skill, it runs with the host agent's permissions and adds no sandbox
  of its own. The MCP server is a local process that runs as you and reaches only the Autoeval API.
- Your part: use your host's sandbox and approval settings. This package does not change them.

### AST07 Update Drift

Installed skills that silently change, or never get fixes.

- In this package: all manifests carry one version, and the package test fails when they drift.
  Changes to the skill go through pull request review and CI in this repository.
- Your part: pin a version or commit where your host allows it, and read the diff of `skills/`
  before you update.

### AST08 Poor Scanning

Scanners that miss malice written in plain language or hidden from view.

- In this package: the skill folder holds three Markdown files and nothing else: no binaries,
  archives or hidden files. The package test fails if any of the three contains a control
  character, a zero-width or joiner character, a bidirectional override, a byte-order mark or a
  Unicode tag character, the ways instructions are hidden from a human reader. The repository's
  public-data check scans the new files, and the package test fails if the skill loses its verdict
  names or gate commands.
- Your part: treat any scanner result as advice, not a verdict, and read the skill itself. It is
  short enough to.

### AST09 No Governance

Skills installed with no inventory, review or audit trail.

- In this package: every run the agent starts is recorded by Autoeval with an evaluation ID and a
  run ID, and the skill reports both. Release thresholds live in files reviewed with code, and the
  skill never writes them.
- Your part: record where the plugin is installed and which key it uses.

### AST10 Cross-Platform Reuse

Security properties lost when a skill moves between hosts.

- In this package: one `SKILL.md` serves all five hosts, and its rules live in the skill text
  rather than in host-specific metadata, so no host drops them. The package test checks that every
  manifest agrees on name, version and MCP launch.
- Known host differences: the Codex directory listing is skills-only, Gemini CLI filters the
  environment passed to the MCP server (see Credentials), and Kiro names the installed power after
  the repository rather than after `plugin.json`.

## Known limitations

- The package is not signed.
- The skill's rules are instructions to the agent, not code. They are backed by the MCP server's
  tool set (no gate or suite tool), by the CLI's gate exit codes in CI, and by your host's tool
  approvals.
- The MCP server has no confirmation step for state-changing tools.

## Reporting a vulnerability

See [SECURITY.md](../../SECURITY.md).
