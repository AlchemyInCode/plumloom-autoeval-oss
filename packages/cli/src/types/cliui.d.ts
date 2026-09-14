/**
 * Minimal typed surface for the untyped `cliui` package.
 * Only the factory and the `div`/`toString` calls used by the layout renderer
 * are declared.
 */
declare module 'cliui' {
  export interface UiColumn {
    text: string;
    width?: number;
    padding?: number[];
    align?: 'left' | 'right' | 'center';
    border?: boolean;
  }

  export interface Ui {
    div(...columns: (UiColumn | string)[]): void;
    span(...columns: (UiColumn | string)[]): void;
    resetOutput(): void;
    toString(): string;
  }

  export interface UiOptions {
    width?: number;
    wrap?: boolean;
  }

  export default function cliui(options?: UiOptions): Ui;
}
