import { z } from 'zod';

export const uuidSchema = z.uuid();
export type JsonValue = z.infer<ReturnType<typeof z.json>>;
export type JsonObject = Record<string, JsonValue>;

export function parseUuid(input: string, label: string): string {
  const parsed = uuidSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`${label} must be a valid UUID.`);
  }
  return parsed.data;
}
