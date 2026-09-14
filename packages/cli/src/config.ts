import { AutoevalError } from './errors/autoeval-error.js';

export type AutoevalConfiguration = {
  apiBaseUrl: URL;
  requestTimeoutMs: number;
  maxResponseBytes: number;
  pollIntervalMs: number;
  pollTimeoutMs: number;
  resultReadyIntervalMs: number;
  resultReadyTimeoutMs: number;
};

function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function parseApiBaseUrl(input: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch (error) {
    throw new AutoevalError('AUTOEVAL_API_BASE_URL must be a valid URL.', {
      kind: 'validation',
      code: 'INVALID_BASE_URL',
      cause: error,
    });
  }

  if (
    parsed.protocol !== 'https:' &&
    !(parsed.protocol === 'http:' && isLocalhost(parsed.hostname))
  ) {
    throw new AutoevalError(
      'The Autoeval API must use HTTPS; HTTP is allowed only for localhost development.',
      {
        kind: 'validation',
        code: 'INSECURE_BASE_URL',
      },
    );
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new AutoevalError(
      'AUTOEVAL_API_BASE_URL must not contain credentials, query parameters, or fragments.',
      {
        kind: 'validation',
        code: 'INVALID_BASE_URL',
      },
    );
  }

  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new AutoevalError('AUTOEVAL_API_BASE_URL must be an origin without a path.', {
      kind: 'validation',
      code: 'INVALID_BASE_URL',
    });
  }

  parsed.pathname = '/';
  return parsed;
}

export function loadConfiguration(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AutoevalConfiguration {
  const apiBaseUrl = environment.AUTOEVAL_API_BASE_URL?.trim();
  if (!apiBaseUrl) {
    throw new AutoevalError(
      'AUTOEVAL_API_BASE_URL is not defined. Set it to the Autoeval API origin to continue.',
      {
        kind: 'validation',
        code: 'MISSING_API_BASE_URL',
      },
    );
  }

  return {
    apiBaseUrl: parseApiBaseUrl(apiBaseUrl),
    requestTimeoutMs: 30_000,
    maxResponseBytes: 2 * 1024 * 1024,
    pollIntervalMs: 2_000,
    pollTimeoutMs: 10 * 60_000,
    resultReadyIntervalMs: 2_000,
    resultReadyTimeoutMs: 60_000,
  };
}
