import { redactText } from '../auth/redact.js';
import { AutoevalError, type AutoevalErrorKind } from '../errors/autoeval-error.js';

type UpstreamErrorDetails = {
  code?: string;
  message?: string;
};

function objectValue(input: unknown): Record<string, unknown> | undefined {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : undefined;
}

function stringValue(input: unknown): string | undefined {
  return typeof input === 'string' && input.trim() !== '' ? input : undefined;
}

export function extractUpstreamError(body: unknown): UpstreamErrorDetails {
  const root = objectValue(body);
  if (!root) {
    const message = stringValue(body);
    return message ? { message } : {};
  }

  const detail = objectValue(root.detail);
  const error = objectValue(root.error);
  const nestedDetailError = objectValue(detail?.error);

  const code =
    stringValue(root.error_code) ??
    stringValue(root.code) ??
    stringValue(detail?.code) ??
    stringValue(detail?.error_code) ??
    stringValue(error?.code) ??
    stringValue(error?.error_code) ??
    stringValue(nestedDetailError?.code) ??
    stringValue(root.error) ??
    stringValue(detail?.error);

  const message =
    stringValue(root.message) ??
    stringValue(detail?.message) ??
    stringValue(detail?.detail) ??
    stringValue(error?.message) ??
    stringValue(error?.detail) ??
    stringValue(root.detail) ??
    stringValue(root.error);

  return {
    ...(code ? { code } : {}),
    ...(message ? { message: redactText(message) } : {}),
  };
}

function errorKind(status: number, code: string | undefined): AutoevalErrorKind {
  const normalizedCode = code?.toUpperCase() ?? '';
  if (status === 401) return 'authentication';
  if (status === 402) return 'plan_restriction';
  if (status === 403) {
    return /PLAN|CREDIT|SUBSCRIPTION|ENTITLEMENT/u.test(normalizedCode)
      ? 'plan_restriction'
      : 'authorization';
  }
  if (status === 404) return 'authorization';
  if (status === 400 || status === 409 || status === 422) return 'validation';
  if (status === 429 || status >= 500) return 'upstream';
  return 'upstream';
}

export class ApiError extends AutoevalError {
  readonly status: number;
  readonly requestId: string | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(input: {
    status: number;
    code?: string;
    message?: string;
    requestId?: string;
    retryAfterMs?: number;
    cause?: unknown;
  }) {
    const safeMessage = input.message ?? `Autoeval API request failed with HTTP ${input.status}.`;
    super(safeMessage, {
      kind: errorKind(input.status, input.code),
      ...(input.code ? { code: input.code } : {}),
      ...(input.cause !== undefined ? { cause: input.cause } : {}),
    });
    this.name = 'ApiError';
    this.status = input.status;
    this.requestId = input.requestId;
    this.retryAfterMs = input.retryAfterMs;
  }
}

export function isRunNotReady(error: unknown): error is ApiError {
  if (!(error instanceof ApiError)) return false;
  if (error.code?.toUpperCase() === 'RUN_NOT_READY') return true;
  return /\bRUN_NOT_READY\b/iu.test(error.message);
}
