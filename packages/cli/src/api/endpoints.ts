const API_PREFIX = '/api/v1';

export const apiEndpoints = {
  currentUser: (): string => `${API_PREFIX}/auth/me`,
  workspaces: (): string => `${API_PREFIX}/workspaces`,
  workspaceCreate: (): string => `${API_PREFIX}/workspaces/create`,
  workspace: (workspaceId: string): string => `${API_PREFIX}/workspaces/${workspaceId}`,
  evaluations: (): string => `${API_PREFIX}/evaltools`,
  evaluationMetadata: (workspaceId: string): string => `${API_PREFIX}/evaltools/${workspaceId}`,
  evaluationDraft: (): string => `${API_PREFIX}/evaluations/draft`,
  evaluationCreate: (): string => `${API_PREFIX}/evaltools/create`,
  methodologyVersions: (evaluationId: string): string =>
    `${API_PREFIX}/evaluations/${evaluationId}/methodology-versions`,
  configVersions: (evaluationId: string): string =>
    `${API_PREFIX}/evaluations/${evaluationId}/config-versions`,
  evaluationVersions: (evaluationId: string): string =>
    `${API_PREFIX}/evaluations/${evaluationId}/versions_v2`,
  evaluationConfiguration: (evaluationId: string): string =>
    `${API_PREFIX}/evaluations/${evaluationId}`,
  evaluationUpdate: (evaluationId: string): string => `${API_PREFIX}/evaluations/${evaluationId}`,
  evaltoolUpdate: (workspaceId: string): string => `${API_PREFIX}/evaltools/${workspaceId}`,
  syncEvalsList: (): string => `${API_PREFIX}/evaltools/sync_evals_list`,
  qualityStandards: (): string => `${API_PREFIX}/quality-standards`,
  qualityStandardsWorkspace: (workspaceId: string): string =>
    `${API_PREFIX}/quality-standards/workspaces/${workspaceId}`,
  qualityStandard: (qualityStandardId: string): string =>
    `${API_PREFIX}/quality-standards/${qualityStandardId}`,
  models: (): string => `${API_PREFIX}/byok/models/enabled`,
  runs: (evaluationId: string): string => `${API_PREFIX}/evaluations/${evaluationId}/runs`,
  runStatus: (evaluationId: string, runId: string): string =>
    `${API_PREFIX}/evaluations/${evaluationId}/runs/${runId}/status`,
  runStatusStream: (evaluationId: string, runId: string): string =>
    `${API_PREFIX}/evaluations/${evaluationId}/runs/${runId}/status/stream`,
  modelPerformance: (evaluationId: string, runId: string): string =>
    `${API_PREFIX}/evaluations/${evaluationId}/runs/${runId}/model-performance`,
  scenarioComparison: (evaluationId: string, runId: string): string =>
    `${API_PREFIX}/evaluations/${evaluationId}/runs/${runId}/scenario-comparison`,
  modelResponses: (evaluationId: string, runId: string): string =>
    `${API_PREFIX}/evaluations/${evaluationId}/runs/${runId}/model-responses`,
  conversationResults: (evaluationId: string, runId: string): string =>
    `${API_PREFIX}/evaluations/${evaluationId}/runs/${runId}/conversation_results`,
  agentTraceResults: (evaluationId: string, runId: string): string =>
    `${API_PREFIX}/evaluations/${evaluationId}/runs/${runId}/agent_trace_results`,
  trajectory: (evaluationId: string, runId: string): string =>
    `${API_PREFIX}/evaluations/${evaluationId}/runs/${runId}/trajectory`,
} as const;
