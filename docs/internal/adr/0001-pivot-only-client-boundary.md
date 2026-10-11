# ADR 0001: API-Only Client Boundary

- Status: Accepted
- Date: 2026-08-11

## Context

Autoeval needs evaluation lifecycle access while the Autoeval API already owns authentication,
authorization, entitlements, billing, provider configuration, and evaluation-service authentication.

## Decision

Autoeval communicates only with the fixed Autoeval API HTTPS endpoint at `https://api.plumloom.ai`
and its existing `/api/v1` routes. Runtime endpoint construction is centralized and does not accept
arbitrary origins or paths. Autoeval contains no evaluation-service credential or direct
evaluation-service transport.

## Consequences

- The Autoeval API remains the authorization and entitlement authority.
- Provider credentials remain server-side.
- Missing API capabilities are reported rather than bypassed.
- Contract tests and a source-boundary regression test guard against direct downstream access.
