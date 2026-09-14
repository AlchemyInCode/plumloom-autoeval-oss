#!/usr/bin/env node
/**
 * Render the Autoeval gate result into the GitHub Actions job summary and set
 * the step outcome. It reads only the CLI's own JSON output, which is already
 * redacted, so no credential or raw upstream payload can reach the summary.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import process from 'node:process';

const exitCode = Number(process.env.GATE_EXIT_CODE ?? '1');
const failOnTimeout = (process.env.FAIL_ON_TIMEOUT ?? 'true') !== 'false';
const evaluationId = process.env.EVALUATION_ID ?? 'unknown';

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function readText(path) {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return '';
  }
}

function escapeCell(value) {
  return String(value ?? '').replaceAll('|', '\\|');
}

function write(lines) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) appendFileSync(summaryFile, `${lines.join('\n')}\n`);
  else process.stdout.write(`${lines.join('\n')}\n`);
}

function setOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) appendFileSync(outputFile, `${name}=${value}\n`);
}

const stdout = readJson(process.env.GATE_RESULT_FILE ?? '');
const stderrText = readText(process.env.GATE_ERROR_FILE ?? '');
const errorPayload = (() => {
  try {
    return JSON.parse(stderrText)?.error;
  } catch {
    return undefined;
  }
})();

// Exit codes: 0 pass, 1 threshold failure, 2 usage, 3 auth, 4 network/timeout, 5 run failed.
const isThresholdFailure = exitCode === 1;
const isTimeout =
  errorPayload?.code === 'RUN_POLL_TIMEOUT' || errorPayload?.code === 'RESULT_POLL_TIMEOUT';
const passed = exitCode === 0;
const neutral = isTimeout && !failOnTimeout;

const lines = [];
// The CLI reports a tri-state decision; fall back to the boolean for older payloads.
const decision = stdout?.report?.decision ?? (passed ? 'PASS' : 'FAIL');
const verdict = passed ? 'PASS' : neutral ? 'NEUTRAL (timeout)' : decision;
lines.push(`## Autoeval release gate: ${verdict}`, '');

if (stdout?.report) {
  const { report, run, elapsedMs } = stdout;
  lines.push(
    `- Evaluation: \`${escapeCell(run?.evaluationId ?? evaluationId)}\``,
    `- Run: \`${escapeCell(run?.runId)}\``,
    `- Context: ${escapeCell(report.contextType)}`,
    `- Duration: ${Math.round((elapsedMs ?? 0) / 1000)}s`,
    '',
  );

  if (report.checks?.length) {
    lines.push('| Metric | Threshold | Actual | Status |', '| --- | --- | --- | --- |');
    for (const check of report.checks) {
      const label = check.detail ? `${check.label} (${check.detail})` : check.label;
      lines.push(
        `| ${escapeCell(label)} | ${escapeCell(check.threshold)} | ${escapeCell(check.actual)} | ${check.passed ? 'pass' : `**${escapeCell(check.decision ?? 'FAIL')}**`} |`,
      );
    }
    lines.push('');
  } else {
    lines.push('No thresholds were configured, so the gate did not evaluate any metric.', '');
  }

  if (report.metrics?.trajectoryScore !== undefined) {
    lines.push(`Trajectory score: ${escapeCell(report.metrics.trajectoryScore)}`, '');
  }
} else {
  lines.push(`- Evaluation: \`${escapeCell(evaluationId)}\``, '');
  lines.push(
    isThresholdFailure
      ? 'The gate failed, but no result payload was produced.'
      : 'The gate could not complete.',
    '',
  );
}

if (!passed && errorPayload?.message) {
  lines.push('### Details', '', `${escapeCell(errorPayload.message)}`);
  if (errorPayload.hint) lines.push('', `Hint: ${escapeCell(errorPayload.hint)}`);
  const runId = stdout?.run?.runId;
  if (runId) {
    lines.push('', `Re-check later with \`autoeval status ${evaluationId} ${runId}\`.`);
  }
  lines.push('');
} else if (!passed && stderrText) {
  lines.push('### Details', '', '```', stderrText.slice(0, 2000), '```', '');
}

write(lines);
setOutput('passed', String(passed));
setOutput('run-id', stdout?.run?.runId ?? '');

if (passed || neutral) process.exit(0);
process.exit(1);
