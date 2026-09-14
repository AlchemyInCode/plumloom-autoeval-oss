/**
 * Section focusing for rendered data blocks.
 *
 * A user who asks to see "the rubric" wants that field, not the whole
 * configuration. The retrieved display is already a labelled, indented outline,
 * so a focused view is a pure text operation: keep the labelled line and the
 * block indented beneath it.
 */

const LABEL_PATTERN = /^(\s*)([^:]{1,60}):(.*)$/u;

function indentWidth(line: string): number {
  return /^\s*/u.exec(line)?.[0].length ?? 0;
}

/**
 * Returns only the labelled blocks whose label contains one of the keywords, or
 * `undefined` when nothing matches so the caller can fall back to the full
 * display.
 */
export function focusDisplaySections(
  display: string,
  keywords: readonly string[],
): string | undefined {
  if (keywords.length === 0) return undefined;
  const lines = display.split('\n');
  const kept: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const label = LABEL_PATTERN.exec(line)?.[2]?.toLowerCase();
    if (label === undefined) continue;
    if (!keywords.some((keyword) => label.includes(keyword))) continue;

    kept.push(line.trimEnd());
    const baseIndent = indentWidth(line);
    for (let next = index + 1; next < lines.length; next += 1) {
      const child = lines[next] ?? '';
      if (child.trim() === '') break;
      if (indentWidth(child) <= baseIndent) break;
      kept.push(child.trimEnd());
      index = next;
    }
  }

  return kept.length === 0 ? undefined : kept.join('\n');
}
