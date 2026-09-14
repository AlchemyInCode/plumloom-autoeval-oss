import password from '@inquirer/password';

import type { SecretPrompt } from './credential-store.js';

export class MaskedSecretPrompt implements SecretPrompt {
  async request(): Promise<string> {
    return password({
      message: 'Autoeval CLI key:',
      mask: '*',
    });
  }
}
