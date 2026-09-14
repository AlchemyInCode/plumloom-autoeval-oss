/**
 * The bundled quickstart samples: an agent trace (default) and a scenario.
 *
 * The published package ships only `dist`, so the samples cannot be read from
 * the repository `examples/` directory on a global install. They live here as
 * source constants; `examples/evals/agent-trace-basic.json` and
 * `examples/evals/scenario-basic.json` stay the repository copies and tests assert
 * the pairs stay identical.
 *
 * The model UUIDs below are placeholders: quickstart replaces them with the
 * models it resolves before any validation or run happens.
 */
export const QUICKSTART_SCENARIO_SAMPLE_NAME = 'examples/evals/scenario-basic.json';
export const QUICKSTART_TRACE_SAMPLE_NAME = 'examples/evals/agent-trace-basic.json';

export const QUICKSTART_SCENARIO_SAMPLE: unknown = {
  methodology: {
    judgeModel: 'GLM 5.2',
    judgeModelId: '11111111-1111-4111-8111-111111111111',
    evaluatorInstructions:
      'Score factual accuracy, relevance, and clarity. Penalize unsupported details.',
  },
  configuration: {
    contextName: 'Basic factual questions',
    primaryModelId: '22222222-2222-4222-8222-222222222222',
    comparisonModelIds: [],
    promptText: "Answer the user's factual question directly in one or two sentences.",
    scenarios: [
      {
        id: 'basic-qa-1',
        name: 'Freezing point',
        prompt:
          'At standard atmospheric pressure, what is the freezing point of pure water in degrees Celsius?',
        expected: 'The answer states 0 degrees Celsius.',
      },
    ],
    referenceDocuments: [],
    selectedMetrics: ['factuality', 'relevance', 'fluency'],
    temperatureContext: 0,
  },
};

/**
 * The default quickstart sample: a recorded agent trajectory. It is graded by
 * the judge alone, so quickstart never has to resolve a model under test.
 */
export const QUICKSTART_TRACE_SAMPLE: unknown = {
  methodology: {
    judgeModel: 'GLM 5.2',
    judgeModelId: '11111111-1111-4111-8111-111111111111',
    evaluatorInstructions:
      'Evaluate whether the agent plans a relevant lookup, uses the returned value, and answers without unnecessary steps.',
  },
  configuration: {
    evaluationName: 'Weather lookup',
    contextName: 'Successful tool-grounded lookup',
    contextType: 'agent_trace',
    artifact: {
      trace: {
        resourceSpans: [
          {
            resource: {
              attributes: [
                {
                  key: 'service.name',
                  value: {
                    stringValue: 'synthetic-weather-agent',
                  },
                },
                {
                  key: 'service.version',
                  value: {
                    stringValue: 'example-1.0',
                  },
                },
              ],
            },
            scopeSpans: [
              {
                scope: {
                  name: 'example.agent.instrumentation',
                  version: '1.0.0',
                },
                spans: [
                  {
                    traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                    spanId: '0000000000000001',
                    name: 'agent.run',
                    kind: 1,
                    startTimeUnixNano: '1000000000',
                    endTimeUnixNano: '1600000000',
                    attributes: [
                      {
                        key: 'openinference.span.kind',
                        value: {
                          stringValue: 'AGENT',
                        },
                      },
                      {
                        key: 'input.value',
                        value: {
                          stringValue: 'What is the temperature in Example City right now?',
                        },
                      },
                      {
                        key: 'output.value',
                        value: {
                          stringValue:
                            'The current temperature in Example City is 18 degrees Celsius.',
                        },
                      },
                    ],
                    status: {
                      code: 1,
                    },
                  },
                  {
                    traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                    spanId: '0000000000000002',
                    parentSpanId: '0000000000000001',
                    name: 'llm.plan',
                    kind: 1,
                    startTimeUnixNano: '1050000000',
                    endTimeUnixNano: '1180000000',
                    attributes: [
                      {
                        key: 'openinference.span.kind',
                        value: {
                          stringValue: 'LLM',
                        },
                      },
                      {
                        key: 'input.value',
                        value: {
                          stringValue: 'What is the temperature in Example City right now?',
                        },
                      },
                      {
                        key: 'output.value',
                        value: {
                          stringValue:
                            'Use weather.lookup with city Example City, then report the returned Celsius value.',
                        },
                      },
                    ],
                    status: {
                      code: 1,
                    },
                  },
                  {
                    traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                    spanId: '0000000000000003',
                    parentSpanId: '0000000000000001',
                    name: 'tool.weather.lookup',
                    kind: 3,
                    startTimeUnixNano: '1200000000',
                    endTimeUnixNano: '1370000000',
                    attributes: [
                      {
                        key: 'openinference.span.kind',
                        value: {
                          stringValue: 'TOOL',
                        },
                      },
                      {
                        key: 'tool.name',
                        value: {
                          stringValue: 'weather.lookup',
                        },
                      },
                      {
                        key: 'input.value',
                        value: {
                          stringValue: '{"city":"Example City","units":"celsius"}',
                        },
                      },
                      {
                        key: 'output.value',
                        value: {
                          stringValue:
                            '{"city":"Example City","temperature_c":18,"observed_at":"2030-01-01T09:00:00Z"}',
                        },
                      },
                    ],
                    status: {
                      code: 1,
                    },
                  },
                  {
                    traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                    spanId: '0000000000000004',
                    parentSpanId: '0000000000000001',
                    name: 'llm.respond',
                    kind: 1,
                    startTimeUnixNano: '1400000000',
                    endTimeUnixNano: '1550000000',
                    attributes: [
                      {
                        key: 'openinference.span.kind',
                        value: {
                          stringValue: 'LLM',
                        },
                      },
                      {
                        key: 'input.value',
                        value: {
                          stringValue: 'Tool result: {"temperature_c":18}',
                        },
                      },
                      {
                        key: 'output.value',
                        value: {
                          stringValue:
                            'The current temperature in Example City is 18 degrees Celsius.',
                        },
                      },
                    ],
                    status: {
                      code: 1,
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    },
    expected:
      'The agent performs one weather lookup, uses the returned value of 18 degrees Celsius, and gives a concise grounded response.',
    referenceDocuments: [],
    selectedMetrics: ['factuality', 'relevance', 'helpfulness'],
    temperatureContext: 0,
  },
};

export type QuickstartSampleKind = 'trace' | 'scenario';

export function quickstartSample(kind: QuickstartSampleKind): {
  data: unknown;
  name: string;
} {
  return kind === 'scenario'
    ? { data: QUICKSTART_SCENARIO_SAMPLE, name: QUICKSTART_SCENARIO_SAMPLE_NAME }
    : { data: QUICKSTART_TRACE_SAMPLE, name: QUICKSTART_TRACE_SAMPLE_NAME };
}

/** `Quickstart Baseline - <ISO-8601 UTC>`, so the dashboard never shows an untitled record. */
export function quickstartEvaluationName(now: Date): string {
  return `Quickstart Baseline - ${now.toISOString().replace(/\.\d{3}Z$/u, 'Z')}`;
}
