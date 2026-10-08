import { InMemoryTransport } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';

import packageMetadata from '../package.json' with { type: 'json' };
import { createAutoevalMcpServer } from '../src/mcp/server.js';
import { CLI_VERSION } from '../src/version.js';
import { createApi } from './helpers.js';
import { loadConfiguration } from '../src/config.js';
import { FakeClock } from './helpers.js';

function mcpContext() {
  return {
    actions: { api: createApi() },
    configuration: loadConfiguration({ AUTOEVAL_API_BASE_URL: 'https://api.example.test' }),
    clock: new FakeClock(),
  };
}

describe('runtime version reporting', () => {
  it('uses the package version for the CLI', () => {
    expect(CLI_VERSION).toBe(packageMetadata.version);
  });

  it('reports the package version during MCP initialization', async () => {
    const server = createAutoevalMcpServer(mcpContext());
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const response = new Promise<unknown>((resolve) => {
      clientTransport.onmessage = resolve;
    });

    await server.connect(serverTransport);
    await clientTransport.start();
    await clientTransport.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'version-test', version: '1.0.0' },
      },
    });

    await expect(response).resolves.toMatchObject({
      result: { serverInfo: { name: 'plumloom-autoeval', version: packageMetadata.version } },
    });
    await clientTransport.close();
    await server.close();
  });
});
