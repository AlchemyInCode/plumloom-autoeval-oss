import { SingleBar } from 'cli-progress';

import type { RunStatus } from '../domain/types.js';
import { paint } from './colors.js';
import { safeTerminalText } from './safe-text.js';
import { createStatusIndicator, type StatusIndicator } from './spinner.js';
import type { OutputStream } from './writer.js';

export interface ProgressReporter {
  /** Report an intermediate step with an animated TTY indicator. */
  update(message: string): void;
  /** Report run status progress in a consistent, scannable form. */
  reportStatus(status: RunStatus): void;
  /** Clear any transient progress output. Safe to call more than once. */
  stop(): void;
}

const DEFAULT_PROGRESS_WIDTH = 80;
const MIN_PROGRESS_WIDTH = 20;
const MIN_BAR_WIDTH = 4;
const TERMINAL_STATES = new Set(['COMPLETED', 'FAILED', 'CANCELED', 'CANCELLED', 'TERMINATED']);

/** Keeps a status line on a single terminal row. */
function truncate(line: string, width: number): string {
  return line.length <= width ? line : `${line.slice(0, Math.max(1, width - 1))}…`;
}

const NOOP_REPORTER: ProgressReporter = {
  update: () => undefined,
  reportStatus: () => undefined,
  stop: () => undefined,
};

export function formatStatusProgress(status: RunStatus): string {
  const parts = [`status ${status.state}`];
  if (status.progress) {
    const completed = status.progress.runsCompleted ?? '?';
    const total = status.progress.totalRuns ?? '?';
    parts.push(`${completed}/${total} runs`);
    if (status.progress.percentage !== undefined && status.progress.percentage !== null) {
      parts.push(`${status.progress.percentage}%`);
    }
  }
  return parts.join(' · ');
}

/**
 * Progress is written to stderr so that stdout stays a clean, pipeable result
 * stream. Non-TTY and --json invocations get no progress output at all.
 *
 * An evaluation run reports how many of its runs have completed, so once a run
 * total is known the reporter switches from a status line to a `cli-progress`
 * bar. Statuses without a countable total keep the animated indicator.
 */
export function createProgressReporter(input: {
  stream: OutputStream;
  enabled: boolean;
  label: string;
  unicode?: boolean;
  color?: boolean;
  /** Terminal width; the line and the bar are kept inside it. */
  width?: number;
}): ProgressReporter {
  if (!input.enabled) return NOOP_REPORTER;

  // One column is left free so a full-width line never wraps onto a second row,
  // which would leave the previous frame stranded on narrow terminals.
  const width = Math.max(
    MIN_PROGRESS_WIDTH,
    (input.width ?? (input.stream as { columns?: number }).columns ?? DEFAULT_PROGRESS_WIDTH) - 1,
  );
  const label = truncate(safeTerminalText(input.label), Math.max(8, Math.floor(width / 3)));

  let bar: SingleBar | undefined;
  let spinner: StatusIndicator | undefined;
  let lastBarCompleted = 0;

  const stopSpinner = (): void => {
    spinner?.stop();
    spinner = undefined;
  };

  const startSpinner = (message: string): void => {
    const text = truncate(safeTerminalText(`${label}: ${message}`), width - 2);
    spinner ??= createStatusIndicator({
      stream: input.stream,
      enabled: true,
      unicode: input.unicode ?? true,
      color: input.color ?? true,
    });
    spinner.start(text);
  };

  const startBar = (total: number, completed: number, state: string): SingleBar => {
    stopSpinner();
    // Everything the format prints except the bar itself, measured exactly so
    // the rendered frame fits the terminal instead of wrapping.
    const reserved = `${label}: [] ${completed}/${total} runs · ${state}`.length;
    const barWidth = Math.max(MIN_BAR_WIDTH, Math.min(40, width - reserved));
    const color = input.color ?? true;
    // cli-progress draws {bar} by slicing the repeated char strings
    // (format-bar.js), which cuts ANSI escapes mid-sequence, so the coloured
    // bar is rendered by a format function instead. The library supports a
    // function at runtime (generic-bar.js) but types `format` as string only.
    type BarFormatParams = { progress: number; value: number; total: number };
    const format = (_options: unknown, params: BarFormatParams, payload: unknown): string => {
      const progress = Math.min(Math.max(params.progress, 0), 1);
      const complete = '█'.repeat(Math.round(barWidth * progress));
      const incomplete = '░'.repeat(barWidth - Math.round(barWidth * progress));
      const renderedBar = color
        ? `${paint.input(complete)}${paint.meta(incomplete)}`
        : `${complete}${incomplete}`;
      const prefix = color ? paint.input(`${label}:`) : `${label}:`;
      const current = safeTerminalText((payload as { state?: string }).state ?? '');
      return `${prefix} [${renderedBar}] ${params.value}/${params.total} runs · ${current}`;
    };
    const created = new SingleBar({
      stream: input.stream,
      format: format as unknown as string,
      barsize: barWidth,
      hideCursor: true,
      // Keep the final frame visible until an explicit `stop()` call.
      clearOnComplete: false,
      noTTYOutput: false,
      linewrap: false,
    });
    created.start(total, completed, { state });
    lastBarCompleted = completed;
    return created;
  };

  return {
    update: (message) => {
      if (bar) {
        bar.stop();
        bar = undefined;
      }
      startSpinner(message);
    },
    reportStatus: (status) => {
      const state = safeTerminalText(status.state);
      const total = status.progress?.totalRuns ?? undefined;
      const completed = status.progress?.runsCompleted ?? 0;

      // Some backends transiently report completed===total before reaching a
      // terminal state, or omit progress fields in later updates. Keep the
      // bar active until a terminal status is observed.
      const terminal = TERMINAL_STATES.has(state);
      if (typeof total !== 'number' || total <= 0) {
        if (bar) {
          bar.update(lastBarCompleted, { state });
          return;
        }
        startSpinner(formatStatusProgress(status));
        return;
      }

      const safeTotal = !terminal && completed >= total ? completed + 1 : total;

      if (!bar) {
        bar = startBar(safeTotal, completed, state);
        return;
      }
      bar.setTotal(safeTotal);
      bar.update(completed, { state });
      lastBarCompleted = completed;
    },
    stop: () => {
      stopSpinner();
      if (bar) {
        bar.stop();
        bar = undefined;
      }
    },
  };
}
