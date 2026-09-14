import { describe, expect, it } from 'vitest';

import {
  applyModelOverrides,
  parseConfiguredRunInput,
  requireModelOverridesForPublicPlaceholders,
  validateConfiguredRunInput,
} from '../src/configured-run/validation.js';
import type { SupportedModel } from '../src/domain/types.js';

const PLACEHOLDER_JUDGE_ID = '11111111-1111-4111-8111-111111111111';
const PLACEHOLDER_PRIMARY_ID = '22222222-2222-4222-8222-222222222222';
const JUDGE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRIMARY_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const MODELS: SupportedModel[] = [
  {
    id: JUDGE_ID,
    provider: 'test',
    displayName: 'Judge',
    apiModelId: 'judge',
    isDeprecated: false,
    isLocked: false,
  },
  {
    id: PRIMARY_ID,
    provider: 'test',
    displayName: 'Primary',
    apiModelId: 'primary',
    isDeprecated: false,
    isLocked: false,
  },
];

function scenarioInput(judgeModelId: string, primaryModelId: string): unknown {
  return {
    methodology: {
      judgeModel: 'Fixture judge',
      judgeModelId,
      runsPerScenario: 1,
      evaluatorInstructions: 'Score accuracy.',
    },
    configuration: {
      primaryModelId,
      comparisonModelIds: [],
      promptText: 'Answer briefly.',
      scenarios: [{ id: 's1', prompt: 'What is 2 + 2?' }],
      selectedMetrics: ['relevance'],
    },
  };
}

describe('configured-run model overrides', () => {
  it('replaces synthetic fixture IDs before enabled-model validation', () => {
    const parsed = parseConfiguredRunInput(
      scenarioInput(PLACEHOLDER_JUDGE_ID, PLACEHOLDER_PRIMARY_ID),
    );
    const overridden = applyModelOverrides(parsed, {
      judgeModelId: JUDGE_ID,
      primaryModelId: PRIMARY_ID,
    });

    expect(() => requireModelOverridesForPublicPlaceholders(overridden)).not.toThrow();
    expect(validateConfiguredRunInput(overridden, MODELS).models).toMatchObject({
      judge: { id: JUDGE_ID },
      primary: { id: PRIMARY_ID },
    });
  });

  it('rejects synthetic fixture IDs without actionable overrides', () => {
    const parsed = parseConfiguredRunInput(
      scenarioInput(PLACEHOLDER_JUDGE_ID, PLACEHOLDER_PRIMARY_ID),
    );
    expect(() => requireModelOverridesForPublicPlaceholders(parsed)).toThrow(
      /autoeval models.*--judge-model-id <uuid>/iu,
    );

    const judgeOverridden = applyModelOverrides(parsed, { judgeModelId: JUDGE_ID });
    expect(() => requireModelOverridesForPublicPlaceholders(judgeOverridden)).toThrow(
      /autoeval models.*--primary-model-id <uuid>/iu,
    );
  });

  it('rejects model names in UUID-only ID fields', () => {
    expect(() => parseConfiguredRunInput(scenarioInput('GLM 5.2', PRIMARY_ID))).toThrow(
      /judgeModelId.*UUID/iu,
    );
    expect(() => parseConfiguredRunInput(scenarioInput(JUDGE_ID, 'GLM 5.3'))).toThrow(
      /primaryModelId.*UUID/iu,
    );

    const parsed = parseConfiguredRunInput(scenarioInput(PLACEHOLDER_JUDGE_ID, PRIMARY_ID));
    expect(() =>
      validateConfiguredRunInput(
        applyModelOverrides(parsed, { judgeModelId: 'not-a-model-uuid' }),
        MODELS,
      ),
    ).toThrow(/must be a UUID/iu);
  });

  it('gives overrides precedence without mutating the parsed fixture', () => {
    const parsed = parseConfiguredRunInput(scenarioInput(PLACEHOLDER_JUDGE_ID, PRIMARY_ID));
    const snapshot = structuredClone(parsed);
    const overridden = applyModelOverrides(parsed, {
      judgeModelId: JUDGE_ID,
      primaryModelId: PLACEHOLDER_PRIMARY_ID,
    });

    expect(parsed).toEqual(snapshot);
    expect(overridden.methodology.judgeModelId).toBe(JUDGE_ID);
    expect(overridden.configuration.artifact.primaryModelId).toBe(PLACEHOLDER_PRIMARY_ID);
  });
});
