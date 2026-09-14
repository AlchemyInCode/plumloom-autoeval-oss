import { z } from 'zod';

import { AutoevalError } from '../errors/autoeval-error.js';
import type { ActionContext } from './context.js';
import { requireUuid } from './validation.js';

const qualityStandardAnchorSchema = z
  .object({
    input: z.string().min(1),
    response: z.string().min(1),
    reference: z.string().min(1),
    score: z.union([z.literal(1), z.literal(5)]),
    reasoning: z.string().min(1),
  })
  .strict();

export const qualityStandardCreateSchema = z
  .object({
    name: z.string().trim().min(1),
    judge_model: z.uuid(),
    rubric: z.string().min(1),
    anchors: z.array(qualityStandardAnchorSchema).min(1).max(5),
  })
  .strict();

export type QualityStandardCreateInput = z.infer<typeof qualityStandardCreateSchema>;

export type CreatedQualityStandard = {
  qualityStandardId?: string;
  raw: Record<string, unknown>;
};

function extractQualityStandardId(response: Record<string, unknown>): string | undefined {
  const idCandidate = response.quality_standard_id ?? response.qualityStandardId ?? response.id;
  return typeof idCandidate === 'string' ? idCandidate : undefined;
}

export async function createQualityStandard(
  context: ActionContext,
  input: QualityStandardCreateInput,
  signal?: AbortSignal,
): Promise<CreatedQualityStandard> {
  const validated = qualityStandardCreateSchema.parse(input);
  const response = await context.api.createQualityStandard(validated, signal);
  const qualityStandardId = extractQualityStandardId(response);

  if (qualityStandardId !== undefined) {
    requireUuid(qualityStandardId, 'Quality standard ID');
  }

  return {
    ...(qualityStandardId !== undefined ? { qualityStandardId } : {}),
    raw: response,
  };
}

export async function assignQualityStandardToWorkspace(
  context: ActionContext,
  input: { workspaceId: string; qualityStandardId: string },
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const workspaceId = requireUuid(input.workspaceId, 'Workspace ID');
  const qualityStandardId = requireUuid(input.qualityStandardId, 'Quality standard ID');
  return context.api.assignQualityStandardToWorkspace(
    workspaceId,
    { quality_standard_id: qualityStandardId },
    signal,
  );
}

export async function updateQualityStandard(
  context: ActionContext,
  input: { qualityStandardId: string } & QualityStandardCreateInput,
  signal?: AbortSignal,
): Promise<CreatedQualityStandard> {
  const qualityStandardId = requireUuid(input.qualityStandardId, 'Quality standard ID');
  const validated = qualityStandardCreateSchema.parse({
    name: input.name,
    judge_model: input.judge_model,
    rubric: input.rubric,
    anchors: input.anchors,
  });
  const response = await context.api.updateQualityStandard(qualityStandardId, validated, signal);
  const responseQualityStandardId = extractQualityStandardId(response);

  if (responseQualityStandardId !== undefined) {
    requireUuid(responseQualityStandardId, 'Quality standard ID');
    if (responseQualityStandardId !== qualityStandardId) {
      throw new AutoevalError('Autoeval API returned a mismatched quality standard identifier.', {
        kind: 'upstream',
        code: 'MISMATCHED_QUALITY_STANDARD_ID',
      });
    }
  }

  return {
    qualityStandardId,
    raw: response,
  };
}

export async function getWorkspaceQualityStandard(
  context: ActionContext,
  workspaceIdInput: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown> | null> {
  const workspaceId = requireUuid(workspaceIdInput, 'Workspace ID');
  return context.api.getWorkspaceQualityStandard(workspaceId, signal);
}

export async function getQualityStandard(
  context: ActionContext,
  qualityStandardIdInput: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const qualityStandardId = requireUuid(qualityStandardIdInput, 'Quality standard ID');
  const response = await context.api.getQualityStandard(qualityStandardId, signal);

  const responseId =
    typeof response.quality_standard_id === 'string'
      ? response.quality_standard_id
      : typeof response.id === 'string'
        ? response.id
        : undefined;

  if (responseId !== undefined && responseId !== qualityStandardId) {
    throw new AutoevalError('Autoeval API returned a mismatched quality standard identifier.', {
      kind: 'upstream',
      code: 'MISMATCHED_QUALITY_STANDARD_ID',
    });
  }

  return response;
}
