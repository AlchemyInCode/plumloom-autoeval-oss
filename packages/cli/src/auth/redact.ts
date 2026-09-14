const CLI_KEY_PATTERN = /pl_sk_[A-Za-z0-9_-]{12,}/gu;
const SENSITIVE_FIELD_SUFFIXES = new Set([
  'authorization',
  'credential',
  'credentials',
  'password',
  'secret',
  'token',
  'tokens',
]);
const SENSITIVE_KEY_QUALIFIERS = new Set([
  'access',
  'api',
  'auth',
  'client',
  'encryption',
  'private',
  'provider',
  'secret',
  'service',
  'signing',
]);

function fieldNameSegments(input: string): string[] {
  return input
    .replace(/([A-Z]+)([A-Z][a-z])/gu, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((segment) => segment !== '');
}

function isSensitiveFieldName(input: string): boolean {
  const segments = fieldNameSegments(input);
  const lastSegment = segments.at(-1);
  if (lastSegment === undefined) return false;
  if (SENSITIVE_FIELD_SUFFIXES.has(lastSegment) || lastSegment === 'apikey') return true;
  return (
    lastSegment === 'key' &&
    segments.slice(0, -1).some((segment) => SENSITIVE_KEY_QUALIFIERS.has(segment))
  );
}

export function redactText(input: string): string {
  return input.replace(CLI_KEY_PATTERN, 'pl_sk_[REDACTED]');
}

/**
 * Credentials are always strings, while numeric fields such as usage counters
 * (`tokens`, `input_tokens`) share a name with credential fields. Numbers and
 * booleans therefore carry no secret and are reported as returned.
 */
function isRedactableValue(input: unknown): boolean {
  return typeof input !== 'number' && typeof input !== 'boolean';
}

export function redactUnknown(input: unknown): unknown {
  if (typeof input === 'string') {
    return redactText(input);
  }
  if (Array.isArray(input)) {
    return input.map((item) => redactUnknown(item));
  }
  if (input !== null && typeof input === 'object') {
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      redacted[key] =
        isSensitiveFieldName(key) && isRedactableValue(value) ? '[REDACTED]' : redactUnknown(value);
    }
    return redacted;
  }
  return input;
}
