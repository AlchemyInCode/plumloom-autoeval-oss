import type { ActionContext } from '../actions/context.js';
import { getModels } from '../actions/models.js';
import { listWorkspaces } from '../actions/workspaces.js';
import type { SupportedModel, Workspace } from '../domain/types.js';

/**
 * Everything the file guide needs from the backend, expressed as a
 * narrow port so the flow itself stays deterministic and testable. Every method
 * is backed by an existing shared action; the flow adds no network boundary.
 */
export interface EvalCreationBackend {
  listWorkspaces(signal?: AbortSignal): Promise<readonly Workspace[]>;
  listModels(signal?: AbortSignal): Promise<readonly SupportedModel[]>;
}

export class ActionEvalCreationBackend implements EvalCreationBackend {
  readonly #actions: ActionContext;

  constructor(input: { actions: ActionContext }) {
    this.#actions = input.actions;
  }

  async listWorkspaces(signal?: AbortSignal): Promise<readonly Workspace[]> {
    const page = await listWorkspaces(this.#actions, {}, signal);
    return page.items;
  }

  listModels(signal?: AbortSignal): Promise<readonly SupportedModel[]> {
    return getModels(this.#actions, signal);
  }
}
