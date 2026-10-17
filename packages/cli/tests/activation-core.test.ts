import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RuntimeCommandExecutor } from '../src/commands/executor.js';
import type { CredentialStore, SecretPrompt } from '../src/auth/credential-store.js';
import { loadConfiguration } from '../src/config.js';
import { FakeClock, IDS, VALID_KEY } from './helpers.js';

const PRIMARY_MODEL_ID = '77777777-7777-4777-8777-777777777777';

class MemoryStream {
  value = '';

  constructor(readonly isTTY = false) {}

  write(chunk: string): boolean {
    this.value += chunk;
    return true;
  }

  cursorTo(): boolean {
    return true;
  }

  moveCursor(): boolean {
    return true;
  }

  clearLine(): boolean {
    return true;
  }
}

class MemoryCredentialStore implements CredentialStore {
  constructor(private key?: string) {}

  read(): Promise<string | undefined> {
    return Promise.resolve(this.key);
  }

  write(apiKey: string): Promise<void> {
    this.key = apiKey;
    return Promise.resolve();
  }

  delete(): Promise<boolean> {
    const had = this.key !== undefined;
    this.key = undefined;
    return Promise.resolve(had);
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

/** A fetch mock for activation flows using a conversation evaluation. */
function conversationBackend(
  options: {
    workspaces?: readonly unknown[];
    models?: readonly unknown[];
    contextType?: 'conversation' | 'agent_trace';
    failResults?: boolean;
    failRunStart?: boolean;
  } = {},
): typeof fetch {
  const workspaces = options.workspaces ?? [
    { workspace_id: IDS.workspace, name: 'Activation workspace', eval_count: 0 },
  ];
  return vi.fn<typeof fetch>((inputArg, init) => {
    const url = requestUrl(inputArg);
    const method = init?.method ?? 'GET';
    const path = url.pathname;

    if (method === 'GET' && path.endsWith('/auth/me')) {
      return Promise.resolve(
        jsonResponse({ id: 'user-1', user_sys_id: 'system-1', email: 'user@example.test' }),
      );
    }
    if (method === 'GET' && path === '/api/v1/workspaces') {
      return Promise.resolve(
        jsonResponse({
          items: workspaces,
          total: workspaces.length,
          page: 1,
          size: 100,
          total_pages: 1,
        }),
      );
    }
    if (method === 'GET' && path === `/api/v1/workspaces/${IDS.workspace}`) {
      return Promise.resolve(
        jsonResponse({
          workspace_id: IDS.workspace,
          name: 'Activation workspace',
          eval_count: 0,
        }),
      );
    }
    if (method === 'GET' && path.endsWith('/byok/models/enabled')) {
      return Promise.resolve(
        jsonResponse({
          models: options.models ?? [
            {
              supported_model_id: IDS.model,
              provider_model_id: 'judge-model',
              provider: 'test',
              display_name: 'Judge model',
            },
          ],
        }),
      );
    }
    if (method === 'POST' && path.endsWith('/evaluations/draft')) {
      return Promise.resolve(jsonResponse({ evaluation_id: IDS.evaluation }));
    }
    if (method === 'POST' && path.endsWith('/evaltools/create')) {
      return Promise.resolve(
        jsonResponse({
          eval_id: IDS.evaluation,
          eval_name: 'Support bot answer quality',
          workspace_id: IDS.workspace,
        }),
      );
    }
    if (method === 'POST' && path.endsWith('/methodology-versions')) {
      return Promise.resolve(jsonResponse({ methodology_version_id: IDS.methodology }));
    }
    if (method === 'POST' && path.endsWith('/config-versions')) {
      return Promise.resolve(jsonResponse({ config_version_id: IDS.config }));
    }
    if (method === 'POST' && path.endsWith('/runs')) {
      if (options.failRunStart) {
        return Promise.resolve(jsonResponse({ message: 'run unavailable' }, 500));
      }
      return Promise.resolve(
        jsonResponse({
          runId: IDS.run,
          status: 'PENDING',
          using: { methodologyVersionId: IDS.methodology, configVersionId: IDS.config },
        }),
      );
    }
    if (method === 'GET' && path.endsWith('/status/stream')) {
      return Promise.resolve(
        new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      );
    }
    if (method === 'GET' && path.endsWith('/status')) {
      return Promise.resolve(
        jsonResponse({
          run_id: IDS.run,
          evaluation_id: IDS.evaluation,
          evaluationState: 'COMPLETED',
          progress: { percentage: 100, runsCompleted: 1, totalRuns: 1 },
        }),
      );
    }
    if (method === 'GET' && path.endsWith('/versions_v2')) {
      return Promise.resolve(
        jsonResponse({
          evaluationId: IDS.evaluation,
          context_type: options.contextType ?? 'conversation',
          evaluationVersions: {
            currentVersion: 1,
            items: [
              { version: 1, methodologyId: IDS.methodology, configId: IDS.config, isCurrent: true },
            ],
          },
        }),
      );
    }
    if (method === 'GET' && path.endsWith('/conversation_results')) {
      if (options.failResults) {
        return Promise.resolve(jsonResponse({ message: 'results unavailable' }, 500));
      }
      return Promise.resolve(jsonResponse({ overall: 4.2, per_metric: {} }));
    }
    if (method === 'GET' && path.endsWith('/agent_trace_results')) {
      if (options.failResults) {
        return Promise.resolve(jsonResponse({ message: 'results unavailable' }, 500));
      }
      return Promise.resolve(jsonResponse({ outcome: { achieved: true }, overall: 5 }));
    }
    if (method === 'GET' && path.endsWith('/trajectory')) {
      return Promise.resolve(jsonResponse({ trace: { resourceSpans: [] } }));
    }
    throw new Error(`Unexpected mocked request: ${method} ${path}`);
  });
}

type Harness = {
  executor: RuntimeCommandExecutor;
  stdout: MemoryStream;
  stderr: MemoryStream;
  settingsPath: string;
  workingDirectory: string;
  store: CredentialStore;
};

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'autoeval-activation-'));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function harness(
  overrides: {
    fetchImplementation?: typeof fetch;
    environment?: Record<string, string | undefined>;
    store?: CredentialStore;
    stdin?: { isTTY?: boolean };
    stderrTTY?: boolean;
    prompt?: SecretPrompt;
  } = {},
): Harness {
  const stdout = new MemoryStream();
  const stderr = new MemoryStream(overrides.stderrTTY ?? false);
  const settingsPath = join(scratch, 'config', 'settings.json');
  const workingDirectory = join(scratch, 'project');
  const store = overrides.store ?? new MemoryCredentialStore();
  const executor = new RuntimeCommandExecutor({
    configuration: loadConfiguration(),
    environment: overrides.environment ?? { AUTOEVAL_API_KEY: VALID_KEY },
    store,
    clock: new FakeClock(),
    now: () => new Date('2026-10-16T00:00:00.000Z'),
    ...(overrides.fetchImplementation
      ? { fetchImplementation: overrides.fetchImplementation }
      : {}),
    ...(overrides.prompt ? { prompt: overrides.prompt } : {}),
    stdout,
    stderr,
    stdin: overrides.stdin ?? { isTTY: false },
    settingsFilePath: settingsPath,
    workingDirectory,
  });
  return { executor, stdout, stderr, settingsPath, workingDirectory, store };
}

describe('config command group', () => {
  it('saves, shows, and clears non-secret defaults', async () => {
    const { executor, stdout, settingsPath } = harness();

    await executor.execute(
      { kind: 'config-set-workspace', workspaceId: IDS.workspace },
      { json: false, debug: false },
    );
    const saved = JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, unknown>;
    expect(saved).toEqual({ version: 1, defaultWorkspaceId: IDS.workspace });
    expect((await stat(settingsPath)).mode & 0o777).toBe(0o600);

    stdout.value = '';
    await executor.execute({ kind: 'config-show' }, { json: false, debug: false });
    expect(stdout.value).toContain(IDS.workspace);
    expect(stdout.value.toLowerCase()).not.toContain('pl_sk_');

    await executor.execute({ kind: 'config-clear' }, { json: false, debug: false });
    await expect(readFile(settingsPath, 'utf8')).rejects.toBeTruthy();
  });

  it('never writes a credential to the settings file', async () => {
    const { executor, settingsPath } = harness();
    await executor.execute(
      { kind: 'config-set-judge-model', modelId: IDS.model },
      { json: false, debug: false },
    );
    const raw = await readFile(settingsPath, 'utf8');
    expect(raw).not.toContain('pl_sk_');
    expect(raw).not.toContain(VALID_KEY);
  });

  it('rejects a credential in every saved field without echoing it', async () => {
    for (const json of [false, true]) {
      const { executor, stdout, stderr, settingsPath } = harness();
      await expect(
        executor.execute(
          { kind: 'config-set-workspace', workspaceId: VALID_KEY },
          { json, debug: true },
        ),
      ).rejects.toMatchObject({ code: 'INVALID_CONFIG_VALUE' });
      expect(stdout.value).not.toContain(VALID_KEY);
      expect(stderr.value).not.toContain(VALID_KEY);
      await expect(readFile(settingsPath, 'utf8')).rejects.toBeTruthy();
    }
  });

  it('ignores malicious existing settings without exposing the credential', async () => {
    for (const json of [false, true]) {
      const { executor, stdout, stderr, settingsPath } = harness();
      await mkdir(join(settingsPath, '..'), { recursive: true });
      await writeFile(
        settingsPath,
        `${JSON.stringify({ version: 1, defaultWorkspaceId: VALID_KEY })}\n`,
        'utf8',
      );
      await executor.execute({ kind: 'config-show' }, { json, debug: true });
      expect(stdout.value).not.toContain(VALID_KEY);
      expect(stderr.value).not.toContain(VALID_KEY);
      if (json) {
        expect(JSON.parse(stdout.value)).toEqual({ version: 1 });
      } else {
        expect(stdout.value).toContain('Default workspace: (not set)');
      }
    }
  });
});

describe('pack commands', () => {
  it('lists the built-in packs without a credential', async () => {
    const { executor, stdout } = harness({ environment: {} });
    await executor.execute({ kind: 'pack-list' }, { json: true, debug: false });
    const packs = JSON.parse(stdout.value) as { name: string }[];
    expect(packs.map((pack) => pack.name).sort()).toEqual([
      'agent-trace',
      'coding-agent',
      'rag-answer-quality',
      'support-bot',
    ]);
  });

  it('installs a pack and refuses to clobber existing files', async () => {
    const { executor, workingDirectory } = harness({ environment: {} });
    await executor.execute(
      { kind: 'pack-add', name: 'support-bot' },
      { json: false, debug: false },
    );
    const manifestPath = join(workingDirectory, 'autoeval', 'support-bot', 'autoeval.suite.yaml');
    await expect(readFile(manifestPath, 'utf8')).resolves.toContain(
      'evals/support-conversation.json',
    );

    await expect(
      executor.execute({ kind: 'pack-add', name: 'support-bot' }, { json: false, debug: false }),
    ).rejects.toMatchObject({ code: 'PACK_FILE_EXISTS' });
  });

  it('reports an unknown pack as PACK_NOT_FOUND', async () => {
    const { executor } = harness({ environment: {} });
    await expect(
      executor.execute({ kind: 'pack-add', name: 'nope' }, { json: false, debug: false }),
    ).rejects.toMatchObject({ code: 'PACK_NOT_FOUND' });
  });

  it('rolls back files it created when an install cannot complete', async () => {
    const { executor, workingDirectory } = harness({ environment: {} });
    const installDir = join(workingDirectory, 'autoeval', 'support-bot');
    await mkdir(installDir, { recursive: true });
    // Pre-create the manifest (written last) so the final write clobbers and the
    // earlier pack files must be rolled back.
    const manifestPath = join(installDir, 'autoeval.suite.yaml');
    await writeFile(manifestPath, 'preexisting', 'utf8');

    await expect(
      executor.execute({ kind: 'pack-add', name: 'support-bot' }, { json: false, debug: false }),
    ).rejects.toMatchObject({ code: 'PACK_FILE_EXISTS' });

    // The pre-existing manifest is untouched; everything this install created is gone.
    expect(await readFile(manifestPath, 'utf8')).toBe('preexisting');
    await expect(readFile(join(installDir, 'pack.yaml'), 'utf8')).rejects.toBeTruthy();
    await expect(
      readFile(join(installDir, 'evals', 'support-conversation.json'), 'utf8'),
    ).rejects.toBeTruthy();
  });
});

describe('autoeval init', () => {
  it('runs a first evaluation and persists defaults with no IDs typed', async () => {
    const { executor, stdout, settingsPath } = harness({
      fetchImplementation: conversationBackend(),
    });

    await executor.execute({ kind: 'init', assumeYes: false }, { json: false, debug: false });

    expect(stdout.value).toContain('Next steps:');
    const saved = JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, unknown>;
    expect(saved).toMatchObject({
      version: 1,
      defaultWorkspaceId: IDS.workspace,
      defaultJudgeModelId: IDS.model,
    });
    expect(saved).not.toHaveProperty('defaultPrimaryModelId');
  });

  it('emits machine output without next-step hints under --json', async () => {
    const { executor, stdout } = harness({ fetchImplementation: conversationBackend() });
    await executor.execute({ kind: 'init', assumeYes: false }, { json: true, debug: false });
    expect(stdout.value).not.toContain('Next steps:');
    const result = JSON.parse(stdout.value) as { completed: number; persistedDefaults: boolean };
    expect(result.completed).toBe(1);
    expect(result.persistedDefaults).toBe(true);
  });

  it('fails with CREDENTIAL_REQUIRED when non-interactive and no key is present', async () => {
    const { executor } = harness({
      environment: {},
      store: new MemoryCredentialStore(undefined),
      fetchImplementation: conversationBackend(),
    });
    await expect(
      executor.execute({ kind: 'init', assumeYes: false }, { json: false, debug: false }),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_REQUIRED' });
  });

  it('with --yes picks the first workspace when several exist', async () => {
    const { executor, settingsPath } = harness({
      fetchImplementation: conversationBackend({
        workspaces: [
          { workspace_id: IDS.workspace, name: 'First', eval_count: 5 },
          { workspace_id: IDS.methodology, name: 'Second', eval_count: 1 },
        ],
      }),
    });
    await executor.execute({ kind: 'init', assumeYes: true }, { json: true, debug: false });
    const saved = JSON.parse(await readFile(settingsPath, 'utf8')) as {
      defaultWorkspaceId: string;
    };
    // selectQuickstartWorkspace orders by evaluation count, so "First" leads.
    expect(saved.defaultWorkspaceId).toBe(IDS.workspace);
  });

  it('surfaces a failed first evaluation, exits non-zero, and does not persist defaults', async () => {
    const { executor, stdout, settingsPath } = harness({
      fetchImplementation: conversationBackend({ failResults: true }),
    });

    await expect(
      executor.execute({ kind: 'init', assumeYes: false }, { json: false, debug: false }),
    ).rejects.toMatchObject({ code: 'INIT_RUN_FAILED', kind: 'run_failed', exitCode: 5 });

    // Truthful messaging: failed next-steps, never the "COMPLETED" success nudge.
    expect(stdout.value).toContain('Fix the app or prompt');
    // Defaults persist only on success.
    await expect(readFile(settingsPath, 'utf8')).rejects.toBeTruthy();
  });

  it('reports the failure in --json with persistedDefaults false', async () => {
    const { executor, stdout, settingsPath } = harness({
      fetchImplementation: conversationBackend({ failResults: true }),
    });

    await expect(
      executor.execute({ kind: 'init', assumeYes: false }, { json: true, debug: false }),
    ).rejects.toMatchObject({ code: 'INIT_RUN_FAILED' });

    const result = JSON.parse(stdout.value) as { failed: number; persistedDefaults: boolean };
    expect(result.failed).toBe(1);
    expect(result.persistedDefaults).toBe(false);
    await expect(readFile(settingsPath, 'utf8')).rejects.toBeTruthy();
  });

  it('fails when a required settings file cannot be persisted', async () => {
    const { executor, stdout, settingsPath } = harness({
      fetchImplementation: conversationBackend(),
    });
    await mkdir(settingsPath, { recursive: true });

    await expect(
      executor.execute({ kind: 'init', assumeYes: false }, { json: false, debug: false }),
    ).rejects.toMatchObject({ code: 'SETTINGS_WRITE_FAILED' });
    expect(stdout.value).not.toContain('Next steps:');
  });

  it('reports run-start failures and does not persist defaults', async () => {
    const { executor, stdout, settingsPath } = harness({
      fetchImplementation: conversationBackend({ failRunStart: true }),
    });
    await expect(
      executor.execute({ kind: 'init', assumeYes: false }, { json: false, debug: false }),
    ).rejects.toMatchObject({ code: 'INIT_RUN_FAILED' });
    expect(stdout.value).toContain('Fix the app or prompt');
    await expect(readFile(settingsPath, 'utf8')).rejects.toBeTruthy();
  });

  it('fails early when a scenario pack has only one enabled model', async () => {
    const fetchImplementation = conversationBackend();
    const { executor, workingDirectory } = harness({ fetchImplementation });
    await expect(
      executor.execute(
        { kind: 'init', pack: 'rag-answer-quality', assumeYes: false },
        { json: false, debug: false },
      ),
    ).rejects.toMatchObject({ code: 'MODEL_ROLE_CONFLICT' });
    await expect(
      readFile(join(workingDirectory, 'autoeval', 'rag-answer-quality', 'pack.yaml'), 'utf8'),
    ).rejects.toBeTruthy();
  });

  it('fails early for explicit conflicting scenario model roles', async () => {
    const { executor } = harness({
      fetchImplementation: conversationBackend({
        models: [
          {
            supported_model_id: IDS.model,
            provider_model_id: 'judge-model',
            provider: 'test',
            display_name: 'Judge model',
          },
          {
            supported_model_id: PRIMARY_MODEL_ID,
            provider_model_id: 'primary-model',
            provider: 'test',
            display_name: 'Primary model',
          },
        ],
      }),
    });
    await expect(
      executor.execute(
        {
          kind: 'init',
          pack: 'rag-answer-quality',
          judgeModelId: IDS.model,
          primaryModelId: IDS.model,
          assumeYes: false,
        },
        { json: false, debug: false },
      ),
    ).rejects.toMatchObject({ code: 'MODEL_ROLE_CONFLICT' });
  });

  it('fails early for saved conflicting scenario model roles', async () => {
    const { executor, settingsPath } = harness({
      fetchImplementation: conversationBackend({
        models: [
          {
            supported_model_id: IDS.model,
            provider_model_id: 'judge-model',
            provider: 'test',
            display_name: 'Judge model',
          },
          {
            supported_model_id: PRIMARY_MODEL_ID,
            provider_model_id: 'primary-model',
            provider: 'test',
            display_name: 'Primary model',
          },
        ],
      }),
    });
    await mkdir(join(settingsPath, '..'), { recursive: true });
    await writeFile(
      settingsPath,
      `${JSON.stringify({
        version: 1,
        defaultJudgeModelId: IDS.model,
        defaultPrimaryModelId: IDS.model,
      })}\n`,
      'utf8',
    );
    await expect(
      executor.execute(
        { kind: 'init', pack: 'rag-answer-quality', assumeYes: false },
        { json: false, debug: false },
      ),
    ).rejects.toMatchObject({ code: 'MODEL_ROLE_CONFLICT' });
  });

  it('never prints the API key in human or machine output', async () => {
    for (const json of [false, true]) {
      const { executor, stdout, stderr } = harness({ fetchImplementation: conversationBackend() });
      await executor.execute({ kind: 'init', assumeYes: false }, { json, debug: true });
      expect(stdout.value).not.toContain(VALID_KEY);
      expect(stdout.value.toLowerCase()).not.toContain('pl_sk_');
      expect(stderr.value).not.toContain(VALID_KEY);
      expect(stderr.value.toLowerCase()).not.toContain('pl_sk_');
    }
  });

  it('persists an interactively prompted key to the store without printing it', async () => {
    const store = new MemoryCredentialStore(undefined);
    const { executor, stdout, stderr } = harness({
      environment: {},
      store,
      stdin: { isTTY: true },
      stderrTTY: true,
      prompt: { request: () => Promise.resolve(VALID_KEY) },
      fetchImplementation: conversationBackend(),
    });

    await executor.execute({ kind: 'init', assumeYes: false }, { json: false, debug: false });

    await expect(store.read()).resolves.toBe(VALID_KEY);
    expect(stdout.value).not.toContain(VALID_KEY);
    expect(stderr.value).not.toContain(VALID_KEY);
  });

  it('omits the raw backend run-status payload from --json output', async () => {
    const { executor, stdout } = harness({ fetchImplementation: conversationBackend() });
    await executor.execute({ kind: 'init', assumeYes: false }, { json: true, debug: false });
    const result = JSON.parse(stdout.value) as {
      evals: { execution?: Record<string, unknown> }[];
    };
    expect(result.evals[0]?.execution).toBeDefined();
    expect(result.evals[0]?.execution).not.toHaveProperty('statusRaw');
  });
});

describe('autoeval pack run', () => {
  it('installs if needed and runs with an auto-picked judge model', async () => {
    const { executor, stdout, workingDirectory } = harness({
      fetchImplementation: conversationBackend(),
    });
    await executor.execute(
      { kind: 'pack-run', name: 'support-bot' },
      { json: false, debug: false },
    );
    expect(stdout.value).toContain('Next steps:');
    const manifestPath = join(workingDirectory, 'autoeval', 'support-bot', 'autoeval.suite.yaml');
    await expect(readFile(manifestPath, 'utf8')).resolves.toContain('workspace:');
  });

  it('exits non-zero when a pack evaluation fails to finish', async () => {
    const { executor } = harness({
      fetchImplementation: conversationBackend({ failResults: true }),
    });
    await expect(
      executor.execute({ kind: 'pack-run', name: 'support-bot' }, { json: false, debug: false }),
    ).rejects.toMatchObject({ code: 'PACK_RUN_FAILED', kind: 'run_failed' });
  });

  it('refuses to execute a modified installed pack', async () => {
    const fetchImplementation = vi.mocked(conversationBackend());
    const { executor, workingDirectory } = harness({ fetchImplementation });
    await executor.execute(
      { kind: 'pack-run', name: 'support-bot' },
      { json: false, debug: false },
    );
    const evalPath = join(
      workingDirectory,
      'autoeval',
      'support-bot',
      'evals',
      'support-conversation.json',
    );
    await writeFile(evalPath, '{"tampered":true}\n', 'utf8');
    const runsBefore = fetchImplementation.mock.calls.filter((call) =>
      requestUrl(call[0]).pathname.endsWith('/runs'),
    ).length;

    await expect(
      executor.execute({ kind: 'pack-run', name: 'support-bot' }, { json: false, debug: false }),
    ).rejects.toMatchObject({ code: 'PACK_FILES_MODIFIED' });
    expect(
      fetchImplementation.mock.calls.filter((call) =>
        requestUrl(call[0]).pathname.endsWith('/runs'),
      ),
    ).toHaveLength(runsBefore);
  });

  it('gives failure guidance after a failed suite run', async () => {
    const { executor, stdout, workingDirectory } = harness({
      fetchImplementation: conversationBackend({ failResults: true }),
    });
    await executor.execute(
      { kind: 'config-set-workspace', workspaceId: IDS.workspace },
      { json: false, debug: false },
    );
    await executor.execute(
      { kind: 'config-set-judge-model', modelId: IDS.model },
      { json: false, debug: false },
    );
    await executor.execute(
      { kind: 'pack-add', name: 'support-bot' },
      { json: false, debug: false },
    );
    stdout.value = '';
    await executor.execute(
      {
        kind: 'suite-run',
        manifestFile: join(workingDirectory, 'autoeval', 'support-bot', 'autoeval.suite.yaml'),
      },
      { json: false, debug: false },
    );
    expect(stdout.value).toContain('Fix the app or prompt');
    expect(stdout.value).not.toContain('Turn it into a release gate');
  });
});

describe('saved-settings command integration', () => {
  it('uses saved workspace and judge defaults for quickstart', async () => {
    const fetchImplementation = vi.mocked(
      conversationBackend({
        contextType: 'agent_trace',
        workspaces: [
          { workspace_id: IDS.workspace, name: 'Saved', eval_count: 2 },
          { workspace_id: IDS.methodology, name: 'Other', eval_count: 1 },
        ],
        models: [
          {
            supported_model_id: IDS.model,
            provider_model_id: 'saved-model',
            provider: 'test',
            display_name: 'Saved model',
          },
          {
            supported_model_id: PRIMARY_MODEL_ID,
            provider_model_id: 'other-model',
            provider: 'test',
            display_name: 'Other model',
          },
        ],
      }),
    );
    const { executor } = harness({ fetchImplementation });
    await executor.execute(
      { kind: 'config-set-workspace', workspaceId: IDS.workspace },
      { json: false, debug: false },
    );
    await executor.execute(
      { kind: 'config-set-judge-model', modelId: IDS.model },
      { json: false, debug: false },
    );

    await executor.execute(
      { kind: 'quickstart', sample: 'trace', assumeYes: false },
      { json: true, debug: false },
    );

    const methodologyCall = fetchImplementation.mock.calls.find((call) =>
      requestUrl(call[0]).pathname.endsWith('/methodology-versions'),
    );
    expect(JSON.parse(methodologyCall?.[1]?.body as string)).toMatchObject({
      judge_model_id: IDS.model,
    });
    const draftCall = fetchImplementation.mock.calls.find((call) =>
      requestUrl(call[0]).pathname.endsWith('/evaluations/draft'),
    );
    expect(JSON.parse(draftCall?.[1]?.body as string)).toMatchObject({
      workspace_id: IDS.workspace,
    });
  });

  it('uses saved workspace and judge defaults for doctor', async () => {
    const { executor, stdout, workingDirectory } = harness({
      fetchImplementation: conversationBackend(),
    });
    await executor.execute(
      { kind: 'config-set-workspace', workspaceId: IDS.workspace },
      { json: false, debug: false },
    );
    await executor.execute(
      { kind: 'config-set-judge-model', modelId: IDS.model },
      { json: false, debug: false },
    );
    await executor.execute(
      { kind: 'pack-add', name: 'support-bot' },
      { json: false, debug: false },
    );
    stdout.value = '';
    await executor.execute(
      {
        kind: 'doctor',
        manifestFile: join(workingDirectory, 'autoeval', 'support-bot', 'autoeval.suite.yaml'),
        inputFiles: [],
      },
      { json: true, debug: false },
    );
    const report = JSON.parse(stdout.value) as { status: string };
    expect(report.status).toBe('ready');
  });
});
