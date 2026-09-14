import { describe, expect, it } from 'vitest';

import type { RunStatus } from '../src/domain/types.js';
import { AutoevalError } from '../src/errors/autoeval-error.js';

import { missingOptionHint } from '../src/commands/program.js';
import { hintForError } from '../src/errors/hints.js';

import { createProgressReporter, formatStatusProgress } from '../src/output/progress.js';
import { formatTable } from '../src/output/table.js';
import { OutputWriter, type OutputStream } from '../src/output/writer.js';

class MemoryStream implements OutputStream {
  value = '';
  isTTY: boolean;

  constructor(isTTY = false) {
    this.isTTY = isTTY;
  }

  write(chunk: string): boolean {
    this.value += chunk;
    return true;
  }

  cursorTo(): boolean {
    this.value += '\r';
    return true;
  }

  moveCursor(): boolean {
    return true;
  }

  clearLine(): boolean {
    return true;
  }
}

describe('aligned tables', () => {
  it('pads columns to a common width and right-aligns numeric columns', () => {
    const table = formatTable(
      [{ header: 'ID' }, { header: 'NAME' }, { header: 'COUNT', align: 'right' }],
      [
        ['a', 'Short', '1'],
        ['bbbb', 'A much longer name', '42'],
      ],
    );

    expect(table.split('\n')).toEqual([
      'ID    NAME                COUNT',
      'a     Short                   1',
      'bbbb  A much longer name     42',
    ]);
  });

  it('tolerates missing cells and strips control characters', () => {
    expect(formatTable([{ header: 'A' }, { header: 'B' }], [['x\u0007']])).toBe('A   B\nx');
  });

  it('keeps later columns stable with minWidth and truncates past maxWidth', () => {
    const table = formatTable(
      [
        { header: 'NAME', minWidth: 10, maxWidth: 8 },
        { header: 'N', align: 'right' },
      ],
      [
        ['ab', '1'],
        ['a-very-long-name', '22'],
      ],
    );

    expect(table.split('\n')).toEqual(['NAME         N', 'ab           1', 'a-very-…    22']);
  });
});

describe('missing required options', () => {
  it('adds an actionable hint for known flags only', () => {
    expect(
      missingOptionHint("error: required option '--workspace <workspace-id>' not specified"),
    ).toContain('autoeval workspace list');
    expect(
      missingOptionHint("error: required option '--unknown <x>' not specified"),
    ).toBeUndefined();
    expect(missingOptionHint('error: unknown command')).toBeUndefined();
  });
});

describe('error hints', () => {
  it('prefers a code-specific hint over the kind fallback', () => {
    expect(
      hintForError(new AutoevalError('x', { kind: 'timeout', code: 'RUN_POLL_TIMEOUT' })),
    ).toContain('autoeval status');
    expect(hintForError(new AutoevalError('x', { kind: 'authentication' }))).toContain(
      'autoeval login',
    );
  });

  it('returns undefined when no hint applies', () => {
    expect(hintForError({ kind: 'run_failed', code: 'UNKNOWN_CODE' })).toContain('autoeval status');
  });

  it('writes hints to stderr for human and JSON output', () => {
    const humanStderr = new MemoryStream();
    new OutputWriter(new MemoryStream(), humanStderr).writeError('boom', false, 'X', 'do this');
    expect(humanStderr.value).toBe('Error: boom\nHint: do this\n');

    const jsonStderr = new MemoryStream();
    new OutputWriter(new MemoryStream(), jsonStderr).writeError('boom', true, 'X', 'do this');
    expect(JSON.parse(jsonStderr.value)).toEqual({
      error: { message: 'boom', code: 'X', hint: 'do this' },
    });
  });
});

/** Cursor moves, colour and mode escapes; built at runtime to keep the literal control character out of the source. */
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}(?:\\[[0-9;?]*[A-Za-z]|[78])`, 'gu');

describe('progress reporting', () => {
  const status: RunStatus = {
    evaluationId: 'e',
    runId: 'r',
    state: 'RUNNING',
    progress: { runsCompleted: 2, totalRuns: 5, percentage: 40 },
    raw: {},
  };

  it('summarizes run status compactly', () => {
    expect(formatStatusProgress(status)).toBe('status RUNNING · 2/5 runs · 40%');
  });

  it('writes nothing when disabled', () => {
    const stream = new MemoryStream();
    const reporter = createProgressReporter({ stream, enabled: false, label: 'Run' });
    reporter.update('working');
    reporter.reportStatus(status);
    reporter.stop();
    expect(stream.value).toBe('');
  });

  it('animates before a run total is known, then draws a progress bar', () => {
    const stream = new MemoryStream(true);
    const reporter = createProgressReporter({ stream, enabled: true, label: 'Run' });
    reporter.update('starting');
    reporter.reportStatus(status);
    reporter.stop();
    reporter.stop();

    expect(stream.value).toContain('Run: starting');
    expect(stream.value).toContain('2/5 runs · RUNNING');
    expect(stream.value).toContain('█');
  });

  it('returns to animated progress for a later phase without overlapping the bar', () => {
    const stream = new MemoryStream(true);
    const reporter = createProgressReporter({
      stream,
      enabled: true,
      label: 'Run',
      unicode: false,
      color: false,
    });
    reporter.update('starting');
    reporter.reportStatus(status);
    reporter.update('reading results');
    reporter.stop();

    expect(stream.value).toContain('2/5 runs · RUNNING');
    expect(stream.value).toContain('Run: reading results');
  });

  it('keeps every frame inside a narrow terminal', () => {
    const stream = new MemoryStream(true);
    const reporter = createProgressReporter({ stream, enabled: true, label: 'Run', width: 30 });
    reporter.update('waiting for the evaluation backend to accept the run');
    reporter.reportStatus(status);
    reporter.stop();

    const visible = stream.value
      // Cursor moves, colour and mode escapes take no columns on screen.
      .replace(ANSI_ESCAPE, '')
      .split(/[\r\n]/u)
      .filter((frame) => frame.trim() !== '');
    expect(visible.length).toBeGreaterThan(0);
    for (const frame of visible) expect(frame.length).toBeLessThanOrEqual(30);
  });

  it('falls back to a status line when no run total is reported', () => {
    const stream = new MemoryStream(true);
    const reporter = createProgressReporter({ stream, enabled: true, label: 'Run' });
    reporter.reportStatus({ evaluationId: 'e', runId: 'r', state: 'QUEUED', raw: {} });
    reporter.stop();

    expect(stream.value).toContain('Run: status QUEUED');
    expect(stream.value).not.toContain('\n');
  });

  it('keeps the bar visible when an update omits progress after a counted frame', () => {
    for (const totalRuns of [3, 5, 10]) {
      const runsCompleted = totalRuns - 1;
      const stream = new MemoryStream(true);
      const reporter = createProgressReporter({ stream, enabled: true, label: 'Run' });
      reporter.reportStatus({
        evaluationId: 'e',
        runId: 'r',
        state: 'IN_PROGRESS',
        progress: {
          runsCompleted,
          totalRuns,
          percentage: Math.floor((runsCompleted / totalRuns) * 100),
        },
        raw: {},
      });
      reporter.reportStatus({ evaluationId: 'e', runId: 'r', state: 'IN_PROGRESS', raw: {} });
      reporter.stop();

      expect(stream.value).toContain(`${runsCompleted}/${totalRuns} runs · IN_PROGRESS`);
      expect(stream.value).not.toContain('Run: status IN_PROGRESS');
    }
  });

  it('avoids premature completion when completed equals total before terminal state', () => {
    for (const finalCompleted of [3, 5, 10]) {
      const inProgressCompleted = finalCompleted - 1;
      const stream = new MemoryStream(true);
      const reporter = createProgressReporter({ stream, enabled: true, label: 'Run' });
      reporter.reportStatus({
        evaluationId: 'e',
        runId: 'r',
        state: 'IN_PROGRESS',
        progress: {
          runsCompleted: inProgressCompleted,
          totalRuns: inProgressCompleted,
          percentage: 100,
        },
        raw: {},
      });
      reporter.reportStatus({
        evaluationId: 'e',
        runId: 'r',
        state: 'COMPLETED',
        progress: { runsCompleted: finalCompleted, totalRuns: finalCompleted, percentage: 100 },
        raw: {},
      });
      reporter.stop();

      expect(stream.value).toContain(
        `${inProgressCompleted}/${inProgressCompleted + 1} runs · IN_PROGRESS`,
      );
      expect(stream.value).toContain(`${finalCompleted}/${finalCompleted} runs · COMPLETED`);
    }
  });

  it('renders the completed frame for a single-run evaluation', () => {
    const stream = new MemoryStream(true);
    const reporter = createProgressReporter({ stream, enabled: true, label: 'Run' });
    reporter.reportStatus({
      evaluationId: 'e',
      runId: 'r',
      state: 'COMPLETED',
      progress: { runsCompleted: 1, totalRuns: 1, percentage: 100 },
      raw: {},
    });
    reporter.stop();

    expect(stream.value).toContain('1/1 runs · COMPLETED');
  });
});
