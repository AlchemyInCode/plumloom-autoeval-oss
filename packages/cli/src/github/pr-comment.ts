import { open } from 'node:fs/promises';

import type { SuiteGateResult } from '../actions/suite-gate.js';
import type { SuiteSummary } from '../actions/suite.js';
import type { FetchImplementation } from '../api/client.js';
import {
  createReliabilityReportMarker,
  renderReliabilityReport,
  type RenderedReliabilityReport,
} from './reliability-report.js';

const MAX_EVENT_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_COMMENT_CHARS = 65_536;
const MAX_COMMENT_PAGES = 100;
const REQUEST_TIMEOUT_MS = 15_000;

type PullRequestComment = {
  id: number;
  body: string;
  authorLogin?: string;
};

export type GithubPullRequestContext = {
  apiUrl: string;
  repository: string;
  pullRequestNumber: number;
  token: string;
  expectedAuthorLogin: string;
  actionsRunUrl?: string;
  reportIdentity: string;
};

export type GithubCommentResult =
  | {
      status: 'created' | 'updated';
      commentId: number;
      detailLevel: RenderedReliabilityReport['detailLevel'];
    }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string };

export function githubReliabilityReportingEnabled(
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  const value = environment.AUTOEVAL_PR_RELIABILITY_COMMENT?.trim().toLowerCase();
  return value === '1' || value === 'true';
}

async function readBoundedJsonFile(path: string): Promise<unknown> {
  const handle = await open(path, 'r');
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > MAX_EVENT_BYTES) {
      throw new Error('GitHub event payload is unavailable or too large.');
    }
    const content = await handle.readFile('utf8');
    return JSON.parse(content) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('GitHub event payload is invalid JSON.', { cause: error });
    }
    throw error;
  } finally {
    await handle.close();
  }
}

function asObject(input: unknown): Record<string, unknown> | undefined {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : undefined;
}

function repositoryParts(repository: string): { owner: string; repo: string } | undefined {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/u.exec(repository);
  return match?.[1] && match[2] ? { owner: match[1], repo: match[2] } : undefined;
}

function normalizedHttpsUrl(input: string): string | undefined {
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:') return undefined;
    return url.toString().replace(/\/$/u, '');
  } catch {
    return undefined;
  }
}

export async function resolveGithubPullRequestContext(input: {
  environment: Readonly<Record<string, string | undefined>>;
  manifestFile: string;
}): Promise<{ context?: GithubPullRequestContext; reason?: string }> {
  const environment = input.environment;
  if (!githubReliabilityReportingEnabled(environment)) {
    return { reason: 'reporting is disabled' };
  }
  if (environment.GITHUB_EVENT_NAME !== 'pull_request') {
    return { reason: 'the workflow event is not pull_request' };
  }
  const token = environment.GITHUB_TOKEN?.trim();
  if (!token) return { reason: 'GITHUB_TOKEN is unavailable' };
  const repository = environment.GITHUB_REPOSITORY?.trim();
  if (!repository || !repositoryParts(repository)) {
    return { reason: 'GITHUB_REPOSITORY is unavailable or invalid' };
  }
  const eventPath = environment.GITHUB_EVENT_PATH?.trim();
  if (!eventPath) return { reason: 'GITHUB_EVENT_PATH is unavailable' };

  let event: Record<string, unknown>;
  try {
    event = asObject(await readBoundedJsonFile(eventPath)) ?? {};
  } catch {
    return { reason: 'the GitHub pull-request event could not be read' };
  }
  const pullRequest = asObject(event.pull_request);
  const headRepository = asObject(asObject(pullRequest?.head)?.repo)?.full_name;
  if (
    typeof headRepository !== 'string' ||
    headRepository.toLowerCase() !== repository.toLowerCase()
  ) {
    return { reason: 'fork pull requests are not eligible for comments' };
  }
  const eventNumber = event.number ?? pullRequest?.number;
  if (typeof eventNumber !== 'number' || !Number.isInteger(eventNumber) || eventNumber <= 0) {
    return { reason: 'the pull-request number is unavailable' };
  }

  const apiUrl = normalizedHttpsUrl(environment.GITHUB_API_URL ?? 'https://api.github.com');
  if (!apiUrl) return { reason: 'GITHUB_API_URL is unavailable or invalid' };
  const serverUrl = normalizedHttpsUrl(environment.GITHUB_SERVER_URL ?? 'https://github.com');
  const runId = environment.GITHUB_RUN_ID?.trim();
  const actionsRunUrl =
    serverUrl && runId
      ? `${serverUrl}/${repository}/actions/runs/${encodeURIComponent(runId)}`
      : undefined;
  const jobValue = environment.GITHUB_JOB?.trim();
  const job = jobValue === undefined || jobValue === '' ? 'job' : jobValue;
  const matrixIdentityValue = environment.AUTOEVAL_REPORT_MATRIX_ID?.trim();
  const matrixIdentity =
    matrixIdentityValue === undefined || matrixIdentityValue === ''
      ? 'default'
      : matrixIdentityValue;
  const expectedAuthorValue = environment.AUTOEVAL_GITHUB_COMMENT_AUTHOR?.trim();
  const expectedAuthorLogin =
    expectedAuthorValue === undefined || expectedAuthorValue === ''
      ? 'github-actions[bot]'
      : expectedAuthorValue;
  const reportIdentity = [repository, input.manifestFile, job, matrixIdentity].join('\n');

  return {
    context: {
      apiUrl,
      repository,
      pullRequestNumber: eventNumber,
      token,
      expectedAuthorLogin,
      ...(actionsRunUrl ? { actionsRunUrl } : {}),
      reportIdentity,
    },
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new Error('GitHub comment response exceeded the allowed size.');
  }
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    totalBytes += result.value.byteLength;
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('GitHub comment response exceeded the allowed size.');
    }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  return text === '' ? undefined : (JSON.parse(text) as unknown);
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function githubRequest(input: {
  context: GithubPullRequestContext;
  path: string;
  method: 'GET' | 'POST' | 'PATCH';
  body?: { body: string };
  fetchImplementation: FetchImplementation;
  signal?: AbortSignal;
}): Promise<unknown> {
  const response = await input.fetchImplementation(`${input.context.apiUrl}${input.path}`, {
    method: input.method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${input.context.token}`,
      'x-github-api-version': '2022-11-28',
      ...(input.body ? { 'content-type': 'application/json' } : {}),
    },
    ...(input.body ? { body: JSON.stringify(input.body) } : {}),
    signal: requestSignal(input.signal),
  });
  const payload = await readBoundedJson(response);
  if (!response.ok) {
    throw new Error(`GitHub comment request failed with HTTP ${response.status}.`);
  }
  return payload;
}

function parseComments(input: unknown): PullRequestComment[] {
  if (!Array.isArray(input)) throw new Error('GitHub returned an invalid comment list.');
  return input.flatMap((item) => {
    const comment = asObject(item);
    const user = asObject(comment?.user);
    return typeof comment?.id === 'number' && typeof comment.body === 'string'
      ? [
          {
            id: comment.id,
            body: comment.body,
            ...(typeof user?.login === 'string' ? { authorLogin: user.login } : {}),
          },
        ]
      : [];
  });
}

export async function upsertPullRequestComment(input: {
  context: GithubPullRequestContext;
  marker: string;
  body: string;
  fetchImplementation?: FetchImplementation;
  signal?: AbortSignal;
}): Promise<{ status: 'created' | 'updated'; commentId: number }> {
  if (input.body.length > MAX_COMMENT_CHARS) {
    throw new Error('Autoeval reliability report exceeded the GitHub comment limit.');
  }
  const repository = repositoryParts(input.context.repository);
  if (!repository) throw new Error('GitHub repository identity is invalid.');
  const fetchImplementation = input.fetchImplementation ?? fetch;
  const commentsPath = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/issues/${input.context.pullRequestNumber}/comments`;
  let existing: PullRequestComment | undefined;
  let paginationComplete = false;

  for (let page = 1; page <= MAX_COMMENT_PAGES; page += 1) {
    const payload = await githubRequest({
      context: input.context,
      path: `${commentsPath}?per_page=100&page=${page}`,
      method: 'GET',
      fetchImplementation,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const comments = parseComments(payload);
    existing = comments.find(
      (comment) =>
        comment.authorLogin === input.context.expectedAuthorLogin &&
        comment.body.includes(input.marker),
    );
    if (existing) break;
    if (comments.length < 100) {
      paginationComplete = true;
      break;
    }
  }

  if (!existing && !paginationComplete) {
    throw new Error('GitHub comment pagination exceeded the allowed page limit.');
  }

  if (existing) {
    const payload = asObject(
      await githubRequest({
        context: input.context,
        path: `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/issues/comments/${existing.id}`,
        method: 'PATCH',
        body: { body: input.body },
        fetchImplementation,
        ...(input.signal ? { signal: input.signal } : {}),
      }),
    );
    const commentId = typeof payload?.id === 'number' ? payload.id : existing.id;
    return { status: 'updated', commentId };
  }

  const payload = asObject(
    await githubRequest({
      context: input.context,
      path: commentsPath,
      method: 'POST',
      body: { body: input.body },
      fetchImplementation,
      ...(input.signal ? { signal: input.signal } : {}),
    }),
  );
  if (typeof payload?.id !== 'number')
    throw new Error('GitHub returned an invalid created comment.');
  return { status: 'created', commentId: payload.id };
}

/**
 * Best-effort PR reporting. Every setup, permission, and REST failure becomes a
 * result value so it can never replace the suite gate's verdict or exit code.
 */
export async function publishGithubReliabilityReport(input: {
  environment: Readonly<Record<string, string | undefined>>;
  manifestFile: string;
  gate: SuiteGateResult;
  summary: SuiteSummary;
  fetchImplementation?: FetchImplementation;
  signal?: AbortSignal;
}): Promise<GithubCommentResult> {
  const resolved = await resolveGithubPullRequestContext({
    environment: input.environment,
    manifestFile: input.manifestFile,
  });
  if (!resolved.context) return { status: 'skipped', reason: resolved.reason ?? 'not eligible' };

  try {
    const marker = createReliabilityReportMarker(resolved.context.reportIdentity);
    const rendered = renderReliabilityReport({
      gate: input.gate,
      summary: input.summary,
      marker,
      ...(resolved.context.actionsRunUrl ? { actionsRunUrl: resolved.context.actionsRunUrl } : {}),
    });
    const result = await upsertPullRequestComment({
      context: resolved.context,
      marker,
      body: rendered.markdown,
      ...(input.fetchImplementation ? { fetchImplementation: input.fetchImplementation } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    return { ...result, detailLevel: rendered.detailLevel };
  } catch (error) {
    return {
      status: 'failed',
      reason: error instanceof Error ? error.message : 'GitHub reliability comment failed.',
    };
  }
}
