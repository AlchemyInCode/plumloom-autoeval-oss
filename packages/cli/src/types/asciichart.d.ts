/**
 * Minimal typed surface for the untyped `asciichart` package.
 * Only the `plot` entry point used by the trend renderer is declared.
 */
declare module 'asciichart' {
  export interface PlotConfig {
    height?: number;
    min?: number;
    max?: number;
    offset?: number;
    padding?: string;
    colors?: readonly (string | undefined)[];
    format?: (value: number, index: number) => string;
  }

  export function plot(
    series: readonly number[] | readonly number[][],
    config?: PlotConfig,
  ): string;
}
