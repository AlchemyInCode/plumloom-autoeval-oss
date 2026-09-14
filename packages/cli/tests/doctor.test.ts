import { describe, expect, it, vi } from 'vitest';

import { doctorExitError, runDoctor } from '../src/actions/doctor.js';
import {
  parseConfiguredRunInput,
  type ParsedConfiguredRunInput,
} from '../src/configured-run/validation.js';
import type { SupportedModel, Workspace } from '../src/domain/types.js';
import { AutoevalError } from '../src/errors/autoeval-error.js';
import { renderDoctorReport } from '../src/output/human.js';
import type { SuiteManifest } from '../src/suite/manifest.js';
import { createApi, IDENTITY, IDS, VALID_KEY } from './helpers.js';

const JUDGE_MODEL_ID = '77777777-7777-4777-8777-777777777777';
const PRIMARY_MODEL_ID = '88888888-8888-4888-8888-888888888888';

function model(id: string, displayName: string): SupportedModel {
  return {
    id,
    provider: 'openai',
    displayName,
    apiModelId: displayName,
    isDeprecated: false,
    isLocked: false,
  };
}

const MODELS = [model(JUDGE_MODEL_ID, 'judge'), model(PRIMARY_MODEL_ID, 'primary')];

const WORKSPACE: Workspace = {
  id: IDS.workspace,
  name: 'Release gate',
  evaluationCount: 3,
};

function evalFile(): ParsedConfiguredRunInput {
  return parseConfiguredRunInput({
    methodology: {
      judgeModel: 'judge',
      judgeModelId: JUDGE_MODEL_ID,
      runsPerScenario: 1,
      evaluatorInstructions: 'Grade the answer against the refund policy.',
    },
    configuration: {
      contextName: 'Refund policy',
      primaryModelId: PRIMARY_MODEL_ID,
      comparisonModelIds: [],
      promptText: 'You are a support agent.',
      scenarios: [{ name: 'Refund', userQuestion: 'Can I get a refund?' }],
      selectedMetrics: ['factuality'],
    },
  });
}

function manifest(files: readonly string[]): SuiteManifest {
  return {
    workspaceId: IDS.workspace,
    entries: files.map((file) => ({ file, gate: {} })),
    evalFiles: [...files],
  };
}

function context(overrides = {}) {
  return {
    api: createApi({
      getCurrentUser: vi.fn(() => Promise.resolve(IDENTITY)),
      getWorkspace: vi.fn(() => Promise.resolve(WORKSPACE)),
      getModels: vi.fn(() => Promise.resolve(MODELS)),
      ...overrides,
    }),
  };
}

describe('autoeval doctor', () => {
  it('reports every check as passing for a valid manifest and eval file', async () => {
    const report = await runDoctor(context(), {
      manifestFile: './autoeval.suite.yaml',
      loadManifest: () => Promise.resolve(manifest(['./refund.json'])),
      loadEvalFile: () => Promise.resolve(evalFile()),
    });

    expect(report.status).toBe('ready');
    expect(report.counts.fail).toBe(0);
    expect(report.checks.map((check) => check.id)).toEqual([
      'auth',
      'manifest',
      'workspace',
      'models',
      'eval:./refund.json',
    ]);
    expect(JSON.stringify(report)).not.toContain(IDENTITY.email);
    expect(JSON.stringify(report)).not.toContain(WORKSPACE.name);
    expect(doctorExitError(report)).toBeUndefined();
  });

  it('takes the workspace from the manifest when no flag is given', async () => {
    const api = context();
    await runDoctor(api, {
      loadManifest: () => Promise.resolve(manifest([])),
      loadEvalFile: () => Promise.reject(new Error('not used')),
    });
    expect(api.api.getWorkspace).toHaveBeenCalledWith(IDS.workspace, undefined);
  });

  it('skips workspace and model checks when authentication fails', async () => {
    const report = await runDoctor(
      context({
        getCurrentUser: vi.fn(() =>
          Promise.reject(
            new AutoevalError('CLI key was rejected.', {
              kind: 'authentication',
              code: 'UNAUTHORIZED',
            }),
          ),
        ),
      }),
      { workspaceId: IDS.workspace, loadEvalFile: () => Promise.resolve(evalFile()) },
    );

    expect(report.status).toBe('blocked');
    const byId = new Map(report.checks.map((check) => [check.id, check]));
    expect(byId.get('auth')?.status).toBe('fail');
    expect(byId.get('workspace')?.status).toBe('skipped');
    expect(byId.get('models')?.status).toBe('skipped');
    expect(doctorExitError(report)?.code).toBe('DOCTOR_BLOCKED');
  });

  it('fails the manifest check without throwing when the manifest cannot be parsed', async () => {
    const report = await runDoctor(context(), {
      manifestFile: './broken.yaml',
      loadManifest: () =>
        Promise.reject(
          new AutoevalError('./broken.yaml is not valid YAML or JSON.', {
            kind: 'usage',
            code: 'INVALID_SUITE_MANIFEST',
          }),
        ),
      loadEvalFile: () => Promise.resolve(evalFile()),
    });

    const check = report.checks.find((entry) => entry.id === 'manifest');
    expect(check?.status).toBe('fail');
    expect(check?.detail).toContain('not valid YAML or JSON');
    expect(report.status).toBe('blocked');
  });

  it('fails an eval file whose model is not enabled for the account', async () => {
    const report = await runDoctor(
      context({ getModels: vi.fn(() => Promise.resolve(MODELS.slice(0, 1))) }),
      {
        workspaceId: IDS.workspace,
        evalFiles: ['./refund.json'],
        loadEvalFile: () => Promise.resolve(evalFile()),
      },
    );

    const check = report.checks.find((entry) => entry.id === 'eval:./refund.json');
    expect(check?.status).toBe('fail');
    expect(check?.detail).toContain('not enabled');
    expect(check?.hint).toContain('autoeval models');
  });

  it('renders a scannable report with remediation for failures', async () => {
    const report = await runDoctor(
      context({
        getWorkspace: vi.fn(() => Promise.reject(new Error(`Workspace not found: ${VALID_KEY}`))),
      }),
      { workspaceId: IDS.workspace, loadEvalFile: () => Promise.resolve(evalFile()) },
    );

    const rendered = renderDoctorReport(report);
    expect(rendered).toContain('Pre-flight checks failed');
    expect(rendered).toContain('Workspace scope');
    expect(rendered).toContain('How to fix');
    expect(rendered).not.toContain(VALID_KEY);
    expect(rendered).toContain('[REDACTED]');
  });
});
