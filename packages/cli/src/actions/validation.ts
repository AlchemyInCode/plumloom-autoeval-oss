import { z } from 'zod';

import { AutoevalError } from '../errors/autoeval-error.js';

const uuidSchema = z.uuid();

export function requireUuid(input: string, label: string): string {
  const parsed = uuidSchema.safeParse(input);
  if (!parsed.success) {
    throw new AutoevalError(`${label} must be a valid UUID.`, {
      kind: 'usage',
      code: 'INVALID_UUID',
      cause: parsed.error,
    });
  }
  return parsed.data;
}

export function requirePageSize(input: number): number {
  const parsed = z.number().int().min(1).max(100).safeParse(input);
  if (!parsed.success) {
    throw new AutoevalError('Page size must be between 1 and 100.', {
      kind: 'usage',
      code: 'INVALID_PAGE_SIZE',
      cause: parsed.error,
    });
  }
  return parsed.data;
}
