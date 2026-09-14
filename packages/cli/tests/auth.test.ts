import { describe, expect, it, vi } from 'vitest';

import type { CredentialStore, SecretPrompt } from '../src/auth/credential-store.js';
import { resolveCredential } from '../src/auth/credentials.js';
import { login, logout, logoutWithEnvironment } from '../src/auth/login.js';
import { redactText, redactUnknown } from '../src/auth/redact.js';
import { RuntimeCommandExecutor } from '../src/commands/executor.js';
import { loadConfiguration } from '../src/config.js';
import { IDENTITY, VALID_KEY } from './helpers.js';

function storeWith(value?: string): CredentialStore & {
  read: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
} {
  return {
    read: vi.fn(() => Promise.resolve(value)),
    write: vi.fn(() => Promise.resolve()),
    delete: vi.fn(() => Promise.resolve(value !== undefined)),
  };
}

function promptWith(value: string): SecretPrompt & { request: ReturnType<typeof vi.fn> } {
  return { request: vi.fn(() => Promise.resolve(value)) };
}

describe('authentication', () => {
  it('validates and persists a successfully prompted credential', async () => {
    const store = storeWith();
    const prompt = promptWith(VALID_KEY);
    const validate = vi.fn(() => Promise.resolve(IDENTITY));

    const result = await login({ environment: {}, store, prompt, allowPrompt: true, validate });

    expect(validate).toHaveBeenCalledWith(VALID_KEY);
    expect(store.write).toHaveBeenCalledWith(VALID_KEY);
    expect(result).toMatchObject({ source: 'prompt', wasPersisted: true });
  });

  it('does not persist a credential when validation fails', async () => {
    const store = storeWith();
    const validate = vi.fn(() => Promise.reject(new Error('invalid')));

    await expect(
      login({
        environment: {},
        store,
        prompt: promptWith(VALID_KEY),
        allowPrompt: true,
        validate,
      }),
    ).rejects.toThrow('invalid');
    expect(store.write).not.toHaveBeenCalled();
  });

  it('removes an invalid stored key and prompts for a replacement', async () => {
    const store = storeWith('not-a-valid-key');
    const prompt = promptWith(VALID_KEY);

    const result = await login({
      environment: {},
      store,
      prompt,
      allowPrompt: true,
      validate: () => Promise.resolve(IDENTITY),
    });

    expect(store.delete).toHaveBeenCalledOnce();
    expect(prompt.request).toHaveBeenCalledOnce();
    expect(store.write).toHaveBeenCalledWith(VALID_KEY);
    expect(result).toMatchObject({ source: 'prompt', replacedInvalidStoredKey: true });
  });

  it('reports an invalid AUTOEVAL_API_KEY as an environment problem', async () => {
    const store = storeWith(VALID_KEY);
    const prompt = promptWith(VALID_KEY);

    await expect(
      login({
        environment: { AUTOEVAL_API_KEY: 'bogus' },
        store,
        prompt,
        allowPrompt: true,
        validate: () => Promise.resolve(IDENTITY),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CLI_KEY_FORMAT' });
    await expect(
      login({
        environment: { AUTOEVAL_API_KEY: 'bogus' },
        store,
        prompt,
        allowPrompt: true,
        validate: () => Promise.resolve(IDENTITY),
      }),
    ).rejects.toThrow('AUTOEVAL_API_KEY is set but is not a valid CLI key');
    expect(store.read).not.toHaveBeenCalled();
    expect(prompt.request).not.toHaveBeenCalled();
  });

  it('validates and persists an explicit --key credential', async () => {
    const store = storeWith();
    const prompt = promptWith('pl_sk_should_not_be_used');
    const validate = vi.fn(() => Promise.resolve(IDENTITY));

    const result = await login({
      environment: {},
      store,
      prompt,
      allowPrompt: false,
      explicitKey: VALID_KEY,
      validate,
    });

    expect(validate).toHaveBeenCalledWith(VALID_KEY);
    expect(store.write).toHaveBeenCalledWith(VALID_KEY);
    expect(prompt.request).not.toHaveBeenCalled();
    expect(result).toMatchObject({ source: 'flag', wasPersisted: true });
  });

  it('explains the non-interactive login options when no key is available', async () => {
    const store = storeWith();
    await expect(
      login({
        environment: {},
        store,
        prompt: promptWith(VALID_KEY),
        allowPrompt: false,
        validate: () => Promise.resolve(IDENTITY),
      }),
    ).rejects.toThrow('autoeval login --key');
  });

  it('uses environment, then keyring, then prompt without persisting environment values', async () => {
    const store = storeWith('pl_sk_storedcredential123');
    const prompt = promptWith('pl_sk_promptcredential123');
    const fromEnvironment = await resolveCredential({
      environment: { AUTOEVAL_API_KEY: VALID_KEY },
      store,
      prompt,
      allowPrompt: true,
    });
    expect(fromEnvironment.source).toBe('environment');
    expect(store.read).not.toHaveBeenCalled();
    expect(prompt.request).not.toHaveBeenCalled();

    const fromStore = await resolveCredential({
      environment: {},
      store,
      prompt,
      allowPrompt: true,
    });
    expect(fromStore.source).toBe('keyring');
    expect(prompt.request).not.toHaveBeenCalled();

    const environmentLoginStore = storeWith();
    await login({
      environment: { AUTOEVAL_API_KEY: VALID_KEY },
      store: environmentLoginStore,
      prompt,
      allowPrompt: true,
      validate: () => Promise.resolve(IDENTITY),
    });
    expect(environmentLoginStore.write).not.toHaveBeenCalled();
  });

  it('removes only the locally stored credential on logout', async () => {
    const store = storeWith(VALID_KEY);
    await expect(logout(store)).resolves.toEqual({ wasRemoved: true });
    expect(store.delete).toHaveBeenCalledOnce();
    expect(store.read).not.toHaveBeenCalled();
  });

  it('reports environment-backed auth state on logout', async () => {
    const store = storeWith();
    await expect(
      logoutWithEnvironment({
        store,
        environment: { AUTOEVAL_API_KEY: VALID_KEY },
      }),
    ).resolves.toEqual({
      wasRemoved: false,
      hasEnvironmentCredential: true,
    });
  });

  it('redacts CLI keys and credential-shaped fields recursively', () => {
    expect(redactText(`failed for ${VALID_KEY}`)).toBe('failed for pl_sk_[REDACTED]');
    expect(
      redactUnknown({ authorization: `Bearer ${VALID_KEY}`, nested: { api_key: VALID_KEY } }),
    ).toEqual({ authorization: '[REDACTED]', nested: { api_key: '[REDACTED]' } });
  });

  it('redacts compound credential fields without redacting ordinary metadata', () => {
    expect(
      redactUnknown({
        access_token: 'access-value',
        refreshToken: 'refresh-value',
        client_secret: 'client-value',
        serviceApiKey: 'service-value',
        provider_api_key: 'provider-value',
        nested: { signing_key: 'signing-value' },
        token_count: 42,
        model_key: 'catalog-model-key',
        public_key: 'publishable-value',
        client_secret_name: 'credential-label',
      }),
    ).toEqual({
      access_token: '[REDACTED]',
      refreshToken: '[REDACTED]',
      client_secret: '[REDACTED]',
      serviceApiKey: '[REDACTED]',
      provider_api_key: '[REDACTED]',
      nested: { signing_key: '[REDACTED]' },
      token_count: 42,
      model_key: 'catalog-model-key',
      public_key: 'publishable-value',
      client_secret_name: 'credential-label',
    });
  });

  it('reports numeric usage counters instead of treating them as credentials', () => {
    expect(
      redactUnknown({
        tokens: 680,
        input_tokens: 412,
        output_tokens: 268,
        total_tokens: 680,
        api_key: 'secret-value',
        session_token: 'secret-value',
      }),
    ).toEqual({
      tokens: 680,
      input_tokens: 412,
      output_tokens: 268,
      total_tokens: 680,
      api_key: '[REDACTED]',
      session_token: '[REDACTED]',
    });
  });

  it('never prompts in non-interactive mode', async () => {
    const prompt = promptWith(VALID_KEY);
    const executor = new RuntimeCommandExecutor({
      configuration: loadConfiguration({ AUTOEVAL_API_BASE_URL: 'https://api.example.test' }),
      environment: {},
      store: storeWith(),
      prompt,
      stdin: { isTTY: false },
      stderr: { isTTY: false, write: () => true },
      stdout: { write: () => true },
    });

    await expect(
      executor.execute({ kind: 'login' }, { json: false, debug: false }),
    ).rejects.toMatchObject({
      code: 'CREDENTIAL_REQUIRED',
    });
    expect(prompt.request).not.toHaveBeenCalled();
  });
});
