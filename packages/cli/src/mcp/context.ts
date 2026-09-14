import type { ActionContext } from '../actions/context.js';
import type { CredentialStore } from '../auth/credential-store.js';
import type { AutoevalConfiguration } from '../config.js';
import type { FetchImplementation } from '../api/client.js';
import { SystemPollClock, type PollClock } from '../polling/clock.js';
import { createAuthenticatedActionContext } from '../runtime/action-context.js';

export type AutoevalMcpContext = {
  actions: ActionContext;
  configuration: AutoevalConfiguration;
  clock: PollClock;
  signal?: AbortSignal;
};

export type AutoevalMcpContextDependencies = {
  configuration: AutoevalConfiguration;
  environment?: Readonly<Record<string, string | undefined>>;
  store?: CredentialStore;
  fetchImplementation?: FetchImplementation;
  clock?: PollClock;
  signal?: AbortSignal;
};

export async function createAutoevalMcpContext(
  dependencies: AutoevalMcpContextDependencies,
): Promise<AutoevalMcpContext> {
  const actions = await createAuthenticatedActionContext({
    configuration: dependencies.configuration,
    ...(dependencies.environment ? { environment: dependencies.environment } : {}),
    ...(dependencies.store ? { store: dependencies.store } : {}),
    ...(dependencies.fetchImplementation
      ? { fetchImplementation: dependencies.fetchImplementation }
      : {}),
  });

  return {
    actions,
    configuration: dependencies.configuration,
    clock: dependencies.clock ?? new SystemPollClock(),
    ...(dependencies.signal ? { signal: dependencies.signal } : {}),
  };
}
