import { describe, expect, it, vi } from 'vitest';

import { getJudgeFeedback } from '../src/actions/feedback.js';
import { renderJudgeFeedback } from '../src/output/feedback.js';
import { renderResults } from '../src/output/human.js';
import { RuntimeCommandExecutor } from '../src/commands/executor.js';
import { loadConfiguration } from '../src/config.js';
import { createAutoevalMcpTools } from '../src/mcp/tools.js';
import { createApi, FakeClock, IDS, VALID_KEY, versionResponse } from './helpers.js';

class MemoryStream {
  value = '';
  isTTY = false;

  write(chunk: string): boolean {
    this.value += chunk;
    return true;
  }
}

describe('Judge Feedback action, renderer, CLI, and MCP', () => {
  it('renders compact index for scenario evaluation without --details', async () => {
    const api = createApi({
      getEvaluationVersions: vi.fn(() => Promise.resolve(versionResponse('scenario'))),
      getModelResponses: vi.fn(() =>
        Promise.resolve({
          outputs: [
            {
              scenario_id: 'sc-1',
              scenario_name: 'Refund request',
              model_responses: [
                {
                  model_key: 'google/gemini-2.5-flash',
                  display_name: 'Gemini 2.5 Flash',
                  judge_feedback: {
                    version: 'jf_v1',
                    status: 'available',
                    summary: 'Incorrect policy.',
                  },
                },
                {
                  model_key: 'anthropic/claude-sonnet',
                  display_name: 'Claude Sonnet',
                  judge_feedback: {
                    version: 'jf_v1',
                    status: 'available',
                  },
                },
              ],
            },
            {
              scenario_id: 'sc-2',
              scenario_name: 'Order cancellation',
              model_responses: [
                {
                  model_key: 'google/gemini-2.5-flash',
                  display_name: 'Gemini 2.5 Flash',
                  judge_feedback: {
                    version: 'jf_v1',
                    status: 'partial',
                  },
                },
                {
                  model_key: 'anthropic/claude-sonnet',
                  display_name: 'Claude Sonnet',
                  judge_feedback: {
                    version: 'jf_v1',
                    status: 'unavailable',
                  },
                },
              ],
            },
          ],
          pagination: {
            page: 1,
            has_next: false,
            total_pages: 1,
          },
        }),
      ),
    });

    const result = await getJudgeFeedback(
      { api },
      { evaluationId: IDS.evaluation, runId: IDS.run },
    );

    const rendered = renderJudgeFeedback(result, { details: false });
    expect(rendered).toContain('JUDGE FEEDBACK');
    expect(rendered).toContain('Context: Scenario');
    expect(rendered).toContain('Refund request');
    expect(rendered).toContain('Order cancellation');
    expect(rendered).toContain('Available');
    expect(rendered).toContain('Partial');
    expect(rendered).toContain('Unavailable');
    expect(rendered).toContain('3 of 4 results have judge feedback.');
    expect(rendered).toContain('To inspect a result:');
    expect(rendered).toContain(
      `autoeval feedback ${IDS.evaluation} ${IDS.run} --scenario <name-or-id> --model <model-key> --details`,
    );
  });

  it('renders detailed scenario feedback with Big-6 dimensions, custom metrics, evidence, and reference docs', async () => {
    const api = createApi({
      getEvaluationVersions: vi.fn(() => Promise.resolve(versionResponse('scenario'))),
      getModelResponses: vi.fn(() =>
        Promise.resolve({
          outputs: [
            {
              scenario_id: 'sc-1',
              scenario_name: 'Refund request',
              model_responses: [
                {
                  model_key: 'google/gemini-2.5-flash',
                  display_name: 'Gemini 2.5 Flash',
                  judge_feedback: {
                    version: 'jf_v1',
                    status: 'available',
                    summary:
                      'The response incorrectly denied a refund and failed to apply the documented exception.',
                    flags: {
                      safety_violation: false,
                      policy_violation: true,
                    },
                    criteria: {
                      correctness: {
                        level: 4,
                        explanation: 'The response applied an incorrect refund rule.',
                        evidence: ['Refunds are never allowed after shipping.'],
                      },
                      grounding: {
                        level: 3,
                        explanation: 'The response contradicts the supplied policy.',
                        evidence: ['Once an order ships, no refund is possible.'],
                      },
                      completeness: {
                        level: 6,
                        explanation: 'Partially complete answer.',
                      },
                      clarity: {
                        level: 8,
                        explanation: 'Responses were clear and easy to follow.',
                      },
                      custom_metric: {
                        level: 9,
                        label: 'Custom Policy Adherence',
                        explanation: 'Custom metric explanation.',
                      },
                    },
                    reference_docs: {
                      'refund-policy.md': {
                        satisfied: false,
                        note: 'The exception for defective items was ignored.',
                      },
                    },
                    judging_method: {
                      replicas_successful: 2,
                      replicas_requested: 2,
                      judges: 2,
                      trials: 2,
                    },
                  },
                },
              ],
            },
          ],
          pagination: {
            page: 1,
            has_next: false,
            total_pages: 1,
          },
        }),
      ),
    });

    const result = await getJudgeFeedback(
      { api },
      {
        evaluationId: IDS.evaluation,
        runId: IDS.run,
        scenario: 'Refund request',
        model: 'google/gemini-2.5-flash',
      },
    );

    const rendered = renderJudgeFeedback(result, { details: true });
    expect(rendered).toContain('Context: Scenario');
    expect(rendered).toContain('Scenario: Refund request');
    expect(rendered).toContain('Model: Gemini 2.5 Flash (google/gemini-2.5-flash)');
    expect(rendered).toContain('WHY THIS SCORE');
    expect(rendered).toContain('The response incorrectly denied a refund');
    expect(rendered).toContain('Policy violation');
    expect(rendered).not.toContain('Safety violation');
    expect(rendered).toContain('CRITERION             SCORE');
    expect(rendered).toContain('Correctness           2.0/5');
    expect(rendered).toContain('Grounding             1.5/5');
    expect(rendered).toContain('Completeness          3.0/5');
    expect(rendered).toContain('Clarity               4.0/5');
    expect(rendered).toContain('Custom Policy Adherence  4.5/5');
    expect(rendered).toContain('CORRECTNESS');
    expect(rendered).toContain('GROUNDING');
    expect(rendered).toContain('COMPLETENESS');
    expect(rendered).toContain('CLARITY');
    expect(rendered).toContain('CUSTOM POLICY ADHERENCE');
    expect(rendered).toContain('Evidence:');
    expect(rendered).toContain('"Refunds are never allowed after shipping."');
    expect(rendered).toContain('REFERENCE DOCUMENTS');
    expect(rendered).toContain('refund-policy.md  Not satisfied');
    expect(rendered).toContain('The exception for defective items was ignored.');
    expect(rendered).toContain('JUDGE RESPONSES\n2/2 completed');
    expect(rendered).toContain('JUDGING');
    expect(rendered).toContain('Judges: 2');
    expect(rendered).toContain('Trials: 2');
  });

  it('renders conversation feedback with summary, criteria, and evidence summary', async () => {
    const api = createApi({
      getEvaluationVersions: vi.fn(() => Promise.resolve(versionResponse('conversation'))),
      getConversationResults: vi.fn(() =>
        Promise.resolve({
          judge_feedback: {
            version: 'jf_v1',
            status: 'available',
            summary: 'The assistant completed the conversation but gave incorrect information.',
            criteria: {
              correctness: {
                level: 5,
                explanation: 'Incorrect timeline.',
                evidence: ['Timeline is 30 days.'],
              },
              completeness: {
                level: 8,
                explanation: 'Most questions addressed.',
              },
            },
          },
          judge_agreement: {
            pass: 2,
            total: 2,
          },
        }),
      ),
    });

    const result = await getJudgeFeedback(
      { api },
      { evaluationId: IDS.evaluation, runId: IDS.run },
    );

    const normal = renderJudgeFeedback(result, { details: false });
    expect(normal).toContain('Context: Conversation');
    expect(normal).toContain('WHY THIS SCORE');
    expect(normal).toContain('CRITERION             SCORE');
    expect(normal).toContain('Correctness           2.5/5');
    expect(normal).toContain('Completeness          4.0/5');
    expect(normal).toContain('CORRECTNESS');
    expect(normal).toContain('COMPLETENESS');
    expect(normal).toContain('Evidence available for 1 criteria.');
    expect(normal).toContain('Use --details to show supporting quotes.');
    expect(normal).toContain('JUDGE RESPONSES\n2/2 completed');

    const detailed = renderJudgeFeedback(result, { details: true });
    expect(detailed).toContain('Evidence:');
    expect(detailed).toContain('"Timeline is 30 days."');
  });

  it('renders agent trace session and trajectory feedback with resolved steps', async () => {
    const api = createApi({
      getEvaluationVersions: vi.fn(() => Promise.resolve(versionResponse('agent_trace'))),
      getAgentTraceResults: vi.fn(() =>
        Promise.resolve({
          judge_feedback: {
            version: 'jf_v1',
            status: 'available',
            summary: 'Agent reached the goal.',
            criteria: {
              task_completion: {
                level: 10,
                explanation: 'Completed successfully.',
              },
            },
          },
          judge_agreement: {
            pass: 3,
            total: 3,
          },
        }),
      ),
      getTrajectory: vi.fn(() =>
        Promise.resolve({
          judge_agreement: {
            agreed: 3,
            total: 3,
            judge_feedback: {
              version: 'jf_v1',
              status: 'available',
              summary: 'Unnecessary tool calls along the way.',
            },
          },
          dimensions: [
            {
              key: 'logical_progression',
              label: 'Logical progression',
              score: 4.0,
              explanation: 'Followed logical path.',
            },
            {
              key: 'repeated_calls_or_loops',
              label: 'Repeated calls or loops',
              score: 2.0,
              explanation: 'Repeated the search.',
              evidence: ['Searching for the same order again.'],
              step_ids: ['step-a', 'step-b'],
            },
          ],
          steps: [
            { step_id: 'step-a', sequence: 3 },
            { step_id: 'step-b', sequence: 5 },
          ],
        }),
      ),
    });

    const result = await getJudgeFeedback(
      { api },
      { evaluationId: IDS.evaluation, runId: IDS.run, section: 'all' },
    );

    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.section).toBe('session');
    expect(result.items[1]?.section).toBe('trajectory');

    const rendered = renderJudgeFeedback(result, { details: true });
    expect(rendered).toContain('Context: Agent Trace');
    expect(rendered).toContain('Section: Session');
    expect(rendered).toContain('CRITERION             SCORE');
    expect(rendered).toContain('Task completion       5.0/5');
    expect(rendered).toContain('TASK COMPLETION');
    expect(rendered).toContain('Section: Trajectory');
    expect(rendered).toContain('Logical progression   4.0/5');
    expect(rendered).toContain('Repeated calls or loops  2.0/5');
    expect(rendered).toContain('LOGICAL PROGRESSION');
    expect(rendered).toContain('REPEATED CALLS OR LOOPS');
    expect(rendered).toContain('Related steps: Step 3, Step 5');
    expect(rendered).toContain('"Searching for the same order again."');
    expect(rendered).toContain('JUDGE RESPONSES\n3/3 completed');
  });

  it('filters agent trace by section', async () => {
    const api = createApi({
      getEvaluationVersions: vi.fn(() => Promise.resolve(versionResponse('agent_trace'))),
      getTrajectory: vi.fn(() =>
        Promise.resolve({
          judge_agreement: {
            agreed: 2,
            total: 2,
            judge_feedback: {
              version: 'jf_v1',
              status: 'available',
            },
          },
          dimensions: [
            {
              key: 'logical_progression',
              score: 4.5,
            },
          ],
        }),
      ),
    });

    const trajectoryOnly = await getJudgeFeedback(
      { api },
      { evaluationId: IDS.evaluation, runId: IDS.run, section: 'trajectory' },
    );

    expect(trajectoryOnly.items).toHaveLength(1);
    expect(trajectoryOnly.items[0]?.section).toBe('trajectory');
    expect(api.getAgentTraceResults).not.toHaveBeenCalled();
    expect(api.getTrajectory).toHaveBeenCalledTimes(1);
  });

  it('gracefully handles missing, null, or unavailable feedback', async () => {
    const api = createApi({
      getEvaluationVersions: vi.fn(() => Promise.resolve(versionResponse('conversation'))),
      getConversationResults: vi.fn(() =>
        Promise.resolve({
          judge_feedback: null,
        }),
      ),
    });

    const result = await getJudgeFeedback(
      { api },
      { evaluationId: IDS.evaluation, runId: IDS.run },
    );

    const rendered = renderJudgeFeedback(result);
    expect(rendered).toContain('Judge feedback is not available for this run.');
    expect(rendered).toContain('Scores remain available through autoeval results.');
  });

  it('handles multi-page scenario pagination without losing rows', async () => {
    const api = createApi({
      getEvaluationVersions: vi.fn(() => Promise.resolve(versionResponse('scenario'))),
      getModelResponses: vi.fn((_evalId, _runId, _signal, page) => {
        if (page === 1) {
          return Promise.resolve({
            outputs: [
              {
                scenario_id: 'sc-1',
                scenario_name: 'Scenario 1',
                model_responses: [
                  {
                    model_key: 'model-a',
                    judge_feedback: { version: 'jf_v1', status: 'available' },
                  },
                ],
              },
            ],
            pagination: { page: 1, has_next: true, total_pages: 2 },
          });
        }
        return Promise.resolve({
          outputs: [
            {
              scenario_id: 'sc-2',
              scenario_name: 'Scenario 2',
              model_responses: [
                {
                  model_key: 'model-a',
                  judge_feedback: { version: 'jf_v1', status: 'available' },
                },
              ],
            },
          ],
          pagination: { page: 2, has_next: false, total_pages: 2 },
        });
      }),
    });

    const result = await getJudgeFeedback(
      { api },
      { evaluationId: IDS.evaluation, runId: IDS.run },
    );

    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.scenarioId).toBe('sc-1');
    expect(result.items[1]?.scenarioId).toBe('sc-2');
    expect(api.getModelResponses).toHaveBeenCalledTimes(2);
  });

  it('validates and rejects invalid filter flags for the evaluation context', async () => {
    const api = createApi({
      getEvaluationVersions: vi.fn(() => Promise.resolve(versionResponse('conversation'))),
    });

    await expect(
      getJudgeFeedback({ api }, { evaluationId: IDS.evaluation, runId: IDS.run, scenario: 'test' }),
    ).rejects.toMatchObject({
      code: 'INVALID_FEEDBACK_FILTER',
    });

    await expect(
      getJudgeFeedback(
        { api },
        { evaluationId: IDS.evaluation, runId: IDS.run, section: 'trajectory' },
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_FEEDBACK_FILTER',
    });
  });

  it('rejects unknown model keys for scenario evaluations', async () => {
    const api = createApi({
      getEvaluationVersions: vi.fn(() => Promise.resolve(versionResponse('scenario'))),
      getModelResponses: vi.fn(() =>
        Promise.resolve({
          outputs: [
            {
              scenario_id: 'sc-1',
              model_responses: [{ model_key: 'model-a' }],
            },
          ],
          pagination: { page: 1, has_next: false, total_pages: 1 },
        }),
      ),
    });

    await expect(
      getJudgeFeedback(
        { api },
        { evaluationId: IDS.evaluation, runId: IDS.run, model: 'model-unknown' },
      ),
    ).rejects.toMatchObject({
      code: 'UNKNOWN_FEEDBACK_MODEL',
    });
  });

  it('omits explanation when null and omits empty evidence block', async () => {
    const api = createApi({
      getEvaluationVersions: vi.fn(() => Promise.resolve(versionResponse('conversation'))),
      getConversationResults: vi.fn(() =>
        Promise.resolve({
          judge_feedback: {
            version: 'jf_v1',
            status: 'available',
            summary: null,
            criteria: {
              correctness: {
                level: 6,
                explanation: null,
                evidence: [],
              },
            },
          },
        }),
      ),
    });

    const result = await getJudgeFeedback(
      { api },
      { evaluationId: IDS.evaluation, runId: IDS.run },
    );

    const rendered = renderJudgeFeedback(result, { details: true });
    expect(rendered).toContain('CRITERION             SCORE');
    expect(rendered).toContain('Correctness           3.0/5');
    expect(rendered).toContain('CORRECTNESS');
    expect(rendered).not.toContain('WHY THIS SCORE');
    expect(rendered).not.toContain('Evidence:');
  });

  it('executes autoeval feedback command through RuntimeCommandExecutor and emits JSON with --json', async () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    const executor = new RuntimeCommandExecutor({
      configuration: loadConfiguration(),
      environment: { AUTOEVAL_API_KEY: VALID_KEY },
      fetchImplementation: vi.fn((inputArg) => {
        const url = String(inputArg);
        if (url.includes('/versions_v2')) {
          return Promise.resolve(
            new Response(JSON.stringify(versionResponse('conversation')), { status: 200 }),
          );
        }
        if (url.includes('/conversation_results')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                judge_feedback: {
                  version: 'jf_v1',
                  status: 'available',
                  summary: 'Clear conversation.',
                  criteria: {
                    clarity: { level: 8, explanation: 'Very clear.' },
                  },
                },
              }),
              { status: 200 },
            ),
          );
        }
        throw new Error(`Unexpected URL: ${url}`);
      }),
      stdout,
      stderr,
      stdin: { isTTY: false },
    });

    await executor.execute(
      {
        kind: 'feedback',
        evaluationId: IDS.evaluation,
        runId: IDS.run,
      },
      { json: true, debug: false },
    );

    const parsed = JSON.parse(stdout.value) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      contextType: 'conversation',
      evaluationId: IDS.evaluation,
      runId: IDS.run,
      items: [
        {
          section: 'session',
          judgeFeedback: {
            version: 'jf_v1',
            status: 'available',
            summary: 'Clear conversation.',
            criteria: {
              clarity: {
                level: 8,
                explanation: 'Very clear.',
              },
            },
          },
        },
      ],
    });
  });

  it('invokes get_judge_feedback MCP tool successfully', async () => {
    const api = createApi({
      getEvaluationVersions: vi.fn(() => Promise.resolve(versionResponse('conversation'))),
      getConversationResults: vi.fn(() =>
        Promise.resolve({
          judge_feedback: {
            version: 'jf_v1',
            status: 'available',
            summary: 'MCP test summary.',
          },
        }),
      ),
    });

    const tools = createAutoevalMcpTools({
      actions: { api },
      configuration: loadConfiguration(),
      clock: new FakeClock(),
    });

    const feedbackTool = tools.find((tool) => tool.name === 'get_judge_feedback');
    expect(feedbackTool).toBeDefined();
    expect(feedbackTool?.access).toBe('readOnly');

    const result = await feedbackTool?.invoke({
      evaluationId: IDS.evaluation,
      runId: IDS.run,
    });

    expect(result?.isError).toBeFalsy();
    const structured = result?.structuredContent as {
      ok: boolean;
      data: { contextType: string; items: unknown[] };
    };
    expect(structured.ok).toBe(true);
    expect(structured.data.contextType).toBe('conversation');
    expect(structured.data.items).toHaveLength(1);
  });

  it('adds short hint to autoeval results output when evaluationId and runId are passed', () => {
    const results = {
      contextType: 'conversation' as const,
      conversation: {
        overall_score: 4.5,
        outcome: { achieved: true },
        metric_scores: [{ metric: 'helpfulness', score: 4.5 }],
      },
    };

    const rendered = renderResults(results, {
      evaluationId: IDS.evaluation,
      runId: IDS.run,
    });

    expect(rendered).toContain('Inspect judge explanations:');
    expect(rendered).toContain(`autoeval feedback ${IDS.evaluation} ${IDS.run}`);
  });
});
