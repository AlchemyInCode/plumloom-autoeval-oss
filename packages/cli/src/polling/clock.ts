export interface PollClock {
  now(): number;
  sleep(milliseconds: number, signal?: AbortSignal): Promise<void>;
}

export class SystemPollClock implements PollClock {
  now(): number {
    return Date.now();
  }

  sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason instanceof Error ? signal.reason : new Error('Polling was canceled.'));
        return;
      }

      const onAbort = (): void => {
        clearTimeout(timeout);
        reject(
          signal?.reason instanceof Error ? signal.reason : new Error('Polling was canceled.'),
        );
      };
      const timeout = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, milliseconds);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}
