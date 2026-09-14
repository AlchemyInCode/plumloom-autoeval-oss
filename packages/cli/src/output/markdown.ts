import { Chalk } from 'chalk';
import { Marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

import { safeMultilineTerminalText } from './safe-text.js';

/**
 * Markdown rendering for model-authored answers.
 *
 * Model answers are markdown, so fenced code, tables, block quotes, links and
 * headings are rendered by `marked-terminal` instead of being printed as raw
 * syntax. The palette is passed in explicitly (not detected by chalk) so the
 * renderer stays deterministic, and the result is plain stdout text.
 */

export type MarkdownStyle = {
  width: number;
  color: boolean;
  unicode: boolean;
};

const chalk = new Chalk({ level: 1 });
const identity = (value: string): string => value;

/**
 * Rich markdown is anything the line-based text renderer cannot express:
 * fenced code, tables, block quotes, headings, links, or images.
 */
const RICH_MARKDOWN = /(^|\n)\s*(?:```|>\s|#{1,6}\s|\|[^\n]*\|\s*$)|!?\[[^\]\n]+\]\([^)\s]+\)/u;

export function hasRichMarkdown(message: string): boolean {
  return RICH_MARKDOWN.test(message);
}

export function createMarkdownRenderer(style: MarkdownStyle): (message: string) => string {
  const paint = style.color;
  const marked = new Marked().use(
    markedTerminal({
      width: style.width,
      reflowText: true,
      tab: 2,
      emoji: style.unicode,
      code: paint ? (value): string => chalk.cyan(value) : identity,
      blockquote: paint ? (value): string => chalk.dim(value) : identity,
      heading: paint ? (value): string => chalk.magenta.bold(value) : identity,
      firstHeading: paint ? (value): string => chalk.magenta.bold(value) : identity,
      strong: paint ? (value): string => chalk.bold(value) : identity,
      em: paint ? (value): string => chalk.italic(value) : identity,
      codespan: paint ? (value): string => chalk.cyan(value) : identity,
      link: paint ? (value): string => chalk.dim(value) : identity,
      href: paint ? (value): string => chalk.dim(value) : identity,
      hr: paint ? (value): string => chalk.dim(value) : identity,
    }),
  );

  return (message: string): string => {
    const rendered = marked.parse(safeMultilineTerminalText(message), { async: false });
    return typeof rendered === 'string' ? rendered.replace(/\s+$/u, '') : '';
  };
}
