import type { GateThresholds } from '../actions/gate.js';
import type { QuickstartSampleKind } from '../quickstart/sample.js';

export type DeterministicCommand =
  | { kind: 'login'; key?: string }
  | { kind: 'logout' }
  | { kind: 'whoami' }
  | { kind: 'workspace-list' }
  | { kind: 'workspace-create'; name: string; description?: string }
  | { kind: 'evaluation-list'; workspaceId: string }
  | { kind: 'evaluation-create'; workspaceId: string; name?: string }
  | {
      kind: 'evaluation-update-title';
      workspaceId: string;
      evaluationId: string;
      name: string;
      userSystemId: string;
      description?: string;
      page?: number;
      size?: number;
    }
  | { kind: 'quality-standard-create'; inputFile: string; workspaceId?: string }
  | { kind: 'quality-standard-update'; qualityStandardId: string; inputFile: string }
  | {
      kind: 'quality-standard-assign';
      workspaceId: string;
      qualityStandardId: string;
    }
  | { kind: 'quality-standard-workspace'; workspaceId: string }
  | { kind: 'quality-standard-show'; qualityStandardId: string }
  | { kind: 'evaluation-validate'; inputFile: string }
  | {
      kind: 'evaluation-create-from';
      workspaceId: string;
      inputFiles: readonly string[];
      run: boolean;
      judgeModelId?: string;
      primaryModelId?: string;
      runConcurrency?: number;
      runStartStaggerMs?: number;
    }
  | {
      kind: 'trace-import';
      source: 'deepseek-harness';
      sessionFile: string;
      templateFile: string;
      outputFile: string;
      evaluationName?: string;
      serviceName?: string;
      workspaceId?: string;
      run: boolean;
    }
  | {
      kind: 'suite-run';
      manifestFile: string;
      workspaceId?: string;
      concurrency?: number;
      staggerMs?: number;
      judgeModelId?: string;
      primaryModelId?: string;
    }
  | {
      kind: 'suite-gate';
      manifestFile: string;
      workspaceId?: string;
      concurrency?: number;
      staggerMs?: number;
      judgeModelId?: string;
      primaryModelId?: string;
    }
  | { kind: 'evaluation-run-configured'; evaluationId: string; inputFile: string }
  | { kind: 'evaluation-versions'; evaluationId: string }
  | { kind: 'evaluation-show'; evaluationId: string; version?: number }
  | { kind: 'models' }
  | {
      kind: 'quickstart';
      workspaceId?: string;
      judgeModelId?: string;
      primaryModelId?: string;
      inputFile?: string;
      sample: QuickstartSampleKind;
      assumeYes: boolean;
    }
  | {
      kind: 'doctor';
      workspaceId?: string;
      manifestFile?: string;
      inputFiles: readonly string[];
    }
  | { kind: 'run'; evaluationId: string }
  | { kind: 'status'; evaluationId: string; runId: string }
  | { kind: 'results'; evaluationId: string; runId: string; showOutputs?: boolean }
  | {
      kind: 'gate';
      evaluationId: string;
      thresholdsFile?: string;
      thresholds: GateThresholds;
    };

export type ExecutionOptions = {
  json: boolean;
  debug: boolean;
};

export interface CommandExecutor {
  execute(command: DeterministicCommand, options: ExecutionOptions): Promise<void>;
}
