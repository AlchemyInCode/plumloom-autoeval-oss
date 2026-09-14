import type { SupportedModel } from '../domain/types.js';
import type { ActionContext } from './context.js';

export function getModels(context: ActionContext, signal?: AbortSignal): Promise<SupportedModel[]> {
  return context.api.getModels(signal);
}
