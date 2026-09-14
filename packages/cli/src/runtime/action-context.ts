import type { ActionContext } from '../actions/context.js';
import type { CredentialStore, SecretPrompt } from '../auth/credential-store.js';
import { resolveCredential } from '../auth/credentials.js';
import { KeyringCredentialStore } from '../auth/keyring-store.js';
import type { AutoevalConfiguration } from '../config.js';
import { AutoevalError } from '../errors/autoeval-error.js';
import { AutoevalApiClient } from '../api/api.js';
import { ApiClient, type FetchImplementation, type ApiDiagnostic } from '../api/client.js';

const nonInteractivePrompt: SecretPrompt = {
  request: () =>
    Promise.reject(
      new AutoevalError('Interactive credential prompts are unavailable in this runtime.', {
        kind: 'authentication',
        code: 'CREDENTIAL_REQUIRED',
      }),
    ),
};

export type ApiActionContextInput = {
  configuration: AutoevalConfiguration;
  apiKey: string;
  fetchImplementation?: FetchImplementation;
  onDiagnostic?: (diagnostic: ApiDiagnostic) => void;
};

export function createApiActionContext(input: ApiActionContextInput): ActionContext {
  return {
    api: new AutoevalApiClient(
      new ApiClient({
        baseUrl: input.configuration.apiBaseUrl,
        apiKey: input.apiKey,
        requestTimeoutMs: input.configuration.requestTimeoutMs,
        maxResponseBytes: input.configuration.maxResponseBytes,
        ...(input.fetchImplementation ? { fetchImplementation: input.fetchImplementation } : {}),
        ...(input.onDiagnostic ? { onDiagnostic: input.onDiagnostic } : {}),
      }),
    ),
  };
}

export async function createAuthenticatedActionContext(input: {
  configuration: AutoevalConfiguration;
  environment?: Readonly<Record<string, string | undefined>>;
  store?: CredentialStore;
  fetchImplementation?: FetchImplementation;
  onDiagnostic?: (diagnostic: ApiDiagnostic) => void;
}): Promise<ActionContext> {
  const environment = input.environment ?? process.env;
  const store = input.store ?? new KeyringCredentialStore(input.configuration.apiBaseUrl.origin);
  const credential = await resolveCredential({
    environment,
    store,
    prompt: nonInteractivePrompt,
    allowPrompt: false,
  });

  return createApiActionContext({
    configuration: input.configuration,
    apiKey: credential.apiKey,
    ...(input.fetchImplementation ? { fetchImplementation: input.fetchImplementation } : {}),
    ...(input.onDiagnostic ? { onDiagnostic: input.onDiagnostic } : {}),
  });
}
