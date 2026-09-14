import { describe, expect, it } from 'vitest';

import { layoutWidth, renderCallout, renderHeading, renderMetadata } from '../src/output/layout.js';
import { formatTable } from '../src/output/table.js';

describe('layout', () => {
  it('clamps the measure to a readable range', () => {
    expect(layoutWidth(10)).toBe(40);
    expect(layoutWidth(400)).toBe(100);
    expect(layoutWidth(72)).toBe(72);
  });

  it('renders a heading surrounded by blank lines', () => {
    expect(renderHeading('Workspaces', 40)).toBe('\nWorkspaces\n\n');
  });

  it('wraps callout text within the measure', () => {
    const lines = renderCallout('warn', 'word '.repeat(30).trim(), 40).trimEnd().split('\n');
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(40);
    expect(lines[0]).toContain('•');
  });

  it('aligns metadata values in a second column and wraps long values', () => {
    const output = renderMetadata(
      [
        ['Evaluation', '11111111-1111-4111-8111-111111111111'],
        ['Context', 'scenario'],
      ],
      60,
    );
    expect(output).toContain('11111111-1111-4111-8111-111111111111');
    for (const line of output.trimEnd().split('\n')) expect(line.length).toBeLessThanOrEqual(60);
    expect(renderMetadata([], 60)).toBe('');
  });

  it('strips control characters from labels and values', () => {
    const output = renderMetadata([['Run\u0007', 'a\u001B[31mb']], 40);
    expect(output.includes('\u0007')).toBe(false);
    expect(output.includes('\u001B[31m')).toBe(false);
  });
});

describe('narrow terminals', () => {
  it('keeps table content readable by wrapping instead of overflowing', () => {
    const table = formatTable(
      [{ header: 'NAME' }, { header: 'ID' }],
      [['A much longer workspace name', '11111111-1111-4111-8111-111111111111']],
      { width: 40 },
    );
    for (const line of table.split('\n')) expect(line.length).toBeLessThanOrEqual(40);
    expect(table).toContain('NAME');
  });
});
