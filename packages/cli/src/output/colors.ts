import chalk from 'chalk';

/**
 * Semantic colour vocabulary for the line-based CLI.
 *
 * Colour carries meaning, never decoration: pass/positive is green, warning is
 * yellow, failure or regression is red, identifiers and metadata are dim, and
 * user input is cyan. Chalk disables itself for pipes, `NO_COLOR`, and
 * non-TTY streams, so the same renderers stay pipe-safe.
 */
export const paint = {
  pass: (value: string): string => chalk.green(value),
  warn: (value: string): string => chalk.yellow(value),
  fail: (value: string): string => chalk.red(value),
  /** Identifiers and other reference metadata recede behind the content. */
  meta: (value: string): string => chalk.dim(value),
  /** Echoed user input. */
  input: (value: string): string => chalk.cyan(value),
  heading: (value: string): string => chalk.bold(value),
  header: (value: string): string => chalk.dim.bold(value),
} as const;

export type SemanticTone = keyof typeof paint;
