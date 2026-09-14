import { performance } from 'node:perf_hooks';

import type { ZodType } from 'zod';

import { redactText } from '../auth/redact.js';
import { AutoevalError } from '../errors/autoeval-error.js';
import { extractUpstreamError, ApiError } from './errors.js';

export type FetchImplementation = typeof fetch;

export type ApiDiagnostic = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  path: string;
  status?: number;
  requestId?: string;
  upstreamCode?: string;
  durationMs: number;
  attempt: number;
};

export type ApiClientOptions = {
  baseUrl: URL;
  apiKey: string;
  requestTimeoutMs: number;
  maxResponseBytes: number;
  fetchImplementation?: FetchImplementation;
  onDiagnostic?: (diagnostic: ApiDiagnostic) => void;
  sleep?: (milliseconds: number) => Promise<void>;
  maxGetAttempts?: number;
};

type RequestOptions<T> = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  path: string;
  schema: ZodType<T>;
  query?: Readonly<Record<string, string | number | boolean | undefined>>;
  body?: unknown;
  headers?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
};

const RETRYABLE_GET_STATUSES = new Set([429, 502, 503, 504]);

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, 5_000);
  }
  return undefined;
}

function createRequestSignal(
  externalSignal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; didTimeout: () => boolean; cleanup: () => void } {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('request timeout'));
  }, timeoutMs);
  const abortFromExternal = (): void => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener('abort', abortFromExternal, { once: true });

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', abortFromExternal);
    },
  };
}

async function readBoundedResponse(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength && Number(declaredLength) > maxBytes) {
    throw new AutoevalError('Autoeval API response exceeded the maximum allowed size.', {
      kind: 'upstream',
      code: 'RESPONSE_TOO_LARGE',
    });
  }

  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      receivedBytes += item.value.byteLength;
      if (receivedBytes > maxBytes) {
        await reader.cancel();
        throw new AutoevalError('Autoeval API response exceeded the maximum allowed size.', {
          kind: 'upstream',
          code: 'RESPONSE_TOO_LARGE',
        });
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks).toString('utf8');
}

function parseJsonBody(text: string, status: number): unknown {
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ApiError({
      status,
      code: 'INVALID_JSON_RESPONSE',
      message: 'Autoeval API returned an invalid JSON response.',
      cause: error,
    });
  }
}

export class ApiClient {
  readonly #baseUrl: URL;
  readonly #apiKey: string;
  readonly #requestTimeoutMs: number;
  readonly #maxResponseBytes: number;
  readonly #fetch: FetchImplementation;
  readonly #onDiagnostic: ((diagnostic: ApiDiagnostic) => void) | undefined;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #maxGetAttempts: number;

  constructor(options: ApiClientOptions) {
    this.#baseUrl = options.baseUrl;
    this.#apiKey = options.apiKey;
    this.#requestTimeoutMs = options.requestTimeoutMs;
    this.#maxResponseBytes = options.maxResponseBytes;
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#onDiagnostic = options.onDiagnostic;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#maxGetAttempts = options.maxGetAttempts ?? 3;
  }

  async request<T>(options: RequestOptions<T>): Promise<T> {
    if (!options.path.startsWith('/api/v1/') || options.path.includes('..')) {
      throw new AutoevalError('Refusing an unsupported API path.', {
        kind: 'validation',
        code: 'UNSUPPORTED_API_PATH',
      });
    }

    const maximumAttempts = options.method === 'GET' ? this.#maxGetAttempts : 1;
    let attempt = 0;

    while (attempt < maximumAttempts) {
      attempt += 1;
      try {
        return await this.#requestOnce(options, attempt);
      } catch (error) {
        const canRetryResponse =
          options.method === 'GET' &&
          error instanceof ApiError &&
          RETRYABLE_GET_STATUSES.has(error.status) &&
          error.code?.toUpperCase() !== 'RUN_NOT_READY';
        const canRetryNetwork =
          options.method === 'GET' &&
          error instanceof AutoevalError &&
          error.kind === 'network' &&
          error.code !== 'REQUEST_ABORTED';

        if (attempt >= maximumAttempts || (!canRetryResponse && !canRetryNetwork)) {
          throw error;
        }

        const retryAfter = error instanceof ApiError ? error.retryAfterMs : undefined;
        await this.#sleep(retryAfter ?? 250 * 2 ** (attempt - 1));
      }
    }

    throw new AutoevalError('Autoeval API request exhausted its retry budget.', {
      kind: 'network',
      code: 'RETRY_EXHAUSTED',
    });
  }

  async openEventStream(path: string, signal?: AbortSignal): Promise<void> {
    if (!path.startsWith('/api/v1/') || path.includes('..')) {
      throw new AutoevalError('Refusing an unsupported API path.', {
        kind: 'validation',
        code: 'UNSUPPORTED_API_PATH',
      });
    }

    const url = new URL(path, this.#baseUrl);
    const requestSignal = createRequestSignal(signal, this.#requestTimeoutMs);
    const startedAt = performance.now();

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: 'GET',
        redirect: 'error',
        signal: requestSignal.signal,
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${this.#apiKey}`,
        },
      });
    } catch (error) {
      requestSignal.cleanup();
      const durationMs = Math.round(performance.now() - startedAt);
      this.#onDiagnostic?.({ method: 'GET', path, durationMs, attempt: 1 });
      if (signal?.aborted) {
        throw new AutoevalError('Autoeval API stream request was canceled.', {
          kind: 'network',
          code: 'REQUEST_ABORTED',
          cause: error,
        });
      }
      throw new AutoevalError(
        requestSignal.didTimeout()
          ? 'Autoeval API stream request timed out.'
          : 'Could not connect to the Autoeval API stream endpoint.',
        {
          kind: 'network',
          code: requestSignal.didTimeout() ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR',
          cause: error,
        },
      );
    }

    const requestId = response.headers.get('x-request-id') ?? undefined;
    const diagnostic: ApiDiagnostic = {
      method: 'GET',
      path,
      status: response.status,
      durationMs: Math.round(performance.now() - startedAt),
      attempt: 1,
      ...(requestId ? { requestId } : {}),
    };
    this.#onDiagnostic?.(diagnostic);

    try {
      if (!response.ok) {
        const responseText = await readBoundedResponse(response, this.#maxResponseBytes);
        const responseBody = parseJsonBody(responseText, response.status);
        const upstream = extractUpstreamError(responseBody);
        const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
        throw new ApiError({
          status: response.status,
          ...(upstream.code ? { code: upstream.code } : {}),
          ...(upstream.message ? { message: redactText(upstream.message) } : {}),
          ...(requestId ? { requestId } : {}),
          ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
        });
      }
    } finally {
      requestSignal.cleanup();
      await response.body?.cancel();
    }
  }

  async #requestOnce<T>(options: RequestOptions<T>, attempt: number): Promise<T> {
    const url = new URL(options.path, this.#baseUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const requestSignal = createRequestSignal(options.signal, this.#requestTimeoutMs);
    const startedAt = performance.now();
    let response: Response;

    try {
      response = await this.#fetch(url, {
        method: options.method,
        redirect: 'error',
        signal: requestSignal.signal,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.#apiKey}`,
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...options.headers,
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch (error) {
      requestSignal.cleanup();
      const durationMs = Math.round(performance.now() - startedAt);
      this.#onDiagnostic?.({ method: options.method, path: options.path, durationMs, attempt });
      if (options.signal?.aborted) {
        throw new AutoevalError('Autoeval API request was canceled.', {
          kind: 'network',
          code: 'REQUEST_ABORTED',
          cause: error,
        });
      }
      throw new AutoevalError(
        requestSignal.didTimeout()
          ? 'Autoeval API request timed out.'
          : 'Could not connect to the Autoeval API.',
        {
          kind: 'network',
          code: requestSignal.didTimeout() ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR',
          cause: error,
        },
      );
    }

    let responseText: string;
    try {
      responseText = await readBoundedResponse(response, this.#maxResponseBytes);
    } finally {
      requestSignal.cleanup();
    }
    const responseBody = parseJsonBody(responseText, response.status);
    const requestId = response.headers.get('x-request-id') ?? undefined;
    const upstream = extractUpstreamError(responseBody);
    const diagnostic: ApiDiagnostic = {
      method: options.method,
      path: options.path,
      status: response.status,
      durationMs: Math.round(performance.now() - startedAt),
      attempt,
      ...(requestId ? { requestId } : {}),
      ...(upstream.code ? { upstreamCode: upstream.code } : {}),
    };
    this.#onDiagnostic?.(diagnostic);

    if (!response.ok) {
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
      throw new ApiError({
        status: response.status,
        ...(upstream.code ? { code: upstream.code } : {}),
        ...(upstream.message ? { message: redactText(upstream.message) } : {}),
        ...(requestId ? { requestId } : {}),
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      });
    }

    const parsed = options.schema.safeParse(responseBody);
    if (!parsed.success) {
      throw new ApiError({
        status: 502,
        code: 'INVALID_API_RESPONSE',
        message: 'Autoeval API returned an unexpected response shape.',
        ...(requestId ? { requestId } : {}),
        cause: parsed.error,
      });
    }
    return parsed.data;
  }
}
