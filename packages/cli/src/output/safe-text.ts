import { redactText } from '../auth/redact.js';

// eslint-disable-next-line no-control-regex -- SGR sequences must be recognised to be removed
const SGR_PATTERN = /\u001B\[[0-9;]*m/gu;

/**
 * Colour sequences are removed whole. Blanking the escape byte alone would
 * leave the visible remainder (for example "[36m") in the rendered output.
 */
function stripSgr(input: string): string {
  return input.replace(SGR_PATTERN, '');
}

// Capturing split keeps the colour sequences themselves in the segment list.
// eslint-disable-next-line no-control-regex -- SGR sequences must be recognised to be preserved
const SGR_PATTERN_KEEP = /(\u001B\[[0-9;]*m)/u;
// eslint-disable-next-line no-control-regex -- matches a whole SGR sequence
const SGR_EXACT = /^\u001B\[[0-9;]*m$/u;

export function safeTerminalText(input: string): string {
  return Array.from(stripSgr(redactText(input)), (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159) ? ' ' : character;
  }).join('');
}

export function safeMultilineTerminalText(input: string): string {
  return Array.from(stripSgr(redactText(input)), (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    const isAllowedWhitespace = codePoint === 9 || codePoint === 10 || codePoint === 13;
    return !isAllowedWhitespace && (codePoint <= 31 || (codePoint >= 127 && codePoint <= 159))
      ? ' '
      : character;
  }).join('');
}

/**
 * Sanitize a block that a trusted renderer has already laid out and coloured.
 *
 * Tables and scorecards carry their own SGR sequences; stripping them here
 * would flatten the palette, so colour sequences are preserved while every
 * other control character is still neutralised and secrets are still redacted.
 */
export function safeRenderedBlock(input: string): string {
  return redactText(input)
    .split(SGR_PATTERN_KEEP)
    .map((segment) => (SGR_EXACT.test(segment) ? segment : safeMultilineTerminalText(segment)))
    .join('');
}
