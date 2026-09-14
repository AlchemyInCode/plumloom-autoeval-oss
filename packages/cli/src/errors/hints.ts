import type { AutoevalError, AutoevalErrorKind } from './autoeval-error.js';

/**
 * Remediation hints are advisory only. They never contain credentials, request
 * payloads, or upstream implementation details.
 */
const HINTS_BY_CODE: Readonly<Record<string, string>> = {
  CREDENTIAL_REQUIRED:
    'Run `autoeval login` (it will prompt for a key), pass `autoeval login --key <pl_sk_...>`, or set AUTOEVAL_API_KEY',
  INVALID_CLI_KEY_FORMAT:
    'Create a current CLI key at https://app.plumloom.ai (it starts with pl_sk_), then run `autoeval login` or `autoeval login --key <key>`',
  MISSING_API_BASE_URL: 'Set AUTOEVAL_API_BASE_URL to the Autoeval API origin',
  INVALID_BASE_URL: 'Set AUTOEVAL_API_BASE_URL to an https origin without a path or query',
  INSECURE_BASE_URL: 'Use an https origin; http is allowed only for localhost',
  INVALID_ENVIRONMENT: 'Check the Autoeval environment variables listed in .env.example',
  RUN_POLL_TIMEOUT:
    'Check progress later with `autoeval status <evaluation-id> <run-id>`; the run keeps going server-side',
  RESULT_POLL_TIMEOUT:
    'Results are still being prepared; retry `autoeval results <evaluation-id> <run-id>` shortly',
  REQUEST_ABORTED: 'The command was interrupted; rerun it when ready',
  INVALID_QUALITY_STANDARD_SCHEMA:
    'Compare your file with the canonical schema in docs/command-reference.md',
  INVALID_QUALITY_STANDARD_JSON: 'Validate the file with a JSON linter, then retry',
  QUALITY_STANDARD_INPUT_READ_FAILED: 'Check the --input path relative to your current directory',
  CONFIGURED_RUN_INPUT_READ_FAILED: 'Check the --input path relative to your current directory',
  INVALID_CONFIGURED_RUN_JSON: 'Validate the file with a JSON linter, then retry',
  GATE_THRESHOLD_NOT_MET:
    'Review the threshold table above, then fix the regression or update the gate thresholds',
  INVALID_GATE_THRESHOLD: 'Thresholds must be numbers, for example --min-overall 4.0',
  NO_GATE_THRESHOLD:
    'Set at least one threshold, for example --min-overall 4.0, or pass --thresholds <file>',
  GATE_THRESHOLDS_READ_FAILED: 'Check the --thresholds path relative to your current directory',
  INVALID_GATE_THRESHOLDS_JSON: 'Validate the thresholds file with a JSON linter, then retry',
};

const HINTS_BY_KIND: Readonly<Partial<Record<AutoevalErrorKind, string>>> = {
  authentication: 'Run `autoeval login`, or set AUTOEVAL_API_KEY in your environment',
  authorization: 'Confirm your account has access to this workspace or evaluation',
  plan_restriction: 'This action needs a different Plumloom plan; contact your workspace owner',
  network: 'Check your connection and AUTOEVAL_API_BASE_URL, then retry',
  timeout: 'The request timed out; retry, or poll status separately for long runs',
  usage: 'Run the command with --help to see required options and examples',
  validation: 'Run the command with --help to see required options and examples',
  run_failed: 'Inspect the run with `autoeval status <evaluation-id> <run-id>`',
  gate_failed:
    'Inspect the failing metric with `autoeval results <evaluation-id> <run-id>`, then adjust the evaluation or the thresholds',
  upstream: 'Retry shortly; rerun with --debug to capture redacted request diagnostics',
  unsupported: 'Run `autoeval --help` to see the supported commands',
};

export function hintForError(error: Pick<AutoevalError, 'kind' | 'code'>): string | undefined {
  const byCode = error.code === undefined ? undefined : HINTS_BY_CODE[error.code];
  return byCode ?? HINTS_BY_KIND[error.kind];
}
