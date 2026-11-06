import { z } from 'zod';
import { ApiError } from '../api/errors.js';
import type { JsonObject } from '../domain/common.js';
import { AutoevalError } from '../errors/autoeval-error.js';
import type { ActionContext } from './context.js';
import { resolveEvaluationVersion } from './evaluations.js';

export const feedbackInputSchema = z
  .object({
    evaluationId: z.uuid(),
    runId: z.uuid(),
    scenario: z.string().trim().min(1).max(500).optional(),
    model: z.string().trim().min(1).max(500).optional(),
    section: z.enum(['session', 'trajectory', 'all']).optional(),
  })
  .strict();

export type FeedbackInput = z.infer<typeof feedbackInputSchema>;

export type FeedbackItem = {
  section: 'response' | 'session' | 'trajectory';
  scenarioId?: string;
  scenarioName?: string;
  modelKey?: string;
  modelName?: string;
  judgeFeedback: JsonObject | null;
  judgeResponses?: {
    successful: number;
    requested: number;
  };
  dimensions?: JsonObject[];
  steps?: {
    step_id: string;
    sequence: number;
  }[];
};

export type JudgeFeedbackResult = {
  contextType: 'scenario' | 'conversation' | 'agent_trace';
  evaluationId: string;
  runId: string;
  items: FeedbackItem[];
};

const feedbackSchema = z
  .object({
    version: z.string(),
    status: z.enum(['available', 'partial', 'unavailable']),
    summary: z.string().nullable().optional(),
    criteria: z
      .record(
        z.string(),
        z
          .object({
            level: z.number().min(0).max(10).nullable().optional(),
            explanation: z.string().nullable().optional(),
            evidence: z.array(z.string()).optional(),
          })
          .loose(),
      )
      .optional(),
  })
  .loose();

function upstream(message: string): never {
  throw new AutoevalError(message, { kind: 'upstream', code: 'INVALID_FEEDBACK_RESPONSE' });
}

export function feedbackObject(input: unknown): JsonObject {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
    ? (input as JsonObject)
    : {};
}

function rows(input: unknown): JsonObject[] {
  if (
    !Array.isArray(input) ||
    input.some((entry) => entry === null || typeof entry !== 'object' || Array.isArray(entry))
  ) {
    return upstream('The result reader returned invalid feedback rows.');
  }
  return input as JsonObject[];
}

function feedback(input: unknown): JsonObject | null {
  if (input === undefined || input === null) return null;
  if (!feedbackSchema.safeParse(input).success) {
    return upstream('The result reader returned invalid judge feedback.');
  }
  return input as JsonObject;
}

function judgeResponses(
  payload: JsonObject,
  envelope: JsonObject | null,
): { successful: number; requested: number } | undefined {
  const reliability = feedbackObject(envelope?.reliability);
  for (const candidate of [
    payload.judge_agreement,
    reliability.judge_agreement,
    envelope?.judging_method,
    reliability,
    payload,
  ]) {
    const counts = feedbackObject(candidate);
    const successful = counts.replicas_successful ?? counts.pass ?? counts.agreed;
    const requested = counts.replicas_requested ?? counts.total;
    if (
      typeof successful === 'number' &&
      typeof requested === 'number' &&
      Number.isInteger(successful) &&
      Number.isInteger(requested) &&
      successful >= 0 &&
      requested >= successful
    ) {
      return { successful, requested };
    }
  }
  return undefined;
}

function item(section: 'response' | 'session' | 'trajectory', payload: JsonObject): FeedbackItem {
  const envelope = feedback(
    section === 'trajectory'
      ? feedbackObject(payload.judge_agreement).judge_feedback
      : payload.judge_feedback,
  );
  const counts = judgeResponses(payload, envelope);
  return { section, judgeFeedback: envelope, ...(counts ? { judgeResponses: counts } : {}) };
}

async function scenarioItems(
  context: ActionContext,
  input: FeedbackInput,
  signal?: AbortSignal,
): Promise<FeedbackItem[]> {
  const items: FeedbackItem[] = [];
  for (let page = 1; page <= 1_000; page += 1) {
    const payload = await context.api.getModelResponses(
      input.evaluationId,
      input.runId,
      signal,
      page,
    );
    for (const output of rows(payload.outputs)) {
      for (const response of rows(output.model_responses)) {
        items.push({
          ...item('response', response),
          ...(typeof output.scenario_id === 'string' ? { scenarioId: output.scenario_id } : {}),
          ...(typeof output.scenario_name === 'string'
            ? { scenarioName: output.scenario_name }
            : {}),
          ...(typeof response.model_key === 'string' ? { modelKey: response.model_key } : {}),
          ...(typeof response.display_name === 'string'
            ? { modelName: response.display_name }
            : typeof response.model_name === 'string'
              ? { modelName: response.model_name }
              : {}),
        });
      }
    }
    const pagination = z
      .object({
        page: z.number().int().positive(),
        has_next: z.boolean().optional(),
        total_pages: z.number().int().nonnegative(),
      })
      .safeParse(payload.pagination);
    if (!pagination.success || pagination.data.page !== page) {
      return upstream(
        'Scenario feedback pagination is missing or inconsistent; complete retrieval cannot be confirmed.',
      );
    }
    const hasNext = pagination.data.has_next ?? page < pagination.data.total_pages;
    if (pagination.data.has_next !== undefined && hasNext !== page < pagination.data.total_pages) {
      return upstream(
        'Scenario feedback pagination is missing or inconsistent; complete retrieval cannot be confirmed.',
      );
    }
    if (!hasNext) return items;
  }
  return upstream(
    'Scenario feedback exceeds the 1000-page retrieval limit. Narrow the evaluation before retrying.',
  );
}

export async function getJudgeFeedback(
  context: ActionContext,
  rawInput: FeedbackInput,
  signal?: AbortSignal,
): Promise<JudgeFeedbackResult> {
  const parsed = feedbackInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new AutoevalError('Feedback arguments are invalid.', {
      kind: 'usage',
      code: 'INVALID_FEEDBACK_ARGUMENTS',
    });
  }
  const input = parsed.data;
  const version = await resolveEvaluationVersion(context, input.evaluationId, undefined, signal);
  const contextType = version.contextType;
  if (
    (contextType !== 'scenario' && (input.scenario !== undefined || input.model !== undefined)) ||
    (contextType !== 'agent_trace' && input.section !== undefined)
  ) {
    throw new AutoevalError(
      'Scenario/model filters require Scenario; section requires Agent Trace.',
      {
        kind: 'usage',
        code: 'INVALID_FEEDBACK_FILTER',
      },
    );
  }
  let items: FeedbackItem[];
  if (contextType === 'scenario') {
    items = await scenarioItems(context, input, signal);
    if (input.model !== undefined && !items.some((entry) => entry.modelKey === input.model)) {
      throw new AutoevalError('Model must match a specific model key in this run.', {
        kind: 'usage',
        code: 'UNKNOWN_FEEDBACK_MODEL',
      });
    }
    if (input.scenario !== undefined) {
      const matches = items.filter(
        (entry) => entry.scenarioId === input.scenario || entry.scenarioName === input.scenario,
      );
      if (
        matches.length === 0 ||
        new Set(matches.map((entry) => entry.scenarioId ?? entry.scenarioName)).size > 1
      ) {
        throw new AutoevalError(
          'Scenario must identify one scenario in this run; use its ID if names are duplicated.',
          { kind: 'usage', code: 'UNKNOWN_FEEDBACK_SCENARIO' },
        );
      }
      items = matches;
    }
    if (input.model !== undefined) items = items.filter((entry) => entry.modelKey === input.model);
  } else if (contextType === 'conversation') {
    items = [
      item(
        'session',
        await context.api.getConversationResults(input.evaluationId, input.runId, signal),
      ),
    ];
  } else {
    items = [];
    if (input.section !== 'trajectory') {
      items.push(
        item(
          'session',
          await context.api.getAgentTraceResults(input.evaluationId, input.runId, signal),
        ),
      );
    }
    if (input.section !== 'session') {
      try {
        const trajectory = await context.api.getTrajectory(input.evaluationId, input.runId, signal);
        const dimensions = rows(trajectory.dimensions ?? []);
        const steps = rows(trajectory.steps ?? []).flatMap((step, index) =>
          typeof step.step_id === 'string'
            ? [
                {
                  step_id: step.step_id,
                  sequence: typeof step.sequence === 'number' ? step.sequence : index + 1,
                },
              ]
            : [],
        );
        items.push({ ...item('trajectory', trajectory), dimensions, steps });
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
        items.push({ section: 'trajectory', judgeFeedback: null });
      }
    }
  }
  return { contextType, evaluationId: input.evaluationId, runId: input.runId, items };
}
