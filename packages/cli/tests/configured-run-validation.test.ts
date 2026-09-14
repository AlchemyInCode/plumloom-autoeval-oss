import { describe, expect, it } from 'vitest';

import {
  parseConfiguredRunInput,
  validateConfiguredRunInput,
} from '../src/configured-run/validation.js';
import type { SupportedModel } from '../src/domain/types.js';
import { IDS } from './helpers.js';

const PRIMARY_ID = '77777777-7777-4777-8777-777777777777';
const COMPARISON_ID = '88888888-8888-4888-8888-888888888888';

function model(id: string, displayName: string): SupportedModel {
  return {
    id,
    displayName,
    provider: 'test-provider',
    apiModelId: displayName.toLowerCase(),
    isDeprecated: false,
    isLocked: false,
  };
}

const ENABLED_MODELS = [
  model(IDS.model, 'Judge'),
  model(PRIMARY_ID, 'Primary'),
  model(COMPARISON_ID, 'Comparison'),
];

function methodology(): Record<string, unknown> {
  return {
    userSystemId: 'USR-3B98B101F7D2',
    judgeModel: 'Judge',
    judgeModelId: IDS.model,
    evaluatorInstructions: 'Evaluate safely',
  };
}

function scenarioInput(overrides: Record<string, unknown> = {}): unknown {
  return {
    methodology: methodology(),
    configuration: {
      primaryModelId: PRIMARY_ID,
      comparisonModelIds: [COMPARISON_ID],
      promptText: 'Review this response',
      scenarios: [{ id: 'case-1', prompt: 'A test case' }],
      selectedMetrics: ['factuality'],
      ...overrides,
    },
  };
}

describe('configured run preflight validation', () => {
  it('validates scenario models and reports the artifact count', () => {
    const result = validateConfiguredRunInput(
      parseConfiguredRunInput(scenarioInput()),
      ENABLED_MODELS,
    );

    expect(result).toMatchObject({
      valid: true,
      contextType: 'scenario',
      artifactCount: 1,
      models: {
        judge: { id: IDS.model },
        primary: { id: PRIMARY_ID },
        comparisons: [{ id: COMPARISON_ID }],
      },
    });
  });

  it.each([
    {
      label: 'judge as primary',
      override: { primaryModelId: IDS.model },
      message: 'judge model cannot also be the primary',
    },
    {
      label: 'judge in comparisons',
      override: { comparisonModelIds: [IDS.model] },
      message: 'judge model cannot also be a comparison',
    },
    {
      label: 'primary in comparisons',
      override: { comparisonModelIds: [PRIMARY_ID] },
      message: 'primary model cannot also be a comparison',
    },
  ])('rejects $label', ({ override, message }) => {
    expect(() =>
      validateConfiguredRunInput(parseConfiguredRunInput(scenarioInput(override)), ENABLED_MODELS),
    ).toThrow(new RegExp(message, 'iu'));
  });

  it('rejects duplicate comparison models with a corrective message', () => {
    expect(() =>
      validateConfiguredRunInput(
        parseConfiguredRunInput(
          scenarioInput({ comparisonModelIds: [COMPARISON_ID, COMPARISON_ID] }),
        ),
        ENABLED_MODELS,
      ),
    ).toThrow(/duplicated.*remove duplicate comparison models/iu);
  });

  it('rejects model IDs that are absent, locked, or deprecated', () => {
    const lockedPrimary = { ...model(PRIMARY_ID, 'Primary'), isLocked: true };
    expect(() =>
      validateConfiguredRunInput(parseConfiguredRunInput(scenarioInput()), [
        model(IDS.model, 'Judge'),
        lockedPrimary,
        model(COMPARISON_ID, 'Comparison'),
      ]),
    ).toThrow(/Primary model ID.*not enabled.*autoeval models/iu);
  });

  it('validates conversation artifacts without exposing run-planning controls', () => {
    const input = {
      methodology: methodology(),
      configuration: {
        contextName: 'Conversation',
        contextType: 'conversation',
        artifact: { messages: [{ role: 'user', content: 'Hello' }] },
        expected: 'A useful answer',
        selectedMetrics: ['helpfulness'],
      },
    };
    expect(
      validateConfiguredRunInput(parseConfiguredRunInput(input), ENABLED_MODELS),
    ).toMatchObject({ contextType: 'conversation', artifactCount: 1 });
  });

  it('validates agent-trace artifacts and requires an OTLP resource span', () => {
    const valid = {
      methodology: methodology(),
      configuration: {
        contextName: 'Agent trace',
        contextType: 'agent_trace',
        artifact: { trace: { resourceSpans: [{ resource: {}, scopeSpans: [] }] } },
        expected: 'A grounded trajectory',
        selectedMetrics: ['factuality'],
      },
    };
    expect(
      validateConfiguredRunInput(parseConfiguredRunInput(valid), ENABLED_MODELS),
    ).toMatchObject({ contextType: 'agent_trace', artifactCount: 1 });

    const missingTrace = {
      ...valid,
      configuration: { ...valid.configuration, artifact: { trace: { resourceSpans: [] } } },
    };
    expect(() =>
      validateConfiguredRunInput(parseConfiguredRunInput(missingTrace), ENABLED_MODELS),
    ).toThrow(/resourceSpans.*Too small/iu);
  });

  it('reports missing required fields with their input path', () => {
    expect(() =>
      parseConfiguredRunInput({ methodology: methodology(), configuration: {} }),
    ).toThrow(/Configured run input is invalid.*configuration/iu);
  });
});
