import type { UserIdentity } from '../domain/types.js';
import type { ActionContext } from './context.js';

export function whoAmI(context: ActionContext, signal?: AbortSignal): Promise<UserIdentity> {
  return context.api.getCurrentUser(signal);
}
