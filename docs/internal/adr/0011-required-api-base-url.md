# ADR 0011: Use one fixed public API endpoint

## Status

Accepted.

Date: 2026-10-11.

## Context

The public CLI originally required users and integrations to configure an API origin. Autoeval is
one hosted service, so exposing endpoint selection added setup, documentation, and CI surface area
without a supported public use case. It also let a misspelled or untrusted environment value
redirect authenticated requests away from Plumloom.

## Decision

The public CLI and MCP server always connect to `https://api.plumloom.ai`. They expose no API URL
setting, environment variable, flag, manifest input, or compatibility alias. Existing internal
transport and client injection remains available only to keep automated tests deterministic and
network-free; it is not a public endpoint override.

## Consequences

CLI, MCP, CI, and integration users configure credentials but not an endpoint. The smaller public
configuration surface prevents environment drift and prevents users from redirecting CLI keys to
another host. Contributors test network behavior with injected mock transports rather than by
changing the public endpoint, and local backend development must use backend-specific tooling.
