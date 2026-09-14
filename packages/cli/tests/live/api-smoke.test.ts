import { describe, expect, it } from 'vitest';

import { validateCliKey } from '../../src/auth/credentials.js';
import { loadConfiguration } from '../../src/config.js';
import { AutoevalApiClient } from '../../src/api/api.js';
import { ApiClient } from '../../src/api/client.js';

const environmentKey = process.env.AUTOEVAL_API_KEY;
const environmentBaseUrl = process.env.AUTOEVAL_API_BASE_URL;

describe.runIf(
  environmentKey !== undefined &&
    environmentKey.trim() !== '' &&
    environmentBaseUrl !== undefined &&
    environmentBaseUrl.trim() !== '',
)('API development smoke test', () => {
  it('authenticates through the API without persisting or displaying the CLI key', async () => {
    const apiKey = validateCliKey(environmentKey ?? '');
    const configuration = loadConfiguration(process.env);
    const api = new AutoevalApiClient(
      new ApiClient({
        baseUrl: configuration.apiBaseUrl,
        apiKey,
        requestTimeoutMs: 30_000,
        maxResponseBytes: 2 * 1024 * 1024,
        maxGetAttempts: 1,
      }),
    );

    const identity = await api.getCurrentUser();
    expect(identity.id).not.toBe('');
    expect(identity.email).toContain('@');
  });
});
