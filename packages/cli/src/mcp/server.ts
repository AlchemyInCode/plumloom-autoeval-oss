import { McpServer } from '@modelcontextprotocol/server';

import type { AutoevalMcpContext } from './context.js';
import { CLI_VERSION } from '../version.js';
import {
  type AutoevalMcpActions,
  createAutoevalMcpTools,
  registerAutoevalMcpTools,
  sharedAutoevalActions,
} from './tools.js';

export function createAutoevalMcpServer(
  context: AutoevalMcpContext,
  actions: AutoevalMcpActions = sharedAutoevalActions,
): McpServer {
  const server = new McpServer(
    { name: 'plumloom-autoeval', version: CLI_VERSION },
    {
      instructions:
        'Use read-only tools to discover IDs and validate configured input before starting runs. Scenario evaluations may repeat runs; conversation and agent-trace artifacts are single-shot. State-changing tools execute deterministically when called.',
    },
  );
  registerAutoevalMcpTools(server, createAutoevalMcpTools(context, actions));
  return server;
}
