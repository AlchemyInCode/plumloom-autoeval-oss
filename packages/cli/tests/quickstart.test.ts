import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { SupportedModel, Workspace } from '../src/domain/types.js';
import { AutoevalError } from '../src/errors/autoeval-error.js';
import {
  QUICKSTART_JUDGE_PREFERENCE,
  QUICKSTART_PRIMARY_PREFERENCE,
  enabledModels,
  selectQuickstartModel,
  selectQuickstartWorkspace,
} from '../src/quickstart/selection.js';
import {
  QUICKSTART_SCENARIO_SAMPLE,
  QUICKSTART_TRACE_SAMPLE,
  quickstartEvaluationName,
  quickstartSample,
} from '../src/quickstart/sample.js';
import { parseConfiguredRunInput } from '../src/configured-run/validation.js';

function workspace(overrides: Partial<Workspace> & Pick<Workspace, 'id' | 'name'>): Workspace {
  return { evaluationCount: 0, ...overrides };
}

function model(overrides: Partial<SupportedModel> & Pick<SupportedModel, 'id'>): SupportedModel {
  return {
    provider: 'plumloom',
    displayName: `Model ${overrides.id}`,
    apiModelId: `api/${overrides.id}`,
    isDeprecated: false,
    isLocked: false,
    ...overrides,
  };
}

describe('quickstart workspace resolution', () => {
  it('uses the only workspace without prompting', () => {
    const only = workspace({ id: 'ws-1', name: 'Acme Evals' });
    expect(selectQuickstartWorkspace([only])).toEqual({ kind: 'resolved', workspace: only });
  });

  it('asks for a choice when several workspaces exist, busiest first', () => {
    const quiet = workspace({ id: 'ws-1', name: 'Payments', evaluationCount: 3 });
    const busy = workspace({ id: 'ws-2', name: 'Acme Evals', evaluationCount: 12 });
    const resolution = selectQuickstartWorkspace([quiet, busy]);
    expect(resolution.kind).toBe('choice-required');
    if (resolution.kind !== 'choice-required') return;
    expect(resolution.candidates.map((candidate) => candidate.id)).toEqual(['ws-2', 'ws-1']);
  });

  it('orders equally busy workspaces by name', () => {
    const b = workspace({ id: 'ws-b', name: 'Beta', evaluationCount: 4 });
    const a = workspace({ id: 'ws-a', name: 'Alpha', evaluationCount: 4 });
    const resolution = selectQuickstartWorkspace([b, a]);
    if (resolution.kind !== 'choice-required') throw new Error('expected a choice');
    expect(resolution.candidates.map((candidate) => candidate.name)).toEqual(['Alpha', 'Beta']);
  });

  it('honours an explicit workspace ID', () => {
    const wanted = workspace({ id: 'ws-2', name: 'Payments' });
    const resolution = selectQuickstartWorkspace(
      [workspace({ id: 'ws-1', name: 'Acme' }), wanted],
      'WS-2',
    );
    expect(resolution).toEqual({ kind: 'resolved', workspace: wanted });
  });

  it('rejects an unknown workspace ID', () => {
    expect(() =>
      selectQuickstartWorkspace([workspace({ id: 'ws-1', name: 'Acme' })], 'ws-9'),
    ).toThrow(AutoevalError);
  });

  it('never creates or assumes a workspace when the account has none', () => {
    expect(() => selectQuickstartWorkspace([])).toThrow(/autoeval workspace create/u);
  });
});

describe('quickstart model resolution', () => {
  it('keeps only enabled models as candidates', () => {
    const usable = model({ id: 'm-1' });
    const candidates = enabledModels([
      usable,
      model({ id: 'm-2', isDeprecated: true }),
      model({ id: 'm-3', isLocked: true }),
    ]);
    expect(candidates).toEqual([usable]);
  });

  it('auto-selects both roles on a free catalog with a single model', () => {
    const only = model({ id: 'm-1' });
    expect(selectQuickstartModel([only], 'judge')).toEqual({ kind: 'resolved', model: only });
    expect(selectQuickstartModel([only], 'primary')).toEqual({ kind: 'resolved', model: only });
  });

  it('uses the committed preference list on a paid catalog', () => {
    const judgeKey = QUICKSTART_JUDGE_PREFERENCE[0] ?? '';
    const primaryKey = QUICKSTART_PRIMARY_PREFERENCE.find((entry) => entry !== judgeKey) ?? '';

    const preferredJudge = model({ id: 'm-judge', modelKey: judgeKey });
    const preferredPrimary = model({ id: 'm-primary', apiModelId: primaryKey });
    expect(selectQuickstartModel([model({ id: 'm-other' }), preferredJudge], 'judge')).toEqual({
      kind: 'resolved',
      model: preferredJudge,
    });
    expect(selectQuickstartModel([model({ id: 'm-other' }), preferredPrimary], 'primary')).toEqual({
      kind: 'resolved',
      model: preferredPrimary,
    });
  });

  it('asks instead of picking alphabetically when no preference matches', () => {
    const candidates = [model({ id: 'm-a' }), model({ id: 'm-b' })];
    expect(selectQuickstartModel(candidates, 'judge')).toEqual({
      kind: 'choice-required',
      role: 'judge',
      candidates,
    });
  });

  it('honours explicit model IDs and rejects models that are not enabled', () => {
    const wanted = model({ id: 'm-b' });
    expect(selectQuickstartModel([model({ id: 'm-a' }), wanted], 'judge', 'M-B')).toEqual({
      kind: 'resolved',
      model: wanted,
    });
    expect(() => selectQuickstartModel([wanted], 'primary', 'm-z')).toThrow(AutoevalError);
  });

  it('fails when the account has no enabled models', () => {
    expect(() => selectQuickstartModel([], 'judge')).toThrow(/autoeval models/u);
  });
});

describe('quickstart sample', () => {
  it('matches the repository sample files', async () => {
    const scenarioCopy = await readFile(
      resolve(import.meta.dirname, '../../../examples/evals/scenario-basic.json'),
      'utf8',
    );
    const traceCopy = await readFile(
      resolve(import.meta.dirname, '../../../examples/evals/agent-trace-basic.json'),
      'utf8',
    );
    expect(QUICKSTART_SCENARIO_SAMPLE).toEqual(JSON.parse(scenarioCopy));
    expect(QUICKSTART_TRACE_SAMPLE).toEqual(JSON.parse(traceCopy));
  });

  it('defaults to the agent trace sample, which needs no model under test', () => {
    const bundled = quickstartSample('trace');
    expect(bundled.name).toBe('examples/evals/agent-trace-basic.json');
    expect(parseConfiguredRunInput(bundled.data).configuration.contextType).toBe('agent_trace');
  });

  it('runs the scenario sample when it is selected', () => {
    const bundled = quickstartSample('scenario');
    expect(bundled.name).toBe('examples/evals/scenario-basic.json');
    expect(parseConfiguredRunInput(bundled.data).configuration.contextType).toBe('scenario');
  });

  it('names the evaluation with a timestamp so the dashboard is never untitled', () => {
    expect(quickstartEvaluationName(new Date('2026-09-09T17:22:04.123Z'))).toBe(
      'Quickstart Baseline - 2026-09-09T17:22:04Z',
    );
  });
});
