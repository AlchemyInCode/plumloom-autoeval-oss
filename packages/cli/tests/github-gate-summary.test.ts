import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { IDS } from './helpers.js';

const execFileAsync = promisify(execFile);
const SUMMARY_SCRIPT = fileURLToPath(
  new URL('../../../.github/actions/autoeval-gate/summary.mjs', import.meta.url),
);

async function runSummary(input: { passed: boolean }): Promise<{
  exitCode: number;
  summary: string;
  outputs: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'autoeval-gate-summary-'));
  const resultFile = join(directory, 'result.json');
  const errorFile = join(directory, 'error.json');
  const summaryFile = join(directory, 'summary.md');
  const outputFile = join(directory, 'outputs.txt');
  await writeFile(
    resultFile,
    JSON.stringify({
      report: {
        passed: input.passed,
        contextType: 'scenario',
        checks: [
          {
            label: 'Overall score',
            threshold: '>= 4',
            actual: input.passed ? '4.5' : '3.5',
            passed: input.passed,
          },
        ],
        metrics: {},
      },
      run: { evaluationId: IDS.evaluation, runId: IDS.run },
      elapsedMs: 1_000,
    }),
  );
  await writeFile(
    errorFile,
    input.passed
      ? ''
      : JSON.stringify({ error: { message: 'Gate failed', code: 'GATE_THRESHOLD_NOT_MET' } }),
  );

  let exitCode = 0;
  try {
    await execFileAsync(process.execPath, [SUMMARY_SCRIPT], {
      env: {
        ...process.env,
        GATE_EXIT_CODE: input.passed ? '0' : '1',
        GATE_RESULT_FILE: resultFile,
        GATE_ERROR_FILE: errorFile,
        GITHUB_STEP_SUMMARY: summaryFile,
        GITHUB_OUTPUT: outputFile,
        EVALUATION_ID: IDS.evaluation,
      },
    });
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    exitCode = typeof code === 'number' ? code : -1;
  }

  return {
    exitCode,
    summary: await readFile(summaryFile, 'utf8'),
    outputs: await readFile(outputFile, 'utf8'),
  };
}

describe('GitHub gate summary', () => {
  it('writes a passing summary and output', async () => {
    const result = await runSummary({ passed: true });
    expect(result.exitCode).toBe(0);
    expect(result.summary).toContain('Autoeval release gate: PASS');
    expect(result.outputs).toContain('passed=true');
    expect(result.outputs).toContain(`run-id=${IDS.run}`);
  });

  it('writes a failing summary and exits non-zero', async () => {
    const result = await runSummary({ passed: false });
    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain('Autoeval release gate: FAIL');
    expect(result.summary).toContain('**FAIL**');
    expect(result.outputs).toContain('passed=false');
  });
});
