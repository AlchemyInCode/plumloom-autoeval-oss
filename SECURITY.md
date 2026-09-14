# Security Policy

## Supported versions

Security fixes are applied to the latest revision of the default branch and to the most recent published `@plumloom/cli` release while Autoeval is pre-release. Older published versions do not receive backports.

## Reporting a vulnerability

Report privately through GitHub security advisories: https://github.com/plumloom-org/plumloom-autoeval/security/advisories/new

Do not open a public issue containing a vulnerability, credential, private response payload, account identifier, or reproduction using production data. Do not report Autoeval vulnerabilities through public discussion channels or the issue tracker.

Include a concise description, affected revision or published version, impact, and a minimal reproduction with synthetic values. Never include a real `pl_sk_` key, browser/session token, provider API key, evaluation-service credential, or full authorization header.

Expect an acknowledgement within five business days and a remediation plan or an explanation of why the report is out of scope within ten business days. Please allow a fix to ship before public disclosure; we will credit reporters who ask to be credited.

## Security boundary

Autoeval sends authenticated evaluation and account requests only to the configured Autoeval API origin. It does not call model providers or evaluation services directly; identity, ownership, entitlements, provider credentials, and evaluation-service access remain server-side.

The CLI:

- accepts only Plumloom `pl_sk_` CLI keys;
- prefers `AUTOEVAL_API_KEY`, then the OS credential store;
- stores only successfully validated, interactively prompted keys;
- never stores environment-provided keys;
- never stores browser sessions or provider credentials;
- rejects redirects and non-HTTPS non-localhost origins;
- bounds request time, response size, read retries, and polling;
- validates untrusted CLI and API values;
- redacts credential patterns and credential-shaped fields from output.

## Credential hygiene

Use `autoeval logout` to remove Autoeval's local keyring entry. This does not revoke a key; revoke compromised credentials through Plumloom account controls.

Avoid shell history exposure. Although `autoeval login --key` is available for non-interactive use,
prefer a secret store that injects `AUTOEVAL_API_KEY` so the credential does not appear in process
arguments. Do not enable shell tracing around credentials.

`--debug` is designed to contain only method, fixed path, status, duration, attempt, request ID, and upstream error code. Treat debug logs as operational data and inspect them before sharing.

## Dependency and endpoint changes

New runtime dependencies, origins, endpoints, credential types, or authorization behavior require explicit review and an architecture decision record. Do not work around a missing API capability by calling another service directly.
