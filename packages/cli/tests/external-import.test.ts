import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProgram, normalizeGlobalCliFlags } from '../src/commands/program.js';
import { RuntimeCommandExecutor } from '../src/commands/executor.js';
import { readImportIds } from '../src/commands/imports.js';
import { loadConfiguration } from '../src/config.js';
import { renderImport } from '../src/output/imports.js';
import type { ImportCommand } from '../src/actions/imports.js';
import type { CommandExecutor } from '../src/commands/types.js';
import type { AutoevalApi } from '../src/api/api.js';
import { AutoevalApiClient } from '../src/api/api.js';
import { ApiClient } from '../src/api/client.js';
import { ApiError } from '../src/api/errors.js';
import { hintForError } from '../src/errors/hints.js';
import {
  executeImport,
  importCommandSchema,
  importOutcomeExitCode,
} from '../src/actions/imports.js';
import { createApi, IDS, VALID_KEY } from './helpers.js';

const EMPTY_BATCH = { imported: [], skipped: [], failed: [] };
function sourceEvaluation(index: number, imported = false) {
  return {
    id: `eval_test${index}`,
    name: `Evaluation ${index}`,
    already_imported: imported,
    run_count: null,
    last_run_at: null,
  };
}
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
function runtime(
  fetchImplementation: typeof fetch,
  interactive = false,
  confirm = vi.fn().mockResolvedValue(false),
) {
  const stdout = {
    value: '',
    write(chunk: string) {
      this.value += chunk;
      return true;
    },
  };
  const stderr = {
    value: '',
    isTTY: interactive,
    write(chunk: string) {
      this.value += chunk;
      return true;
    },
  };
  const executor = new RuntimeCommandExecutor({
    configuration: loadConfiguration(),
    environment: { AUTOEVAL_API_KEY: VALID_KEY },
    fetchImplementation,
    stdout,
    stderr,
    stdin: { isTTY: interactive },
    confirmImportRemoval: confirm,
  });
  return { executor, stdout, stderr, confirm };
}

describe('import command parsing', () => {
  it.each([
    ['status', { operation: 'status' }],
    ['connect --refresh', { operation: 'connect', refresh: true }],
    [
      'review --search rubric --page 2 --size 10 --all',
      { operation: 'review', search: 'rubric', page: 2, size: 10, all: true },
    ],
    [
      'run --eval eval_one --eval eval_two',
      { operation: 'run', evalIds: ['eval_one', 'eval_two'], allNew: false },
    ],
    ['run --all-new', { operation: 'run', allNew: true }],
    ['run --input ids.txt', { operation: 'run', allNew: false }],
    ['list', { operation: 'list' }],
    [
      `evals --workspace ${IDS.workspace} --search rubric`,
      { operation: 'evals', workspaceId: IDS.workspace, page: 1, size: 50, search: 'rubric' },
    ],
    [
      `show ${IDS.evaluation} --run evalrun_example --show-outputs`,
      {
        operation: 'show',
        evaluationId: IDS.evaluation,
        run: 'evalrun_example',
        showOutputs: true,
        page: 1,
        size: 50,
      },
    ],
    [
      `insights --workspace ${IDS.workspace}`,
      { operation: 'insights', workspaceId: IDS.workspace },
    ],
    [
      `remove ${IDS.evaluation} --yes`,
      { operation: 'remove', evaluationId: IDS.evaluation, yes: true },
    ],
    ['disconnect', { operation: 'disconnect' }],
  ])('parses %s with global JSON', async (argumentsText, expected) => {
    const execute = vi.fn<CommandExecutor['execute']>().mockResolvedValue(undefined);
    await createProgram({ execute }).parseAsync([
      'node',
      'autoeval',
      ...normalizeGlobalCliFlags(['import', ...argumentsText.split(' '), '--json']),
    ]);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'external-import', input: expected }),
      { json: true, debug: false },
    );
    if (argumentsText.includes('--input'))
      expect(execute.mock.calls[0]?.[0]).toMatchObject({ inputFile: 'ids.txt' });
  });

  it.each([
    ['run', '--all-new', '--eval', 'eval_one'],
    ['run', '--input', 'ids.txt', '--eval', 'eval_one'],
    ['run', '--input', 'ids.txt', '--all-new'],
    ['review', '--page', '0'],
    ['review', '--size', 'NaN'],
    ['evals'],
    ['insights'],
  ])('rejects conflicting or invalid flags: %j', async (...args) => {
    const execute = vi.fn<CommandExecutor['execute']>();
    const program = createProgram({ execute });
    const silence = (command: typeof program): void => {
      command.configureOutput({ writeOut: () => undefined, writeErr: () => undefined });
      command.commands.forEach(silence);
    };
    silence(program);
    await expect(program.parseAsync(['node', 'autoeval', 'import', ...args])).rejects.toBeDefined();
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('import action boundaries', () => {
  it.each([
    ['NO_KEY', 3],
    ['INVALID_KEY', 3],
    ['EVALS_FORBIDDEN', 4],
    ['OPENAI_UNREACHABLE', 4],
  ])('maps provider error %s without exposing upstream text', async (code, exitCode) => {
    const externalImport = vi
      .fn<AutoevalApi['externalImport']>()
      .mockRejectedValue(
        new ApiError({ status: 400, code, message: 'Sensitive upstream payload' }),
      );
    const promise = executeImport({ api: createApi({ externalImport }) }, { operation: 'connect' });
    await expect(promise).rejects.toMatchObject({ code, exitCode });
    await expect(promise).rejects.not.toMatchObject({ message: 'Sensitive upstream payload' });
  });

  it.each([
    { operation: 'run' },
    { operation: 'run', evalIds: [] },
    { operation: 'run', allNew: true, evalIds: ['eval_one'] },
    { operation: 'run', evalIds: ['eval_valid', '../invalid'] },
    { operation: 'review', size: 101 },
    { operation: 'review', page: -1 },
    { operation: 'show', evaluationId: IDS.evaluation, run: '../invalid' },
    { operation: 'insights', workspaceId: 'eval_not_uuid' },
  ])('rejects invalid input without HTTP: %j', async (input) => {
    const api = createApi();
    await expect(executeImport({ api }, input as ImportCommand)).rejects.toMatchObject({
      code: 'INVALID_IMPORT_ARGUMENTS',
    });
    expect(api.externalImport).not.toHaveBeenCalled();
  });

  it('pages discovery, deduplicates source IDs, and filters imported evaluations before writing', async () => {
    const externalImport = vi
      .fn<AutoevalApi['externalImport']>()
      .mockResolvedValueOnce({
        evals: Array.from({ length: 100 }, (_, index) => sourceEvaluation(index, index % 2 === 0)),
        total: 101,
        page: 1,
        size: 100,
      })
      .mockResolvedValueOnce({
        evals: [sourceEvaluation(99), sourceEvaluation(100)],
        total: 101,
        page: 2,
        size: 100,
      })
      .mockResolvedValue(EMPTY_BATCH);
    await executeImport({ api: createApi({ externalImport }) }, { operation: 'run', allNew: true });
    const writes = externalImport.mock.calls
      .map(([request]) => request)
      .filter((request) => request.method === 'POST');
    expect(writes).toHaveLength(3);
    const expectedIds = Array.from({ length: 50 }, (_, index) => `eval_test${index * 2 + 1}`);
    expectedIds.push('eval_test100');
    expect(writes.map((request) => request.body)).toEqual([
      { eval_ids: expectedIds.slice(0, 25) },
      { eval_ids: expectedIds.slice(25, 50) },
      { eval_ids: expectedIds.slice(50) },
    ]);
    expect(externalImport.mock.calls[1]?.[0].query?.page).toBe(2);
  });

  it('does not write when all discovered evaluations are imported', async () => {
    const externalImport = vi
      .fn<AutoevalApi['externalImport']>()
      .mockResolvedValue({ evals: [sourceEvaluation(1, true)], total: 1, page: 1, size: 100 });
    expect(
      await executeImport(
        { api: createApi({ externalImport }) },
        { operation: 'run', allNew: true },
      ),
    ).toMatchObject(EMPTY_BATCH);
    expect(externalImport).toHaveBeenCalledOnce();
  });

  it('rejects stalled or empty intermediate pages instead of returning a partial selection', async () => {
    const externalImport = vi
      .fn<AutoevalApi['externalImport']>()
      .mockResolvedValue({ evals: [], total: 200, page: 1, size: 100 });
    await expect(
      executeImport({ api: createApi({ externalImport }) }, { operation: 'run', allNew: true }),
    ).rejects.toMatchObject({ code: 'IMPORT_PAGINATION_STALLED' });
    expect(externalImport).toHaveBeenCalledOnce();
  });

  it('rejects malformed responses without exposing their contents', async () => {
    const externalImport = vi
      .fn<AutoevalApi['externalImport']>()
      .mockResolvedValue({ evals: [{ name: 'Private payload' }] });
    await expect(
      executeImport({ api: createApi({ externalImport }) }, { operation: 'review' }),
    ).rejects.toMatchObject({ code: 'INVALID_IMPORT_RESPONSE' });
  });

  it('cancels before starting any request', async () => {
    const api = createApi();
    await expect(
      executeImport({ api }, { operation: 'connect' }, { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });
    expect(api.externalImport).not.toHaveBeenCalled();
  });

  it.each([
    [{ operation: 'status' }, 'GET', '/connect/status'],
    [{ operation: 'connect' }, 'POST', '/connect'],
    [{ operation: 'connect', refresh: true }, 'POST', '/refresh'],
    [{ operation: 'list' }, 'GET', '/workspaces'],
    [{ operation: 'evals', workspaceId: IDS.workspace }, 'GET', `/workspaces/${IDS.workspace}`],
    [
      { operation: 'show', evaluationId: IDS.evaluation, run: 'evalrun_sample', page: 2, size: 10 },
      'GET',
      `/evaluations/${IDS.evaluation}`,
    ],
    [
      { operation: 'insights', workspaceId: IDS.workspace },
      'GET',
      `/workspaces/${IDS.workspace}/insights`,
    ],
    [
      { operation: 'remove', evaluationId: IDS.evaluation, yes: true },
      'DELETE',
      `/evaluations/${IDS.evaluation}`,
    ],
    [{ operation: 'disconnect' }, 'POST', '/disconnect'],
  ])('routes %j to its existing backend path', async (input, method, path) => {
    const bodies: Record<string, unknown> = {
      status: { key_present: true, evals_access: 'ready', cache_status: 'warm' },
      connect: { total: 4 },
      list: { workspaces: [] },
      evals: {
        items: [],
        total: 0,
        page: 1,
        page_size: 50,
        workspace: { workspace_id: IDS.workspace, name: 'Imported from OpenAI' },
      },
      show: { raw_json: { preserved: true } },
      insights: { derived_by: 'Plumloom' },
      remove: undefined,
      disconnect: undefined,
    };
    const externalImport = vi
      .fn<AutoevalApi['externalImport']>()
      .mockResolvedValue(bodies[input.operation]);
    await executeImport({ api: createApi({ externalImport }) }, input as ImportCommand);
    expect(externalImport).toHaveBeenCalledWith(expect.objectContaining({ method, path }));
    if (input.operation === 'show')
      expect(externalImport.mock.calls[0]?.[0].query).toEqual({
        run_id: 'evalrun_sample',
        page: 2,
        size: 10,
      });
  });
});

describe('import runtime and output', () => {
  it.each([
    ['NO_KEY', 'AI Providers & Models'],
    ['INVALID_KEY', 'Replace the OpenAI key'],
    ['EVALS_FORBIDDEN', 'Enable Evals read access'],
    ['OPENAI_UNREACHABLE', 'when OpenAI is reachable'],
  ])('gives actionable guidance for provider error %s', (code, guidance) => {
    const hint = hintForError({ kind: 'upstream', code });
    expect(hint).toContain(guidance);
    expect(hint).not.toContain('Retry shortly');
  });

  it.each([
    ['NO_KEY', 3],
    ['INVALID_KEY', 3],
    ['EVALS_FORBIDDEN', 4],
    ['OPENAI_UNREACHABLE', 4],
  ])(
    'rejects HTTP 200 provider error %s without reporting a connection',
    async (code, exitCode) => {
      for (const refresh of [false, true]) {
        const fetchImplementation = vi
          .fn<typeof fetch>()
          .mockResolvedValue(
            jsonResponse({ status: 'error', code, message: 'Private upstream content' }),
          );
        const { executor, stdout } = runtime(fetchImplementation);
        await expect(
          executor.execute(
            { kind: 'external-import', input: { operation: 'connect', refresh } },
            { json: false, debug: false },
          ),
        ).rejects.toMatchObject({ code, exitCode });
        expect(stdout.value).toBe('');
        expect(fetchImplementation).toHaveBeenCalledOnce();
      }
    },
  );

  it.each([{ total: 5 }, { eval_count: 5 }, { total_evals: 5 }, { total: 0 }])(
    'prints the actual connect count for %j',
    async (envelope) => {
      const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(envelope));
      const { executor, stdout } = runtime(fetchImplementation);
      await executor.execute(
        { kind: 'external-import', input: { operation: 'connect' } },
        { json: false, debug: false },
      );
      const count =
        'total' in envelope
          ? envelope.total
          : 'eval_count' in envelope
            ? envelope.eval_count
            : envelope.total_evals;
      expect(stdout.value).toContain(`Evals found: ${count}`);
      expect(stdout.value).not.toContain('Evals found: \u2014');
    },
  );

  it.each([{}, { total: -1 }, { total: '5' }, { total: 1.5 }])(
    'rejects a connect response without a valid count: %j',
    async (envelope) => {
      const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(envelope));
      const { executor, stdout } = runtime(fetchImplementation);
      await expect(
        executor.execute(
          { kind: 'external-import', input: { operation: 'connect' } },
          { json: false, debug: false },
        ),
      ).rejects.toMatchObject({ code: 'INVALID_IMPORT_RESPONSE' });
      expect(stdout.value).toBe('');
    },
  );

  it.each([
    [false, 'not_ready'],
    [false, 'ready'],
    [true, 'not_ready'],
    [true, 'forbidden'],
    [true, 'unreachable'],
    [true, null],
  ])('hides stale warm-cache guidance for key=%s access=%s', (keyPresent, access) => {
    const command = importCommandSchema.parse({ operation: 'status' });
    const response = { key_present: keyPresent, evals_access: access, cache_status: 'warm' };
    const human = renderImport(command, response);
    expect(human).not.toContain('Cached list:');
    expect(human).not.toContain("autoeval import review' to list");
    expect(importOutcomeExitCode(command, response)).toBe(keyPresent ? 4 : 3);
  });

  it.each([
    [{ code: 'KEY_PRESENT' }, true, 4],
    [{ error_code: 'KEY_PRESENT' }, true, 4],
    [{ detail: { code: 'KEY_PRESENT' } }, true, 4],
    [{ code: 'NO_KEY' }, false, 3],
  ])(
    'normalizes coded status %j without inventing readiness',
    async (envelope, keyPresent, exitCode) => {
      const externalImport = vi.fn<AutoevalApi['externalImport']>().mockResolvedValue(envelope);
      const command = importCommandSchema.parse({ operation: 'status' });
      const response = await executeImport({ api: createApi({ externalImport }) }, command);
      expect(response).toEqual({
        ...envelope,
        key_present: keyPresent,
        evals_access: 'not_ready',
        cache_status: null,
      });
      expect(importOutcomeExitCode(command, response)).toBe(exitCode);
      const human = renderImport(command, response);
      expect(human).toContain('Evals access: not ready');
      expect(human).not.toContain('Cached list:');
      if (keyPresent) {
        expect(human).toContain("Hint: Run 'autoeval import connect'");
        expect(human).not.toContain('Add an OpenAI key');
      } else {
        expect(human).toContain(
          'Hint: Add an OpenAI key in the Plumloom UI under AI Providers & Models.',
        );
        expect(human).toContain('autoeval import status --json');
      }
      expect(externalImport).toHaveBeenCalledOnce();
    },
  );

  it.each([
    [true, true, 'KEY_PRESENT', 'ready', 'warm', 0],
    [true, false, 'KEY_PRESENT', 'not_ready', 'cold', 4],
    [false, false, 'NO_KEY', 'not_ready', 'cold', 3],
    [true, true, 'EVALS_FORBIDDEN', 'forbidden', 'warm', 4],
    [true, true, 'OPENAI_UNREACHABLE', 'unreachable', 'warm', 4],
  ])(
    'maps backend key/cache fields with key=%s cache=%s code=%s',
    async (keyPresent, cacheWarm, code, access, cache, exitCode) => {
      const envelope = {
        key_present: keyPresent,
        key_last4: keyPresent ? 'test' : null,
        cache_warm: cacheWarm,
        code,
      };
      const externalImport = vi.fn<AutoevalApi['externalImport']>().mockResolvedValue(envelope);
      const command = importCommandSchema.parse({ operation: 'status' });
      const response = await executeImport({ api: createApi({ externalImport }) }, command);
      expect(response).toMatchObject({
        key_present: keyPresent,
        key_suffix: envelope.key_last4,
        evals_access: access,
        cache_status: cache,
      });
      expect(importOutcomeExitCode(command, response)).toBe(exitCode);
      const human = renderImport(command, response);
      expect(human).toContain(`Evals access: ${access === 'not_ready' ? 'not ready' : access}`);
      if (access === 'ready') expect(human).toContain(`Cached list:  ${cache}`);
      else expect(human).not.toContain('Cached list:');
      expect(human).not.toContain('not checked');
      if (keyPresent) expect(human).toContain('present (...test)');
      if (exitCode === 0) expect(human).toContain("run 'autoeval import review'");
      expect(externalImport).toHaveBeenCalledOnce();
    },
  );

  it('preserves an explicit forbidden state even when the discovery cache is warm', async () => {
    const api = createApi({
      externalImport: vi.fn<AutoevalApi['externalImport']>().mockResolvedValue({
        key_present: true,
        key_last4: 'test',
        cache_warm: true,
        code: 'KEY_PRESENT',
        evals_access: 'forbidden',
      }),
    });
    const command = importCommandSchema.parse({ operation: 'status' });
    const response = await executeImport({ api }, command);
    expect(response).toMatchObject({ evals_access: 'forbidden', cache_status: 'warm' });
    expect(importOutcomeExitCode(command, response)).toBe(4);
  });

  it('preserves explicitly reported access and cache states in coded responses', async () => {
    const envelope = {
      code: 'KEY_PRESENT',
      evals_access: 'ready',
      cache_status: 'warm',
      key_suffix: 'test',
    };
    const api = createApi({
      externalImport: vi.fn<AutoevalApi['externalImport']>().mockResolvedValue(envelope),
    });
    const command = importCommandSchema.parse({ operation: 'status' });
    const response = await executeImport({ api }, command);
    expect(response).toEqual({ ...envelope, key_present: true });
    expect(importOutcomeExitCode(command, response)).toBe(0);
    expect(renderImport(command, response)).toContain('present (...test)');
    expect(renderImport(command, response)).not.toContain('Hint:');
  });

  it.each([
    {},
    { code: 'UNKNOWN_STATUS' },
    { code: 'KEY_PRESENT', key_present: 'true' },
    { code: 'KEY_PRESENT', evals_access: 'maybe' },
    { code: 'KEY_PRESENT', cache_status: 'maybe' },
    { code: 'KEY_PRESENT', cache_warm: 'true' },
    { code: 'KEY_PRESENT', key_last4: 'too-long' },
    { code: 'UNKNOWN_STATUS', key_present: true, key_last4: 'test', cache_warm: true },
  ])('rejects unknown or malformed status %j', async (envelope) => {
    const api = createApi({
      externalImport: vi.fn<AutoevalApi['externalImport']>().mockResolvedValue(envelope),
    });
    await expect(executeImport({ api }, { operation: 'status' })).rejects.toMatchObject({
      code: 'INVALID_IMPORT_RESPONSE',
    });
  });

  it('gives a connect hint for a present key with a cold cache', () => {
    const human = renderImport(importCommandSchema.parse({ operation: 'status' }), {
      key_present: true,
      evals_access: 'ready',
      cache_status: 'cold',
    });
    expect(human).toContain("Hint: Run 'autoeval import connect'");
    expect(human).not.toContain('Add an OpenAI key');
  });

  it('rejects an invalid key before considering stale warm-cache state', async () => {
    const api = createApi({
      externalImport: vi.fn<AutoevalApi['externalImport']>().mockResolvedValue({
        code: 'INVALID_KEY',
        key_present: true,
        key_last4: 'test',
        cache_warm: true,
      }),
    });
    await expect(executeImport({ api }, { operation: 'status' })).rejects.toMatchObject({
      code: 'INVALID_KEY',
      exitCode: 3,
    });
  });

  it.each([
    ['forbidden', 'Hint: Enable Evals access'],
    ['unreachable', 'Hint: OpenAI is unreachable'],
  ])('gives the appropriate hint for %s access', (evalsAccess, expectedHint) => {
    const human = renderImport(importCommandSchema.parse({ operation: 'status' }), {
      key_present: true,
      evals_access: evalsAccess,
      cache_status: 'cold',
    });
    expect(human).toContain(expectedHint);
    expect(human).not.toContain('Add an OpenAI key');
    expect(human).not.toContain('to validate access and cache');
  });

  it.each([
    [{ key_present: true, evals_access: 'ready', cache_status: 'warm' }, 0],
    [{ key_present: false, evals_access: null, cache_status: 'cold' }, 3],
    [{ key_present: true, evals_access: 'forbidden', cache_status: 'cold' }, 4],
    [{ key_present: true, evals_access: 'unreachable', cache_status: 'cold' }, 4],
  ])('returns the documented status exit code', (status, expected) => {
    expect(importOutcomeExitCode(importCommandSchema.parse({ operation: 'status' }), status)).toBe(
      expected,
    );
  });

  it('preserves raw detail in JSON, redacts secrets, and emits no human text', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        name: 'Imported eval',
        raw_json: { api_key: 'synthetic-provider-credential', input: 'Record', trace: VALID_KEY },
      }),
    );
    const { executor, stdout, stderr } = runtime(fetchImplementation);
    await executor.execute(
      { kind: 'external-import', input: { operation: 'show', evaluationId: IDS.evaluation } },
      { json: true, debug: false },
    );
    expect(JSON.parse(stdout.value)).toEqual({
      name: 'Imported eval',
      raw_json: { api_key: '[REDACTED]', input: 'Record', trace: 'pl_sk_[REDACTED]' },
    });
    expect(stderr.value).toBe('');
  });

  it('preserves the full insights envelope and grader navigation IDs in JSON', async () => {
    const envelope = {
      derived_by: 'Plumloom',
      totals: { pass_rate: null },
      flaky_graders: [{ name: 'Rubric', evals: [{ eval_id: IDS.evaluation }] }],
    };
    const { executor, stdout } = runtime(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(envelope)),
    );
    await executor.execute(
      { kind: 'external-import', input: { operation: 'insights', workspaceId: IDS.workspace } },
      { json: true, debug: false },
    );
    expect(JSON.parse(stdout.value)).toEqual(envelope);
    expect(
      renderImport(
        importCommandSchema.parse({ operation: 'insights', workspaceId: IDS.workspace }),
        envelope,
      ),
    ).not.toContain('Pass rate 0.0%');
  });

  it('does not delete when confirmation is declined', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ name: 'Imported eval' }));
    const { executor, stdout, confirm } = runtime(fetchImplementation, true);
    await executor.execute(
      { kind: 'external-import', input: { operation: 'remove', evaluationId: IDS.evaluation } },
      { json: false, debug: false },
    );
    expect(confirm).toHaveBeenCalledWith('Remove "Imported eval" and its runs/results?', undefined);
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(stdout.value).toBe('Removal canceled.\n');
  });

  it('deletes only after interactive confirmation', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ name: 'Imported eval' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { executor, stdout } = runtime(
      fetchImplementation,
      true,
      vi.fn().mockResolvedValue(true),
    );
    await executor.execute(
      { kind: 'external-import', input: { operation: 'remove', evaluationId: IDS.evaluation } },
      { json: false, debug: false },
    );
    expect(fetchImplementation.mock.calls[1]?.[1]?.method).toBe('DELETE');
    expect(stdout.value).toContain('Removed.');
  });

  it('rejects noninteractive removal before fetching details', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const { executor } = runtime(fetchImplementation);
    await expect(
      executor.execute(
        { kind: 'external-import', input: { operation: 'remove', evaluationId: IDS.evaluation } },
        { json: true, debug: false },
      ),
    ).rejects.toMatchObject({ code: 'IMPORT_CONFIRMATION_REQUIRED' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('shows two result columns when expected is blank and selects the newest run', () => {
    const human = renderImport(
      importCommandSchema.parse({
        operation: 'show',
        evaluationId: IDS.evaluation,
        showOutputs: true,
      }),
      {
        name: 'Example',
        runs: [
          {
            id: 'evalrun_old',
            created_at: '2026-01-01',
            results: [{ input: 'OLD', output: 'Old output' }],
          },
          {
            id: 'evalrun_new',
            created_at: '2026-10-01',
            results: [{ input: 'NEW', expected: '', output: 'New output', passed: true }],
          },
        ],
      },
    );
    expect(human).toContain('Results (evalrun_new)');
    expect(human).toContain('New output');
    expect(human).not.toContain('EXPECTED');
    expect(human).not.toContain('Old output');
  });

  it('neutralizes terminal control characters in backend names', () => {
    const human = renderImport(importCommandSchema.parse({ operation: 'review' }), {
      evals: [{ ...sourceEvaluation(1), name: 'Unsafe\u001b[2Jname' }],
      total: 1,
      page: 1,
      size: 50,
    });
    expect(human).not.toContain('\u001b[2J');
    expect(human).toContain('Unsafe');
  });

  it('reads BOM/CRLF files, deduplicates IDs, and bounds invalid files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'autoeval-import-'));
    const filename = join(directory, 'ids.txt');
    try {
      await writeFile(filename, '\uFEFFeval_one\r\n\r\neval_one\r\neval_two\r\n');
      const fetchImplementation = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse(EMPTY_BATCH));
      const { executor } = runtime(fetchImplementation);
      await executor.execute(
        { kind: 'external-import', input: { operation: 'run' }, inputFile: filename },
        { json: true, debug: false },
      );
      expect(fetchImplementation.mock.calls[0]?.[1]?.body).toBe(
        JSON.stringify({ eval_ids: ['eval_one', 'eval_two'] }),
      );
      await writeFile(filename, Buffer.alloc(1024 * 1024 + 1));
      await expect(readImportIds(filename)).rejects.toMatchObject({ code: 'INVALID_IMPORT_FILE' });
      await writeFile(filename, Buffer.from([0xff]));
      await expect(readImportIds(filename)).rejects.toMatchObject({ code: 'INVALID_IMPORT_FILE' });
      await expect(readImportIds(directory)).rejects.toMatchObject({ code: 'INVALID_IMPORT_FILE' });
      await expect(readImportIds(join(directory, 'missing.txt'))).rejects.toMatchObject({
        code: 'INVALID_IMPORT_FILE',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('imported workspace evaluations', () => {
  it('accepts a 200-item workspace page without changing discovery limits', async () => {
    const execute = vi.fn<CommandExecutor['execute']>().mockResolvedValue(undefined);
    await createProgram({ execute }).parseAsync([
      'node',
      'autoeval',
      'import',
      'evals',
      '--workspace',
      IDS.workspace,
      '--size',
      '200',
    ]);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { operation: 'evals', workspaceId: IDS.workspace, page: 1, size: 200 },
      }),
      { json: false, debug: false },
    );
    expect(
      importCommandSchema.safeParse({ operation: 'evals', workspaceId: IDS.workspace, size: 200 })
        .success,
    ).toBe(true);
    expect(
      importCommandSchema.safeParse({ operation: 'evals', workspaceId: IDS.workspace, size: 201 })
        .success,
    ).toBe(false);
    expect(importCommandSchema.safeParse({ operation: 'review', size: 200 }).success).toBe(false);
  });

  const item = {
    eval_id: IDS.evaluation,
    openai_eval_id: 'eval_example_imported',
    name: 'Example imported rubric',
    openai_created_at: '2026-10-01T01:00:00Z',
    imported_at: '2026-10-15T01:00:00Z',
    run_count: 1,
    last_run_at: '2026-10-01T01:00:00Z',
  };
  const envelope = {
    page: 1,
    page_size: 200,
    total: 1,
    workspace: { workspace_id: IDS.workspace, name: 'Imported from OpenAI' },
    items: [item],
  };

  it.each([50, 200])(
    'uses page_size=%s and preserves the complete backend envelope in JSON',
    async (size) => {
      const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(envelope));
      const { executor, stdout, stderr } = runtime(fetchImplementation);
      await executor.execute(
        {
          kind: 'external-import',
          input: { operation: 'evals', workspaceId: IDS.workspace, page: 1, size },
        },
        { json: true, debug: false },
      );
      expect(fetchImplementation.mock.calls[0]?.[0]).toEqual(
        new URL(
          `/api/v1/import/external/evals/workspaces/${IDS.workspace}?page=1&page_size=${size}&search=`,
          loadConfiguration().apiBaseUrl,
        ),
      );
      expect(fetchImplementation.mock.calls[0]?.[1]?.method).toBe('GET');
      expect(fetchImplementation).toHaveBeenCalledOnce();
      expect(JSON.parse(stdout.value)).toEqual(envelope);
      expect(stderr.value).toBe('');
    },
  );

  it('shows both complete IDs, workspace context, runs, and last run in human output', () => {
    const human = renderImport(
      importCommandSchema.parse({ operation: 'evals', workspaceId: IDS.workspace }),
      envelope,
    );
    for (const expected of [
      'Imported from OpenAI',
      IDS.workspace,
      'EVAL ID (plumloom)',
      IDS.evaluation,
      'OPENAI EVAL ID',
      item.openai_eval_id,
      'LAST RUN',
      '2026-10-01',
      'Showing 1-1 of 1.',
    ])
      expect(human).toContain(expected);
  });

  it('uses returned pagination rather than the requested size in the summary', () => {
    const human = renderImport(
      importCommandSchema.parse({
        operation: 'evals',
        workspaceId: IDS.workspace,
        page: 2,
        size: 10,
      }),
      { ...envelope, page: 2, page_size: 50, total: 200 },
    );
    expect(human).toContain('Showing 51-51 of 200. --page 3');
  });

  it('renders null run metadata and empty result sets without inventing values', () => {
    const command = importCommandSchema.parse({ operation: 'evals', workspaceId: IDS.workspace });
    expect(
      renderImport(command, {
        ...envelope,
        items: [{ ...item, run_count: null, last_run_at: null }],
      }),
    ).toContain('\u2014');
    expect(renderImport(command, { ...envelope, total: 0, items: [] })).toContain(
      'No imported evaluations found.\nShowing 0-0 of 0.',
    );
  });

  it('preserves page and search parameters', async () => {
    const externalImport = vi.fn<AutoevalApi['externalImport']>().mockResolvedValue(envelope);
    await executeImport(
      { api: createApi({ externalImport }) },
      { operation: 'evals', workspaceId: IDS.workspace, page: 2, size: 10, search: 'rubric' },
    );
    expect(externalImport).toHaveBeenCalledWith({
      method: 'GET',
      path: `/workspaces/${IDS.workspace}`,
      query: { page: 2, page_size: 10, search: 'rubric' },
    });
  });

  it.each([
    { ...envelope, page_size: '200' },
    { ...envelope, items: {} },
    { ...envelope, items: [{ ...item, eval_id: 'eval_not_a_uuid' }] },
    { ...envelope, items: [{ ...item, openai_eval_id: IDS.evaluation }] },
    { ...envelope, items: [{ ...item, run_count: -1 }] },
  ])('rejects malformed imported-eval metadata: %j', async (response) => {
    const api = createApi({
      externalImport: vi.fn<AutoevalApi['externalImport']>().mockResolvedValue(response),
    });
    await expect(
      executeImport({ api }, { operation: 'evals', workspaceId: IDS.workspace }),
    ).rejects.toMatchObject({ code: 'INVALID_IMPORT_RESPONSE' });
  });
});

describe('external import transport', () => {
  it('renders backend review rows, nullable run metadata, imported flags, and paging', async () => {
    const items = [
      {
        openai_eval_id: 'eval_rubric_one',
        name: 'Marketing tone rubric',
        created_at: '2026-10-01T12:00:00Z',
        last_run_at: '2026-10-01T13:00:00Z',
        run_count: 1,
        already_imported: true,
      },
      {
        openai_eval_id: 'eval_rubric_two',
        name: 'Code review rubric',
        created_at: '2026-09-30T12:00:00Z',
        last_run_at: null,
        run_count: null,
        already_imported: false,
      },
    ];
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ items, page: 1, page_size: 2, total: 3, already_imported_count: 1 }),
      );
    const { executor, stdout, stderr } = runtime(fetchImplementation);
    await executor.execute(
      { kind: 'external-import', input: { operation: 'review', size: 2 } },
      { json: false, debug: false },
    );
    for (const expected of [
      'OPENAI EVAL ID',
      'NAME',
      'CREATED',
      'LAST RUN',
      'RUNS',
      'IMPORTED',
      'Marketing tone rubric',
      'Code review rubric',
      '2026-10-01',
      'yes',
      'no',
      '\u2014',
      'Showing 1-2 of 3.',
      '--page 2',
    ]) {
      expect(stdout.value).toContain(expected);
    }
    expect(stderr.value).toBe('');
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it('renders an empty backend discovery page without inventing evaluations', async () => {
    const { executor, stdout } = runtime(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          jsonResponse({ items: [], page: 1, page_size: 50, total: 0, already_imported_count: 0 }),
        ),
    );
    await executor.execute(
      { kind: 'external-import', input: { operation: 'review' } },
      { json: false, debug: false },
    );
    expect(stdout.value).toBe('No OpenAI evaluations found.\nShowing 0-0 of 0.\n');
  });

  it.each([
    { items: 'invalid', page: 1, page_size: 50, total: 0 },
    { items: [], page: 1, page_size: '50', total: 0 },
    { items: [], page: 1, page_size: 50, total: 0, already_imported_count: -1 },
    {
      items: [{ id: 'eval_invalid', name: 'Invalid', already_imported: 'yes' }],
      page: 1,
      page_size: 50,
      total: 1,
    },
  ])('rejects malformed backend discovery metadata without rendering it: %j', async (envelope) => {
    const { executor, stdout } = runtime(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(envelope)),
    );
    await expect(
      executor.execute(
        { kind: 'external-import', input: { operation: 'review' } },
        { json: true, debug: false },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_IMPORT_RESPONSE' });
    expect(stdout.value).toBe('');
  });

  it('uses the confirmed collection GET and normalizes backend paging fields', async () => {
    const page = {
      items: [sourceEvaluation(1)],
      total: 11,
      already_imported_count: 0,
      page: 2,
      page_size: 10,
    };
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(page));
    const { executor, stdout } = runtime(fetchImplementation);
    await executor.execute(
      {
        kind: 'external-import',
        input: { operation: 'review', page: 2, size: 10, search: 'rubric' },
      },
      { json: true, debug: false },
    );
    const origin = loadConfiguration().apiBaseUrl;
    expect(fetchImplementation.mock.calls.map(([url]) => url)).toEqual([
      new URL('/api/v1/import/external/evals?page=2&page_size=10&search=rubric', origin),
    ]);
    expect(fetchImplementation.mock.calls.map(([, options]) => options?.method)).toEqual(['GET']);
    expect(JSON.parse(stdout.value)).toEqual({ ...page, evals: page.items, size: page.page_size });
  });

  it('preserves the cold-cache exit code on the confirmed discovery route', async () => {
    const externalImport = vi
      .fn<AutoevalApi['externalImport']>()
      .mockRejectedValueOnce(new ApiError({ status: 409 }));
    await expect(
      executeImport({ api: createApi({ externalImport }) }, { operation: 'review' }),
    ).rejects.toMatchObject({ code: 'IMPORT_CACHE_COLD', exitCode: 9 });
    expect(externalImport).toHaveBeenCalledOnce();
    expect(externalImport.mock.calls[0]?.[0]).toMatchObject({
      method: 'GET',
      path: '',
      query: { page: 1, page_size: 50, search: '' },
    });
  });

  it('reads all backend pages without connecting or importing', async () => {
    const externalImport = vi.fn<AutoevalApi['externalImport']>().mockImplementation((request) => {
      const page = request.query?.page === 2 ? 2 : 1;
      return Promise.resolve({ items: [sourceEvaluation(page)], total: 2, page, page_size: 1 });
    });
    const response = await executeImport(
      { api: createApi({ externalImport }) },
      { operation: 'review', all: true, size: 1, search: 'rubric' },
    );
    expect(response).toMatchObject({
      items: [sourceEvaluation(1), sourceEvaluation(2)],
      evals: [sourceEvaluation(1), sourceEvaluation(2)],
      total: 2,
    });
    expect(externalImport).toHaveBeenCalledTimes(2);
    expect(externalImport.mock.calls.map(([request]) => request.method)).toEqual(['GET', 'GET']);
    expect(externalImport.mock.calls.map(([request]) => request.query?.page)).toEqual([1, 2]);
    expect(externalImport.mock.calls.map(([request]) => request.query?.page_size)).toEqual([1, 1]);
    expect(externalImport.mock.calls.every(([request]) => request.query?.search === 'rubric')).toBe(
      true,
    );
  });

  it('reports an unsupported GET without guessing another discovery route', async () => {
    const externalImport = vi
      .fn<AutoevalApi['externalImport']>()
      .mockRejectedValue(new ApiError({ status: 405 }));
    await expect(
      executeImport({ api: createApi({ externalImport }) }, { operation: 'review' }),
    ).rejects.toMatchObject({ code: 'IMPORT_METHOD_NOT_ALLOWED', exitCode: 4 });
    expect(externalImport).toHaveBeenCalledOnce();
    expect(hintForError({ kind: 'unsupported', code: 'IMPORT_METHOD_NOT_ALLOWED' })).not.toContain(
      'Retry shortly',
    );
  });

  it.each([403, 409])('does not probe another route after HTTP %s', async (status) => {
    const externalImport = vi
      .fn<AutoevalApi['externalImport']>()
      .mockRejectedValue(new ApiError({ status }));
    await expect(
      executeImport({ api: createApi({ externalImport }) }, { operation: 'review' }),
    ).rejects.toBeDefined();
    expect(externalImport).toHaveBeenCalledOnce();
  });

  it('does not retry writes against the discovery collection on HTTP 405', async () => {
    const externalImport = vi
      .fn<AutoevalApi['externalImport']>()
      .mockRejectedValue(new ApiError({ status: 405 }));
    await expect(
      executeImport({ api: createApi({ externalImport }) }, { operation: 'connect' }),
    ).rejects.toMatchObject({ code: 'IMPORT_METHOD_NOT_ALLOWED' });
    expect(externalImport).toHaveBeenCalledOnce();
  });

  it('starts --all at page one even with a page override', async () => {
    const externalImport = vi
      .fn<AutoevalApi['externalImport']>()
      .mockResolvedValue({ evals: [], total: 0, page: 1, size: 50 });
    await executeImport(
      { api: createApi({ externalImport }) },
      { operation: 'review', all: true, page: 3 },
    );
    expect(externalImport.mock.calls[0]?.[0].query?.page).toBe(1);
  });

  it('provides machine-readable results for empty delete and disconnect responses', async () => {
    const api = createApi({
      externalImport: vi.fn<AutoevalApi['externalImport']>().mockResolvedValue(undefined),
    });
    await expect(executeImport({ api }, { operation: 'disconnect' })).resolves.toEqual({
      disconnected: true,
    });
    await expect(
      executeImport({ api }, { operation: 'remove', evaluationId: IDS.evaluation, yes: true }),
    ).resolves.toEqual({ removed: true, eval_id: IDS.evaluation });
  });

  it('preserves numeric count responses and partial-failure exit status', async () => {
    const batch = {
      imported: 2,
      skipped: 1,
      failed: [{ openai_eval_id: 'eval_failed', reason: 'Unavailable' }],
      workspace_id: IDS.workspace,
    };
    const response = await executeImport(
      {
        api: createApi({
          externalImport: vi.fn<AutoevalApi['externalImport']>().mockResolvedValue(batch),
        }),
      },
      { operation: 'run', evalIds: ['eval_selected'] },
    );
    expect(response).toMatchObject(batch);
    expect(
      importOutcomeExitCode(
        importCommandSchema.parse({ operation: 'run', evalIds: ['eval_selected'] }),
        response,
      ),
    ).toBe(1);
  });

  it('rejects source IDs in UUID paths without making a request', async () => {
    const api = createApi();
    await expect(
      executeImport({ api }, { operation: 'show', evaluationId: 'eval_example' }),
    ).rejects.toMatchObject({ code: 'INVALID_IMPORT_ARGUMENTS' });
    expect(api.externalImport).not.toHaveBeenCalled();
  });

  it('maps cold discovery caches to exit 9', async () => {
    const api = createApi({
      externalImport: vi
        .fn<AutoevalApi['externalImport']>()
        .mockRejectedValue(new ApiError({ status: 409 })),
    });
    await expect(executeImport({ api }, { operation: 'review' })).rejects.toMatchObject({
      code: 'IMPORT_CACHE_COLD',
      exitCode: 9,
    });
  });

  it('deduplicates and chunks selections without aborting on per-eval failures', async () => {
    const externalImport = vi
      .fn<AutoevalApi['externalImport']>()
      .mockResolvedValueOnce({ imported: ['eval_first'], skipped: [], failed: ['eval_failed'] })
      .mockResolvedValueOnce({ imported: [], skipped: ['eval_last'], failed: [] });
    const evalIds = Array.from({ length: 26 }, (_, index) => `eval_test${index}`);
    const response = await executeImport(
      { api: createApi({ externalImport }) },
      { operation: 'run', evalIds: [...evalIds, 'eval_test0'] },
    );
    expect(externalImport).toHaveBeenCalledTimes(2);
    expect(externalImport.mock.calls[0]?.[0].body).toEqual({ eval_ids: evalIds.slice(0, 25) });
    expect(externalImport.mock.calls[1]?.[0].body).toEqual({ eval_ids: evalIds.slice(25) });
    expect(response).toMatchObject({
      imported: ['eval_first'],
      skipped: ['eval_last'],
      failed: ['eval_failed'],
    });
  });

  it('requires explicit removal confirmation', async () => {
    const api = createApi();
    await expect(
      executeImport({ api }, { operation: 'remove', evaluationId: IDS.evaluation }),
    ).rejects.toMatchObject({ code: 'IMPORT_CONFIRMATION_REQUIRED' });
    expect(api.externalImport).not.toHaveBeenCalled();
  });

  it('uses the Plumloom import endpoint and does not retry deletion', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const api = new AutoevalApiClient(
      new ApiClient({
        baseUrl: new URL('https://example.test'),
        apiKey: VALID_KEY,
        requestTimeoutMs: 1000,
        maxResponseBytes: 1024,
        fetchImplementation,
      }),
    );
    await api.externalImport({ method: 'DELETE', path: '/evaluations/test' });
    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [url, options] = fetchImplementation.mock.calls[0] ?? [];
    expect(url).toEqual(
      new URL('https://example.test/api/v1/import/external/evals/evaluations/test'),
    );
    expect(options?.method).toBe('DELETE');
    expect(options?.headers).toMatchObject({ Authorization: ['Bearer', VALID_KEY].join(' ') });
  });
});
