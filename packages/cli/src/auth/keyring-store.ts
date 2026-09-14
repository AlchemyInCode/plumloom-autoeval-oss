import { AutoevalError } from '../errors/autoeval-error.js';
import type { CredentialStore } from './credential-store.js';

type KeyringEntry = {
  getPassword(): string | null;
  setPassword(password: string): void;
  deletePassword(): boolean;
};

export class KeyringCredentialStore implements CredentialStore {
  readonly #apiOrigin: string;

  constructor(apiOrigin: string) {
    this.#apiOrigin = apiOrigin;
  }

  async #createEntry(): Promise<KeyringEntry> {
    try {
      const { Entry } = await import('@napi-rs/keyring');
      return new Entry('Plumloom Autoeval', `api-key:${this.#apiOrigin}`);
    } catch (error) {
      throw new AutoevalError('The OS credential store is unavailable.', {
        kind: 'authentication',
        code: 'CREDENTIAL_STORE_UNAVAILABLE',
        cause: error,
      });
    }
  }

  async read(): Promise<string | undefined> {
    try {
      return (await this.#createEntry()).getPassword() ?? undefined;
    } catch (error) {
      throw new AutoevalError('The OS credential store is unavailable.', {
        kind: 'authentication',
        code: 'CREDENTIAL_STORE_UNAVAILABLE',
        cause: error,
      });
    }
  }

  async write(apiKey: string): Promise<void> {
    try {
      (await this.#createEntry()).setPassword(apiKey);
    } catch (error) {
      throw new AutoevalError(
        'The CLI key was valid, but the OS credential store could not save it.',
        {
          kind: 'authentication',
          code: 'CREDENTIAL_STORE_UNAVAILABLE',
          cause: error,
        },
      );
    }
  }

  async delete(): Promise<boolean> {
    try {
      return (await this.#createEntry()).deletePassword();
    } catch (error) {
      throw new AutoevalError('The OS credential store could not remove the local CLI key.', {
        kind: 'authentication',
        code: 'CREDENTIAL_STORE_UNAVAILABLE',
        cause: error,
      });
    }
  }
}
