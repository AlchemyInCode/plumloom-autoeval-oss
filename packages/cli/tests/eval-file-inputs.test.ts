import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readEvalFile } from '../src/configured-run/file-inputs.js';
import { parseConfiguredRunInput } from '../src/configured-run/validation.js';
import { parseSuiteManifest } from '../src/suite/manifest.js';

async function fixtureDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'autoeval-files-'));
}

function methodology(): Record<string, unknown> {
  return {
    userSystemId: 'USR-1',
    judgeModel: 'GPT-5',
    judgeModelId: 'af851ab7-69cf-4b99-9ddc-bea8233ddb2a',
    runsPerScenario: 1,
    evaluatorInstructions: 'Grade against the policy.',
  };
}

describe('eval files that reference their inputs', () => {
  it('expands a conversation transcript and reference documents by path', async () => {
    const directory = await fixtureDirectory();
    await writeFile(
      join(directory, 'conversation.json'),
      JSON.stringify({ messages: [{ role: 'user', content: 'Where is my refund?' }] }),
      'utf8',
    );
    await writeFile(join(directory, 'policy.md'), '# Refund policy\n30 days.\n', 'utf8');
    const evalFile = join(directory, 'support.autoeval.json');
    await writeFile(
      evalFile,
      JSON.stringify({
        methodology: methodology(),
        configuration: {
          contextName: 'Support conversation',
          contextType: 'conversation',
          artifactFile: './conversation.json',
          referenceDocumentFiles: ['./policy.md'],
          expected: 'Agent explains the refund window.',
          selectedMetrics: ['factuality', 'relevance', 'helpfulness'],
          temperatureContext: 0,
          autoStopEnabled: true,
        },
      }),
      'utf8',
    );

    const parsed = parseConfiguredRunInput(await readEvalFile(evalFile));

    expect(parsed.configuration.artifact).toEqual({
      messages: [{ role: 'user', content: 'Where is my refund?' }],
    });
    expect(parsed.configuration.referenceDocuments).toEqual([
      { filename: 'policy.md', content: '# Refund policy\n30 days.\n' },
    ]);
  });

  it('wraps a raw OTLP trace export under trace', async () => {
    const directory = await fixtureDirectory();
    await writeFile(join(directory, 'trace.json'), JSON.stringify({ resourceSpans: [] }), 'utf8');
    const evalFile = join(directory, 'trace.autoeval.json');
    await writeFile(
      evalFile,
      JSON.stringify({
        methodology: methodology(),
        configuration: {
          contextName: 'Cancellation trace',
          contextType: 'agent_trace',
          artifactFile: 'trace.json',
          expected: 'Agent follows policy.',
          selectedMetrics: ['factuality', 'relevance', 'helpfulness'],
          temperatureContext: 0,
          autoStopEnabled: true,
        },
      }),
      'utf8',
    );

    const parsed = parseConfiguredRunInput(await readEvalFile(evalFile));

    expect(parsed.configuration.artifact).toEqual({ trace: { resourceSpans: [] } });
  });

  it('rejects a file that declares both artifact and artifactFile', async () => {
    const directory = await fixtureDirectory();
    const evalFile = join(directory, 'conflict.autoeval.json');
    await writeFile(
      evalFile,
      JSON.stringify({
        methodology: methodology(),
        configuration: {
          contextName: 'Conflict',
          contextType: 'conversation',
          artifact: { messages: [] },
          artifactFile: './conversation.json',
        },
      }),
      'utf8',
    );

    await expect(readEvalFile(evalFile)).rejects.toThrow(/artifact and artifactFile/u);
  });

  it('reports a missing referenced file by path instead of failing validation later', async () => {
    const directory = await fixtureDirectory();
    const evalFile = join(directory, 'missing.autoeval.json');
    await writeFile(
      evalFile,
      JSON.stringify({
        methodology: methodology(),
        configuration: {
          contextName: 'Missing',
          contextType: 'conversation',
          artifactFile: './nope.json',
        },
      }),
      'utf8',
    );

    await expect(readEvalFile(evalFile)).rejects.toThrow(/nope\.json/u);
  });
});

describe('suite manifest', () => {
  it('resolves eval paths relative to the manifest', () => {
    const manifest = parseSuiteManifest(
      ['workspace: 91111111-1111-4111-8111-111111111111', 'evals:', '  - ./evals/one.json'].join(
        '\n',
      ),
      '/tmp/suite/autoeval.suite.yaml',
    );

    expect(manifest.workspaceId).toBe('91111111-1111-4111-8111-111111111111');
    expect(manifest.evalFiles).toEqual([resolve('/tmp/suite/evals/one.json')]);
  });

  it('accepts JSON manifests', () => {
    const manifest = parseSuiteManifest(
      JSON.stringify({ workspace: 'ws-1', evals: ['/abs/one.json'] }),
      '/tmp/suite.json',
    );

    expect(manifest.evalFiles).toEqual(['/abs/one.json']);
  });

  it('rejects a manifest with no evals', () => {
    expect(() => parseSuiteManifest('workspace: ws-1\nevals: []\n', '/tmp/s.yaml')).toThrow(
      /not a valid suite manifest/u,
    );
  });
});
