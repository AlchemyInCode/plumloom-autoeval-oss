# AGENTS.md

## Purpose

This is an open-source repository. Make changes that are secure, correct, readable, maintainable, and straightforward for a human reviewer to understand.

Read this file, `CODING_STANDARDS.md`, `README.md`, and relevant nearby code before working. Repository conventions override generic preferences when they are clear and safe.

## Operating rules

1. Understand the existing implementation before changing it.
2. For a non-trivial task, first provide a short plan: goal, affected files, approach, risks or assumptions, and verification steps. Wait for approval when the task changes architecture, public APIs, data models, authentication/authorization, dependencies, infrastructure, or deployment.
3. Make the smallest focused change that fully solves the requested problem.
4. Do not edit unrelated files, perform opportunistic refactors, reformat unrelated code, rename public APIs, or upgrade dependencies unless explicitly asked.
5. Do not invent product requirements. Ask concise clarifying questions when a decision materially affects behavior, security, or public compatibility.
6. Do not claim that code, tests, builds, or security checks passed unless they were actually run.
7. Do not weaken, skip, delete, or rewrite tests, validation, authorization, encryption, logging, or error handling merely to get a passing result.

## Code standards

Follow `CODING_STANDARDS.md` for naming, code structure, errors, logging, testing, and documentation.

- Use the project’s configured formatter, linter, type checker, and test framework; do not impose a different style.
- Prefer explicit, idiomatic code over cleverness, premature abstraction, or compressed expressions.
- Keep public interfaces stable unless a breaking change is explicitly approved and documented.
- Preserve established terminology. Use one name for one domain concept.
- Add comments only for non-obvious intent, constraints, security reasoning, or trade-offs.

## Security requirements

Treat every external value as untrusted, including HTTP requests, CLI arguments, environment variables, files, webhooks, queue messages, database values from untrusted sources, and third-party API responses.

- Never commit, display, log, test with, or place in documentation any real secret, credential, private key, access token, session value, production data, or personal data.
- Never expose secrets, sensitive payloads, stack traces, internal paths, or security-sensitive implementation details in user-facing errors.
- Validate and normalize untrusted inputs at trust boundaries before business logic uses them.
- Use parameterized queries or trusted ORM/query-builder mechanisms. Never interpolate untrusted input into SQL, shell commands, HTML, file paths, URLs, or code.
- Avoid shell execution. If unavoidable, use a fixed executable and argument array, strict allow-lists, no shell interpolation, and bounded time/resources.
- Enforce authentication and authorization on the server for every protected operation. Client-side checks are not authorization.
- Apply least privilege to credentials, services, files, databases, and integrations.
- Use maintained libraries and standard secure primitives. Do not implement cryptography, password hashing, token signing, or authorization schemes from scratch.
- Bound untrusted resource consumption: request/body/file sizes, timeouts, retries, pagination, concurrency, redirects, recursion, and decompression.
- Do not add dependencies unless the benefit is clear and a maintained, secure alternative is not already available in the project or standard library.
- Explicitly report security implications for changes involving dependencies, authentication, authorization, data access, networking, filesystem access, parsers, serialization, CI, secrets, or deployment.

## Tests and verification

Before completing a task:

1. Identify the repository’s documented commands in `README.md`, package/build configuration, CI workflows, and existing contributor documentation.
2. Add or update tests for changed behavior. Include failure, validation, permission, and regression tests where relevant.
3. Run every applicable formatter, linter, type checker, test suite, build, and targeted security check available in the repository.
4. Keep tests deterministic. Do not require live production services, real credentials, or uncontrolled network access.
5. If a relevant check cannot run, state the exact command, why it did not run, and what remains unverified.

## Documentation and open source

- Update `README.md` whenever installation, configuration, public behavior, usage, or compatibility changes.
- Keep configuration documented with safe example values only. Provide an `.env.example` when configuration uses environment variables.
- Document public APIs, permissions, expected errors, operational limits, and meaningful security assumptions.
- Add a short architecture decision record under `docs/internal/adr/` for consequential decisions affecting security, public APIs, data models, reliability, or operating cost.
- Do not make unsubstantiated performance, security, or compliance claims.

## Definition of done

A task is complete only when the change is focused, readable, secure at its trust boundaries, tested, and documented as needed; applicable checks have been run; and the final report includes:

- What changed and why
- Files added or modified
- Commands run and their actual results
- Security-relevant decisions
- Known limitations, risks, or follow-up work
