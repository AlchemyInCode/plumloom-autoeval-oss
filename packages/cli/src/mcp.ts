#!/usr/bin/env node

import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { redactText } from './auth/redact.js';
import { loadConfiguration } from './config.js';
import { asAutoevalError } from './errors/autoeval-error.js';
import { createAutoevalMcpContext } from './mcp/context.js';
import { createAutoevalMcpServer } from './mcp/server.js';

const abortController = new AbortController();

const handle = serveStdio(
  async () => {
    const configuration = loadConfiguration();
    const context = await createAutoevalMcpContext({
      configuration,
      signal: abortController.signal,
    });
    return createAutoevalMcpServer(context);
  },
  {
    onerror: (error) => {
      const normalized = asAutoevalError(error);
      process.stderr.write(`Autoeval MCP error: ${redactText(normalized.message)}\n`);
    },
  },
);

async function stop(reason: string): Promise<void> {
  abortController.abort(new Error(reason));
  await handle.close();
}

process.once('SIGINT', () => {
  void stop('interrupted');
});
process.once('SIGTERM', () => {
  void stop('terminated');
});
