import type { UserIdentity } from '../domain/types.js';
import type { CredentialStore, SecretPrompt } from './credential-store.js';
import { resolveLoginCredential, type CredentialSource } from './credentials.js';

export type LoginResult = {
  identity: UserIdentity;
  source: CredentialSource;
  wasPersisted: boolean;
  replacedInvalidStoredKey: boolean;
};

export async function login(input: {
  environment: Readonly<Record<string, string | undefined>>;
  store: CredentialStore;
  prompt: SecretPrompt;
  allowPrompt: boolean;
  explicitKey?: string;
  validate: (apiKey: string) => Promise<UserIdentity>;
}): Promise<LoginResult> {
  const { credential, replacedInvalidStoredKey } = await resolveLoginCredential(input);
  const identity = await input.validate(credential.apiKey);
  const shouldPersist = credential.source === 'prompt' || credential.source === 'flag';
  if (shouldPersist) {
    await input.store.write(credential.apiKey);
  }
  return {
    identity,
    source: credential.source,
    wasPersisted: shouldPersist,
    replacedInvalidStoredKey,
  };
}

export async function logout(store: CredentialStore): Promise<{ wasRemoved: boolean }> {
  return { wasRemoved: await store.delete() };
}

export async function logoutWithEnvironment(input: {
  store: CredentialStore;
  environment: Readonly<Record<string, string | undefined>>;
}): Promise<{ wasRemoved: boolean; hasEnvironmentCredential: boolean }> {
  const hasEnvironmentCredential =
    input.environment.AUTOEVAL_API_KEY !== undefined &&
    input.environment.AUTOEVAL_API_KEY.trim() !== '';

  return {
    wasRemoved: await input.store.delete(),
    hasEnvironmentCredential,
  };
}
