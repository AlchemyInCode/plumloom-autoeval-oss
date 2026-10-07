# Autoeval agent skill: install and verify

The agent skill package teaches a coding agent to run Autoeval and report the verdict it returns.
One skill, `skills/autoeval/SKILL.md`, serves Claude Code, Codex, Cursor, Gemini CLI and Kiro;
each host reads its own manifest at the repository root. The package adds no code: the skill drives
the `autoeval` CLI, and the manifests for Claude Code, Codex, Cursor and Kiro register the local
`autoeval-mcp` server. For what the package can and cannot do, see
[Agent skill security and permissions](./agent-skill-security.md).

Claude Code, Codex, Cursor and Kiro run Autoeval end to end. Gemini CLI is skill-only for now: the
extension installs and the skill triggers, but the extension registers no MCP server and end-to-end
Autoeval execution from Gemini CLI is not currently supported.

## Prerequisites

- Node.js 22.13 or newer and the published CLI: `npm install --global @plumloom/cli`. This
  installs the `autoeval` and `autoeval-mcp` executables the package relies on.
- `AUTOEVAL_API_BASE_URL` in the shell your agent runs commands in. Plumloom's hosted service is
  `https://api.plumloom.ai`; the manifests that register the MCP server pass the same value to it.
- One `autoeval login` on the machine. The key goes to the OS credential store, where both the CLI
  and the MCP server read it. The skill never asks for a key and never passes one on a command
  line.

Everything below was run on 2026-10-06 on Windows 11 against the package in pull request #5,
installed from the fork that holds it. The commands show the repository's own address,
which is where they point once the package is on `main`.

## Claude Code

Install from the marketplace file in this repository:

```bash
claude plugin marketplace add AlchemyInCode/plumloom-autoeval-oss
claude plugin install plumloom-autoeval@plumloom
```

Append `@<tag-or-branch>` to the marketplace address to install from a specific ref.

Check it:

```bash
claude plugin list
claude mcp list
```

`claude plugin list` shows `plumloom-autoeval@plumloom` with `Status: ✔ enabled`, and
`claude mcp list` shows `plugin:plumloom-autoeval:plumloom-autoeval: autoeval-mcp - ✔ Connected`.
Inside a session the skill is `plumloom-autoeval:autoeval`. Verified with Claude Code 2.1.289.

Two notes:

- `claude plugin list` adds a note that the packages were not installed because the plugin uses a
  yarn or pnpm lockfile. The lockfile is this repository's `pnpm-lock.yaml`, which Claude Code sees
  because the package root is the repository root. The skill needs no packages, so nothing is
  missing.
- `claude plugin install` copies the whole repository into the plugin cache, including `packages/`
  and `docs/`.

Remove it with `claude plugin uninstall plumloom-autoeval@plumloom` and
`claude plugin marketplace remove plumloom`.

## Codex

Codex reads the Agent Plugins manifest at the repository root and lists the repository through
`.agents/plugins/marketplace.json`. With the Codex CLI, per OpenAI's plugin documentation (the CLI
path was not part of this test):

```bash
codex plugin marketplace add AlchemyInCode/plumloom-autoeval-oss
```

then install `plumloom-autoeval` from the plugin browser. In Codex in the ChatGPT desktop app,
which has no CLI, add a personal marketplace file at `~/.agents/plugins/marketplace.json`:

```json
{
  "name": "plumloom",
  "interface": { "displayName": "Plumloom" },
  "plugins": [
    {
      "name": "plumloom-autoeval",
      "source": {
        "source": "url",
        "url": "https://github.com/AlchemyInCode/plumloom-autoeval-oss.git"
      },
      "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
      "category": "Developer Tools"
    }
  ]
}
```

Add `"ref": "<tag-or-branch>"` to `source` to pin a ref. Restart the app, open **Plugins**, choose
**Personal**, and install **Plumloom Autoeval**. The plugin page then lists one MCP server and one
skill, `Autoeval`. Codex copies the whole repository to
`~/.codex/plugins/cache/<marketplace>/plumloom-autoeval/0.1.0/`. Verified in the ChatGPT desktop
app 26.930.6422.0 (Codex 0.160.0) on Windows.

Two notes:

- On Windows, the desktop app runs the agent's commands in a sandbox that, in this test, did not
  find the globally installed `autoeval` command and had no network access. The agent then reported
  that it could not run the CLI and started nothing. The MCP server is a separate process, and
  Codex's log showed it initialized. With the chat's permission set to Full access, a request to
  gate `examples/agent-skill/pass.suite.yaml` ran end to end and returned `PASS` (2026-10-07).
  Full access turns off the sandbox and the approval prompts, so the agent runs commands, uses the
  network and edits files anywhere without asking, which raises the stakes of any instruction hidden
  in evaluation content. Use it only in a folder you trust, and set the chat back to asking for
  approval when you are done.
- MCP tool calls follow your Codex approval settings. To be asked before every Autoeval tool, add
  this to `~/.codex/config.toml`, using the `plugin@marketplace` key Codex wrote when you installed:

  ```toml
  [plugins."plumloom-autoeval@plumloom".mcp_servers.plumloom-autoeval]
  default_tools_approval_mode = "prompt"
  ```

The Codex directory listing is skills-only: the ZIP submitted there is built from `plugin.json`,
`skills/` and `assets/` and leaves out `mcp.json`. The MCP server can still be registered by hand;
see [Autoeval with Codex and Claude Code](./integration-codex-and-claude-code.md).

Remove the plugin from its page in the plugin browser, and delete the personal marketplace file if
you added one.

## Cursor

Cursor reads the Agent Plugins manifest at the repository root (`plugin.json`, `skills/`,
`mcp.json`). For a local install, put the repository contents in Cursor's local plugin folder:

```bash
git clone https://github.com/AlchemyInCode/plumloom-autoeval-oss
mkdir -p ~/.cursor/plugins/local/plumloom-autoeval
git -C plumloom-autoeval-oss archive HEAD | tar -x -C ~/.cursor/plugins/local/plumloom-autoeval
```

Cursor loads plugins from that folder without further registration. Check it from the Cursor
terminal agent:

```bash
agent -p --mode ask "List the skills and MCP servers you have."
```

The answer lists `autoeval` among the skills and `plugin-plumloom-autoeval-plumloom-autoeval` as
an MCP server; Cursor prefixes a plugin's MCP server with `plugin-<package>-`. Verified with Cursor
3.22.12 and the Cursor terminal agent 2026.10.01 on the Pro plan.

Remove it by deleting the folder.

## Gemini CLI

Gemini CLI is skill-only for now. The extension installs the skill and registers no MCP server, and
end-to-end Autoeval execution from Gemini CLI is not currently supported. The trigger results
further down cover skill activation only.

```bash
gemini extensions install https://github.com/AlchemyInCode/plumloom-autoeval-oss
```

Add `--ref <tag-or-branch>` to pin a ref, and `--consent` in a non-interactive shell, where the
third-party confirmation prompt cannot be answered.

Check it:

```bash
gemini extensions list
gemini skills list
gemini mcp list
```

`gemini extensions list` shows `✓ plumloom-autoeval (0.1.0)` with the agent skill `autoeval` and no
MCP servers; `gemini skills list` shows `autoeval [Enabled]`; and `gemini mcp list`, on a machine
with no other MCP servers configured, shows `No MCP servers configured.` Verified with Gemini CLI
0.63.0 on 2026-10-07.

In a non-interactive run (`gemini -p`) with the default approval mode, Gemini CLI offers no
`activate_skill` tool: the model chooses the skill, and the call returns
`Tool "activate_skill" not found`. Allow that one tool, for example with
`--allowed-tools activate_skill`, and the skill loads.

Remove it with `gemini extensions uninstall plumloom-autoeval`.

## Kiro

In the Kiro IDE, open the Powers panel, choose **Add Custom Power**, then **Import power from
GitHub**, and paste `https://github.com/AlchemyInCode/plumloom-autoeval-oss`. To install a branch,
append `/tree/<branch>` to the address.

Kiro names the installed power after the repository, `plumloom-autoeval-oss`, and shows the
`plugin.json` name on the power's page, with the skill `autoeval` under Skills and the contents of
`mcp.json` under MCP Configuration. Kiro keeps that MCP configuration inside the power; it does not
write to `~/.kiro/settings/mcp.json`. Verified with Kiro IDE 1.2.37.

With Autopilot off, Kiro asked before activating the power and before each MCP tool call. Keep it
off for the state-changing tools listed in the security page.

To install from a local checkout instead, choose **Import power from a folder** and select a folder
named `plumloom-autoeval-oss` that holds the package files; Kiro names the power after the folder.

Remove it from the power's page with **Uninstall**.

## Skill only, with the skills CLI

The open `skills` CLI installs the skill without a host plugin:

```bash
npx skills add AlchemyInCode/plumloom-autoeval-oss --skill autoeval -a claude-code -a codex --copy
```

It copies `skills/autoeval/` into the project, `.claude/skills/autoeval/` for Claude Code and
`.agents/skills/autoeval/` for agents that read that folder, and records the source in
`skills-lock.json`. Add `-g` to install for your user instead of the project. This path installs
the skill only: the MCP server is not registered, and the skill works through the `autoeval` CLI.
The CLI sends anonymous usage telemetry unless `DISABLE_TELEMETRY=1` or `DO_NOT_TRACK=1` is set.

Verified with `skills` 1.7.0, installing from the branch under review into an empty project: both
folders held the three skill files, identical to the repository, and `npx skills ls` listed
`autoeval` for Claude Code, Codex, Cursor, Gemini CLI and GitHub Copilot.

## Trigger test

The same ten prompts were run on every host, after the method OpenAI describes for skill evals:
two name the skill, four describe the task without naming it, and four are near-miss requests that
must not trigger it.

| ID  | Kind     | Should trigger | Prompt                                                                                                      |
| --- | -------- | -------------- | ----------------------------------------------------------------------------------------------------------- |
| E1  | explicit | yes            | Use the autoeval skill to check my Autoeval setup without starting a run.                                   |
| E2  | explicit | yes            | With the Plumloom Autoeval skill, explain what an INCONCLUSIVE verdict means and what I should do about it. |
| I1  | implicit | yes            | Run the eval suite in examples/suite and tell me whether this release passes the gate.                      |
| I2  | implicit | yes            | Is this change safe to release? Check the evaluation results before you answer.                             |
| I3  | implicit | yes            | The last release gate came back inconclusive. Why would that happen?                                        |
| I4  | implicit | yes            | Validate examples/evals/conversation-success.json without spending a run.                                   |
| N1  | negative | no             | Write a Python function that evaluates a postfix expression.                                                |
| N2  | negative | no             | How do I gate a feature behind a flag in React?                                                             |
| N3  | negative | no             | Summarize the README in this folder in three sentences.                                                     |
| N4  | negative | no             | What does exit code 2 usually mean for a Unix command line tool?                                            |

Each prompt ran in a fresh session from a folder holding only this repository's `examples/` and
`README.md`. Claude Code, Cursor and Gemini CLI ran headless and their event streams were read for
the skill-activation event; on Codex and Kiro the prompts were typed in the app and the host's own
session logs were read. "Triggered" means the host loaded the skill, not that the agent then
followed it. Sessions that never reached the model, for example
on a usage limit, count as invalid rather than as a result.

| Host        | Version                                       | Mode and tools                                                                                                                                        | Triggered when                                                                                      | Result                                                                              |
| ----------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Claude Code | 2.1.289, Claude Sonnet 5.5                    | `claude -p`, only the Skill, Read, Glob and Grep tools allowed; shell, file writes and the MCP tools blocked                                          | the `Skill` tool loaded `plumloom-autoeval:autoeval`                                                | 10 of 10 as expected                                                                |
| Cursor      | terminal agent 2026.10.01, Pro                | `agent -p --mode ask`; MCP, shell and web fetch are rejected in ask mode                                                                              | the agent read `skills/autoeval/SKILL.md`                                                           | 10 of 10 as expected                                                                |
| Gemini CLI  | 0.62.0, gemini-3.8-flash, paid key            | `gemini -p`, default approval mode, `--allowed-tools activate_skill`, and a policy file denying shell commands, sub-agents and the Autoeval MCP tools | `activate_skill` for `autoeval` returned success                                                    | 10 of 10 as expected (skill activation only; end-to-end execution is not supported) |
| Kiro        | IDE 1.2.37, free plan                         | typed in the IDE, Autopilot off; power activation approved, every MCP tool call and command declined (on E1, read-only tools were approved)           | the agent called `kiro_powers` to activate `plumloom-autoeval-oss`                                  | 9 of 10 as expected with the first description; I4 then 3 of 3 after the fix below  |
| Codex       | ChatGPT desktop app 26.930.6422.0, gpt-6-luna | typed in a new chat, approval on request, every Autoeval MCP tool set to ask and each request declined                                                | the agent read `skills/autoeval/SKILL.md` (Codex lists the skill with its path; the agent opens it) | 10 of 10 as expected, 1 empty session invalid                                       |

No evaluation was created and no credit was spent during the trigger runs: the tools that could
have done so were blocked or rejected on every host, and the only Autoeval tools approved, on
Kiro's E1, were read-only (`get_current_user`, `list_workspaces`,
`validate_configured_evaluation`). The evaluation counts in the test account's
workspaces were the same before and after the runs.

Observations worth knowing:

- The Gemini CLI run was made on 2026-10-06, when the extension still registered the Autoeval MCP
  server; the policy file denied its tools in every run.
- On 2026-10-06 a free AI Studio key allowed 20 requests a day each for `gemini-2.5-flash` and
  `gemini-3.8-flash`, and one prompt takes several requests, so the Gemini CLI run used a paid
  key. That key was refused `gemini-2.5-flash` ("no longer available to new users") and ran on
  `gemini-3.8-flash`.
- On Kiro, with the skill loaded, the agent followed the skill's first step on its own: it checked
  authentication, listed workspaces, and pointed out that the example files carry placeholder model
  IDs.
- On Kiro, I4 missed four times out of four with the first `plugin.json` description, which named
  evaluations and release gates but not validating a file without a run. Without the skill, the
  agent checked the file by reading it and marked the placeholder judge ID as valid each time.
  Adding that use to the `plugin.json` description and two keywords fixed it: I4 then triggered
  three times out of three, and N1 to N4, run again, still did not trigger. Only `plugin.json`
  changed; the skill's own description in `SKILL.md`, which the other hosts use, is the same.

## Recorded sample runs

The three examples in `examples/agent-skill/` were run on 2026-10-06 against the hosted service with
the published CLI (`@plumloom/cli` 0.1.2) and GLM 5.2 as judge:

```bash
autoeval --json suite gate --manifest examples/agent-skill/<name>.suite.yaml \
  --workspace "$WORKSPACE_ID" \
  --judge-model-id "$JUDGE_MODEL_ID"
```

| Manifest                  | Verdict        | Exit                            | Scores                                                         |
| ------------------------- | -------------- | ------------------------------- | -------------------------------------------------------------- |
| `pass.suite.yaml`         | `PASS`         | `0`                             | completeness 4.60, helpfulness 4.60                            |
| `fail.suite.yaml`         | `FAIL`         | `1` (`SUITE_GATE_FAIL`)         | completeness 1.60, helpfulness 2.16                            |
| `inconclusive.suite.yaml` | `INCONCLUSIVE` | `1` (`SUITE_GATE_INCONCLUSIVE`) | not gated: "no metric thresholds are configured for this eval" |

Each run created one evaluation and one run. An earlier run of the pass example, gated on
factuality at 3.5, came back `FAIL`: factuality 2.86, relevance 2.72, completeness 4.20 and
helpfulness 4.20, with the judge's note that the transcript invents the confirmation number
`DEMO-1042`. That is why the examples gate on completeness and helpfulness. Scores move between runs
of the same transcript (4.20 and 4.60 here), so keep a margin between a threshold and the scores you
expect.

The pre-flight for the three examples was run the same day with `--workspace` and
`--judge-model-id`: every manifest reported five passing checks and exited `0`. Without the
overrides each one was blocked on the placeholder workspace and judge ID, as designed.
