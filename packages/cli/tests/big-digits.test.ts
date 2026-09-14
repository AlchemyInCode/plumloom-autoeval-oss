import { describe, expect, it } from 'vitest';

import { renderBigScore } from '../src/output/big-digits.js';

describe('renderBigScore', () => {
  it('renders a decimal score as five rows of block digits with the suffix', () => {
    const rows = renderBigScore('4.7', '/ 5 overall');

    expect(rows).toHaveLength(5);
    // Digit rows use full blocks; the suffix sits dimmed on the bottom row.
    expect(rows[0]).toContain('█');
    expect(rows.some((row) => row.includes('/ 5 overall'))).toBe(true);
    expect(rows[4]).toContain('/ 5 overall');
    // Every glyph row is the same visible width: 3 chars per glyph plus a space.
    const widths = rows.slice(0, 4).map((row) => row.length);
    expect(new Set(widths).size).toBe(1);
    expect(widths[0]).toBe('4.7'.length * 4 - 1);
  });

  it('degrades unknown characters to a blank column instead of throwing', () => {
    const rows = renderBigScore('N/A', '/ 5');
    expect(rows).toHaveLength(5);
    expect(rows[0]).not.toContain('█');
  });
});
