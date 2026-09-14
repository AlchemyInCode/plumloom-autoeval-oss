/**
 * Bounded, shell-free clipboard access for terminal output.
 *
 * Two mechanisms, in order:
 *  1. the platform clipboard helper (`pbcopy`, `wl-copy`, `xclip`, `clip.exe`),
 *     invoked with a fixed executable and a fixed argument array — never a
 *     shell — and fed through stdin so the copied text is never interpolated
 *     into a command line;
 *  2. an OSC 52 escape written to the terminal, which is the only mechanism
 *     that works over SSH or inside a multiplexer.
 *
 * Copy payloads are bounded: OSC 52 is refused by terminals past a few
 * kilobytes anyway, and an unbounded write would let a large backend response
 * flood the terminal.
 */

import { spawn } from 'node:child_process';

/** Upper bound on a single copy payload. */
export const MAX_CLIPBOARD_BYTES = 64 * 1024;

const COPY_TIMEOUT_MS = 2_000;

export interface ClipboardWriter {
  /** Resolves when the text has been handed to the clipboard. */
  copy(text: string): Promise<void>;
}

type CopyCommand = { command: string; args: readonly string[] };

function platformCommands(platform: NodeJS.Platform): readonly CopyCommand[] {
  switch (platform) {
    case 'darwin':
      return [{ command: 'pbcopy', args: [] }];
    case 'win32':
      return [{ command: 'clip.exe', args: [] }];
    default:
      return [
        { command: 'wl-copy', args: [] },
        { command: 'xclip', args: ['-selection', 'clipboard'] },
        { command: 'xsel', args: ['--clipboard', '--input'] },
      ];
  }
}

/** OSC 52 sequence carrying the base64 payload to the terminal emulator. */
export function osc52Sequence(text: string): string {
  return `\u001B]52;c;${Buffer.from(text, 'utf8').toString('base64')}\u0007`;
}

function runCopyCommand(entry: CopyCommand, text: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let child;
    try {
      child = spawn(entry.command, [...entry.args], { stdio: ['pipe', 'ignore', 'ignore'] });
    } catch {
      resolve(false);
      return;
    }

    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(false);
    }, COPY_TIMEOUT_MS);
    timer.unref?.();

    child.once('error', () => finish(false));
    child.once('close', (code) => finish(code === 0));
    child.stdin?.on('error', () => finish(false));
    child.stdin?.end(text);
  });
}

export function createClipboardWriter(input: {
  /** Stream used for the OSC 52 fallback; usually the surface or stdout. */
  write: (chunk: string) => void;
  platform?: NodeJS.Platform;
}): ClipboardWriter {
  const commands = platformCommands(input.platform ?? process.platform);
  return {
    async copy(text: string): Promise<void> {
      const payload =
        Buffer.byteLength(text, 'utf8') > MAX_CLIPBOARD_BYTES
          ? Buffer.from(text, 'utf8').subarray(0, MAX_CLIPBOARD_BYTES).toString('utf8')
          : text;
      for (const entry of commands) {
        if (await runCopyCommand(entry, payload)) return;
      }
      input.write(osc52Sequence(payload));
    },
  };
}
