import { z } from 'zod';

import type { Workspace, WorkspacePage } from '../domain/types.js';
import type { ActionContext } from './context.js';
import { requirePageSize } from './validation.js';

const workspaceNameSchema = z.string().trim().min(1).max(120);
const workspaceDescriptionSchema = z.string().trim().min(1).max(1_000).optional();

export function listWorkspaces(
  context: ActionContext,
  input: { page?: number; size?: number } = {},
  signal?: AbortSignal,
): Promise<WorkspacePage> {
  const size = requirePageSize(input.size ?? 100);
  return context.api.listWorkspaces({ page: input.page ?? 1, size }, signal);
}

export function createWorkspace(
  context: ActionContext,
  input: { name: string; description?: string },
  signal?: AbortSignal,
): Promise<Workspace> {
  const name = workspaceNameSchema.parse(input.name);
  const description = workspaceDescriptionSchema.parse(input.description);
  return context.api.createWorkspace({ name, ...(description ? { description } : {}) }, signal);
}

/** Read-only workspace lookup used by pre-flight diagnostics. */
export function getWorkspace(
  context: ActionContext,
  workspaceId: string,
  signal?: AbortSignal,
): Promise<Workspace> {
  return context.api.getWorkspace(workspaceId, signal);
}
