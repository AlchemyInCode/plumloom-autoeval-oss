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
import { safeMultilineTerminalText } from '../src/output/safe-text.js';
import * as progressOutput from '../src/output/progress.js';
import {
  executeImport,
  importCommandSchema,
  importOutcomeExitCode,
} from '../src/actions/imports.js';
import { createApi, IDS, VALID_KEY } from './helpers.js';

const EMPTY_BATCH = { imported: [], skipped: [], failed: [] };
const IMPORTED_EVAL = {
  eval_id: IDS.evaluation,
  openai_eval_id: 'eval_example_imported',
  name: 'Imported eval',
  openai_created_at: '2026-10-01T01:00:00Z',
  imported_at: '2026-10-15T01:00:00Z',
};
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
  signal?: AbortSignal,
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
    ...(signal ? { signal } : {}),
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

  it('imports 1,000 discovered evaluations in 40 complete batches with mixed outcomes', async () => {
    const evaluationIds = Array.from({ length: 1_000 }, (_, index) => `eval_batch${index}`);
    const backendBatches: {
      workspace_id: string;
      imported: number;
      skipped: number;
      failed: { eval_id: string; reason: string }[];
      eval_ids_imported: string[];
    }[] = [];
    const skippedIds: string[] = [];
    let batchIndex = 0;
    const externalImport = vi.fn<AutoevalApi['externalImport']>().mockImplementation((request) => {
      if (request.method === 'GET') {
        const page = Number(request.query?.page);
        const start = (page - 1) * 100;
        return Promise.resolve({
          items: evaluationIds.slice(start, start + 100).map((id, index) => ({
            id,
            name: `Evaluation ${start + index}`,
            already_imported: false,
            run_count: null,
            last_run_at: null,
          })),
          total: evaluationIds.length,
          page,
          page_size: 100,
        });
      }

      const batchIds = evaluationIds.slice(batchIndex * 25, (batchIndex + 1) * 25);
      skippedIds.push(...batchIds.slice(0, 1));
      const batch = {
        workspace_id: IDS.workspace,
        imported: 22,
        skipped: 1,
        failed: batchIds.slice(1, 3).map((eval_id, index) => ({
          eval_id,
          reason: index === 0 ? 'EVAL_NOT_FOUND' : 'RATE_LIMITED',
        })),
        eval_ids_imported: batchIds.slice(3),
      };
      backendBatches.push(batch);
      batchIndex += 1;
      return Promise.resolve(batch);
    });

    const response = await executeImport(
      { api: createApi({ externalImport }) },
      { operation: 'run', allNew: true },
    );

    const discoveryRequests = externalImport.mock.calls
      .map(([request]) => request)
      .filter((request) => request.method === 'GET');
    const batchRequests = externalImport.mock.calls
      .map(([request]) => request)
      .filter((request) => request.method === 'POST');
    const requestedIds = batchRequests.flatMap((request) => {
      const body = request.body as { eval_ids: string[] };
      expect(body.eval_ids).toHaveLength(25);
      return body.eval_ids;
    });
    const importedIds = backendBatches.flatMap((batch) => batch.eval_ids_imported);
    const failedIds = backendBatches.flatMap((batch) =>
      batch.failed.map((failure) => failure.eval_id),
    );

    expect(discoveryRequests).toHaveLength(10);
    expect(discoveryRequests.map((request) => request.query?.page)).toEqual(
      Array.from({ length: 10 }, (_, index) => index + 1),
    );
    expect(batchRequests).toHaveLength(40);
    expect(batchRequests.every((request) => request.path === '/run')).toBe(true);
    expect(requestedIds).toEqual(evaluationIds);
    expect(new Set(requestedIds).size).toBe(1_000);
    expect(importedIds).toHaveLength(880);
    expect(skippedIds).toHaveLength(40);
    expect(failedIds).toHaveLength(80);
    expect(
      backendBatches.flatMap((batch) => batch.failed.map((failure) => failure.reason)),
    ).toEqual(Array.from({ length: 40 }, () => ['EVAL_NOT_FOUND', 'RATE_LIMITED']).flat());
    expect([...importedIds, ...skippedIds, ...failedIds].sort()).toEqual([...evaluationIds].sort());
    expect(new Set([...importedIds, ...skippedIds, ...failedIds]).size).toBe(1_000);
    expect(response).toEqual({
      imported: 880,
      skipped: 40,
      failed: backendBatches.flatMap((batch) => batch.failed),
      eval_ids_imported: importedIds,
      workspace_id: IDS.workspace,
      batches: backendBatches,
    });
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

  it('does not release late review results after cancellation', async () => {
    const controller = new AbortController();
    const externalImport = vi.fn<AutoevalApi['externalImport']>().mockImplementation(() => {
      controller.abort();
      return Promise.resolve({ items: [sourceEvaluation(1)], total: 1, page: 1, page_size: 50 });
    });
    await expect(
      executeImport(
        { api: createApi({ externalImport }) },
        { operation: 'review' },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });
    expect(externalImport).toHaveBeenCalledOnce();
  });

  it.each([
    [{ operation: 'status' }, 'GET', '/connect/status'],
    [{ operation: 'connect' }, 'POST', '/connect'],
    [{ operation: 'connect', refresh: true }, 'POST', '/refresh'],
    [{ operation: 'list' }, 'GET', '/workspaces'],
    [{ operation: 'evals', workspaceId: IDS.workspace }, 'GET', `/workspaces/${IDS.workspace}`],
    [
      { operation: 'show', evaluationId: IDS.evaluation, page: 2, size: 10 },
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
      show: { eval: IMPORTED_EVAL, runs: [], results: [], raw_json: { preserved: true } },
      insights: { derived_by: 'Plumloom' },
      remove: { deleted: true, eval_id: IDS.evaluation },
      disconnect: undefined,
    };
    const externalImport = vi
      .fn<AutoevalApi['externalImport']>()
      .mockResolvedValue(bodies[input.operation]);
    await executeImport({ api: createApi({ externalImport }) }, input as ImportCommand);
    expect(externalImport).toHaveBeenCalledWith(expect.objectContaining({ method, path }));
    if (input.operation === 'show') {
      expect(externalImport.mock.calls[0]?.[0].query).toEqual({
        page: 2,
        page_size: 10,
      });
    }
  });
});

describe('import runtime and output', () => {
  it.each(['success', 'failure', 'cancelled'] as const)(
    'clears workspace-evals loading on %s',
    async (outcome) => {
      const controller = new AbortController();
      const update = vi.fn();
      const stop = vi.fn();
      const progress = vi
        .spyOn(progressOutput, 'createProgressReporter')
        .mockReturnValue({ update, stop, reportStatus: vi.fn() });
      const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(() => {
        expect(update).toHaveBeenCalledWith('Loading imported evaluations...');
        if (outcome === 'cancelled') controller.abort();
        return Promise.resolve(
          outcome === 'failure'
            ? jsonResponse({ code: 'NO_KEY' })
            : jsonResponse({
                page: 1,
                page_size: 50,
                total: 0,
                items: [],
                workspace: { workspace_id: IDS.workspace, name: 'Imported from OpenAI' },
              }),
        );
      });
      const { executor, stdout } = runtime(
        fetchImplementation,
        true,
        vi.fn().mockResolvedValue(false),
        controller.signal,
      );
      const write = vi.spyOn(stdout, 'write').mockImplementation((chunk: string) => {
        expect(stop).toHaveBeenCalledOnce();
        stdout.value += chunk;
        return true;
      });
      try {
        const execution = executor.execute(
          { kind: 'external-import', input: { operation: 'evals', workspaceId: IDS.workspace } },
          { json: false, debug: false },
        );
        if (outcome === 'success') {
          await execution;
          expect(stdout.value).toContain('No imported evaluations found.');
        } else {
          await expect(execution).rejects.toMatchObject({
            code: outcome === 'failure' ? 'NO_KEY' : 'REQUEST_ABORTED',
          });
          expect(stdout.value).toBe('');
        }
        expect(progress).toHaveBeenCalledWith(
          expect.objectContaining({ label: 'Imported evaluations', enabled: true }),
        );
        expect(stop).toHaveBeenCalledOnce();
      } finally {
        progress.mockRestore();
        write.mockRestore();
      }
    },
  );

  it.each([true, false])(
    'keeps workspace-evals progress quiet for JSON or pipes (json=%s)',
    async (json) => {
      const envelope = {
        page: 1,
        page_size: 50,
        total: 0,
        items: [],
        workspace: { workspace_id: IDS.workspace, name: 'Imported from OpenAI' },
      };
      const progress = vi.spyOn(progressOutput, 'createProgressReporter');
      const { executor, stdout, stderr } = runtime(
        vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(envelope)),
        json,
      );
      try {
        await executor.execute(
          { kind: 'external-import', input: { operation: 'evals', workspaceId: IDS.workspace } },
          { json, debug: false },
        );
        expect(progress).toHaveBeenCalledWith(
          expect.objectContaining({ label: 'Imported evaluations', enabled: false }),
        );
        expect(stderr.value).toBe('');
        if (json) expect(JSON.parse(stdout.value)).toEqual(envelope);
      } finally {
        progress.mockRestore();
      }
    },
  );

  it.each(['success', 'failure', 'cancelled'] as const)(
    'clears detail loading before %s completes',
    async (outcome) => {
      const controller = new AbortController();
      const phases: string[] = [];
      const update = vi.fn((message: string) => {
        phases.push(message);
      });
      const stop = vi.fn(() => {
        phases.push('stopped');
      });
      const progress = vi
        .spyOn(progressOutput, 'createProgressReporter')
        .mockReturnValue({ update, stop, reportStatus: vi.fn() });
      const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(() => {
        phases.push('request');
        if (outcome === 'cancelled') controller.abort();
        return Promise.resolve(
          outcome === 'failure'
            ? jsonResponse({ code: 'NO_KEY' })
            : jsonResponse({
                eval: IMPORTED_EVAL,
                runs: [],
                results: { page: 1, page_size: 50, total: 0, items: [] },
              }),
        );
      });
      const { executor, stdout } = runtime(
        fetchImplementation,
        true,
        vi.fn().mockResolvedValue(false),
        controller.signal,
      );
      const write = vi.spyOn(stdout, 'write').mockImplementation((chunk: string) => {
        phases.push('output');
        stdout.value += chunk;
        return true;
      });
      try {
        const execution = executor.execute(
          {
            kind: 'external-import',
            input: { operation: 'show', evaluationId: IDS.evaluation, showOutputs: true },
          },
          { json: false, debug: false },
        );
        if (outcome === 'success') {
          await execution;
          expect(phases).toEqual([
            'Loading evaluation details and run results...',
            'request',
            'stopped',
            'output',
          ]);
        } else {
          await expect(execution).rejects.toMatchObject({
            code: outcome === 'failure' ? 'NO_KEY' : 'REQUEST_ABORTED',
          });
          expect(phases).toEqual([
            'Loading evaluation details and run results...',
            'request',
            'stopped',
          ]);
          expect(stdout.value).toBe('');
        }
        expect(progress).toHaveBeenCalledWith(
          expect.objectContaining({ label: 'Import details', enabled: true }),
        );
        expect(stop).toHaveBeenCalledOnce();
      } finally {
        progress.mockRestore();
        write.mockRestore();
      }
    },
  );

  it.each([true, false])('keeps detail loading quiet for JSON or pipes (json=%s)', async (json) => {
    const envelope = {
      eval: IMPORTED_EVAL,
      runs: [],
      results: { page: 1, page_size: 50, total: 0, items: [] },
      raw_json: { preserved: true },
    };
    const progress = vi.spyOn(progressOutput, 'createProgressReporter');
    const { executor, stdout, stderr } = runtime(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(envelope)),
      json,
    );
    try {
      await executor.execute(
        { kind: 'external-import', input: { operation: 'show', evaluationId: IDS.evaluation } },
        { json, debug: false },
      );
      expect(progress).toHaveBeenCalledWith(
        expect.objectContaining({ label: 'Import details', enabled: false }),
      );
      expect(stderr.value).toBe('');
      if (json) expect(JSON.parse(stdout.value)).toEqual(envelope);
    } finally {
      progress.mockRestore();
    }
  });

  it.each([60, 80, 120, 160])('fits expanded result columns to a %s-column terminal', (width) => {
    const descriptor = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
    Object.defineProperty(process.stdout, 'columns', { configurable: true, value: width });
    try {
      for (const expected of [
        '',
        'An expected answer with enough detail to wrap across several lines',
      ]) {
        const human = renderImport(
          importCommandSchema.parse({
            operation: 'show',
            evaluationId: IDS.evaluation,
            showOutputs: true,
          }),
          {
            eval: IMPORTED_EVAL,
            runs: [],
            results: {
              page: 1,
              page_size: 50,
              total: 1,
              items: [
                {
                  input:
                    'A detailed input request that should use the available terminal width instead of a tiny fixed column',
                  expected,
                  output:
                    'A detailed output response that should wrap within its expanded column without being truncated',
                  passed: true,
                },
              ],
            },
          },
        );
        const plain = safeMultilineTerminalText(human);
        const border = plain.split('\n').find((line) => line.startsWith('\u250c'));
        expect(border?.length).toBe(width - 1);
        const tableLines = plain
          .split('\n')
          .filter((line) => /^[\u250c\u251c\u2514\u2502]/u.test(line));
        expect(tableLines.every((line) => line.length <= width)).toBe(true);
        expect(plain.includes('EXPECTED')).toBe(expected !== '');
        expect(plain).toContain('truncated');
      }
    } finally {
      if (descriptor) Object.defineProperty(process.stdout, 'columns', descriptor);
      else Reflect.deleteProperty(process.stdout, 'columns');
    }
  });

  it('renders nested results.items with pass/fail rows and preserves the full JSON page', async () => {
    const envelope = {
      eval: IMPORTED_EVAL,
      runs: [
        {
          openai_run_id: 'evalrun_nested',
          run_created_at: '2026-10-01',
          model: null,
          passed_count: 2,
          total_count: 3,
        },
      ],
      results: {
        run_id: IDS.run,
        page: 1,
        page_size: 50,
        total: 3,
        items: [
          {
            input: 'Example billing question',
            expected: 'Helpful billing reply',
            output: null,
            passed: true,
            grader_type: 'example_grader',
          },
          {
            input: 'Example order question',
            expected: 'Helpful order reply',
            output: null,
            passed: true,
            grader_type: 'example_grader',
          },
          {
            input: 'Example account question',
            expected: 'Helpful account reply',
            output: null,
            passed: false,
            grader_type: 'example_grader',
          },
        ],
      },
      raw_json: { testing_criteria: [] },
    };
    for (const json of [false, true]) {
      const { executor, stdout } = runtime(
        vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(envelope)),
      );
      await executor.execute(
        { kind: 'external-import', input: { operation: 'show', evaluationId: IDS.evaluation } },
        { json, debug: false },
      );
      if (json) expect(JSON.parse(stdout.value)).toEqual(envelope);
      else {
        expect(stdout.value).toContain('\u2713 pass  Example billing question');
        expect(stdout.value).toContain('\u2713 pass  Example order question');
        expect(stdout.value).toContain('\u2717 fail  Example account question');
        expect(stdout.value).toContain('Showing 1-3 of 3 results.');
        expect(stdout.value).not.toContain('No results on this page.');
      }
    }
  });

  it('uses nested result pagination and expands null outputs without losing expected values', () => {
    const command = importCommandSchema.parse({
      operation: 'show',
      evaluationId: IDS.evaluation,
      showOutputs: true,
      page: 1,
      size: 50,
    });
    const envelope = {
      eval: IMPORTED_EVAL,
      runs: [],
      page: 1,
      page_size: 50,
      results: {
        run_id: IDS.run,
        page: 2,
        page_size: 1,
        total: 3,
        items: [
          { input: 'Example request', expected: 'Expected response', output: null, passed: true },
        ],
      },
    };
    const human = renderImport(command, envelope);
    expect(human).toContain('EXPECTED');
    expect(human).toContain('Expected');
    expect(human).toContain('\u2014');
    expect(human).toContain('Showing 2-2 of 3 results. --page 3 for more.');
    expect(human).toContain('Page 2; size 1.');
    expect(
      renderImport(command, {
        ...envelope,
        results: {
          ...envelope.results,
          items: [{ input: 'Example request', expected: '', output: null, passed: true }],
        },
      }),
    ).not.toContain('EXPECTED');
    expect(
      renderImport(command, {
        ...envelope,
        results: { ...envelope.results, items: [], total: 0, page: 1 },
      }),
    ).toContain('No results on this page.');
  });

  it.each(['eval_example_not_a_run', '../invalid', ''])(
    'rejects an invalid --run value with specific guidance: %s',
    async (run) => {
      const fetchImplementation = vi.fn<typeof fetch>();
      const { executor } = runtime(fetchImplementation);
      await expect(
        executor.execute(
          {
            kind: 'external-import',
            input: { operation: 'show', evaluationId: IDS.evaluation, run },
          },
          { json: false, debug: false },
        ),
      ).rejects.toMatchObject({ code: 'INVALID_IMPORT_RUN_ID', exitCode: 2 });
      expect(fetchImplementation).not.toHaveBeenCalled();
      expect(hintForError({ kind: 'usage', code: 'INVALID_IMPORT_RUN_ID' })).toContain(
        'runs[].run_id',
      );
    },
  );
  it('accepts a valid Plumloom run UUID', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        eval: IMPORTED_EVAL,
        runs: [],
        results: [],
      }),
    );

    const { executor } = runtime(fetchImplementation);

    await executor.execute(
      {
        kind: 'external-import',
        input: {
          operation: 'show',
          evaluationId: IDS.evaluation,
          run: IDS.run,
        },
      },
      { json: false, debug: false },
    );

    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it('shows loading before importing text-file IDs and advances between batches', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'autoeval-import-progress-'));
    const filename = join(directory, 'ids.txt');
    const ids = Array.from({ length: 26 }, (_, index) => `eval_progress${index}`);
    const phases: string[] = [];
    const update = vi.fn((message: string) => {
      phases.push(message);
    });
    const stop = vi.fn(() => {
      phases.push('stopped');
    });
    const progress = vi
      .spyOn(progressOutput, 'createProgressReporter')
      .mockReturnValue({ update, stop, reportStatus: vi.fn() });
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(() => {
      phases.push('request');
      return Promise.resolve(jsonResponse(EMPTY_BATCH));
    });
    const { executor, stdout, stderr } = runtime(fetchImplementation, true);
    try {
      await writeFile(filename, [...ids, ids[0]].join('\r\n'));
      await executor.execute(
        { kind: 'external-import', input: { operation: 'run' }, inputFile: filename },
        { json: false, debug: false },
      );
      expect(progress).toHaveBeenCalledWith(
        expect.objectContaining({ label: 'Import run', enabled: true }),
      );
      expect(update.mock.calls.map(([message]) => message)).toEqual([
        'Importing 26 evaluation(s), batch 1/2...',
        'Importing batch 2/2...',
      ]);
      expect(phases).toEqual([
        'Importing 26 evaluation(s), batch 1/2...',
        'request',
        'stopped',
        'Importing batch 2/2...',
        'request',
        'stopped',
        'stopped',
      ]);
      expect(fetchImplementation).toHaveBeenCalledTimes(2);
      expect(stderr.value).toContain('Batch 1/2:');
      expect(stderr.value).toContain('Batch 2/2:');
      expect(stdout.value).toContain('Imported 0, skipped 0, failed 0.');
    } finally {
      progress.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each(['failure', 'cancelled'] as const)(
    'clears import-run loading on %s without printing results',
    async (outcome) => {
      const controller = new AbortController();
      const update = vi.fn();
      const stop = vi.fn();
      const progress = vi
        .spyOn(progressOutput, 'createProgressReporter')
        .mockReturnValue({ update, stop, reportStatus: vi.fn() });
      const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(() => {
        if (outcome === 'cancelled') controller.abort();
        return Promise.resolve(
          outcome === 'failure' ? jsonResponse({ code: 'NO_KEY' }) : jsonResponse(EMPTY_BATCH),
        );
      });
      const { executor, stdout } = runtime(
        fetchImplementation,
        true,
        vi.fn().mockResolvedValue(false),
        controller.signal,
      );
      try {
        await expect(
          executor.execute(
            { kind: 'external-import', input: { operation: 'run', evalIds: ['eval_progress'] } },
            { json: false, debug: false },
          ),
        ).rejects.toMatchObject({ code: outcome === 'failure' ? 'NO_KEY' : 'REQUEST_ABORTED' });
        expect(update).toHaveBeenCalledWith('Importing 1 evaluation(s), batch 1/1...');
        expect(stop).toHaveBeenCalledOnce();
        expect(stdout.value).toBe('');
        expect(fetchImplementation).toHaveBeenCalledOnce();
      } finally {
        progress.mockRestore();
      }
    },
  );

  it.each([true, false])(
    'keeps import-run progress disabled for JSON or pipes (json=%s)',
    async (json) => {
      const progress = vi.spyOn(progressOutput, 'createProgressReporter');
      const { executor, stdout, stderr } = runtime(
        vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(EMPTY_BATCH)),
        json,
      );
      try {
        await executor.execute(
          { kind: 'external-import', input: { operation: 'run', evalIds: ['eval_progress'] } },
          { json, debug: false },
        );
        expect(progress).toHaveBeenCalledWith(
          expect.objectContaining({ label: 'Import run', enabled: false }),
        );
        if (json) {
          expect(JSON.parse(stdout.value)).toMatchObject(EMPTY_BATCH);
          expect(stderr.value).toBe('');
        } else {
          expect(stderr.value).toBe('Batch 1/1: imported 0, skipped 0, failed 0.\n');
        }
      } finally {
        progress.mockRestore();
      }
    },
  );

  it('keeps --all-new discovery visibly loading when there are no new evaluations', async () => {
    const update = vi.fn();
    const stop = vi.fn();
    const progress = vi
      .spyOn(progressOutput, 'createProgressReporter')
      .mockReturnValue({ update, stop, reportStatus: vi.fn() });
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ items: [], total: 0, page: 1, page_size: 100 }));
    const { executor, stdout } = runtime(fetchImplementation, true);
    try {
      await executor.execute(
        { kind: 'external-import', input: { operation: 'run', allNew: true } },
        { json: false, debug: false },
      );
      expect(update).toHaveBeenCalledWith('Finding and importing new OpenAI evaluations...');
      expect(stop).toHaveBeenCalledOnce();
      expect(fetchImplementation).toHaveBeenCalledOnce();
      expect(fetchImplementation.mock.calls[0]?.[1]?.method).toBe('GET');
      expect(stdout.value).toContain('Imported 0, skipped 0, failed 0.');
    } finally {
      progress.mockRestore();
    }
  });

  it.each(['success', 'failure', 'cancelled'] as const)(
    'clears review progress before %s completes',
    async (outcome) => {
      const phases: string[] = [];
      const controller = new AbortController();
      const update = vi.fn(() => {
        phases.push('loading');
      });
      const stop = vi.fn(() => {
        phases.push('stopped');
      });
      const progress = vi
        .spyOn(progressOutput, 'createProgressReporter')
        .mockReturnValue({ update, stop, reportStatus: vi.fn() });
      const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(() => {
        phases.push('request');
        if (outcome === 'cancelled') controller.abort();
        return Promise.resolve(
          outcome === 'failure'
            ? jsonResponse({ code: 'IMPORT_CACHE_COLD' }, 409)
            : jsonResponse({ items: [], total: 0, page: 1, page_size: 50 }),
        );
      });
      const { executor, stdout } = runtime(
        fetchImplementation,
        true,
        vi.fn().mockResolvedValue(false),
        controller.signal,
      );
      const write = vi.spyOn(stdout, 'write').mockImplementation((chunk: string) => {
        phases.push('output');
        stdout.value += chunk;
        return true;
      });
      try {
        const execution = executor.execute(
          { kind: 'external-import', input: { operation: 'review' } },
          { json: false, debug: false },
        );
        if (outcome === 'success') {
          await execution;
          expect(phases).toEqual(['loading', 'request', 'stopped', 'output']);
          expect(stdout.value).toContain('No OpenAI evaluations found.');
        } else {
          await expect(execution).rejects.toMatchObject({
            code: outcome === 'failure' ? 'IMPORT_CACHE_COLD' : 'REQUEST_ABORTED',
          });
          expect(phases).toEqual(['loading', 'request', 'stopped']);
          expect(stdout.value).toBe('');
        }
        expect(progress).toHaveBeenCalledWith(
          expect.objectContaining({ label: 'Import review', enabled: true }),
        );
        expect(update).toHaveBeenCalledWith('Loading cached OpenAI evaluations...');
        expect(stop).toHaveBeenCalledOnce();
      } finally {
        progress.mockRestore();
        write.mockRestore();
      }
    },
  );

  it.each([true, false])(
    'keeps progress disabled for JSON or noninteractive review (json=%s)',
    async (json) => {
      const progress = vi.spyOn(progressOutput, 'createProgressReporter');
      const { executor, stdout, stderr } = runtime(
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(jsonResponse({ items: [], total: 0, page: 1, page_size: 50 })),
        json,
      );
      try {
        await executor.execute(
          { kind: 'external-import', input: { operation: 'review' } },
          { json, debug: false },
        );
        expect(progress).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
        expect(stderr.value).toBe('');
        if (json) expect(JSON.parse(stdout.value)).toMatchObject({ items: [], total: 0 });
        else expect(stdout.value).toContain('No OpenAI evaluations found.');
      } finally {
        progress.mockRestore();
      }
    },
  );

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
    const response = {
      key_present: keyPresent,
      evals_access: access,
      cache_status: 'warm',
    };

    const human = renderImport(command, response);
    expect(human).toContain(keyPresent ? 'Cache:       Warm' : 'Cache:       Cold');
    expect(human).not.toContain('Evals access:');
    expect(human).not.toContain('Cached list:');

    expect(human).toContain(
      keyPresent
        ? "Action:      Run 'autoeval import connect' to verify live OpenAI Evals access."
        : "Action:      Add your OpenAI key in Plumloom (Settings → AI Providers & Models), then run 'autoeval import connect'.",
    );

    expect(importOutcomeExitCode(command, response)).toBe(keyPresent ? 0 : 3);
  });

  it.each([
    [{ code: 'KEY_PRESENT' }, true, 0],
    [{ error_code: 'KEY_PRESENT' }, true, 0],
    [{ detail: { code: 'KEY_PRESENT' } }, true, 0],
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
      expect(human).not.toContain('Evals access:');
      expect(human).not.toContain('evals_access');
      expect(human).not.toContain('Cached list:');

      if (keyPresent) {
        expect(human).toContain('Configured (unverified)');
        expect(human).toContain(
          "Run 'autoeval import connect' to verify live OpenAI Evals access.",
        );
      } else {
        expect(human).toContain('API Key:     Missing');
        expect(human).toContain(
          "Add your OpenAI key in Plumloom (Settings → AI Providers & Models), then run 'autoeval import connect'.",
        );
      }
      expect(externalImport).toHaveBeenCalledOnce();
    },
  );

  it.each([
    [true, true, 'KEY_PRESENT', 'not_ready', 'warm', 0],
    [true, false, 'KEY_PRESENT', 'not_ready', 'cold', 0],
    [false, false, 'NO_KEY', 'not_ready', 'cold', 3],
    [true, true, 'EVALS_FORBIDDEN', 'forbidden', 'warm', 0],
    [true, true, 'OPENAI_UNREACHABLE', 'unreachable', 'warm', 0],
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
      expect(human).not.toContain('Evals access:');
      expect(human).not.toContain('evals_access');
      expect(human).not.toContain('Cached list:');
      expect(human).toContain(keyPresent ? 'Configured (unverified)' : 'API Key:     Missing');
      expect(human).toContain(
        keyPresent
          ? "Run 'autoeval import connect' to verify live OpenAI Evals access."
          : "Add your OpenAI key in Plumloom (Settings → AI Providers & Models), then run 'autoeval import connect'.",
      );
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
    expect(importOutcomeExitCode(command, response)).toBe(0);
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
    const human = renderImport(command, response);
    expect(human).toContain('API Key:     Configured (unverified)');
    expect(human).toContain(
      "Action:      Run 'autoeval import connect' to verify live OpenAI Evals access.",
    );
    expect(human).not.toContain('Evals access:');
    expect(human).not.toContain('present (...test)');
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
      evals_access: 'not_ready',
      cache_status: 'cold',
    });
    expect(human).toContain('API Key:     Configured (unverified)');
    expect(human).toContain('Cache:       Warm');
    expect(human).toContain(
      "Action:      Run 'autoeval import connect' to verify live OpenAI Evals access.",
    );
    expect(human).not.toContain('Evals access:');
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
    [{ key_present: true, evals_access: 'ready', cache_status: 'warm' }, 0],
    [{ key_present: false, evals_access: null, cache_status: 'cold' }, 3],
    [{ key_present: true, evals_access: 'forbidden', cache_status: 'cold' }, 0],
    [{ key_present: true, evals_access: 'unreachable', cache_status: 'cold' }, 0],
  ])('returns the documented status exit code', (status, expected) => {
    expect(importOutcomeExitCode(importCommandSchema.parse({ operation: 'status' }), status)).toBe(
      expected,
    );
  });

  it('preserves raw detail in JSON, redacts secrets, and emits no human text', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        eval: IMPORTED_EVAL,
        runs: [],
        results: [],
        raw_json: { api_key: 'synthetic-provider-credential', input: 'Record', trace: VALID_KEY },
      }),
    );
    const { executor, stdout, stderr } = runtime(fetchImplementation);
    await executor.execute(
      { kind: 'external-import', input: { operation: 'show', evaluationId: IDS.evaluation } },
      { json: true, debug: false },
    );
    expect(JSON.parse(stdout.value)).toEqual({
      eval: IMPORTED_EVAL,
      runs: [],
      results: [],
      raw_json: { api_key: '[REDACTED]', input: 'Record', trace: 'pl_sk_[REDACTED]' },
    });
    expect(stderr.value).toBe('');
  });

  it('preserves the full insights envelope and grader navigation IDs in JSON', async () => {
    const envelope = {
      derived_by: 'Plumloom',
      workspace_name: 'Imported from OpenAI',
      totals: { evals: 2, runs: 3, results: 4, pass_rate: null, last_run: '2026-10-02T12:00:00Z' },
      migration_readiness: {
        ready: 1,
        total: 2,
        evals: [
          { eval_id: IDS.evaluation, name: 'Ready rubric', ready: true, reason: null },
          { eval_id: IDS.run, name: 'Stale rubric', ready: false, reason: 'no recent run' },
        ],
      },
      going_stale: [{ eval_id: IDS.run, name: 'Stale rubric', last_run_at: null }],
      pass_rate_trend: [
        {
          eval_id: IDS.evaluation,
          name: 'Ready rubric',
          points: [
            {
              openai_run_id: 'evalrun_new',
              run_created_at: '2026-10-02T12:00:00Z',
              pass_rate: 0.96,
            },
            {
              openai_run_id: 'evalrun_old',
              run_created_at: '2026-10-01T12:00:00Z',
              pass_rate: 0.95,
            },
          ],
        },
      ],
      flaky_graders: [
        {
          grader_type: 'score_model',
          swing: 0.3,
          flagged: true,
          evals: [{ eval_id: IDS.evaluation }],
        },
        { grader_type: 'string_check', swing: 0.01, flagged: false, evals: [{ eval_id: IDS.run }] },
      ],
    };
    const { executor, stdout } = runtime(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(envelope)),
    );
    await executor.execute(
      { kind: 'external-import', input: { operation: 'insights', workspaceId: IDS.workspace } },
      { json: true, debug: false },
    );
    expect(JSON.parse(stdout.value)).toEqual(envelope);
    const human = renderImport(
      importCommandSchema.parse({ operation: 'insights', workspaceId: IDS.workspace }),
      envelope,
    );
    expect(human).not.toContain('Pass rate 0.0%');
    for (const expected of [
      'Derived by Plumloom',
      'Last run 2026-10-02',
      'Migration readiness   1 of 2 ready',
      '\u2713 Ready rubric',
      '\u2717 Stale rubric',
      'swing 30.0 pts',
    ])
      expect(human).toContain(expected);
    expect(human).toMatch(/Stale rubric\s+no recent run/u);
    expect(human).toMatch(/Ready rubric\s+95\.0% \u2192 96\.0%/u);
    expect(human).toMatch(/\u2022 Stale rubric\s+last run \u2014/u);
    expect(human).toContain(`Evals: ${IDS.evaluation}`);
    expect(human).not.toContain('string_check');
    expect(human).toContain('\n\nTotals\n  Evals 2');
    expect(human).toContain('\n\nMigration readiness');
    expect(human).toContain('\n\nGoing stale');
    expect(human).toContain('\n\nPass-rate trend');
    expect(human).toContain('\n\nFlaky graders');
  });

  it('does not delete when confirmation is declined', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ eval: IMPORTED_EVAL, runs: [], results: [] }));
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
      .mockResolvedValueOnce(jsonResponse({ eval: IMPORTED_EVAL, runs: [], results: [] }))
      .mockResolvedValueOnce(jsonResponse({ deleted: true, eval_id: IDS.evaluation }));
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

  it.each([undefined, null, {}, { deleted: false }, { deleted: 'true' }, { removed: true }])(
    'does not report deletion success for invalid acknowledgment %j',
    async (response) => {
      const fetchImplementation = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          response === undefined ? new Response(null, { status: 204 }) : jsonResponse(response),
        );
      const { executor, stdout } = runtime(fetchImplementation);
      await expect(
        executor.execute(
          {
            kind: 'external-import',
            input: { operation: 'remove', evaluationId: IDS.evaluation, yes: true },
          },
          { json: false, debug: false },
        ),
      ).rejects.toMatchObject({ code: 'INVALID_IMPORT_RESPONSE' });
      expect(stdout.value).toBe('');
      expect(fetchImplementation).toHaveBeenCalledOnce();
    },
  );

  it('rejects a legacy detail envelope before requesting deletion confirmation', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ evaluation: IMPORTED_EVAL, runs: [], results: [] }));
    const { executor, confirm } = runtime(fetchImplementation, true);
    await expect(
      executor.execute(
        { kind: 'external-import', input: { operation: 'remove', evaluationId: IDS.evaluation } },
        { json: false, debug: false },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_IMPORT_RESPONSE' });
    expect(confirm).not.toHaveBeenCalled();
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it('shows two result columns when expected is blank and selects the newest run', () => {
    const human = renderImport(
      importCommandSchema.parse({
        operation: 'show',
        evaluationId: IDS.evaluation,
        showOutputs: true,
      }),
      {
        eval: IMPORTED_EVAL,
        page: 1,
        page_size: 50,
        runs: [
          {
            run_id: '55555555-5555-4555-8555-555555555551',
            openai_run_id: 'evalrun_old',
            run_created_at: '2026-01-01T12:00:00Z',
            model: 'example-old-model',
            passed_count: 1,
            total_count: 3,
          },
          {
            run_id: '55555555-5555-4555-8555-555555555552',
            openai_run_id: 'evalrun_new',
            run_created_at: '2026-10-01T12:00:00Z',
            model: 'example-new-model',
            passed_count: 2,
            total_count: 2,
          },
        ],
        results: [{ input: 'NEW', expected: '', output: 'New output', passed: true }],
        raw_json: { testing_criteria: [] },
      },
    );
    expect(human).toContain('Results (run 2)');
    expect(human).toContain('New output');
    expect(human).not.toContain('EXPECTED');
    expect(human).toContain('Imported eval');
    expect(human).toContain('Source: OpenAI (eval_example_imported)');
    expect(human).toContain('Imported: 2026-10-15');
    expect(human).toContain(
      'run 2   example-new-model   2026-10-01   2/2 passed   55555555-5555-4555-8555-555555555552',
    );
    expect(human).toContain(
      'run 1   example-old-model   2026-01-01   1/3 passed   55555555-5555-4555-8555-555555555551',
    );
    expect(human.indexOf('run 2')).toBeLessThan(human.indexOf('run 1'));
    expect(human).toContain('\u2713 pass');
    expect(human).toContain('Hint: Use --json for the full record, including raw_json.');
  });

  it.each([
    [[], 'no runs available'],
    [[{ run_created_at: '2026-10-01', pass_rate: null }], '\u2014 (single run)'],
    [[{ run_created_at: '2026-10-01', pass_rate: 0 }], '0.0% (single run)'],
    [
      [
        { run_created_at: '2026-10-01', pass_rate: null },
        { run_created_at: '2026-10-02', pass_rate: 0.5 },
      ],
      '\u2014 \u2192 50.0%',
    ],
  ])('renders empty, single, zero, and null trend points: %j', (points, expected) => {
    const human = renderImport(
      importCommandSchema.parse({ operation: 'insights', workspaceId: IDS.workspace }),
      {
        derived_by: 'Plumloom',
        totals: { evals: 1, runs: 1, results: 0, pass_rate: null, last_run: null },
        migration_readiness: { ready: 0, total: 1, evals: [] },
        going_stale: [],
        flaky_graders: [],
        pass_rate_trend: [{ eval_id: IDS.evaluation, name: 'Trend rubric', points }],
      },
    );
    expect(human).toContain(`Trend rubric`.padEnd(36) + `  ${expected}`);
    expect(human).toContain('Last run \u2014');
    expect(human).toContain('Migration readiness   0 of 1 ready');
  });

  it.each([
    undefined,
    null,
    [],
    [
      {
        grader_type: 'score_model',
        swing: 0.01,
        flagged: false,
        evals: [{ eval_id: IDS.evaluation }],
      },
    ],
    [
      {
        grader_type: 'score_model',
        swing: 0.9,
        flagged: false,
        evals: [{ eval_id: IDS.evaluation }],
      },
    ],
  ])('shows none flagged when the backend reports no flagged graders: %j', (graders) => {
    const human = renderImport(
      importCommandSchema.parse({ operation: 'insights', workspaceId: IDS.workspace }),
      {
        derived_by: 'Plumloom',
        totals: { pass_rate: null },
        migration_readiness: { ready: 0, total: 0, evals: [] },
        flaky_graders: graders,
      },
    );
    expect(human).toContain('Flaky graders (swing \u2265 25pts)\n  none flagged');
    expect(human).not.toContain('score_model');
    expect(human).toContain('Pass rate \u2014');
    expect(human).not.toContain('Pass rate 0.0%');
  });

  it('sends exact result-page query parameters for an explicitly selected run', async () => {
    const envelope = {
      eval: IMPORTED_EVAL,
      runs: [
        {
          run_id: IDS.run,
          openai_run_id: 'evalrun_selected',
          run_created_at: '2026-10-01T12:00:00Z',
          model: 'example-model',
          passed_count: 0,
          total_count: 1,
        },
      ],
      results: [
        {
          input: 'Example input',
          expected: 'Expected answer',
          output: 'Actual answer',
          passed: false,
        },
      ],
      page: 2,
      page_size: 10,
      total: 11,
      raw_json: { testing_criteria: [] },
    };
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(envelope));
    const { executor, stdout } = runtime(fetchImplementation);
    await executor.execute(
      {
        kind: 'external-import',
        input: {
          operation: 'show',
          evaluationId: IDS.evaluation,
          run: IDS.run,
          page: 2,
          size: 10,
          showOutputs: true,
        },
      },
      { json: false, debug: false },
    );
    expect(fetchImplementation.mock.calls[0]?.[0]).toEqual(
      new URL(
        `/api/v1/import/external/evals/evaluations/${IDS.evaluation}?run_id=${IDS.run}&page=2&page_size=10`,
        loadConfiguration().apiBaseUrl,
      ),
    );
    expect(stdout.value).toContain('Results (run 1)');
    expect(stdout.value).toContain('EXPECTED');
    expect(stdout.value).toContain('Actual answer');
    expect(stdout.value).toContain('Page 2; size 10.');
  });

  it.each([undefined, null, '', '   '])('shows unknown for an unavailable model: %j', (model) => {
    const human = renderImport(
      importCommandSchema.parse({ operation: 'show', evaluationId: IDS.evaluation }),
      {
        eval: IMPORTED_EVAL,
        runs: [
          {
            run_id: IDS.run,
            openai_run_id: 'evalrun_example',
            run_created_at: '2026-10-01',
            model,
            passed_count: 2,
            total_count: 3,
          },
        ],
        results: [],
      },
    );
    expect(human).toContain(`run 1   unknown   2026-10-01   2/3 passed   ${IDS.run}`);
    expect(human).toContain('\n\nGraders\n  None reported.\n\nRun history\n');
    expect(human).toContain('\n\nResults (run 1)  [--show-outputs for input/expected/output]');
    expect(human).toContain('No results on this page.');
  });

  it('shows available graders and a numbered explicitly selected older run', () => {
    const human = renderImport(
      importCommandSchema.parse({
        operation: 'show',
        evaluationId: IDS.evaluation,
        run: '55555555-5555-4555-8555-555555555551',
      }),
      {
        eval: IMPORTED_EVAL,
        raw_json: { testing_criteria: [{ name: 'rubric_judge', type: 'score_model' }] },
        runs: [
          {
            run_id: '55555555-5555-4555-8555-555555555551',
            openai_run_id: 'evalrun_old',
            run_created_at: '2026-01-01',
            model: 'example-model',
            passed_count: 1,
            total_count: 1,
          },
          {
            run_id: '55555555-5555-4555-8555-555555555552',
            openai_run_id: 'evalrun_new',
            run_created_at: '2026-10-01',
            model: 'example-model',
            passed_count: 2,
            total_count: 2,
          },
        ],
        results: [{ passed: false, input: 'Example failed case' }],
      },
    );
    expect(human).toContain('rubric_judge (score_model)');
    expect(human).toContain('Results (run 1)');
    expect(human).toContain('\u2717 fail  Example failed case');
    expect(human).not.toContain('None reported.');
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

  it('preserves the deletion acknowledgment and handles an empty disconnect response', async () => {
    const api = createApi({
      externalImport: vi
        .fn<AutoevalApi['externalImport']>()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ deleted: true, eval_id: IDS.evaluation }),
    });
    await expect(executeImport({ api }, { operation: 'disconnect' })).resolves.toEqual({
      disconnected: true,
    });
    await expect(
      executeImport({ api }, { operation: 'remove', evaluationId: IDS.evaluation, yes: true }),
    ).resolves.toEqual({ deleted: true, eval_id: IDS.evaluation });
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
