import type { JsonObject } from './common.js';

export type UserIdentity = {
  id: string;
  userSystemId: string;
  email: string;
  name?: string;
};

export type Workspace = {
  id: string;
  name: string;
  description?: string;
  evaluationCount: number;
  updatedAt?: string;
  qualityStandardId?: string;
};

export type WorkspacePage = {
  items: Workspace[];
  total: number;
  page: number;
  size: number;
  totalPages: number;
};

export type EvaluationSummary = {
  id: string;
  name: string;
  workspaceId?: string;
  updatedAt?: string;
};

export type EvaluationPage = {
  items: EvaluationSummary[];
  total: number;
  page: number;
  size: number;
  totalPages: number;
};

export type EvaluationContextType = 'scenario' | 'conversation' | 'agent_trace';

export type EvaluationVersionSummary = {
  version: number;
  methodologyVersionId: string;
  configVersionId: string;
  isCurrent: boolean;
  createdAt?: string;
};

export type EvaluationVersionHistory = {
  evaluationId: string;
  contextType: EvaluationContextType;
  currentVersion?: number;
  versions: EvaluationVersionSummary[];
  raw: JsonObject;
};

export type EvaluationVersion = {
  version?: number;
  evaluationId: string;
  methodologyVersionId: string;
  configVersionId: string;
  isCurrent?: boolean;
  createdAt?: string;
  contextType: EvaluationContextType;
  raw: JsonObject;
};

export type Evaluation = EvaluationVersion & {
  configuration: JsonObject;
};

export type SupportedModel = {
  id: string;
  provider: string;
  displayName: string;
  apiModelId: string;
  isDeprecated: boolean;
  isLocked: boolean;
  modelKey?: string;
};

export type RunHandle = {
  evaluationId: string;
  runId: string;
  status: string;
  configVersionId: string;
  methodologyVersionId: string;
};

export type RunStatus = {
  evaluationId: string;
  runId: string;
  state: string;
  progress?: {
    percentage?: number;
    runsCompleted?: number;
    totalRuns?: number;
  };
  errorMessage?: string;
  failureCode?: string;
  raw: JsonObject;
};

export type PollOutcome = {
  status: RunStatus;
  elapsedMs: number;
};

export type RunExecution = {
  run: RunHandle;
  outcome: PollOutcome;
};

export type ScenarioResults = {
  contextType: 'scenario';
  modelPerformance: JsonObject;
  scenarioComparison: JsonObject;
  modelResponses: JsonObject;
};

export type ConversationResults = {
  contextType: 'conversation';
  conversation: JsonObject;
};

export type AgentTraceResults = {
  contextType: 'agent_trace';
  agentTrace: JsonObject;
  trajectory?: JsonObject;
};

export type EvaluationResults = ScenarioResults | ConversationResults | AgentTraceResults;
