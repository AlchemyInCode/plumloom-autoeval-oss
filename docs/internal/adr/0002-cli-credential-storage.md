# ADR 0002: CLI Credential Storage

- Status: Accepted
- Date: 2026-08-11

## Context

Autoeval authenticates with a long-lived `pl_sk_` key. Plaintext configuration files, command arguments, browser-session reuse, and custom encryption would create unnecessary exposure.

## Decision

Credential resolution uses this precedence:

1. `AUTOEVAL_API_KEY` environment variable;
2. OS credential store;
3. masked TTY prompt when explicitly allowed.

Prompted credentials are validated through the Autoeval API before storage. Environment credentials are never persisted. Logout removes only the OS credential-store entry. No plaintext file fallback is provided.

The credential is held only by the authentication boundary and authenticated API request code. Logging, errors, debug output, domain objects, action inputs, tests, and fixtures must not contain a real or complete key.

## Consequences

- CI can provide an ephemeral environment credential.
- Desktop users receive OS-managed at-rest storage.
- Headless systems without a keyring must use the environment variable.
- Native keyring packaging and supported-platform behavior require dependency review.
