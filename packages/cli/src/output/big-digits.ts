import { paint } from './colors.js';

/**
 * Five-row block font for result scores. Only the glyphs a rendered score can
 * contain exist: digits, a decimal point, and a minus sign. Anything else maps
 * to a blank column so an unexpected value degrades to a gap instead of an
 * exception inside result rendering.
 */
const GLYPH_WIDTH = 3;
const BLANK = Array.from({ length: 5 }, () => ' '.repeat(GLYPH_WIDTH));

const GLYPHS: Record<string, readonly string[]> = {
  '0': ['███', '█ █', '█ █', '█ █', '███'],
  '1': [' █ ', ' █ ', ' █ ', ' █ ', ' █ '],
  '2': ['███', '  █', '███', '█  ', '███'],
  '3': ['███', '  █', '███', '  █', '███'],
  '4': ['█ █', '█ █', '███', '  █', '  █'],
  '5': ['███', '█  ', '███', '  █', '███'],
  '6': ['███', '█  ', '███', '█ █', '███'],
  '7': ['███', '  █', '  █', '  █', '  █'],
  '8': ['███', '█ █', '███', '█ █', '███'],
  '9': ['███', '█ █', '███', '  █', '███'],
  '.': ['   ', '   ', '   ', '   ', ' █ '],
  '-': ['   ', '   ', '███', '   ', '   '],
};

/**
 * Render a short numeric string (e.g. `4.7`) as large block digits, with the
 * suffix (`/ 5 overall`) dimmed on the bottom row. Bold bright digits carry
 * the score; colour is chalk-mediated, so pipes and NO_COLOR get plain text.
 */
export function renderBigScore(value: string, suffix: string): string[] {
  const rows: string[] = [];
  for (let row = 0; row < 5; row += 1) {
    // Array.from iterates code points; a plain spread would trip the repo's
    // string-splitting lint rule.
    const line = Array.from(value)
      .map((char) => (GLYPHS[char] ?? BLANK)[row] ?? '   ')
      .join(' ');
    rows.push(paint.heading(paint.input(line)));
  }
  const bottom = rows.length - 1;
  rows[bottom] = `${rows[bottom]}  ${paint.meta(suffix)}`;
  return rows;
}
