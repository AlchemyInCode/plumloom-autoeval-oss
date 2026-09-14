/**
 * Minimal typed surface for the untyped `cli-progress` package.
 * Only the single-bar API used by the progress reporter is declared.
 */
declare module 'cli-progress' {
  export interface SingleBarOptions {
    stream?: { write(chunk: string): unknown };
    format?: string;
    barsize?: number;
    barCompleteChar?: string;
    barIncompleteChar?: string;
    hideCursor?: boolean;
    clearOnComplete?: boolean;
    noTTYOutput?: boolean;
    linewrap?: boolean;
    fps?: number;
  }

  export type BarPayload = Record<string, string | number>;

  export class SingleBar {
    constructor(options?: SingleBarOptions, preset?: unknown);
    start(total: number, startValue: number, payload?: BarPayload): void;
    update(current: number, payload?: BarPayload): void;
    setTotal(total: number): void;
    increment(step?: number, payload?: BarPayload): void;
    stop(): void;
  }
}
