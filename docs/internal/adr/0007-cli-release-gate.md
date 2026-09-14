# ADR 0007: Deterministic CLI release gate

## Status

Accepted.

## Context

CI needs a deterministic way to evaluate an existing configured evaluation and fail a release when validated result metrics miss explicit thresholds.

## Decision

Add `autoeval gate` as a composition of the existing run, polling, and result actions. The returned run may reuse an existing completed run and result while keeping the same Run ID. If the returned run is still active, the CLI polls it to a terminal state before reading results. Threshold evaluation is local and pure. The command emits a terminal run status in JSON and uses exit code 1 only for a threshold failure; established usage, authentication, network, timeout, and run-failure exit codes remain unchanged.

A composite GitHub Action injects the Plumloom CLI key through the environment, captures the redacted JSON result, and writes a job summary. It does not add backend endpoints or repository write permissions.

## Consequences

An existing completed run can be evaluated immediately without forcing a new run. When the returned run is active, the gate waits within the deterministic CLI polling bounds before evaluating its result. Missing metrics fail when a corresponding threshold was requested. CI operators must configure an existing evaluation and store its CLI key in the platform secret facility.
