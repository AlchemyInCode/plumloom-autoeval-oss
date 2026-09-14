import cliuiFactory from 'cliui';

import { paint } from './colors.js';
import { safeMultilineTerminalText, safeTerminalText } from './safe-text.js';

type UiColumn = { text: string; width?: number; padding?: number[]; align?: 'left' | 'right' };
type Ui = { div: (...columns: UiColumn[]) => void; toString: () => string };

// cliui ships an ESM bootstrap without matching call-signature types.
const cliui = cliuiFactory as unknown as (options?: { width?: number }) => Ui;

/**
 * Section layout for command output.
 *
 * cliui owns wrapping so headers, callouts, and two-column metadata all use one
 * measure and stay readable in a narrow terminal. Everything here returns plain
 * text: it never takes over the screen, so terminal scrollback and native
 * selection keep working.
 */

const DEFAULT_WIDTH = 100;
const MAX_WIDTH = 100;
const MIN_WIDTH = 40;
const LABEL_COLUMN = 20;

export function layoutWidth(width?: number): number {
  const candidate = width ?? process.stdout.columns ?? DEFAULT_WIDTH;
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, candidate));
}

/** A bold section header with the surrounding blank line a section needs. */
export function renderHeading(title: string, width?: number): string {
  const ui = cliui({ width: layoutWidth(width) });
  ui.div({ text: paint.heading(safeTerminalText(title)), padding: [1, 0, 1, 0] });
  return `${ui.toString()}\n`;
}

export type CalloutTone = 'pass' | 'warn' | 'fail' | 'meta';

/** A short, wrapped note marked with a semantic colour. */
export function renderCallout(tone: CalloutTone, message: string, width?: number): string {
  const ui = cliui({ width: layoutWidth(width) });
  ui.div(
    { text: paint[tone]('•'), width: 2 },
    { text: paint[tone](safeMultilineTerminalText(message)) },
  );
  return `${ui.toString()}\n`;
}

/** Two-column label/value metadata; values wrap under their own column. */
export function renderMetadata(
  entries: readonly (readonly [label: string, value: string])[],
  width?: number,
): string {
  if (entries.length === 0) return '';
  const total = layoutWidth(width);
  const labelWidth = Math.min(
    LABEL_COLUMN,
    Math.max(...entries.map(([label]) => label.length + 2)),
  );
  const ui = cliui({ width: total });
  for (const [label, value] of entries) {
    ui.div(
      { text: paint.meta(safeTerminalText(label)), width: labelWidth },
      { text: safeMultilineTerminalText(value) },
    );
  }
  return `${ui.toString()}\n`;
}

/** A dim full-width rule used to separate sections of output. */
export function renderRule(width?: number): string {
  return `${paint.meta('─'.repeat(layoutWidth(width)))}\n`;
}

/**
 * A short status badge. Status is the one thing that may shout, so it is the
 * only place a reversed, bright colour is used.
 */
export function renderBadge(tone: CalloutTone, label: string): string {
  return paint[tone](`[ ${safeTerminalText(label).toUpperCase()} ]`);
}

/** A labelled section: heading, rule, then the body indented by nothing. */
export function renderSection(title: string, body: string, width?: number): string {
  const trimmed = body.replace(/\n+$/u, '');
  if (trimmed.trim() === '') return '';
  return `${paint.header(safeTerminalText(title.toUpperCase()))}\n${renderRule(width)}${trimmed}\n\n`;
}
