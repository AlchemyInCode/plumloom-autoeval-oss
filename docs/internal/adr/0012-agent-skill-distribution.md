# ADR 0012: Distribute one agent skill through thin host manifests

- Status: Proposed
- Date: 2026-10-05

## Context

Coding agents load reusable instructions as Agent Skills and install them through host-specific
packages: Claude Code plugins, Agent Plugins for Codex, Cursor and Kiro, and Gemini CLI extensions.
Autoeval already has a deterministic CLI and a local stdio MCP server, so the missing piece is
distribution, not behaviour.

Every host loads skills from a `skills/` folder inside the package root, and the Agent Plugins
specification rejects package paths that resolve outside that root. Gemini CLI installs an
extension from a repository only when `gemini-extension.json` is at the repository root or at the
root of a release archive, and this repository publishes no release archives.

## Decision

The repository root is the package root. It holds one canonical skill, `skills/autoeval/`, and one
manifest per host format:

- `plugin.json` and `mcp.json` in Agent Plugins 1.0.0 format, read by Codex, Cursor and Kiro;
- `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` for Claude Code;
- `gemini-extension.json` for Gemini CLI;
- `.cursor-plugin/plugin.json` for the Cursor listing logo;
- `.agents/plugins/marketplace.json` so Codex can install from this repository.

The skill adds no runtime code and no API calls. It directs the agent to the existing CLI and MCP
server. A release verdict comes only from `autoeval gate` or `autoeval suite gate`; the skill forbids
editing evaluation files, suite manifests or thresholds to change a verdict.

Manifests launch the published `autoeval-mcp` binary by name and carry no credential. All manifests
share one package name and one version, enforced by `packages/cli/tests/agent-skill-package.test.ts`.

## Consequences

- One skill file serves five hosts, and the existing checks cover the package: formatting, the
  public-data scan, and an offline test of every manifest.
- The repository root gains eight entries. Hosts that copy a package copy the whole repository.
- The Codex directory listing is skills-only. OpenAI does not currently support adding an MCP
  server to an existing skills-only plugin, so adding one later means a new listing.
- Live behaviour on each host needs accounts and network access, so trigger tests run by hand and
  their results are recorded in the integration guide rather than in CI.
- The manifests set `AUTOEVAL_API_BASE_URL` to the hosted origin, `https://api.plumloom.ai`, so the
  MCP server starts without extra setup. Confirmed in review on 2026-10-06: for people using the
  skill, the public docs and the published product are the source of truth, and both use the hosted
  origin. ADR 0011 still governs the CLI, which keeps no compiled-in origin. Users set the variable
  themselves only to extend Autoeval or to target a different backend.
