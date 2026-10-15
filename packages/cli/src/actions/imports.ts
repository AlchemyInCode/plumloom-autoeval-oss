import { z } from 'zod';

import type { ExternalImportRequest } from '../api/external-import.js';
import { ApiError, extractUpstreamError } from '../api/errors.js';
import { AutoevalError } from '../errors/autoeval-error.js';
import type { ActionContext } from './context.js';

export const openaiEvalIdSchema = z.string().regex(/^eval_[A-Za-z0-9_-]{1,200}$/u);
const openaiRunIdSchema = z.string().regex(/^(?:evalrun|run)_[A-Za-z0-9_-]{1,200}$/u);
const pageOptions = {
  page: z.number().int().min(1).max(1000).default(1),
  size: z.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(500).optional(),
};

export const importCommandSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('status') }).strict(),
  z.object({ operation: z.literal('connect'), refresh: z.boolean().default(false) }).strict(),
  z
    .object({ operation: z.literal('review'), ...pageOptions, all: z.boolean().default(false) })
    .strict(),
  z
    .object({
      operation: z.literal('run'),
      evalIds: z.array(openaiEvalIdSchema).max(25_000).optional(),
      allNew: z.boolean().default(false),
    })
    .strict(),
  z.object({ operation: z.literal('list') }).strict(),
  z
    .object({
      operation: z.literal('evals'),
      workspaceId: z.uuid(),
      ...pageOptions,
      size: z.number().int().min(1).max(200).default(50),
    })
    .strict(),
  z
    .object({
      operation: z.literal('show'),
      evaluationId: z.uuid(),
      run: openaiRunIdSchema.optional(),
      showOutputs: z.boolean().default(false),
      page: pageOptions.page,
      size: pageOptions.size,
    })
    .strict(),
  z.object({ operation: z.literal('insights'), workspaceId: z.uuid() }).strict(),
  z
    .object({
      operation: z.literal('remove'),
      evaluationId: z.uuid(),
      yes: z.boolean().default(false),
    })
    .strict(),
  z.object({ operation: z.literal('disconnect') }).strict(),
]);

export type ImportCommand = z.input<typeof importCommandSchema>;
export type ParsedImportCommand = z.output<typeof importCommandSchema>;
const jsonRecord = z.record(z.string(), z.json());
const importCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const importConnectSchema = z
  .object({
    total: importCountSchema.optional(),
    eval_count: importCountSchema.optional(),
    total_evals: importCountSchema.optional(),
  })
  .loose()
  .refine(
    (response) =>
      response.total !== undefined ||
      response.eval_count !== undefined ||
      response.total_evals !== undefined,
  );
const sourceEvalSchema = z
  .object({
    id: openaiEvalIdSchema.optional(),
    openai_eval_id: openaiEvalIdSchema.optional(),
    name: z.string(),
    created_at: z.union([z.string(), z.number()]).nullable().optional(),
    last_run_at: z.union([z.string(), z.number()]).nullable().optional(),
    run_count: z.number().int().nonnegative().nullable().optional(),
    already_imported: z.boolean(),
  })
  .loose()
  .refine((item) => item.id !== undefined || item.openai_eval_id !== undefined);

const normalizedImportReviewSchema = z
  .object({
    evals: z.array(sourceEvalSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    size: z.number().int().positive(),
    items: z.array(sourceEvalSchema).optional(),
    page_size: z.number().int().positive().optional(),
    already_imported_count: z.number().int().nonnegative().optional(),
  })
  .loose();
export const importReviewSchema = z.preprocess((input: unknown) => {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return input;
  const response = input as Record<string, unknown>;
  if (!('items' in response) && !('page_size' in response)) return input;
  return {
    ...response,
    evals: response.evals ?? response.items,
    size: response.size ?? response.page_size,
  };
}, normalizedImportReviewSchema);
export type ImportReview = z.infer<typeof importReviewSchema>;
export const importWorkspaceEvalsSchema = z
  .object({
    page: z.number().int().positive(),
    page_size: z.number().int().positive(),
    total: importCountSchema,
    workspace: z.object({ workspace_id: z.uuid(), name: z.string() }).loose(),
    items: z.array(
      z
        .object({
          eval_id: z.uuid(),
          openai_eval_id: openaiEvalIdSchema,
          name: z.string(),
          openai_created_at: z.union([z.string(), z.number()]).nullable().optional(),
          imported_at: z.union([z.string(), z.number()]).nullable().optional(),
          run_count: importCountSchema.nullable().optional(),
          last_run_at: z.union([z.string(), z.number()]).nullable().optional(),
        })
        .loose(),
    ),
  })
  .loose();
function sourceEvaluationId(evaluation: ImportReview['evals'][number]): string {
  const id = evaluation.openai_eval_id ?? evaluation.id;
  if (id === undefined) {
    throw new AutoevalError('The import API returned an evaluation without a source ID.', {
      kind: 'upstream',
      code: 'INVALID_IMPORT_RESPONSE',
    });
  }
  return id;
}
const batchEntrySchema = z.union([openaiEvalIdSchema, jsonRecord]);
const batchCountSchema = z.union([z.array(batchEntrySchema), z.number().int().nonnegative()]);
export const importBatchSchema = z
  .object({
    imported: batchCountSchema,
    skipped: batchCountSchema,
    failed: z.array(batchEntrySchema),
    workspace_id: z.uuid().nullable().optional(),
  })
  .loose();
export type ImportBatch = z.infer<typeof importBatchSchema>;
export function importEntryCount(entries: number | readonly unknown[]): number {
  return typeof entries === 'number' ? entries : entries.length;
}
const normalizedImportStatusSchema = z
  .object({
    key_present: z.boolean(),
    key_suffix: z.string().max(8).nullable().optional(),
    key_last4: z.string().length(4).nullable().optional(),
    cache_warm: z.boolean().optional(),
    evals_access: z.enum(['ready', 'not_ready', 'forbidden', 'unreachable']).nullable(),
    cache_status: z.enum(['warm', 'cold']).nullable(),
  })
  .loose();

export const importStatusSchema = z.preprocess((input: unknown) => {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return input;
  const response = input as Record<string, unknown>;
  const code = extractUpstreamError(response).code;
  const recognizedCode =
    code === 'KEY_PRESENT' ||
    code === 'NO_KEY' ||
    code === 'EVALS_FORBIDDEN' ||
    code === 'OPENAI_UNREACHABLE';
  if (code !== undefined && !recognizedCode) return input;
  if (!recognizedCode && !('cache_warm' in response) && !('key_last4' in response)) return input;
  const keyPresent = response.key_present ?? (recognizedCode ? code !== 'NO_KEY' : undefined);
  const cacheStatus =
    response.cache_status ??
    (typeof response.cache_warm === 'boolean' ? (response.cache_warm ? 'warm' : 'cold') : null);
  let access = response.evals_access;
  if (access === undefined) {
    if (code === 'EVALS_FORBIDDEN') access = 'forbidden';
    else if (code === 'OPENAI_UNREACHABLE') access = 'unreachable';
    else access = keyPresent === true && cacheStatus === 'warm' ? 'ready' : 'not_ready';
  }
  return {
    ...response,
    key_present: keyPresent,
    key_suffix: response.key_suffix ?? response.key_last4,
    evals_access: access,
    cache_status: cacheStatus,
  };
}, normalizedImportStatusSchema);

const importErrors: Readonly<Record<string, { message: string; exitCode: number }>> = {
  NO_KEY: {
    message:
      'Add an OpenAI key in the Plumloom UI (AI Providers & Models), then run autoeval import connect.',
    exitCode: 3,
  },
  INVALID_KEY: {
    message:
      'Replace the OpenAI key in the Plumloom UI (AI Providers & Models), then run autoeval import connect.',
    exitCode: 3,
  },
  EVALS_FORBIDDEN: {
    message:
      'The configured OpenAI key cannot read Evals. Enable Evals access in OpenAI, then reconnect.',
    exitCode: 4,
  },
  OPENAI_UNREACHABLE: {
    message: 'OpenAI is unreachable. Try autoeval import connect again later.',
    exitCode: 4,
  },
};

function invalidImport(message: string, code = 'INVALID_IMPORT_ARGUMENTS'): AutoevalError {
  return new AutoevalError(message, { kind: 'usage', code });
}

async function requestImport<Schema extends z.ZodType>(
  context: ActionContext,
  request: ExternalImportRequest,
  schema: Schema,
): Promise<z.output<Schema>> {
  if (request.signal?.aborted)
    throw new AutoevalError('Import request was canceled.', {
      kind: 'network',
      code: 'REQUEST_ABORTED',
    });
  try {
    const response = await context.api.externalImport(request);
    const code = extractUpstreamError(response).code;
    const providerError = importErrors[code ?? ''];
    const isStatusState =
      request.path === '/connect/status' &&
      (code === 'NO_KEY' || code === 'EVALS_FORBIDDEN' || code === 'OPENAI_UNREACHABLE');
    if (providerError && !isStatusState) {
      throw new AutoevalError(providerError.message, {
        kind: 'upstream',
        code: code ?? 'IMPORT_PROVIDER_ERROR',
        exitCode: providerError.exitCode,
      });
    }
    const parsed = schema.safeParse(response);
    if (!parsed.success)
      throw new AutoevalError(
        'The import API returned an unsupported response. Check CLI/backend compatibility.',
        { kind: 'upstream', code: 'INVALID_IMPORT_RESPONSE' },
      );
    return parsed.data;
  } catch (error) {
    if (error instanceof ApiError) {
      const providerError = importErrors[error.code ?? ''];
      if (providerError)
        throw new AutoevalError(providerError.message, {
          kind: 'upstream',
          code: error.code ?? 'IMPORT_PROVIDER_ERROR',
          exitCode: providerError.exitCode,
        });
      if (error.status === 409)
        throw new AutoevalError("Run 'autoeval import connect' first.", {
          kind: 'validation',
          code: 'IMPORT_CACHE_COLD',
          exitCode: 9,
        });
      if (error.status === 405) {
        throw new AutoevalError(
          'The import endpoint does not support this HTTP method. Check CLI/backend route compatibility.',
          {
            kind: 'unsupported',
            code: 'IMPORT_METHOD_NOT_ALLOWED',
            exitCode: 4,
          },
        );
      }
      throw new AutoevalError(
        `Import request failed (HTTP ${error.status}). Check access and try again.`,
        { kind: error.kind, code: error.code ?? 'IMPORT_REQUEST_FAILED', exitCode: error.exitCode },
      );
    }
    throw error;
  }
}

async function reviewImports(
  context: ActionContext,
  input: Extract<ParsedImportCommand, { operation: 'review' }>,
  signal?: AbortSignal,
): Promise<ImportReview> {
  const evals: ImportReview['evals'] = [];
  const seen = new Set<string>();
  let first: ImportReview | undefined;
  for (let page = input.all ? 1 : input.page; page <= 1000; page += 1) {
    const response = await requestImport(
      context,
      {
        method: 'GET',
        path: '',
        query: { page, page_size: input.size, search: input.search ?? '' },
        ...(signal ? { signal } : {}),
      },
      importReviewSchema,
    );
    if (!input.all) return response;
    first ??= response;
    let added = 0;
    for (const evaluation of response.evals) {
      const id = sourceEvaluationId(evaluation);
      if (!seen.has(id)) {
        seen.add(id);
        evals.push(evaluation);
        added += 1;
      }
    }
    if (evals.length > 25_000)
      throw invalidImport(
        'Discovery exceeds 25,000 evaluations. Narrow the search.',
        'IMPORT_LIMIT_EXCEEDED',
      );
    if (page * response.size >= response.total) {
      return { ...first, evals, ...(Array.isArray(first.items) ? { items: evals } : {}) };
    }
    if (added === 0)
      throw new AutoevalError('Import discovery pagination did not advance. Reconnect and retry.', {
        kind: 'upstream',
        code: 'IMPORT_PAGINATION_STALLED',
      });
  }
  throw invalidImport('Discovery exceeds 1,000 pages. Narrow the search.', 'IMPORT_LIMIT_EXCEEDED');
}

export function importOutcomeExitCode(command: ParsedImportCommand, response: unknown): number {
  if (command.operation === 'status') {
    const status = importStatusSchema.parse(response);
    if (!status.key_present) return 3;
    return status.evals_access === 'ready' ? 0 : 4;
  }
  if (command.operation === 'run')
    return importBatchSchema.parse(response).failed.length > 0 ? 1 : 0;
  return 0;
}

export async function executeImport(
  context: ActionContext,
  untrustedInput: ImportCommand,
  options: {
    signal?: AbortSignal;
    onBatch?: (batch: ImportBatch, index: number, total: number) => void;
  } = {},
): Promise<unknown> {
  const parsed = importCommandSchema.safeParse(untrustedInput);
  if (!parsed.success)
    throw invalidImport(
      'Invalid import arguments. Use UUIDs for Plumloom resources and eval_ IDs for OpenAI sources.',
    );
  const input = parsed.data;
  const request = <Schema extends z.ZodType>(
    method: ExternalImportRequest['method'],
    path: string,
    schema: Schema,
    extras: Partial<ExternalImportRequest> = {},
  ) =>
    requestImport(
      context,
      { method, path, ...extras, ...(options.signal ? { signal: options.signal } : {}) },
      schema,
    );
  switch (input.operation) {
    case 'status':
      return request('GET', '/connect/status', importStatusSchema);
    case 'connect':
      return request('POST', input.refresh ? '/refresh' : '/connect', importConnectSchema);
    case 'disconnect':
      return (
        (await request('POST', '/disconnect', z.union([jsonRecord, z.undefined(), z.null()]))) ?? {
          disconnected: true,
        }
      );
    case 'review':
      return reviewImports(context, input, options.signal);
    case 'list':
      return request(
        'GET',
        '/workspaces',
        z.union([z.array(jsonRecord), z.object({ workspaces: z.array(jsonRecord) }).loose()]),
      );
    case 'evals':
      return request('GET', `/workspaces/${input.workspaceId}`, importWorkspaceEvalsSchema, {
        query: { page: input.page, page_size: input.size, search: input.search ?? '' },
      });
    case 'show':
      return request('GET', `/evaluations/${input.evaluationId}`, jsonRecord, {
        query: { run_id: input.run, page: input.page, size: input.size },
      });
    case 'insights':
      return request(
        'GET',
        `/workspaces/${input.workspaceId}/insights`,
        z.object({ derived_by: z.literal('Plumloom') }).loose(),
      );
    case 'remove': {
      if (!input.yes)
        throw invalidImport(
          'Removal requires explicit confirmation (--yes).',
          'IMPORT_CONFIRMATION_REQUIRED',
        );
      return (
        (await request(
          'DELETE',
          `/evaluations/${input.evaluationId}`,
          z.union([jsonRecord, z.undefined(), z.null()]),
        )) ?? { removed: true, eval_id: input.evaluationId }
      );
    }
    case 'run': {
      if (input.allNew === (input.evalIds !== undefined))
        throw invalidImport('Choose exactly one of --eval, --input, or --all-new.');
      let evalIds = [...new Set(input.evalIds ?? [])];
      if (input.allNew) {
        const discovered = await reviewImports(
          context,
          { operation: 'review', all: true, page: 1, size: 100 },
          options.signal,
        );
        evalIds = discovered.evals
          .filter((evaluation) => !evaluation.already_imported)
          .map(sourceEvaluationId);
      }
      if (!input.allNew && evalIds.length === 0)
        throw invalidImport('Select at least one OpenAI evaluation.');
      const summary: ImportBatch & { batches: ImportBatch[] } = {
        imported: [],
        skipped: [],
        failed: [],
        batches: [],
      };
      for (let offset = 0; offset < evalIds.length; offset += 25) {
        const batch = await request('POST', '/run', importBatchSchema, {
          body: { eval_ids: evalIds.slice(offset, offset + 25) },
        });
        for (const field of ['imported', 'skipped'] as const) {
          const previous = summary[field];
          const incoming = batch[field];
          summary[field] =
            typeof previous === 'number' || typeof incoming === 'number'
              ? importEntryCount(previous) + importEntryCount(incoming)
              : [...previous, ...incoming];
        }
        summary.failed.push(...batch.failed);
        if (batch.workspace_id) summary.workspace_id = batch.workspace_id;
        summary.batches.push(batch);
        options.onBatch?.(batch, offset / 25 + 1, Math.ceil(evalIds.length / 25));
      }
      return summary.batches.length === 1
        ? { ...summary.batches[0], batches: summary.batches }
        : summary;
    }
  }
}
