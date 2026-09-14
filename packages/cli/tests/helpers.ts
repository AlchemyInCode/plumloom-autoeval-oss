import { vi } from 'vitest';

import type { JsonObject } from '../src/domain/common.js';
import type {
  EvaluationPage,
  RunStatus,
  SupportedModel,
  UserIdentity,
  Workspace,
  WorkspacePage,
} from '../src/domain/types.js';
import type { AutoevalApi } from '../src/api/api.js';
import type {
  ConfigVersionCreateResponse,
  EvaluationCreateResponse,
  EvaluationConfigurationResponse,
  EvaluationDraftResponse,
  EvaluationVersionsResponse,
  MethodologyVersionCreateResponse,
  RunCreateResponse,
} from '../src/api/schemas.js';
import type { PollClock } from '../src/polling/clock.js';

export const IDS = {
  workspace: '11111111-1111-4111-8111-111111111111',
  evaluation: '22222222-2222-4222-8222-222222222222',
  methodology: '33333333-3333-4333-8333-333333333333',
  config: '44444444-4444-4444-8444-444444444444',
  run: '55555555-5555-4555-8555-555555555555',
  model: '66666666-6666-4666-8666-666666666666',
} as const;

export const VALID_KEY = 'pl_sk_testcredential12345';

export const IDENTITY: UserIdentity = {
  id: 'user-1',
  userSystemId: 'system-1',
  email: 'developer@example.com',
};

function unexpectedCall(): Error {
  return new Error('Unexpected API call in test.');
}

export function createApi(overrides: Partial<AutoevalApi> = {}): AutoevalApi {
  return {
    getCurrentUser: vi.fn(() => Promise.resolve(IDENTITY)),
    listWorkspaces: vi.fn(() =>
      Promise.resolve<WorkspacePage>({
        items: [],
        total: 0,
        page: 1,
        size: 100,
        totalPages: 0,
      }),
    ),
    createWorkspace: vi.fn(() => Promise.reject<Workspace>(unexpectedCall())),
    getWorkspace: vi.fn(() => Promise.reject<Workspace>(unexpectedCall())),
    listEvaluations: vi.fn(() =>
      Promise.resolve<EvaluationPage>({
        items: [],
        total: 0,
        page: 1,
        size: 100,
        totalPages: 0,
      }),
    ),
    getEvaluationMetadata: vi.fn(() => Promise.reject(unexpectedCall())),
    createEvaluationDraft: vi.fn(() => Promise.reject<EvaluationDraftResponse>(unexpectedCall())),
    createEvaluation: vi.fn(() => Promise.reject<EvaluationCreateResponse>(unexpectedCall())),
    patchEvaluationTitle: vi.fn(() => Promise.reject<JsonObject>(unexpectedCall())),
    putEvaltoolTitle: vi.fn(() => Promise.reject<JsonObject>(unexpectedCall())),
    syncEvalsList: vi.fn(() => Promise.reject<JsonObject>(unexpectedCall())),
    listEvaluationsSorted: vi.fn(() => Promise.reject<EvaluationPage>(unexpectedCall())),
    createQualityStandard: vi.fn(() => Promise.reject<JsonObject>(unexpectedCall())),
    updateQualityStandard: vi.fn(() => Promise.reject<JsonObject>(unexpectedCall())),
    assignQualityStandardToWorkspace: vi.fn(() => Promise.reject<JsonObject>(unexpectedCall())),
    getQualityStandard: vi.fn(() => Promise.reject<JsonObject>(unexpectedCall())),
    getWorkspaceQualityStandard: vi.fn(() => Promise.reject<JsonObject | null>(unexpectedCall())),
    createMethodologyVersion: vi.fn(() =>
      Promise.reject<MethodologyVersionCreateResponse>(unexpectedCall()),
    ),
    createConfigVersion: vi.fn(() => Promise.reject<ConfigVersionCreateResponse>(unexpectedCall())),
    startRunStatusStream: vi.fn(() => Promise.reject(unexpectedCall())),
    getEvaluationVersions: vi.fn(() =>
      Promise.reject<EvaluationVersionsResponse>(unexpectedCall()),
    ),
    getEvaluationConfiguration: vi.fn(() =>
      Promise.reject<EvaluationConfigurationResponse>(unexpectedCall()),
    ),
    getModels: vi.fn(() => Promise.resolve<SupportedModel[]>([])),
    createRun: vi.fn(() => Promise.reject<RunCreateResponse>(unexpectedCall())),
    getRunStatus: vi.fn(() => Promise.reject<RunStatus>(unexpectedCall())),
    getModelPerformance: vi.fn(() => Promise.reject<JsonObject>(unexpectedCall())),
    getScenarioComparison: vi.fn(() => Promise.reject<JsonObject>(unexpectedCall())),
    getModelResponses: vi.fn(() => Promise.reject<JsonObject>(unexpectedCall())),
    getConversationResults: vi.fn(() => Promise.reject<JsonObject>(unexpectedCall())),
    getAgentTraceResults: vi.fn(() => Promise.reject<JsonObject>(unexpectedCall())),
    getTrajectory: vi.fn(() => Promise.reject<JsonObject>(unexpectedCall())),
    ...overrides,
  };
}

export class FakeClock implements PollClock {
  #time = 0;

  now(): number {
    return this.#time;
  }

  sleep(milliseconds: number): Promise<void> {
    this.#time += milliseconds;
    return Promise.resolve();
  }
}

export function versionResponse(
  contextType: 'scenario' | 'conversation' | 'agent_trace' = 'scenario',
): EvaluationVersionsResponse {
  return {
    evaluationId: IDS.evaluation,
    context_type: contextType,
    evaluationVersions: {
      currentVersion: 1,
      items: [
        {
          version: 1,
          methodologyId: IDS.methodology,
          configId: IDS.config,
          isCurrent: true,
        },
      ],
    },
  };
}
