# Troubleshooting Autoeval

Use `--debug` for bounded, redacted request metadata on stderr. Put `--json` before a
deterministic command for machine-readable output. Never include a real credential in an issue or
copied diagnostic.

## No enabled models are shown

**Symptom:** `autoeval models` is empty, or file preflight reports that a model is not enabled.

**Check:** Run `autoeval whoami` and verify the account. `AUTOEVAL_API_KEY` takes precedence over
the OS credential store, so an old exported key can silently select a different account.
Configured-run preflight and the file guide use the same account-enabled model list.

## A conversation transcript or agent trace is rejected

**Symptom:** The file guide or `eval validate` rejects the artifact.

**Check:** Conversation requires a non-empty `messages` array. Agent trace requires a non-empty
OpenTelemetry `trace.resourceSpans` structure. The file guide requires a valid file and never
authors a placeholder. Validate the input with
`autoeval eval validate --input <file>`.

## Results are not ready

**Symptom:** A result request reports that no results are available.

**Check:** Run `autoeval status <evaluation-id> <run-id>` and confirm the run reached a terminal
state. A run that failed before scoring may have no readable result payload.

Results are addressed by evaluation and run. Autoeval does not invent or search an undocumented
run-list endpoint. If a known run cannot be read, use the exact identifiers printed at run time
with `autoeval results <evaluation-id> <run-id>`.

## Colour, tables, or progress look wrong

Colour is disabled for pipes and `NO_COLOR`. Tables use the detected terminal width, and transient
spinners/progress are sent to stderr. Use `--json` for scripting rather than parsing human output.

## Authentication fails

Run `autoeval whoami`, then `autoeval login` if necessary. Environment credentials are never
persisted. `autoeval logout` removes only the local credential-store item and cannot unset or revoke
an environment/server key.

## Suite gate reports `INCONCLUSIVE` because thresholds are missing

**Symptom:** `autoeval suite gate` returns `INCONCLUSIVE` with
`no score thresholds are configured for this eval` (scenario) or
`no metric thresholds are configured for this eval` (conversation, agent trace).

**Check:** The gate plane is pure: with no policy there is nothing to decide against, so it never
returns `PASS`. Add a `gate` block to the manifest — suite-level, or per eval to override it — and
re-run. An eval with an empty effective policy always blocks the release.

## A required metric is missing or reports `has_data: false`

**Symptom:** A check is `INCONCLUSIVE` with `required metric is missing from the result payload`,
`metric reported has_data: false`, or `required score is unavailable`.

**Check:** The run completed, but the evidence for that threshold does not exist. Confirm the
metric name in the `gate` block matches the metric the evaluation actually produces (read the raw
payload with `autoeval --json results <evaluation-id> <run-id>`). `has_data: false` means the
backend scored no data for that cell — usually a scenario/model combination that never produced a
gradeable response. Fix the eval file or drop the threshold; do not treat it as a pass.

## Null confidence interval on a required multi-run Scenario check

**Symptom:** `required 95% confidence interval is unavailable` on a multi-run scenario eval.

**Check:** Interval-aware gating needs the backend to return a 95% confidence interval for that
cell. Too few completed runs, or a run that stopped early, leaves the interval null. Verify the run
mode and run count with `autoeval status <evaluation-id> <run-id>`; if the eval is genuinely
single-run, gate it with a plain score threshold instead of relying on interval comparison. A
missing interval is `INCONCLUSIVE`, never `PASS`.

## Convergence fields are unavailable through status

**Symptom:** The report shows no convergence classification, or convergence looks unknown even
though the manifest expects a consistency target.

**Check:** Convergence is classified only from terminal run status. When the status payload carries
none of the convergence fields, the gate records that evidence as unavailable and does not invent a
verdict. `MAX_RUNS_REACHED` on its own does not prove a convergence failure — the configured
consistency target decides whether convergence was enabled at all. Inspect the raw status with
`autoeval --json status <evaluation-id> <run-id>`. When convergence was enabled and the target was
not reached, the eval is `INCONCLUSIVE`.

## A result fetch fails for one eval in a suite

**Symptom:** One eval reports `ERROR` with `eval results could not be fetched` while the rest of the
suite reports normally.

**Check:** Result fetching runs off-plane, so one failed fetch does not abort the suite; it is
isolated to that eval and rolls up as `ERROR`. Re-read that single result with
`autoeval results <evaluation-id> <run-id>`. If the run itself never reached a terminal state, the
reason is an execution failure rather than a fetch failure — see below.

## Suite exit codes

| Exit code | Roll-up verdict          | Meaning                                                               |
| --------- | ------------------------ | --------------------------------------------------------------------- |
| `0`       | `PASS`                   | every eval met its configured thresholds                              |
| `1`       | `FAIL` or `INCONCLUSIVE` | a quality threshold was missed, or the gate had no evidence to decide |
| `5`       | `ERROR`                  | an eval could not be executed or its results could not be read        |

Roll-up precedence is `ERROR > FAIL > INCONCLUSIVE > PASS`, so a single `ERROR` sets exit code `5`
for the whole suite. Any non-`PASS` verdict is non-zero and blocks the release.

## Execution failure versus quality failure

**Execution failure (`ERROR`, exit `5`):** the eval never produced trustworthy evidence — the run
failed, never reached a terminal state, or the results could not be fetched. This is an
infrastructure/config problem: check credentials, the model enablement, and the eval file, then
re-run.

**Quality failure (`FAIL`, exit `1`):** the eval ran fine and the scores are below the configured
thresholds. This is a product signal: the change under test regressed, or the threshold is wrong.

`INCONCLUSIVE` (also exit `1`) sits between them: the run completed but the gate lacked the
evidence it needed — missing thresholds, missing metrics, a null confidence interval, or
convergence that was enabled but not reached. It blocks the release deliberately rather than
guessing.
