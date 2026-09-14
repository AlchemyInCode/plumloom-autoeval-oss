import { describe, expect, it } from 'vitest';

import { parseConfiguredRunInput } from '../src/commands/executor.js';

describe('configured run input parsing', () => {
  it('accepts normalized agent_trace configuration shape', () => {
    const parsed = parseConfiguredRunInput({
      methodology: {
        userSystemId: 'USR-3B98B101F7D2',
        judgeModel: 'GPT-5-mini',
        judgeModelId: '11111111-1111-4111-8111-111111111111',
        runsPerScenario: 1,
        evaluatorInstructions: 'Evaluate tool grounding',
      },
      configuration: {
        evaluationName: 'Cancellation title',
        contextName: 'Cancellation Agent Trace Eval',
        contextType: 'agent_trace',
        artifact: { trace: { resourceSpans: [] } },
        expected: 'Agent should verify and follow policy.',
        referenceDocuments: [{ filename: 'policy.md', content: 'policy text' }],
        selectedMetrics: ['factuality'],
        temperatureContext: 0,
        autoStopEnabled: true,
      },
    });

    expect(parsed.configuration.contextType).toBe('agent_trace');
    expect(parsed.configuration.contextName).toBe('Cancellation Agent Trace Eval');
    expect(parsed.evaluationName).toBe('Cancellation title');
    expect(parsed.methodology.runsPerScenario).toBe(1);
    expect(parsed.configuration).not.toHaveProperty('autoStopEnabled');
  });

  it('accepts legacy scenario configuration shape and normalizes it', () => {
    const parsed = parseConfiguredRunInput({
      methodology: {
        userSystemId: 'USR-3B98B101F7D2',
        judgeModel: 'DeepSeek V4 Pro',
        judgeModelId: '33333333-3333-4333-8333-333333333333',
        runsPerScenario: 1,
        evaluatorInstructions: 'Evaluate code review quality',
      },
      configuration: {
        evaluationName: 'Code review title',
        primaryModelId: '11111111-1111-4111-8111-111111111111',
        comparisonModelIds: ['22222222-2222-4222-8222-222222222222'],
        promptText: 'You are an AI code reviewer',
        referenceDocuments: [],
        selectedMetrics: ['helpfulness'],
        temperatureContext: 0,
        autoStopEnabled: true,
        scenarios: [[{ id: 'code-tc-1', name: 'Case 1', prompt: 'Review this code.' }]],
      },
    });

    expect(parsed.configuration.contextType).toBe('scenario');
    expect(parsed.configuration.contextName).toBe('Scenario Evaluation');
    expect(parsed.evaluationName).toBe('Code review title');
    expect(parsed.configuration.expected).toBe('You are an AI code reviewer');
    expect(parsed.methodology.runsPerScenario).toBe(1);
    expect(parsed.configuration).not.toHaveProperty('autoStopEnabled');
    expect(parsed.configuration.artifact).toEqual({
      primaryModelId: '11111111-1111-4111-8111-111111111111',
      comparisonModelIds: ['22222222-2222-4222-8222-222222222222'],
      promptText: 'You are an AI code reviewer',
      scenarios: [[{ id: 'code-tc-1', name: 'Case 1', prompt: 'Review this code.' }]],
    });
    if (parsed.configuration.contextType === 'scenario') {
      expect(parsed.configuration.scenarioGeneration).toBeUndefined();
    }
  });

  it('accepts flat legacy scenarios array and preserves it in artifact', () => {
    const parsed = parseConfiguredRunInput({
      methodology: {
        userSystemId: 'USR-3B98B101F7D2',
        judgeModel: 'DeepSeek V4 Pro',
        judgeModelId: '33333333-3333-4333-8333-333333333333',
        runsPerScenario: 1,
        evaluatorInstructions: 'Evaluate code review quality',
      },
      configuration: {
        primaryModelId: '11111111-1111-4111-8111-111111111111',
        comparisonModelIds: ['22222222-2222-4222-8222-222222222222'],
        promptText: 'You are an AI code reviewer',
        referenceDocuments: [],
        selectedMetrics: ['helpfulness'],
        scenarios: [{ id: 'code-tc-1', name: 'Case 1', prompt: 'Review this code.' }],
      },
    });

    expect(parsed.configuration.contextType).toBe('scenario');
    expect(parsed.configuration.artifact).toEqual({
      primaryModelId: '11111111-1111-4111-8111-111111111111',
      comparisonModelIds: ['22222222-2222-4222-8222-222222222222'],
      promptText: 'You are an AI code reviewer',
      scenarios: [{ id: 'code-tc-1', name: 'Case 1', prompt: 'Review this code.' }],
    });
  });
});
