import ora, { type Ora } from 'ora';

import { paint } from './colors.js';
import { safeTerminalText } from './safe-text.js';
import type { OutputStream } from './writer.js';

/**
 * Transient "the assistant is working" indicator.
 *
 * It is a status channel, not output: frames are written to stderr so stdout
 * stays a clean, pipeable stream, nothing is emitted at all when the stream is
 * not a TTY (CI, pipes, tests), and the indicator is always stopped and cleared
 * before any rendered output is written.
 */
export interface StatusIndicator {
  /** Show (or relabel) the working indicator. */
  start(label: string): void;
  /** Erase the indicator. Safe to call when nothing is showing. */
  stop(): void;
}

export const NOOP_STATUS_INDICATOR: StatusIndicator = {
  start: () => undefined,
  stop: () => undefined,
};

export type StatusIndicatorOptions = {
  stream: OutputStream;
  enabled: boolean;
  unicode: boolean;
  color: boolean;
};

export function createStatusIndicator(options: StatusIndicatorOptions): StatusIndicator {
  if (!options.enabled) return NOOP_STATUS_INDICATOR;

  const spinner: Ora = ora({
    stream: options.stream as unknown as NodeJS.WriteStream,
    spinner: options.unicode ? 'dots' : 'line',
    isEnabled: true,
    // Ora otherwise pauses stdin, which conflicts with the readline composer.
    discardStdin: false,
    ...(options.color ? { color: 'cyan' as const } : {}),
  });

  return {
    start: (label: string): void => {
      const text = safeTerminalText(label);
      // The glyph and the label share one cyan voice; chalk is a no-op for
      // pipes and NO_COLOR, so non-TTY callers keep plain text.
      spinner.text = options.color ? paint.input(text) : text;
      if (!spinner.isSpinning) spinner.start();
    },
    stop: (): void => {
      if (spinner.isSpinning) spinner.stop();
    },
  };
}
