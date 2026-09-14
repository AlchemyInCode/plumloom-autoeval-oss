import { AutoevalError } from '../errors/autoeval-error.js';
import type { CredentialStore, SecretPrompt } from './credential-store.js';

const CLI_KEY_PREFIX = 'pl_sk_';
const MINIMUM_CLI_KEY_LENGTH = CLI_KEY_PREFIX.length + 12;

export type CredentialSource = 'environment' | 'keyring' | 'prompt' | 'flag';

export type ResolvedCredential = {
  apiKey: string;
  source: CredentialSource;
};

export function validateCliKey(input: string): string {
  const apiKey = input.trim();
  if (!apiKey.startsWith(CLI_KEY_PREFIX) || apiKey.length < MINIMUM_CLI_KEY_LENGTH) {
    throw new AutoevalError(
      'The CLI key format is invalid. Create a new Autoeval key in Plumloom.',
      {
        kind: 'authentication',
        code: 'INVALID_CLI_KEY_FORMAT',
      },
    );
  }
  return apiKey;
}

export async function resolveCredential(input: {
  environment: Readonly<Record<string, string | undefined>>;
  store: CredentialStore;
  prompt: SecretPrompt;
  allowPrompt: boolean;
}): Promise<ResolvedCredential> {
  const environmentKey = input.environment.AUTOEVAL_API_KEY;
  if (environmentKey !== undefined && environmentKey.trim() !== '') {
    return { apiKey: validateCliKey(environmentKey), source: 'environment' };
  }

  const storedKey = await input.store.read();
  if (storedKey !== undefined && storedKey.trim() !== '') {
    return { apiKey: validateCliKey(storedKey), source: 'keyring' };
  }

  if (!input.allowPrompt) {
    throw new AutoevalError('No Autoeval CLI key is available. Run `autoeval login` first.', {
      kind: 'authentication',
      code: 'CREDENTIAL_REQUIRED',
    });
  }

  const promptedKey = await input.prompt.request();
  return { apiKey: validateCliKey(promptedKey), source: 'prompt' };
}

export type LoginCredentialResolution = {
  credential: ResolvedCredential;
  /** True when an invalid stored key was removed before prompting. */
  replacedInvalidStoredKey: boolean;
};

/** Resolve login credentials in explicit flag, environment, keyring, prompt order. */
export async function resolveLoginCredential(input: {
  environment: Readonly<Record<string, string | undefined>>;
  store: CredentialStore;
  prompt: SecretPrompt;
  allowPrompt: boolean;
  explicitKey?: string;
}): Promise<LoginCredentialResolution> {
  if (input.explicitKey !== undefined) {
    return {
      credential: { apiKey: validateCliKey(input.explicitKey), source: 'flag' },
      replacedInvalidStoredKey: false,
    };
  }

  const environmentKey = input.environment.AUTOEVAL_API_KEY;
  if (environmentKey !== undefined && environmentKey.trim() !== '') {
    try {
      return {
        credential: { apiKey: validateCliKey(environmentKey), source: 'environment' },
        replacedInvalidStoredKey: false,
      };
    } catch (error) {
      throw new AutoevalError(
        'AUTOEVAL_API_KEY is set but is not a valid CLI key. Fix or unset it, then run `autoeval login` again.',
        { kind: 'authentication', code: 'INVALID_CLI_KEY_FORMAT', cause: error },
      );
    }
  }

  const storedKey = await input.store.read();
  if (storedKey !== undefined && storedKey.trim() !== '') {
    try {
      return {
        credential: { apiKey: validateCliKey(storedKey), source: 'keyring' },
        replacedInvalidStoredKey: false,
      };
    } catch {
      await input.store.delete();
      if (!input.allowPrompt) {
        throw new AutoevalError(
          'The stored Autoeval CLI key was invalid and has been removed. Run `autoeval login` in a terminal or pass `--key`.',
          { kind: 'authentication', code: 'INVALID_CLI_KEY_FORMAT' },
        );
      }
      const promptedKey = await input.prompt.request();
      return {
        credential: { apiKey: validateCliKey(promptedKey), source: 'prompt' },
        replacedInvalidStoredKey: true,
      };
    }
  }

  if (!input.allowPrompt) {
    throw new AutoevalError(
      'No Autoeval CLI key is available. Run `autoeval login` in a terminal, pass `autoeval login --key <pl_sk_...>`, or set AUTOEVAL_API_KEY.',
      { kind: 'authentication', code: 'CREDENTIAL_REQUIRED' },
    );
  }

  const promptedKey = await input.prompt.request();
  return {
    credential: { apiKey: validateCliKey(promptedKey), source: 'prompt' },
    replacedInvalidStoredKey: false,
  };
}
