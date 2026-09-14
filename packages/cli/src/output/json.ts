import { redactUnknown } from '../auth/redact.js';

export function renderJson(input: unknown): string {
  return `${JSON.stringify(redactUnknown(input), null, 2)}\n`;
}
