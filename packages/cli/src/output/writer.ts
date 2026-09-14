import { redactUnknown } from '../auth/redact.js';
import type { ApiDiagnostic } from '../api/client.js';
import { renderJson } from './json.js';
import { safeTerminalText } from './safe-text.js';

export interface OutputStream {
  write(chunk: string): boolean;
  isTTY?: boolean;
}

export class OutputWriter {
  readonly #stdout: OutputStream;
  readonly #stderr: OutputStream;

  constructor(stdout: OutputStream, stderr: OutputStream) {
    this.#stdout = stdout;
    this.#stderr = stderr;
  }

  writeResult(input: unknown, human: string, isJson: boolean): void {
    this.#stdout.write(isJson ? renderJson(input) : human);
  }

  writeError(message: string, isJson: boolean, code?: string, hint?: string): void {
    const safeMessage = safeTerminalText(message);
    const safeHint = hint === undefined ? undefined : safeTerminalText(hint);
    if (isJson) {
      this.#stderr.write(
        renderJson({
          error: { message: safeMessage, code, ...(safeHint ? { hint: safeHint } : {}) },
        }),
      );
      return;
    }
    this.#stderr.write(`Error: ${safeMessage}\n${safeHint ? `Hint: ${safeHint}\n` : ''}`);
  }

  writeDiagnostic(diagnostic: ApiDiagnostic): void {
    this.writeStructuredDiagnostic(diagnostic);
  }

  writeStructuredDiagnostic(diagnostic: unknown): void {
    const line = `[debug] ${JSON.stringify(redactUnknown(diagnostic))}`;
    this.#stderr.write(this.#stderr.isTTY === true ? `\u001B[2m${line}\u001B[22m\n` : `${line}\n`);
  }
}
