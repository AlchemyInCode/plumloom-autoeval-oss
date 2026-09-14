import { describe, expect, it, vi } from 'vitest';

import type { CredentialStore } from '../src/auth/credential-store.js';
import { loadConfiguration } from '../src/config.js';
import { createAutoevalMcpContext } from '../src/mcp/context.js';
import { createAutoevalMcpTools } from '../src/mcp/tools.js';
import { VALID_KEY } from './helpers.js';

describe('Autoeval MCP authenticated context', () => {
  it('reuses environment credential precedence and authenticated API transport', async () => {
    const store: CredentialStore = {
      read: vi.fn(() => Promise.resolve('pl_sk_unusedStoredKey12345')),
      write: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve(false)),
    };
    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${VALID_KEY}`);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'user-1',
            user_sys_id: 'USR-SYNTHETIC',
            email: 'developer@example.com',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    });
    const context = await createAutoevalMcpContext({
      configuration: loadConfiguration({
        AUTOEVAL_API_BASE_URL: 'https://api.example.test',
      }),
      environment: { AUTOEVAL_API_KEY: VALID_KEY },
      store,
      fetchImplementation: fetchMock,
    });
    const currentUser = createAutoevalMcpTools(context).find(
      (tool) => tool.name === 'get_current_user',
    );
    if (!currentUser) throw new Error('Missing get_current_user tool');

    const result = await currentUser.invoke({});

    expect(store.read).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain(VALID_KEY);
    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: { id: 'user-1', userSystemId: 'USR-SYNTHETIC' },
    });
  });
});
