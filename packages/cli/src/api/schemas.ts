import { z } from 'zod';

import { uuidSchema } from '../domain/common.js';

export const jsonObjectSchema = z.record(z.string(), z.json());
export const nullableJsonObjectSchema = jsonObjectSchema.nullable();

export const userIdentityResponseSchema = z
  .object({
    id: z.string().min(1),
    user_sys_id: z.string().min(1),
    email: z.email(),
    name: z.string().nullable().optional(),
  })
  .loose();

const workspaceResponseSchema = z
  .object({
    workspace_id: uuidSchema,
    name: z.string(),
    description: z.string().nullable().optional(),
    eval_count: z.number().int().nonnegative().optional(),
    updated_at: z.string().optional(),
  })
  .loose();

export const workspacePageResponseSchema = z
  .object({
    items: z.array(workspaceResponseSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    size: z.number().int().positive(),
    total_pages: z.number().int().nonnegative(),
  })
  .loose();

export { workspaceResponseSchema };

const evaluationSummaryResponseSchema = z
  .object({
    eval_id: uuidSchema,
    eval_name: z.string(),
    workspace_id: uuidSchema.optional(),
    updated_at: z.string().optional(),
  })
  .loose();

export const evaluationPageResponseSchema = z
  .object({
    items: z.array(evaluationSummaryResponseSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    size: z.number().int().positive(),
    total_pages: z.number().int().nonnegative(),
  })
  .loose();

export { evaluationSummaryResponseSchema };

export const evaluationDraftResponseSchema = z
  .object({
    evaluation_id: uuidSchema.optional(),
    evaluationId: uuidSchema.optional(),
    eval_id: uuidSchema.optional(),
    id: uuidSchema.optional(),
  })
  .loose();

export const evaluationCreateResponseSchema = z
  .object({
    evaluation_id: uuidSchema.optional(),
    evaluationId: uuidSchema.optional(),
    eval_id: uuidSchema.optional(),
    id: uuidSchema.optional(),
    eval_name: z.string().optional(),
    workspace_id: uuidSchema.optional(),
  })
  .loose();

export const methodologyVersionCreateResponseSchema = z
  .object({
    methodology_version_id: uuidSchema.optional(),
    methodologyVersionId: uuidSchema.optional(),
    methodology_id: uuidSchema.optional(),
    methodologyId: uuidSchema.optional(),
    id: uuidSchema.optional(),
  })
  .loose();

export const configVersionCreateResponseSchema = z
  .object({
    config_version_id: uuidSchema.optional(),
    configVersionId: uuidSchema.optional(),
    config_id: uuidSchema.optional(),
    configId: uuidSchema.optional(),
    id: uuidSchema.optional(),
  })
  .loose();

const evaluationVersionItemSchema = z
  .object({
    version: z.number().int().positive(),
    methodologyId: uuidSchema,
    configId: uuidSchema,
    isCurrent: z.boolean(),
  })
  .loose();

const methodologySchema = z
  .object({
    methodologyId: uuidSchema,
    versionNumber: z.number().int().positive(),
    configs: z.array(
      z
        .object({
          configId: uuidSchema,
          versionNumber: z.number().int().positive(),
        })
        .loose(),
    ),
  })
  .loose();

export const evaluationVersionsResponseSchema = z
  .object({
    evaluationId: uuidSchema,
    context_type: z.enum(['scenario', 'conversation', 'agent_trace']).nullable().optional(),
    methodologies: z.array(methodologySchema).optional(),
    evaluationVersions: z
      .object({
        currentVersion: z.number().int().positive(),
        items: z.array(evaluationVersionItemSchema),
      })
      .nullable()
      .optional(),
  })
  .loose();

export const evaluationConfigurationResponseSchema = z
  .object({
    evaluation_id: uuidSchema,
    methodology_version_id: uuidSchema,
    config_version_id: uuidSchema,
    context_type: z.enum(['scenario', 'conversation', 'agent_trace']).nullable().optional(),
  })
  .loose();

const modelResponseSchema = z
  .object({
    id: uuidSchema,
    display_name: z.string(),
    api_model_id: z.string(),
    is_deprecated: z.boolean(),
    locked: z.boolean(),
    model_key: z.string().optional(),
  })
  .loose();

const byokModelResponseSchema = z
  .object({
    supported_model_id: uuidSchema,
    provider_model_id: z.string().min(1),
    provider: z.string().min(1),
    display_name: z.string().min(1),
    is_deprecated: z.boolean().optional(),
    locked: z.boolean().optional(),
    model_key: z.string().optional(),
  })
  .loose();

export const modelsResponseSchema = z.union([
  z
    .object({
      providers: z.record(
        z.string(),
        z
          .object({
            models: z.array(modelResponseSchema),
          })
          .loose(),
      ),
    })
    .loose(),
  z
    .object({
      models: z.array(byokModelResponseSchema),
    })
    .loose(),
]);

export const runCreateResponseSchema = z
  .object({
    runId: uuidSchema,
    status: z.string(),
    using: z
      .object({
        methodologyVersionId: uuidSchema,
        configVersionId: uuidSchema,
      })
      .loose(),
  })
  .loose();

export const runStatusResponseSchema = z
  .object({
    run_id: uuidSchema,
    evaluation_id: uuidSchema,
    evaluationState: z.string(),
    progress: z
      .object({
        percentage: z.number().optional(),
        runsCompleted: z.number().int().nonnegative().optional(),
        totalRuns: z.number().int().nonnegative().optional(),
      })
      .loose()
      .optional(),
    error_message: z.string().nullable().optional(),
    failure_code: z.string().nullable().optional(),
  })
  .loose();

export type UserIdentityResponse = z.infer<typeof userIdentityResponseSchema>;
export type WorkspaceResponse = z.infer<typeof workspaceResponseSchema>;
export type WorkspacePageResponse = z.infer<typeof workspacePageResponseSchema>;
export type EvaluationSummaryResponse = z.infer<typeof evaluationSummaryResponseSchema>;
export type EvaluationDraftResponse = z.infer<typeof evaluationDraftResponseSchema>;
export type EvaluationCreateResponse = z.infer<typeof evaluationCreateResponseSchema>;
export type MethodologyVersionCreateResponse = z.infer<
  typeof methodologyVersionCreateResponseSchema
>;
export type ConfigVersionCreateResponse = z.infer<typeof configVersionCreateResponseSchema>;
export type EvaluationPageResponse = z.infer<typeof evaluationPageResponseSchema>;
export type EvaluationVersionsResponse = z.infer<typeof evaluationVersionsResponseSchema>;
export type EvaluationConfigurationResponse = z.infer<typeof evaluationConfigurationResponseSchema>;
export type ModelsResponse = z.infer<typeof modelsResponseSchema>;
export type RunCreateResponse = z.infer<typeof runCreateResponseSchema>;
export type RunStatusResponse = z.infer<typeof runStatusResponseSchema>;
