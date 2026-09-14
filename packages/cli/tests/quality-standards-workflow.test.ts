import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { RuntimeCommandExecutor } from '../src/commands/executor.js';
import { loadConfiguration } from '../src/config.js';
import { IDS, VALID_KEY } from './helpers.js';

class MemoryStream {
  value = '';
  isTTY = false;

  write(chunk: string): boolean {
    this.value += chunk;
    return true;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function requestUrl(input: Parameters<typeof fetch>[0]): URL {
  if (input instanceof URL) return input;
  if (typeof input === 'string') return new URL(input);
  return new URL(input.url);
}

async function writeTempJson(
  filename: string,
  body: unknown,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'autoeval-qs-'));
  const path = join(dir, filename);
  await writeFile(path, JSON.stringify(body), 'utf8');
  return {
    path,
    cleanup: async () => rm(dir, { recursive: true, force: true }),
  };
}

function createExecutor(
  fetchImplementation: typeof fetch,
  stdout = new MemoryStream(),
): RuntimeCommandExecutor {
  const stderr = new MemoryStream();
  return new RuntimeCommandExecutor({
    configuration: loadConfiguration({ AUTOEVAL_API_BASE_URL: 'https://api.example.test' }),
    environment: { AUTOEVAL_API_KEY: VALID_KEY },
    fetchImplementation,
    stdout,
    stderr,
    stdin: { isTTY: false },
  });
}

describe('quality standards command workflows', () => {
  it('creates from canonical input with one POST request', async () => {
    const input = await writeTempJson('canonical.json', {
      name: 'Customer Support Return Intake',
      judge_model: IDS.model,
      rubric: 'rubric',
      anchors: [
        {
          input: 'question',
          response: 'response',
          reference: 'ideal',
          score: 5,
          reasoning: 'reasoning',
        },
      ],
    });
    try {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ quality_standard_id: IDS.methodology }));
      const stdout = new MemoryStream();
      const executor = createExecutor(fetchMock, stdout);

      await executor.execute(
        { kind: 'quality-standard-create', inputFile: input.path },
        { json: false, debug: false },
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const call = fetchMock.mock.calls[0] as [Parameters<typeof fetch>[0], RequestInit];
      expect(requestUrl(call[0]).pathname).toBe('/api/v1/quality-standards');
      expect(call[1].method).toBe('POST');
      expect(JSON.parse(call[1].body as string)).toEqual({
        name: 'Customer Support Return Intake',
        judge_model: IDS.model,
        rubric: 'rubric',
        anchors: [
          {
            input: 'question',
            response: 'response',
            reference: 'ideal',
            score: 5,
            reasoning: 'reasoning',
          },
        ],
      });
      expect(stdout.value).toBe(
        `Created quality standard Customer Support Return Intake (${IDS.methodology})\n`,
      );
    } finally {
      await input.cleanup();
    }
  });

  it('accepts canonical input with extra top-level fields and posts only required payload keys', async () => {
    const input = await writeTempJson('canonical-with-id.json', {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Customer Support Return Intake',
      judge_model: IDS.model,
      rubric: 'rubric',
      anchors: [
        {
          input: 'question',
          score: 5.0,
          response: 'response',
          reasoning: 'reasoning',
          reference: 'ideal',
        },
      ],
    });
    try {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ quality_standard_id: IDS.methodology }));
      const executor = createExecutor(fetchMock, new MemoryStream());

      await executor.execute(
        { kind: 'quality-standard-create', inputFile: input.path },
        { json: false, debug: false },
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const call = fetchMock.mock.calls[0] as [Parameters<typeof fetch>[0], RequestInit];
      expect(call[1].method).toBe('POST');
      expect(JSON.parse(call[1].body as string)).toEqual({
        name: 'Customer Support Return Intake',
        judge_model: IDS.model,
        rubric: 'rubric',
        anchors: [
          {
            input: 'question',
            score: 5,
            response: 'response',
            reasoning: 'reasoning',
            reference: 'ideal',
          },
        ],
      });
    } finally {
      await input.cleanup();
    }
  });

  it('accepts canonical scores 5.0 and 1.0 only', async () => {
    const input = await writeTempJson('canonical-scores.json', {
      name: 'Customer Support Return Intake Scores',
      judge_model: IDS.model,
      rubric: 'rubric',
      anchors: [
        {
          input: 'question-accept',
          response: 'response-accept',
          reference: 'ideal-accept',
          score: 5.0,
          reasoning: 'reasoning-accept',
        },
        {
          input: 'question-reject',
          response: 'response-reject',
          reference: 'ideal-reject',
          score: 1.0,
          reasoning: 'reasoning-reject',
        },
      ],
    });
    try {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ quality_standard_id: IDS.methodology }));
      const executor = createExecutor(fetchMock, new MemoryStream());

      await executor.execute(
        { kind: 'quality-standard-create', inputFile: input.path },
        { json: false, debug: false },
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const call = fetchMock.mock.calls[0] as [Parameters<typeof fetch>[0], RequestInit];
      expect(call[1].method).toBe('POST');
      expect(JSON.parse(call[1].body as string)).toEqual({
        name: 'Customer Support Return Intake Scores',
        judge_model: IDS.model,
        rubric: 'rubric',
        anchors: [
          {
            input: 'question-accept',
            response: 'response-accept',
            reference: 'ideal-accept',
            score: 5,
            reasoning: 'reasoning-accept',
          },
          {
            input: 'question-reject',
            response: 'response-reject',
            reference: 'ideal-reject',
            score: 1,
            reasoning: 'reasoning-reject',
          },
        ],
      });
    } finally {
      await input.cleanup();
    }
  });

  it('fails create-with-workspace when workspace lookup returns 404', async () => {
    const input = await writeTempJson('draft.json', {
      qs_name: 'Customer Support Draft',
      judgeModel: IDS.model,
      rubric: 'draft rubric',
      anchors: [
        {
          user_question: 'User question',
          example_response: 'Assistant response',
          ideal_answer: 'Reference answer',
          why: 'Reasoning',
          score: 1,
          rating: 'Reject',
        },
      ],
    });
    try {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          jsonResponse({ error: { message: 'Quality Standard not found' } }, 404),
        );
      const executor = createExecutor(fetchMock);

      await expect(
        executor.execute(
          {
            kind: 'quality-standard-create',
            inputFile: input.path,
            workspaceId: IDS.workspace,
          },
          { json: false, debug: false },
        ),
      ).rejects.toMatchObject({ status: 404 });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const workspaceLookupCall = fetchMock.mock.calls[0] as [
        Parameters<typeof fetch>[0],
        RequestInit,
      ];

      expect(requestUrl(workspaceLookupCall[0]).pathname).toBe(
        `/api/v1/quality-standards/workspaces/${IDS.workspace}`,
      );
      expect(workspaceLookupCall[1].method).toBe('GET');
    } finally {
      await input.cleanup();
    }
  });

  it('fails create-with-workspace when workspace lookup response shape is malformed', async () => {
    const input = await writeTempJson('canonical-precheck-invalid-shape.json', {
      name: 'Customer Support Return Intake',
      judge_model: IDS.model,
      rubric: 'rubric',
      anchors: [
        {
          input: 'question',
          response: 'response',
          reference: 'ideal',
          score: 5,
          reasoning: 'reasoning',
        },
      ],
    });
    try {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse([{ id: IDS.methodology }]));
      const executor = createExecutor(fetchMock);

      await expect(
        executor.execute(
          {
            kind: 'quality-standard-create',
            inputFile: input.path,
            workspaceId: IDS.workspace,
          },
          { json: false, debug: false },
        ),
      ).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE' });

      expect(fetchMock).toHaveBeenCalledTimes(3);
      const workspaceLookupCall = fetchMock.mock.calls[0] as [
        Parameters<typeof fetch>[0],
        RequestInit,
      ];

      expect(requestUrl(workspaceLookupCall[0]).pathname).toBe(
        `/api/v1/quality-standards/workspaces/${IDS.workspace}`,
      );
      expect(workspaceLookupCall[1].method).toBe('GET');
    } finally {
      await input.cleanup();
    }
  });

  it('fails create-with-workspace when workspace lookup returns a non-null invalid quality standard object', async () => {
    const input = await writeTempJson('canonical-precheck-invalid-object.json', {
      name: 'Customer Support Return Intake',
      judge_model: IDS.model,
      rubric: 'rubric',
      anchors: [
        {
          input: 'question',
          response: 'response',
          reference: 'ideal',
          score: 5,
          reasoning: 'reasoning',
        },
      ],
    });
    try {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse({ id: IDS.methodology }));
      const executor = createExecutor(fetchMock);

      await expect(
        executor.execute(
          {
            kind: 'quality-standard-create',
            inputFile: input.path,
            workspaceId: IDS.workspace,
          },
          { json: false, debug: false },
        ),
      ).rejects.toMatchObject({ code: 'INVALID_WORKSPACE_QUALITY_STANDARD' });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const workspaceLookupCall = fetchMock.mock.calls[0] as [
        Parameters<typeof fetch>[0],
        RequestInit,
      ];
      expect(requestUrl(workspaceLookupCall[0]).pathname).toBe(
        `/api/v1/quality-standards/workspaces/${IDS.workspace}`,
      );
      expect(workspaceLookupCall[1].method).toBe('GET');
    } finally {
      await input.cleanup();
    }
  });

  it('fails create-with-workspace when the workspace already has an assigned quality standard', async () => {
    const payload = {
      name: 'Existing Workspace Standard',
      judge_model: IDS.model,
      rubric: 'existing rubric',
      anchors: [
        {
          input: 'existing question',
          response: 'existing response',
          reference: 'existing ideal',
          score: 5,
          reasoning: 'existing reasoning',
        },
      ],
    };
    const input = await writeTempJson('canonical-already-assigned.json', {
      name: 'New Workspace Standard',
      judge_model: IDS.model,
      rubric: 'new rubric',
      anchors: [
        {
          input: 'new question',
          response: 'new response',
          reference: 'new ideal',
          score: 1,
          reasoning: 'new reasoning',
        },
      ],
    });
    try {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          id: IDS.methodology,
          name: payload.name,
          judge_model: payload.judge_model,
          rubric: payload.rubric,
          anchors: payload.anchors,
        }),
      );
      const executor = createExecutor(fetchMock);

      const rejection = await executor
        .execute(
          {
            kind: 'quality-standard-create',
            inputFile: input.path,
            workspaceId: IDS.workspace,
          },
          { json: false, debug: false },
        )
        .catch((error: unknown) => error);

      expect(rejection).toMatchObject({ code: 'WORKSPACE_QUALITY_STANDARD_ALREADY_ASSIGNED' });
      const message = rejection instanceof Error ? rejection.message : String(rejection);
      expect(message).toContain('Delete the existing quality standard first');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const call = fetchMock.mock.calls[0] as [Parameters<typeof fetch>[0], RequestInit];
      expect(requestUrl(call[0]).pathname).toBe(
        `/api/v1/quality-standards/workspaces/${IDS.workspace}`,
      );
      expect(call[1].method).toBe('GET');
    } finally {
      await input.cleanup();
    }
  });

  it('assign sends PUT to the workspace association endpoint', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ok: true }));
    const stdout = new MemoryStream();
    const executor = createExecutor(fetchMock, stdout);

    await executor.execute(
      {
        kind: 'quality-standard-assign',
        workspaceId: IDS.workspace,
        qualityStandardId: IDS.methodology,
      },
      { json: false, debug: false },
    );

    const call = fetchMock.mock.calls[0] as [Parameters<typeof fetch>[0], RequestInit];
    expect(requestUrl(call[0]).pathname).toBe(
      `/api/v1/quality-standards/workspaces/${IDS.workspace}`,
    );
    expect(call[1].method).toBe('PUT');
    expect(JSON.parse(call[1].body as string)).toEqual({ quality_standard_id: IDS.methodology });
    expect(stdout.value).toBe(
      `Associated quality standard ${IDS.methodology} with workspace ${IDS.workspace}\n`,
    );
  });

  it('update sends PATCH to the quality standard endpoint with file payload', async () => {
    const input = await writeTempJson('update.json', {
      name: 'Customer Support Return Intake v2',
      judge_model: IDS.model,
      rubric: 'updated rubric',
      anchors: [
        {
          input: 'question',
          response: 'response',
          reference: 'ideal',
          score: 5,
          reasoning: 'reasoning',
        },
      ],
    });
    try {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ quality_standard_id: IDS.methodology }));
      const stdout = new MemoryStream();
      const executor = createExecutor(fetchMock, stdout);

      await executor.execute(
        {
          kind: 'quality-standard-update',
          qualityStandardId: IDS.methodology,
          inputFile: input.path,
        },
        { json: false, debug: false },
      );

      const call = fetchMock.mock.calls[0] as [Parameters<typeof fetch>[0], RequestInit];
      expect(requestUrl(call[0]).pathname).toBe(`/api/v1/quality-standards/${IDS.methodology}`);
      expect(call[1].method).toBe('PATCH');
      expect(JSON.parse(call[1].body as string)).toEqual({
        name: 'Customer Support Return Intake v2',
        judge_model: IDS.model,
        rubric: 'updated rubric',
        anchors: [
          {
            input: 'question',
            response: 'response',
            reference: 'ideal',
            score: 5,
            reasoning: 'reasoning',
          },
        ],
      });
      expect(stdout.value).toBe(
        `Updated quality standard Customer Support Return Intake v2 (${IDS.methodology})\n`,
      );
    } finally {
      await input.cleanup();
    }
  });

  it('show retrieves a quality standard by id', async () => {
    const qualityStandard = {
      id: IDS.methodology,
      name: 'QS',
      judge_model: IDS.model,
      rubric: 'support rubric',
      anchors: [
        {
          input: 'accepted input',
          response: 'accepted response',
          reference: 'accepted reference',
          score: 5,
          reasoning: 'accepted reasoning',
        },
        {
          input: 'rejected input',
          response: 'rejected response',
          reference: 'rejected reference',
          score: 1,
          reasoning: 'rejected reasoning',
        },
      ],
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(qualityStandard));
    const stdout = new MemoryStream();
    const executor = createExecutor(fetchMock, stdout);

    await executor.execute(
      { kind: 'quality-standard-show', qualityStandardId: IDS.methodology },
      { json: false, debug: false },
    );

    const call = fetchMock.mock.calls[0] as [Parameters<typeof fetch>[0], RequestInit];
    expect(requestUrl(call[0]).pathname).toBe(`/api/v1/quality-standards/${IDS.methodology}`);
    expect(call[1].method).toBe('GET');
    expect(stdout.value).toContain('Name: QS');
    expect(stdout.value).toContain(`QS ID: ${IDS.methodology}`);
    expect(stdout.value).toContain(`Judge model: ${IDS.model}`);
    expect(stdout.value).toContain('Rubric\n  support rubric');
    expect(stdout.value).toContain('1. Accept (5)');
    expect(stdout.value).toContain('2. Reject (1)');
    for (const anchor of qualityStandard.anchors) {
      expect(stdout.value).toContain(anchor.input);
      expect(stdout.value).toContain(anchor.response);
      expect(stdout.value).toContain(anchor.reference);
      expect(stdout.value).toContain(anchor.reasoning);
    }
  });

  it('show JSON mode returns the backend payload unchanged', async () => {
    const qualityStandard = {
      id: IDS.methodology,
      name: 'QS',
      judge_model: IDS.model,
      rubric: 'support rubric',
      anchors: [
        {
          input: 'question',
          response: 'response',
          reference: 'reference',
          score: 5,
          reasoning: 'reasoning',
        },
      ],
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(qualityStandard));
    const stdout = new MemoryStream();
    const executor = createExecutor(fetchMock, stdout);

    await executor.execute(
      { kind: 'quality-standard-show', qualityStandardId: IDS.methodology },
      { json: true, debug: false },
    );

    expect(JSON.parse(stdout.value)).toEqual(qualityStandard);
  });

  it('workspace retrieves the assigned quality standard by workspace id', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: IDS.methodology,
        name: 'Support quality',
        judge_model: IDS.model,
        rubric: 'support rubric',
        anchors: [
          {
            input: 'question',
            response: 'response',
            reference: 'reference',
            score: 5,
            reasoning: 'reasoning',
          },
        ],
        created_at: '2026-04-07T19:35:45.122111Z',
        updated_at: '2026-07-06T16:49:39.139294Z',
      }),
    );
    const stdout = new MemoryStream();
    const executor = createExecutor(fetchMock, stdout);

    await executor.execute(
      { kind: 'quality-standard-workspace', workspaceId: IDS.workspace },
      { json: false, debug: false },
    );

    const call = fetchMock.mock.calls[0] as [Parameters<typeof fetch>[0], RequestInit];
    expect(requestUrl(call[0]).pathname).toBe(
      `/api/v1/quality-standards/workspaces/${IDS.workspace}`,
    );
    expect(call[1].method).toBe('GET');
    expect(stdout.value).toBe(
      `Workspace ${IDS.workspace} is assigned quality standard Support quality (${IDS.methodology})\n`,
    );
  });

  it('workspace treats HTTP 200 null as unassigned quality standard', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(null));
    const stdout = new MemoryStream();
    const executor = createExecutor(fetchMock, stdout);

    await executor.execute(
      { kind: 'quality-standard-workspace', workspaceId: IDS.workspace },
      { json: false, debug: false },
    );

    const call = fetchMock.mock.calls[0] as [Parameters<typeof fetch>[0], RequestInit];
    expect(requestUrl(call[0]).pathname).toBe(
      `/api/v1/quality-standards/workspaces/${IDS.workspace}`,
    );
    expect(call[1].method).toBe('GET');
    expect(stdout.value).toBe('No Quality Standard assigned to this workspace.\n');
  });

  it('workspace JSON mode returns null payload for HTTP 200 null', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(null));
    const stdout = new MemoryStream();
    const executor = createExecutor(fetchMock, stdout);

    await executor.execute(
      { kind: 'quality-standard-workspace', workspaceId: IDS.workspace },
      { json: true, debug: false },
    );

    const call = fetchMock.mock.calls[0] as [Parameters<typeof fetch>[0], RequestInit];
    expect(requestUrl(call[0]).pathname).toBe(
      `/api/v1/quality-standards/workspaces/${IDS.workspace}`,
    );
    expect(call[1].method).toBe('GET');
    expect(stdout.value).toBe('null\n');
  });

  it.each([
    ['human', false, {}],
    ['JSON', true, {}],
    ['human', false, { error: 'something' }],
    ['JSON', true, { error: 'something' }],
  ])(
    'workspace rejects a malformed non-null assignment in %s mode',
    async (_label, json, responseBody) => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(responseBody));
      const stdout = new MemoryStream();
      const executor = createExecutor(fetchMock, stdout);

      await expect(
        executor.execute(
          { kind: 'quality-standard-workspace', workspaceId: IDS.workspace },
          { json, debug: false },
        ),
      ).rejects.toMatchObject({ code: 'INVALID_WORKSPACE_QUALITY_STANDARD' });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(stdout.value).toBe('');
    },
  );

  it('returns a usage error when create input file is missing', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const executor = createExecutor(fetchMock);

    await expect(
      executor.execute(
        { kind: 'quality-standard-create', inputFile: 'does-not-exist.json' },
        { json: false, debug: false },
      ),
    ).rejects.toMatchObject({ code: 'QUALITY_STANDARD_INPUT_READ_FAILED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a usage error for unsupported quality-standard JSON schema', async () => {
    const input = await writeTempJson('invalid.json', { invalid: true });
    try {
      const fetchMock = vi.fn<typeof fetch>();
      const executor = createExecutor(fetchMock);

      await expect(
        executor.execute(
          { kind: 'quality-standard-create', inputFile: input.path },
          { json: false, debug: false },
        ),
      ).rejects.toMatchObject({ code: 'INVALID_QUALITY_STANDARD_SCHEMA' });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await input.cleanup();
    }
  });

  it('returns a usage error when quality-standard anchors are empty', async () => {
    const input = await writeTempJson('empty-anchors.json', {
      name: 'Customer Support Return Intake',
      judge_model: IDS.model,
      rubric: 'rubric',
      anchors: [],
    });
    try {
      const fetchMock = vi.fn<typeof fetch>();
      const executor = createExecutor(fetchMock);

      await expect(
        executor.execute(
          { kind: 'quality-standard-create', inputFile: input.path },
          { json: false, debug: false },
        ),
      ).rejects.toMatchObject({ code: 'INVALID_QUALITY_STANDARD_SCHEMA' });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await input.cleanup();
    }
  });

  it('returns a usage error listing missing mandatory anchor fields across all anchors', async () => {
    const payload = {
      name: 'Customer Support Return Intake',
      judge_model: IDS.model,
      rubric: 'rubric',
      anchors: [
        {
          input: 'question',
          score: 5,
          response: 'response',
          reasoning: 'reasoning',
        },
        {
          reference: 'ideal',
        },
      ],
    };
    const input = await writeTempJson('missing-anchor-fields.json', {
      ...payload,
    });
    try {
      const fetchMock = vi.fn<typeof fetch>();
      const executor = createExecutor(fetchMock);

      const command = executor.execute(
        { kind: 'quality-standard-create', inputFile: input.path },
        { json: false, debug: false },
      );

      const rejection = await command.catch((error: unknown) => error);
      expect(rejection).toMatchObject({ code: 'INVALID_QUALITY_STANDARD_SCHEMA' });

      const requiredAnchorFields = ['input', 'score', 'response', 'reasoning', 'reference'];
      const expectedMissingPaths = payload.anchors.flatMap((anchor, index) =>
        requiredAnchorFields
          .filter((field) => !(field in anchor))
          .map((field) => `anchors[${index}].${field}`),
      );

      const message = rejection instanceof Error ? rejection.message : String(rejection);
      for (const expectedPath of expectedMissingPaths) {
        expect(message).toContain(expectedPath);
      }
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await input.cleanup();
    }
  });

  it('returns a usage error when quality-standard anchors exceed five', async () => {
    const input = await writeTempJson('too-many-anchors.json', {
      name: 'Customer Support Return Intake',
      judge_model: IDS.model,
      rubric: 'rubric',
      anchors: [
        { input: 'q1', response: 'r1', reference: 'a1', score: 5, reasoning: 'x1' },
        { input: 'q2', response: 'r2', reference: 'a2', score: 5, reasoning: 'x2' },
        { input: 'q3', response: 'r3', reference: 'a3', score: 5, reasoning: 'x3' },
        { input: 'q4', response: 'r4', reference: 'a4', score: 5, reasoning: 'x4' },
        { input: 'q5', response: 'r5', reference: 'a5', score: 5, reasoning: 'x5' },
        { input: 'q6', response: 'r6', reference: 'a6', score: 5, reasoning: 'x6' },
      ],
    });
    try {
      const fetchMock = vi.fn<typeof fetch>();
      const executor = createExecutor(fetchMock);

      await expect(
        executor.execute(
          { kind: 'quality-standard-create', inputFile: input.path },
          { json: false, debug: false },
        ),
      ).rejects.toMatchObject({ code: 'INVALID_QUALITY_STANDARD_SCHEMA' });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await input.cleanup();
    }
  });

  it('returns a usage error when a canonical score is not 1 or 5', async () => {
    const input = await writeTempJson('invalid-score.json', {
      name: 'Customer Support Return Intake',
      judge_model: IDS.model,
      rubric: 'rubric',
      anchors: [
        {
          input: 'question',
          response: 'response',
          reference: 'ideal',
          score: 3.0,
          reasoning: 'reasoning',
        },
      ],
    });
    try {
      const fetchMock = vi.fn<typeof fetch>();
      const executor = createExecutor(fetchMock);

      await expect(
        executor.execute(
          { kind: 'quality-standard-create', inputFile: input.path },
          { json: false, debug: false },
        ),
      ).rejects.toMatchObject({ code: 'INVALID_QUALITY_STANDARD_SCHEMA' });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await input.cleanup();
    }
  });

  it('fails create-with-workspace when create response has no quality standard id', async () => {
    const input = await writeTempJson('canonical.json', {
      name: 'Customer Support Return Intake',
      judge_model: IDS.model,
      rubric: 'rubric',
      anchors: [
        {
          input: 'question',
          response: 'response',
          reference: 'ideal',
          score: 5,
          reasoning: 'reasoning',
        },
      ],
    });
    try {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse(null))
        .mockResolvedValueOnce(jsonResponse({ ok: true }));
      const executor = createExecutor(fetchMock);

      await expect(
        executor.execute(
          {
            kind: 'quality-standard-create',
            inputFile: input.path,
            workspaceId: IDS.workspace,
          },
          { json: false, debug: false },
        ),
      ).rejects.toMatchObject({ code: 'MISSING_QUALITY_STANDARD_ID' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      await input.cleanup();
    }
  });
});
