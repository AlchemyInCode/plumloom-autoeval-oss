import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  parseConfiguredRunInput,
  validateConfiguredRunInput,
} from '../src/configured-run/validation.js';
import type { SupportedModel } from '../src/domain/types.js';
import { readSuiteManifest } from '../src/suite/manifest.js';

const JUDGE_ID = '11111111-1111-4111-8111-111111111111';
const PRIMARY_ID = '22222222-2222-4222-8222-222222222222';
const COMPARISON_ID = '33333333-3333-4333-8333-333333333333';
const SECOND_COMPARISON_ID = '44444444-4444-4444-8444-444444444444';

const PLACEHOLDER_MODELS: SupportedModel[] = [
  {
    id: JUDGE_ID,
    provider: 'example',
    displayName: 'Example judge',
    apiModelId: 'example-judge',
    isDeprecated: false,
    isLocked: false,
  },
  {
    id: PRIMARY_ID,
    provider: 'example',
    displayName: 'Example primary',
    apiModelId: 'example-primary',
    isDeprecated: false,
    isLocked: false,
  },
  {
    id: COMPARISON_ID,
    provider: 'example',
    displayName: 'Example comparison',
    apiModelId: 'example-comparison',
    isDeprecated: false,
    isLocked: false,
  },
  {
    id: SECOND_COMPARISON_ID,
    provider: 'example',
    displayName: 'Second example comparison',
    apiModelId: 'second-example-comparison',
    isDeprecated: false,
    isLocked: false,
  },
];

async function loadExample(filename: string): Promise<{ contents: string; parsed: unknown }> {
  const contents = await readFile(
    new URL(`../../../examples/evals/${filename}`, import.meta.url),
    'utf8',
  );
  return { contents, parsed: JSON.parse(contents) as unknown };
}

describe('public configured-run examples', () => {
  it.each([
    ['scenario-basic.json', 'scenario', 1],
    ['scenario-grounded.json', 'scenario', 2],
    ['scenario-model-comparison.json', 'scenario', 3],
    ['conversation-success.json', 'conversation', 5],
    ['conversation-failure.json', 'conversation', 5],
    ['agent-trace-basic.json', 'agent_trace', 1],
    ['agent-trace-bad-decision.json', 'agent_trace', 1],
  ] as const)(
    'parses and preflights %s against synthetic enabled models',
    async (filename, contextType, artifactCount) => {
      const { contents, parsed } = await loadExample(filename);
      const result = validateConfiguredRunInput(
        parseConfiguredRunInput(parsed),
        PLACEHOLDER_MODELS,
      );

      expect(result).toMatchObject({
        valid: true,
        contextType,
        artifactCount,
      });
      expect(contents).not.toContain('runsPerScenario');
      expect(contents).not.toContain('autoStopEnabled');
      expect(contents).not.toContain('userSystemId');
      expect(contents).not.toMatch(/pl_sk_/u);
    },
  );

  it('ships a smoke suite that resolves to the three sanitized fixtures', async () => {
    const manifest = await readSuiteManifest(
      fileURLToPath(new URL('../../../examples/suite/autoeval.suite.yaml', import.meta.url)),
    );

    expect(manifest.workspaceId).toBe('ffffffff-ffff-4fff-8fff-ffffffffffff');
    expect(manifest.evalFiles.map((file) => file.split(/[\\/]/u).pop())).toEqual([
      'smoke-scenario.json',
      'smoke-conversation.json',
      'smoke-agent-trace.json',
    ]);
    await expect(
      Promise.all(manifest.evalFiles.map((file) => readFile(file, 'utf8'))),
    ).resolves.toHaveLength(3);
  });
});
