import Table from 'cli-table3';

import { paint, type SemanticTone } from './colors.js';
import { safeTerminalText } from './safe-text.js';

export type TableColumn = {
  header: string;
  /** Right-align the column values, for counts and numeric fields. */
  align?: 'left' | 'right';
  /** Keep the column at least this wide so later columns stay in a stable position. */
  minWidth?: number;
  /** Cap the column so one outlier cannot push later columns off screen. */
  maxWidth?: number;
  /**
   * Never shrink or wrap this column. Used for UUID columns: an id must stay a
   * single, complete, selectable token so it can be copied from the terminal.
   */
  atomic?: boolean;
  /**
   * Semantic colour for the column's values. Identifiers and metadata use
   * `meta` so they recede; status columns colour per cell instead.
   */
  tone?: SemanticTone;
  /** Per-cell colour, used by status columns where the value decides the tone. */
  toneOf?: (value: string) => SemanticTone | undefined;
};

export type TableOptions = {
  /** Terminal columns available for the table; defaults to the current stdout width. */
  width?: number;
};

const PADDING_RIGHT = 2;
const DEFAULT_WIDTH = 100;
const MIN_COLUMN_WIDTH = 8;

/** cli-table3 draws a full box by default; every border glyph is blanked here. */
const BORDERLESS = {
  top: '',
  'top-mid': '',
  'top-left': '',
  'top-right': '',
  bottom: '',
  'bottom-mid': '',
  'bottom-left': '',
  'bottom-right': '',
  left: '',
  'left-mid': '',
  mid: '',
  'mid-mid': '',
  right: '',
  'right-mid': '',
  middle: '',
} as const;

const ELLIPSIS = '…';

/** Values past `maxWidth` are truncated so one outlier cannot dominate. */
function truncate(value: string, maxWidth: number | undefined): string {
  if (maxWidth === undefined || value.length <= maxWidth) return value;
  if (maxWidth <= 1) return ELLIPSIS.slice(0, maxWidth);
  return `${value.slice(0, maxWidth - 1)}${ELLIPSIS}`;
}

function naturalWidth(column: TableColumn, values: readonly string[]): number {
  const widest = Math.max(column.header.length, ...values.map((value) => value.length), 0);
  return Math.max(widest, column.minWidth ?? 0);
}

/**
 * Shrink the widest column (and then the next widest) until the table fits the
 * terminal. cli-table3 wraps on word boundaries inside the resulting width, so
 * a narrow terminal produces a readable stack instead of a broken grid.
 */
function fitWidths(
  widths: number[],
  available: number,
  atomic: readonly boolean[],
  floors: readonly number[],
): number[] {
  const fitted = [...widths];
  const overhead = fitted.length * PADDING_RIGHT;
  let total = fitted.reduce((sum, value) => sum + value, 0) + overhead;
  while (total > available) {
    let widest = -1;
    for (let index = 0; index < fitted.length; index += 1) {
      if (atomic[index] === true) continue;
      if (widest === -1 || (fitted[index] ?? 0) > (fitted[widest] ?? 0)) widest = index;
    }
    if (widest === -1) break;
    if ((fitted[widest] ?? 0) <= Math.max(MIN_COLUMN_WIDTH, floors[widest] ?? 0)) break;
    fitted[widest] = (fitted[widest] ?? 0) - 1;
    total -= 1;
  }
  return fitted;
}

/**
 * Render an aligned text table. Values are sanitized for terminal output before
 * measurement so that redaction cannot change column widths, and identifiers
 * stay plain text so the terminal can select and copy them.
 */
export function formatTable(
  columns: readonly TableColumn[],
  rows: readonly string[][],
  options: TableOptions = {},
): string {
  const safeRows = rows.map((row) =>
    columns.map((column, index) =>
      column.atomic === true
        ? safeTerminalText(row[index] ?? '')
        : truncate(safeTerminalText(row[index] ?? ''), column.maxWidth),
    ),
  );
  const available = options.width ?? process.stdout.columns ?? DEFAULT_WIDTH;
  const widths = fitWidths(
    columns.map((column, index) =>
      naturalWidth(
        column,
        safeRows.map((row) => row[index] ?? ''),
      ),
    ),
    Math.max(available, MIN_COLUMN_WIDTH * columns.length),
    columns.map((column) => column.atomic === true),
    columns.map((column) => column.minWidth ?? 0),
  );

  const table = new Table({
    head: columns.map((column) => paint.header(safeTerminalText(column.header))),
    colWidths: widths.map((width) => width + PADDING_RIGHT),
    colAligns: columns.map((column) => column.align ?? 'left'),
    wordWrap: true,
    wrapOnWordBoundary: true,
    chars: { ...BORDERLESS },
    style: {
      'padding-left': 0,
      'padding-right': PADDING_RIGHT,
      head: [],
      border: [],
      compact: true,
    },
  });

  // Colour is applied after measurement so redaction and wrapping stay
  // width-accurate, and identifiers stay plain, selectable text.
  for (const row of safeRows) {
    table.push(
      row.map((value, index) => {
        const column = columns[index];
        const tone = column?.toneOf?.(value) ?? column?.tone;
        return tone === undefined || value === '' ? value : paint[tone](value);
      }),
    );
  }

  return table
    .toString()
    .split('\n')
    .map((line) => line.replace(/\s+$/u, ''))
    .join('\n');
}
