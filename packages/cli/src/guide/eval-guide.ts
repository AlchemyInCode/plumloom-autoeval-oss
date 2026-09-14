import { basename } from 'node:path';

import { readEvalFile } from '../configured-run/file-inputs.js';
import {
  parseConfiguredRunInput,
  validateConfiguredRunInput,
  type ConfiguredRunValidationResult,
} from '../configured-run/validation.js';
import type { Workspace } from '../domain/types.js';
import { AutoevalError } from '../errors/autoeval-error.js';
import { renderRule } from '../output/layout.js';
import { readSuiteManifest } from '../suite/manifest.js';
import type { EvalCreationBackend } from './eval-creation-backend.js';

/**
 * Conversation as a guide to eval files.
 *
 * Evaluations are defined in files and run by scripts; the terminal's job is to
 * help a developer understand and operate those files. So this flow only ever
 * does four things: ask whether this is one eval or a suite, take a file path,
 * validate and summarise what the file contains, and hand back the exact
 * deterministic command — running it on request. It never asks for prompts,
 * rubrics, scenarios, metrics, transcripts, traces, or documents.
 */

type Step = 'scope' | 'file' | 'workspace' | 'confirm' | 'done';

export type EvalGuideOutput = {
  /** Text to show the user. */
  output: string;
  /** Deterministic CLI command the caller should execute now, when confirmed. */
  command?: string;
};

const SUITE_ANSWERS: ReadonlySet<string> = new Set(['suite', 'many', 'multiple', 'manifest', '2']);
const ONE_ANSWERS: ReadonlySet<string> = new Set(['one', 'single', 'a single eval', '1']);
const YES_ANSWERS: ReadonlySet<string> = new Set(['y', 'yes', 'run', 'run it', 'ok', 'go']);

const RUN_FILE_PATTERNS: readonly RegExp[] = [
  /\b(?:run|execute|start)\b[^.!?]*\b(?:an?|my|the|this)?\s*(?:eval|evaluation|suite)\b/iu,
  /\b(?:how do i|help me)\b[^.!?]*\b(?:run|use)\b[^.!?]*\b(?:eval|evaluation|suite)\b/iu,
  /\b(?:create|author|build|make|set ?up)\b[^.!?]*\b(?:an?|my|the|new)?\s*(?:eval|evaluation)\b/iu,
];

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/iu;

/** True when the user is asking to run or set up evaluations from files. */
export function isEvalFileRequest(message: string): boolean {
  if (/^\s*autoeval\b/iu.test(message)) return false;
  if (UUID_PATTERN.test(message)) return false;
  return RUN_FILE_PATTERNS.some((pattern) => pattern.test(message));
}

/** A quoted or bare path mentioned in the message, if any. */
function extractPath(message: string): string | undefined {
  const quoted = /"([^"]+)"|'([^']+)'/u.exec(message);
  const candidate =
    quoted?.[1] ??
    quoted?.[2] ??
    message.split(/\s+/u).find((token) => /[./\\]/u.test(token) && !token.endsWith('.'));
  return candidate?.trim() === '' ? undefined : candidate;
}

function quoteCommandValue(value: string): string {
  return /\s/u.test(value) ? `"${value.replace(/["\\]/gu, '\\$&')}"` : value;
}

function summarize(path: string, validation: ConfiguredRunValidationResult): string {
  const contextLabel =
    validation.contextType === 'agent_trace'
      ? 'Agent trace'
      : validation.contextType === 'conversation'
        ? 'Conversation'
        : 'Scenario';
  const unit =
    validation.contextType === 'scenario'
      ? 'scenarios'
      : validation.contextType === 'conversation'
        ? 'messages'
        : 'resource spans';
  const lines = [
    `${basename(path)} — ${contextLabel} · ${validation.artifactCount} ${unit}`,
    validation.models.primary
      ? `Model under test ${validation.models.primary.displayName} · judge ${validation.models.judge.displayName}`
      : `Judge ${validation.models.judge.displayName}`,
  ];
  lines.push('Valid.');
  return lines.join('\n');
}

export class EvalGuideFlow {
  readonly #backend: EvalCreationBackend;
  readonly #signal: AbortSignal | undefined;
  #step: Step = 'scope';
  #scope: 'one' | 'suite' | undefined;
  #evalFile = '';
  #manifestFile = '';
  #workspaceId = '';
  #workspaceChoices: readonly Workspace[] = [];
  #command = '';

  constructor(dependencies: { backend: EvalCreationBackend; signal?: AbortSignal }) {
    this.#backend = dependencies.backend;
    this.#signal = dependencies.signal;
  }

  get isComplete(): boolean {
    return this.#step === 'done';
  }

  /** Evaluation ids are created by the deterministic command, not by the guide. */
  readonly createdEvaluationId: string = '';

  /** The eval file the user pointed at, once one has been accepted. */
  get savedDraftPath(): string {
    return this.#evalFile;
  }

  start(message: string): Promise<EvalGuideOutput> {
    const inlinePath = extractPath(message);
    if (inlinePath !== undefined) {
      return this.#acceptPath(inlinePath);
    }
    if (/\bsuite\b|\bmanifest\b/iu.test(message)) {
      this.#scope = 'suite';
      this.#step = 'file';
      return Promise.resolve({ output: 'Which suite manifest? (path to the YAML or JSON file)' });
    }
    return Promise.resolve({
      output:
        'Evaluations are defined in files, so I just need the file.\n' +
        'Is this one eval, or a suite?  [one | suite]',
    });
  }

  handle(message: string): Promise<EvalGuideOutput> {
    const answer = message.trim();
    const lowered = answer.toLowerCase();
    if (lowered === 'cancel' || lowered === 'quit' || lowered === 'exit') {
      this.#step = 'done';
      return Promise.resolve({ output: 'Cancelled.' });
    }

    switch (this.#step) {
      case 'scope':
        return this.#answerScope(answer, lowered);
      case 'file':
        return this.#acceptPath(extractPath(answer) ?? answer);
      case 'workspace':
        return Promise.resolve(this.#answerWorkspace(answer));
      case 'confirm':
        return Promise.resolve(this.#answerConfirm(lowered));
      default:
        this.#step = 'done';
        return Promise.resolve({ output: 'Nothing left to do.' });
    }
  }

  async #answerScope(answer: string, lowered: string): Promise<EvalGuideOutput> {
    const path = extractPath(answer);
    if (path !== undefined) return this.#acceptPath(path);
    if (SUITE_ANSWERS.has(lowered)) {
      this.#scope = 'suite';
      this.#step = 'file';
      return { output: 'Which suite manifest? (path to the YAML or JSON file)' };
    }
    if (ONE_ANSWERS.has(lowered)) {
      this.#scope = 'one';
      this.#step = 'file';
      return { output: 'Which eval file? (path to the .autoeval.json file)' };
    }
    return { output: 'Answer `one` or `suite`, or give me the file path directly.' };
  }

  async #acceptPath(path: string): Promise<EvalGuideOutput> {
    const isManifest =
      this.#scope === 'suite' || /\.(?:ya?ml)$/iu.test(path) || /suite/iu.test(basename(path));
    return isManifest ? this.#acceptManifest(path) : this.#acceptEvalFile(path);
  }

  async #acceptEvalFile(path: string): Promise<EvalGuideOutput> {
    const summary = await this.#describeEvalFile(path);
    this.#scope = 'one';
    this.#evalFile = path;
    return this.#askWorkspaceOrConfirm(summary);
  }

  async #acceptManifest(path: string): Promise<EvalGuideOutput> {
    const manifest = await readSuiteManifest(path);
    const summaries: string[] = [];
    for (const evalFile of manifest.evalFiles) {
      summaries.push(await this.#describeEvalFile(evalFile));
    }
    this.#scope = 'suite';
    this.#manifestFile = path;
    this.#workspaceId = manifest.workspaceId;
    this.#command = `autoeval suite run --manifest ${quoteCommandValue(path)}`;
    this.#step = 'confirm';
    return {
      output: [
        `${basename(path)} — ${manifest.evalFiles.length} evaluations · workspace ${manifest.workspaceId}`,
        renderRule(),
        summaries.join(`\n${renderRule()}\n`),
        renderRule(),
        this.#command,
        'Run it now? [y/N]',
      ].join('\n'),
    };
  }

  async #describeEvalFile(path: string): Promise<string> {
    const input = parseConfiguredRunInput(await readEvalFile(path));
    const models = await this.#backend.listModels(this.#signal);
    return summarize(path, validateConfiguredRunInput(input, models));
  }

  async #askWorkspaceOrConfirm(summary: string): Promise<EvalGuideOutput> {
    if (this.#workspaceId === '') {
      const workspaces = await this.#backend.listWorkspaces(this.#signal);
      if (workspaces.length === 1 && workspaces[0]) {
        this.#workspaceId = workspaces[0].id;
      } else {
        this.#workspaceChoices = workspaces;
        this.#step = 'workspace';
        return {
          output: [
            summary,
            renderRule(),
            'Which workspace?',
            ...workspaces.map((workspace, index) => `  ${index + 1}. ${workspace.name}`),
          ].join('\n'),
        };
      }
    }
    return { output: `${summary}\n${renderRule()}\n${this.#buildConfirmation()}` };
  }

  #buildConfirmation(): string {
    this.#command =
      `autoeval eval create-from --workspace ${this.#workspaceId} ` +
      `--input ${quoteCommandValue(this.#evalFile)} --run`;
    this.#step = 'confirm';
    return `${this.#command}\nRun it now? [y/N]`;
  }

  #answerWorkspace(answer: string): EvalGuideOutput {
    const index = Number.parseInt(answer, 10);
    const chosen =
      this.#workspaceChoices[index - 1] ??
      this.#workspaceChoices.find(
        (workspace) =>
          workspace.id === answer || workspace.name.toLowerCase() === answer.toLowerCase(),
      );
    if (!chosen) {
      throw new AutoevalError('Pick a workspace by number or name.', {
        kind: 'usage',
        code: 'WORKSPACE_CHOICE_UNKNOWN',
      });
    }
    this.#workspaceId = chosen.id;
    return { output: this.#buildConfirmation() };
  }

  #answerConfirm(lowered: string): EvalGuideOutput {
    this.#step = 'done';
    if (YES_ANSWERS.has(lowered)) {
      return {
        output: `Running ${basename(this.#manifestFile || this.#evalFile)}...`,
        command: this.#command,
      };
    }
    return { output: `Run it when you are ready:\n${this.#command}` };
  }
}
