import { readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

import { AutoevalError } from '../errors/autoeval-error.js';

/**
 * Reading an eval file that points at its own inputs.
 *
 * A configured-run file is the contract between the developer and Autoeval, and
 * it is committed alongside the code. Inlining a whole transcript, trace, or
 * policy document into it makes that file unreadable in review, so the file may
 * instead reference them by path:
 *
 *   "artifactFile": "./data/conversation.json"
 *   "referenceDocumentFiles": ["./policy/escalation.md"]
 *
 * Paths resolve relative to the eval file, so a checkout can live anywhere. The
 * references are expanded here, before validation, into exactly the inline
 * shape the existing schema and run path already accept — nothing downstream
 * knows the difference.
 */

const MAX_ARTIFACT_CHARS = 2_000_000;
const MAX_REFERENCE_DOCUMENT_CHARS = 200_000;

type ConfigurationRecord = Record<string, unknown>;

function readFailure(path: string, error: unknown): AutoevalError {
  return new AutoevalError(`File was not found or could not be read: ${path}`, {
    kind: 'usage',
    code: 'EVAL_FILE_READ_FAILED',
    cause: error,
  });
}

async function readBounded(path: string, limit: number): Promise<string> {
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    throw readFailure(path, error);
  }
  if (content.length > limit) {
    throw new AutoevalError(`${path} is larger than ${limit} characters.`, {
      kind: 'validation',
      code: 'EVAL_FILE_TOO_LARGE',
    });
  }
  return content;
}

function resolveAgainst(baseDirectory: string, path: string): string {
  return isAbsolute(path) ? path : resolve(baseDirectory, path);
}

function asRecord(value: unknown): ConfigurationRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as ConfigurationRecord)
    : undefined;
}

/**
 * An agent trace file is usually the raw OTLP export, whose top level is
 * `resourceSpans`. The configuration schema expects it under `trace`, so the
 * raw export is wrapped rather than rejected.
 */
function normalizeArtifact(contextType: unknown, artifact: unknown, path: string): unknown {
  if (contextType !== 'agent_trace') return artifact;
  const record = asRecord(artifact);
  if (!record) {
    throw new AutoevalError(`${path} must contain a JSON object.`, {
      kind: 'validation',
      code: 'ARTIFACT_FILE_INVALID_SHAPE',
    });
  }
  return 'trace' in record ? record : { trace: record };
}

async function readArtifactFile(path: string): Promise<unknown> {
  const content = await readBounded(path, MAX_ARTIFACT_CHARS);
  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    throw new AutoevalError(`${path} is not valid JSON.`, {
      kind: 'validation',
      code: 'ARTIFACT_FILE_INVALID_JSON',
      cause: error,
    });
  }
}

async function readReferenceDocument(path: string): Promise<{ filename: string; content: string }> {
  const content = await readBounded(path, MAX_REFERENCE_DOCUMENT_CHARS);
  if (content.trim() === '') {
    throw new AutoevalError(`${path} is empty.`, {
      kind: 'validation',
      code: 'REFERENCE_DOCUMENT_EMPTY',
    });
  }
  return { filename: basename(path), content };
}

/**
 * Expands `artifactFile` and `referenceDocumentFiles` in an already-parsed eval
 * file. `baseDirectory` is the directory holding the eval file.
 */
export async function resolveEvalFileInputs(
  parsedJson: unknown,
  baseDirectory: string,
): Promise<unknown> {
  const root = asRecord(parsedJson);
  const configuration = root === undefined ? undefined : asRecord(root.configuration);
  if (root === undefined || configuration === undefined) return parsedJson;

  const artifactFile = configuration.artifactFile;
  const referenceDocumentFiles = configuration.referenceDocumentFiles;
  if (artifactFile === undefined && referenceDocumentFiles === undefined) return parsedJson;

  const resolved: ConfigurationRecord = { ...configuration };
  delete resolved.artifactFile;
  delete resolved.referenceDocumentFiles;

  if (artifactFile !== undefined) {
    if (typeof artifactFile !== 'string' || artifactFile.trim() === '') {
      throw new AutoevalError('configuration.artifactFile must be a file path.', {
        kind: 'validation',
        code: 'ARTIFACT_FILE_INVALID_PATH',
      });
    }
    if (configuration.artifact !== undefined) {
      throw new AutoevalError(
        'configuration has both artifact and artifactFile. Keep one of them.',
        { kind: 'validation', code: 'ARTIFACT_FILE_CONFLICT' },
      );
    }
    const path = resolveAgainst(baseDirectory, artifactFile);
    resolved.artifact = normalizeArtifact(
      configuration.contextType,
      await readArtifactFile(path),
      path,
    );
  }

  if (referenceDocumentFiles !== undefined) {
    if (
      !Array.isArray(referenceDocumentFiles) ||
      referenceDocumentFiles.some((entry) => typeof entry !== 'string' || entry.trim() === '')
    ) {
      throw new AutoevalError(
        'configuration.referenceDocumentFiles must be an array of file paths.',
        { kind: 'validation', code: 'REFERENCE_DOCUMENT_INVALID_PATH' },
      );
    }
    const existing = Array.isArray(configuration.referenceDocuments)
      ? (configuration.referenceDocuments as unknown[])
      : [];
    const documents: unknown[] = [...existing];
    for (const entry of referenceDocumentFiles as readonly string[]) {
      documents.push(await readReferenceDocument(resolveAgainst(baseDirectory, entry)));
    }
    resolved.referenceDocuments = documents;
  }

  return { ...root, configuration: resolved };
}

/** Reads an eval file from disk and expands any file references it declares. */
export async function readEvalFile(path: string): Promise<unknown> {
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    throw readFailure(path, error);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch (error) {
    throw new AutoevalError(`${path} must contain valid JSON.`, {
      kind: 'usage',
      code: 'INVALID_CONFIGURED_RUN_JSON',
      cause: error,
    });
  }
  return resolveEvalFileInputs(parsed, dirname(resolve(path)));
}
