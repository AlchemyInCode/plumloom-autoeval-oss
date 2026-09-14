# Coding Standards

These are the repository’s default standards for humans and coding agents. Follow existing language and framework conventions where they conflict with this document. Consistency within the repository is more important than individual preference.

## Principles

- Optimize for correctness, security, clarity, testability, and maintainability.
- Prefer simple, explicit, idiomatic code over clever or overly abstract code.
- Keep functions, modules, classes, and pull requests narrowly focused.
- Make invalid states hard to represent using types, schemas, validation, and small interfaces.
- Avoid duplication of important business rules, but do not extract an abstraction until it has a clear responsibility and name.
- Use the configured formatter. Formatting is automated, not a review debate.

## Naming

Names must communicate intent, domain meaning, and units. Prefer complete, recognizable words over abbreviations.

### General rules

- Use one term for one concept throughout the repository. Do not alternate between `account`, `customer`, and `client` unless they have distinct meanings.
- Use clear domain terms: `customer_account`, not `cust_acct`; `authorization_policy`, not `authz_mgr`.
- Avoid unexplained acronyms. Common technical terms such as `API`, `URL`, `HTTP`, `JSON`, `SQL`, `UUID`, and `ID` are acceptable when they improve clarity.
- Do not encode a value’s type in its name: use `users`, not `user_list`; use `is_enabled`, not `enabled_bool`.
- Avoid vague names such as `data`, `info`, `thing`, `value`, `result`, `manager`, `helper`, `util`, `misc`, `handle`, `process`, or `do` unless the very small local scope makes the meaning unambiguous.
- Single-letter names are allowed only for a conventional, tiny local loop.
- Include units where ambiguity is possible: `timeout_seconds`, `max_bytes`, `retry_count`, `created_at_utc`.
- Names must not misrepresent a value’s unit, ownership, mutability, authorization status, or lifecycle.

### Values and functions

Use the standard casing of the repository’s language: normally `snake_case` for Python and `camelCase` for TypeScript/JavaScript.

- Values are nouns: `active_subscription`, `request_headers`, `parsed_payload`.
- Collections are plural: `users`, `pending_jobs`, `validation_errors`.
- Functions and methods are precise verbs: `parse_request`, `validate_signature`, `create_session`, `send_notification`.
- Boolean values read as predicates: `is_active`, `has_access`, `can_retry`, `should_redact`.
- Avoid behavior-changing boolean parameters. Prefer a named options object or a separate function when behavior differs materially.
- Functions with side effects should reveal them through their name, interface, or documentation: `write_audit_event`, `delete_expired_session`, `send_email`.

### Types, classes, and interfaces

Use the language’s standard type casing: normally `PascalCase` for Python and TypeScript.

- Use singular, meaningful nouns: `Invoice`, `WebhookPayload`, `AuthorizationPolicy`.
- Name types for their capability or domain role: `SignatureVerifier`, `PaymentGateway`, `AuditLog`, `UserRepository`.
- Do not use redundant suffixes such as `Data`, `Info`, `Object`, `Class`, `Interface`, or `Impl` unless they distinguish a real public concept.
- Do not expose an implementation detail in a public name unless that implementation is the intended contract.

### Constants, errors, and external contracts

- Follow the ecosystem’s constant convention; in Python, use `UPPER_SNAKE_CASE`.
- Name constants for their meaning rather than their literal value: `DEFAULT_REQUEST_TIMEOUT_SECONDS`, not `THIRTY`.
- Error types name the failed condition: `InvalidSignatureError`, `AccountNotFoundError`, `RateLimitExceededError`.
- Error messages state what failed and a safe next step when useful. They never include secrets, authorization values, private data, stack traces, or internal paths.
- Use stable, explicit field names for persisted database columns and public API payloads. Do not rename them without a migration and compatibility plan.

## Code structure

- Keep each file and module focused on a discoverable responsibility.
- Keep I/O, framework glue, and provider-specific integration at the boundaries; keep domain logic deterministic and easy to test where practical.
- Prefer guard clauses to deeply nested conditionals.
- Prefer explicit transformations to mutation that crosses distant scopes.
- Keep public interfaces small. Do not expose internal implementation details by default.
- Extract a function when it gives a cohesive operation a better name or makes testing meaningfully easier—not simply to reduce line count.
- Use comments to explain intent, constraints, security reasoning, or non-obvious trade-offs. Do not comment obvious code. Do not leave commented-out code; version control preserves history.

## Input, errors, and logging

- Validate external data at the boundary and convert it to trusted domain data before use.
- Handle expected failures deliberately. Do not use broad exception handling that hides failures or converts unsafe input into a success case.
- Preserve useful error context without exposing sensitive data.
- Use structured logs when the project supports them, with clear event names and safe identifiers.
- Never log passwords, tokens, API keys, session identifiers, private keys, raw authorization headers, or sensitive payloads.

## Testing

- Test observable behavior, not private implementation details.
- Include happy paths, edge cases, validation failures, authorization failures, and regressions appropriate to the change.
- Name tests as specifications, for example: `rejects_request_when_signature_is_invalid`.
- Each test should have one clear reason to fail.
- Keep tests deterministic by controlling time, randomness, network calls, and external services.
- Use small, readable fixtures and builders. Never use real credentials, customer data, or production identifiers.
- Do not weaken production validation or delete coverage to make a test pass.

## Documentation

- Update public documentation with behavior, configuration, permissions, error handling, constraints, and security assumptions that users or contributors need.
- Keep examples minimal, runnable, and safe.
- Record consequential architectural decisions under `docs/internal/adr/`.

## Review checklist

Before requesting review, verify:

- Names reveal intent and use consistent domain terminology.
- The diff contains no unrelated formatting churn or refactors.
- External inputs are validated at trust boundaries.
- Error handling and logs are useful without exposing sensitive data.
- Tests cover changed behavior and important negative paths.
- Applicable formatter, linter, type checker, tests, build, and security checks have run.
- Documentation and configuration examples are accurate.
