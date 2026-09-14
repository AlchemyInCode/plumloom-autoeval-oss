import { z } from 'zod';

import { qualityStandardCreateSchema } from '../actions/quality-standards.js';
import { configuredRunFileSchema } from '../configured-run/validation.js';

const uuid = z.uuid();
const page = z.number().int().positive().optional();
const pageSize = z.number().int().min(1).max(100).optional();

export const emptyInputSchema = z.object({}).strict();

export const listWorkspacesInputSchema = z
  .object({
    page,
    size: pageSize,
  })
  .strict();

export const createWorkspaceInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict();

export const listEvaluationsInputSchema = z
  .object({
    workspaceId: uuid,
    page,
    size: pageSize,
  })
  .strict();

export const createEvaluationInputSchema = z
  .object({
    workspaceId: uuid,
    evaluationName: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const evaluationInputSchema = z.object({ evaluationId: uuid }).strict();

export const updateEvaluationTitleInputSchema = z
  .object({
    workspaceId: uuid,
    evaluationId: uuid,
    evaluationName: z.string().trim().min(1).max(120),
    userSystemId: z.string().trim().min(1),
    description: z.string().optional(),
    page,
    size: pageSize,
  })
  .strict();

export const qualityStandardInputSchema = qualityStandardCreateSchema;

export const qualityStandardIdInputSchema = z.object({ qualityStandardId: uuid }).strict();

export const assignQualityStandardInputSchema = z
  .object({
    workspaceId: uuid,
    qualityStandardId: uuid,
  })
  .strict();

export const validateConfiguredEvaluationInputSchema = z
  .object({ input: configuredRunFileSchema })
  .strict();

export const runConfiguredEvaluationInputSchema = z
  .object({
    evaluationId: uuid,
    input: configuredRunFileSchema,
  })
  .strict();

export const runInputSchema = z.object({ evaluationId: uuid }).strict();

export const runReferenceInputSchema = z
  .object({
    evaluationId: uuid,
    runId: uuid,
  })
  .strict();

const mcpErrorSchema = z
  .object({
    kind: z.string(),
    code: z.string(),
    message: z.string(),
  })
  .strict();

export const mcpToolOutputSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.json() }).strict(),
  z.object({ ok: z.literal(false), error: mcpErrorSchema }).strict(),
]);
