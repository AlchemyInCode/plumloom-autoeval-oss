# Agent skill: directory submissions

Internal checklist for listing the agent skill package on each host's directory. Submissions come
from Plumloom's own accounts, because the directories bind a listing to the publisher. The package
itself is already complete in this repository; this page is only about the listing step.

The package name is permanent once a directory lists it. Claude Code's publishing guide says never
to change a published plugin's name, and Kiro warns that a rename may force users to reinstall.
The name is `plumloom-autoeval`, the skill is `autoeval`, the display name is "Plumloom Autoeval".

## Listing text

The same text is in `plugin.json` under `extensions.com.openai.interface`, so a directory that
reads the manifest gets it without retyping.

| Field             | Text                                                                                                                                                                                                                                                                                                                                                                                                         | Limit (Codex) |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| Display name      | Plumloom Autoeval                                                                                                                                                                                                                                                                                                                                                                                            | 30 (17 used)  |
| Short description | Evals and release gates                                                                                                                                                                                                                                                                                                                                                                                      | 30 (23 used)  |
| Long description  | Run Plumloom Autoeval evaluations and release gates for AI agents and LLM features. The skill checks setup, validates evaluation files without spending a run, runs an evaluation or a suite gate, and reports the PASS, FAIL, INCONCLUSIVE or ERROR verdict exactly as Autoeval returns it. It never edits evaluations or thresholds to change a verdict. Requires the autoeval CLI and a Plumloom CLI key. | 4000 (396)    |
| Developer name    | Plumloom                                                                                                                                                                                                                                                                                                                                                                                                     |               |
| Category          | Developer Tools                                                                                                                                                                                                                                                                                                                                                                                              |               |
| Keywords          | autoeval, plumloom, evals, evaluation, llm evaluation, agent evaluation, release gate, ci, mcp, validate evaluation, eval file                                                                                                                                                                                                                                                                               |               |
| Website           | https://github.com/AlchemyInCode/plumloom-autoeval-oss#readme (`interface.websiteURL`; without it the Codex plugin page shows no website)                                                                                                                                                                                                                                                                    |               |

Icon: `assets/logo.svg`, the square P mark, 512 by 512 with no scripts and no external references.
Codex wants a square icon of at least 48 by 48 in PNG, JPEG, WebP or SVG; Cursor reads the `logo`
path in `.cursor-plugin/plugin.json`; Claude Code's directory reads `icon` from
`.claude-plugin/plugin.json` if present.

## Before any submission

- The package is on `main` and the repository is public (it is).
- `pnpm test` and `claude plugin validate --strict .` pass on `main`.
- The README carries the privacy policy link and the support contact (Kiro requires both; the
  placeholders are in the "Agent skill for coding agents" section).
- Fill `homepage` and `repository` in the manifests if the repository ever moves.

## Claude Code

Two routes, and the first needs no submission:

1. **Own marketplace.** `.claude-plugin/marketplace.json` is in the repository, so
   `claude plugin marketplace add AlchemyInCode/plumloom-autoeval-oss` works as soon as the package
   is on `main`. Nothing to submit.
2. **Anthropic's directory.** Submit at `claude.ai/directory/manage` from a paid claude.ai plan,
   with a GitHub account connected that can push to this repository. The form asks for the
   repository and, if the plugin is not at the repository root, a plugin path; here the plugin is
   the root, so leave the path empty. The directory reads and scans that folder, which is the whole
   repository. Optional manifest fields the directory shows if present: `icon`, `documentationUrl`,
   `supportUrl`, `privacyPolicyUrl`, `termsOfServiceUrl`.

## Codex

The directory takes a ZIP, skills-only. Build it from the committed files, without `mcp.json`:

```bash
git archive --format=zip -o plumloom-autoeval-codex.zip main plugin.json skills assets
```

The ZIP built from the branch under review holds nine entries: `plugin.json`, `assets/logo.svg`,
`skills/autoeval/SKILL.md` and the two reference files, plus the folder entries. No `mcp.json`.

Upload it at `developers.openai.com/plugins/deploy/submission`. An organization owner can submit;
other members need the Apps Management Write role, and the organization must have completed
identity verification. A skills-only plugin needs no MCP review cases and no demo recording, and
its metadata validation does not require all four policy URLs. The dashboard needs the primary
icon before submission.

One thing to decide now: OpenAI does not currently support adding an MCP server to an existing
skills-only plugin. A later Codex listing with the MCP server means a new listing, and it would
need the server on a public HTTPS URL or local-MCP support arranged through an OpenAI contact.

## Cursor

Submit the public repository address at `cursor.com/marketplace/publish`. Every plugin is reviewed
by hand. Cursor's checklist: a valid manifest, a lowercase hyphenated name that is not already
taken, a clear description, a committed logo referenced by relative path (`assets/logo.svg`), a
README with usage and configuration, and a local test. The local test is recorded in
`docs/public/integration-agent-skill.md`.

## Gemini CLI

No form. The gallery crawls public repositories that carry the GitHub topic
`gemini-cli-extension` and have `gemini-extension.json` at the repository root, once a day:

```bash
gh repo edit AlchemyInCode/plumloom-autoeval-oss --add-topic gemini-cli-extension
```

Until the topic is set, `gemini extensions install <repository>` already works.

## Kiro

Form at `kiro.dev/powers/submit` with the public repository address, which must contain
`plugin.json` at the root (it does). Kiro's conditions: `plugin.json` carries `$schema`, `name`,
`version`, `description`, `author`, `keywords` and `license` (all present); the README includes a
privacy policy link and a support contact; MCP servers, if used, are not in beta or preview. The
form is a request: Kiro contacts the publisher if the power fits its registry.

Kiro names an imported power after the repository (`plumloom-autoeval-oss`) and shows the
`plugin.json` name on the power's page.

## After listing

Record each listing's address and the version listed, and treat a version bump as a change to all
manifests at once (the package test fails when they drift).
