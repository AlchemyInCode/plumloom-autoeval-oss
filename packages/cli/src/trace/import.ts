/**
 * Composing an importable configured-run file.
 *
 * The trajectory supplies the artifact. Everything a judge needs — judge model,
 * evaluator instructions, expected behavior, metrics — is a review-time decision
 * that belongs in a committed template file, not in whatever the agent happened
 * to do. This module joins the two and validates the result against the same
 * schema the run path uses, so a bad conversion fails at import rather than at
 * submit.
 */
import { z } from 'zod';

import { redactUnknown } from '../auth/redact.js';
import { configuredRunFileSchema } from '../configured-run/validation.js';
import { AutoevalError } from '../errors/autoeval-error.js';
import type { HarnessTraceConversion } from './deepseek-harness.js';

const templateSchema = z
  .object({
    methodology: z.record(z.string(), z.json()),
    configuration: z.record(z.string(), z.json()),
  })
  .loose();

export type AgentTraceImportInput = {
  template: unknown;
  conversion: HarnessTraceConversion;
  /** Overrides the template's `configuration.evaluationName`. */
  evaluationName?: string;
};

export function buildAgentTraceInput(input: AgentTraceImportInput): Record<string, unknown> {
  const template = templateSchema.safeParse(input.template);
  if (!template.success) {
    throw new AutoevalError(
      'The template must be a JSON object with `methodology` and `configuration` objects. Start from examples/evals/agent-trace-basic.json.',
      { kind: 'usage', code: 'TRACE_TEMPLATE_INVALID', cause: template.error },
    );
  }

  const configuration: Record<string, unknown> = {
    ...template.data.configuration,
    contextType: 'agent_trace',
    artifact: input.conversion.artifact,
    ...(input.evaluationName ? { evaluationName: input.evaluationName } : {}),
  };
  // The trace file supplies the artifact; a path reference in the template
  // would silently override it during file-input resolution.
  delete configuration.artifactFile;

  const candidate = redactUnknown({
    methodology: template.data.methodology,
    configuration,
  }) as Record<string, unknown>;

  const validated = configuredRunFileSchema.safeParse(candidate);
  if (!validated.success) {
    throw new AutoevalError(
      'The imported trace did not produce a valid agent_trace evaluation input. Check that the template supplies methodology, contextName, expected, and selectedMetrics.',
      { kind: 'validation', code: 'TRACE_IMPORT_INVALID_INPUT', cause: validated.error },
    );
  }
  return candidate;
}
