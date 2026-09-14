/**
 * Minimal typed surface for the untyped `marked-terminal` package.
 * Only the `markedTerminal` extension factory used by the markdown renderer is
 * declared; the returned value is consumed by `marked`'s `use()`.
 */
declare module 'marked-terminal' {
  import type { MarkedExtension } from 'marked';

  export type MarkedTerminalStyle = (value: string) => string;

  export interface MarkedTerminalOptions {
    width?: number;
    reflowText?: boolean;
    tab?: number;
    emoji?: boolean;
    code?: MarkedTerminalStyle;
    blockquote?: MarkedTerminalStyle;
    heading?: MarkedTerminalStyle;
    firstHeading?: MarkedTerminalStyle;
    strong?: MarkedTerminalStyle;
    em?: MarkedTerminalStyle;
    codespan?: MarkedTerminalStyle;
    link?: MarkedTerminalStyle;
    href?: MarkedTerminalStyle;
    hr?: MarkedTerminalStyle;
    listitem?: MarkedTerminalStyle;
    paragraph?: MarkedTerminalStyle;
    text?: MarkedTerminalStyle;
  }

  export function markedTerminal(
    options?: MarkedTerminalOptions,
    highlightOptions?: unknown,
  ): MarkedExtension;
}
