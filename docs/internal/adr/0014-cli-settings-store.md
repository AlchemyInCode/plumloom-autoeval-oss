# ADR 0014: On-disk CLI settings store

- Status: Accepted
- Date: 2026-10-16

## Context

Until now the CLI held no on-disk configuration. Every command that needs a
workspace or model required the UUID on each invocation, which blocks the
activation goal of "install to first finished evaluation with zero hand-copied
IDs" (SPEC-01). Persisting non-secret defaults (default workspace and model
roles) removes that friction and lets `autoeval init` save what it resolved so
later runs need no flags.

This is the first file the CLI writes for its own configuration, so it sets
precedent for location, format, validation, permissions, and — most importantly
— what must never be stored.

## Decision

Introduce a single JSON settings file holding only non-secret user defaults:

```
version: 1
defaultWorkspaceId?: string
defaultJudgeModelId?: string
defaultPrimaryModelId?: string
telemetryOptIn?: boolean   // field reserved for SPEC-02; unused here
```

- **Location.** `$XDG_CONFIG_HOME/autoeval/settings.json`, else
  `~/.config/autoeval/settings.json` on all platforms (via `os.homedir()`).
- **Permissions.** The file is written `0600` through an atomic
  temp-file-plus-rename so a partial write never replaces a good file. The temp
  file is created with `O_EXCL` (the `wx` flag) under a random name and
  `fsync`ed before the rename, so the writer never follows or overwrites a
  pre-planted file or symlink at the temp path.
- **Validation.** The file is untrusted input: it is parsed with Zod at the
  trust boundary, unknown keys are dropped, and a missing or corrupt file
  degrades to defaults (`{ version: 1 }`) without throwing. A diagnostic is
  emitted only under `--debug`.
- **No secrets.** The API key continues to live only in the OS keyring
  (ADR 0002); it is never read into or written from this file. Every stored ID is checked for the
  CLI credential shape on both load and save. A credential-bearing existing file is discarded as
  invalid, and diagnostics never include its contents.
- **No endpoint override.** Consistent with ADR 0011, the settings store adds no
  API base URL or origin field, environment, or alias of any kind.
- **Resolution precedence.** Wherever a workspace or model is needed:
  explicit flag → settings default → existing interactive/auto behavior
  (`selectQuickstartWorkspace` / `selectQuickstartModel`). Shared activation resolution and
  sequencing live in the action layer; other commands apply the same fallback before their action
  call. Commands that declare a required workspace/model flag keep their Commander semantics
  unchanged and remain backward compatible.

## Consequences

- `autoeval config set-workspace/set-judge-model/set-primary-model/show/clear`
  manage these defaults locally and work offline; IDs are stored as-is and
  validated lazily when used, so a stale or wrong ID surfaces the existing
  "not enabled / not found" errors rather than failing the write.
- `autoeval init` and `autoeval pack run` can resolve a workspace and models
  with no flags once defaults are saved.
- The reserved `telemetryOptIn` field lets SPEC-02 add opt-in telemetry without
  a second settings migration.
- A new on-disk surface widens the attack/privacy surface slightly; it is
  mitigated by `0600` permissions, strict validation, dropping unknown keys,
  and the hard rule that no credential is ever written here.
