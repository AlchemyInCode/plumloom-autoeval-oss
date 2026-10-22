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

export const importConnectInputSchema = z
  .object({
    refresh: z.boolean().default(false),
  })
  .strict();

export const importReviewInputSchema = z
  .object({
    page: z.number().int().min(1).max(1000).optional(),
    size: pageSize,
    search: z.string().trim().max(500).optional(),
    all: z.boolean().default(false),
  })
  .strict();

export const importEvaluationsInputSchema = z
  .object({
    evalIds: z
      .array(z.string().regex(/^eval_[A-Za-z0-9_-]{1,200}$/u))
      .max(25_000)
      .optional(),
    eval_ids: z
      .array(z.string().regex(/^eval_[A-Za-z0-9_-]{1,200}$/u))
      .max(25_000)
      .optional(),
    allNew: z.boolean().default(false),
    all_new: z.boolean().optional(),
  })
  .strict();

export const importWorkspaceEvaluationsInputSchema = z
  .object({
    workspaceId: uuid.optional(),
    workspace_id: uuid.optional(),
    page: z.number().int().min(1).max(1000).optional(),
    size: z.number().int().min(1).max(200).optional(),
    search: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((data) => data.workspaceId !== undefined || data.workspace_id !== undefined, {
    message: 'workspaceId or workspace_id is required',
  });

export const importEvaluationDetailInputSchema = z
  .object({
    evaluationId: uuid.optional(),
    eval_id: uuid.optional(),
    run: z.union([uuid, z.string().regex(/^(?:evalrun|run)_[A-Za-z0-9_-]{1,200}$/u)]).optional(),
    run_id: z.union([uuid, z.string().regex(/^(?:evalrun|run)_[A-Za-z0-9_-]{1,200}$/u)]).optional(),
    showOutputs: z.boolean().default(false),
    show_outputs: z.boolean().optional(),
    page: z.number().int().min(1).max(1000).optional(),
    size: pageSize,
  })
  .strict()
  .refine((data) => data.evaluationId !== undefined || data.eval_id !== undefined, {
    message: 'evaluationId or eval_id is required',
  });

export const importWorkspaceIdInputSchema = z
  .object({
    workspaceId: uuid.optional(),
    workspace_id: uuid.optional(),
  })
  .strict()
  .refine((data) => data.workspaceId !== undefined || data.workspace_id !== undefined, {
    message: 'workspaceId or workspace_id is required',
  });

export const importRemoveEvaluationInputSchema = z
  .object({
    evaluationId: uuid.optional(),
    eval_id: uuid.optional(),
    yes: z.boolean().default(false),
  })
  .strict()
  .refine((data) => data.evaluationId !== undefined || data.eval_id !== undefined, {
    message: 'evaluationId or eval_id is required',
  });

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
