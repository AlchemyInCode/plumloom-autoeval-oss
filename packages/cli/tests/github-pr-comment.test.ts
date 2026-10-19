import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { SuiteGateResult } from '../src/actions/suite-gate.js';
import type { SuiteSummary } from '../src/actions/suite.js';
import {
  publishGithubReliabilityReport,
  resolveGithubPullRequestContext,
  upsertPullRequestComment,
  type GithubPullRequestContext,
} from '../src/github/pr-comment.js';
import { createReliabilityReportMarker } from '../src/github/reliability-report.js';
import { IDS } from './helpers.js';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function requestedUrl(input: RequestInfo | URL | undefined): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input?.url ?? '';
}

async function eventFile(headRepository = 'example/repo'): Promise<{
  path: string;
  cleanup: () => Promise<void>;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'autoeval-pr-event-'));
  const path = join(directory, 'event.json');
  await writeFile(
    path,
    JSON.stringify({
      number: 42,
      pull_request: { head: { repo: { full_name: headRepository } } },
    }),
  );
  return { path, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

function environment(path: string): Record<string, string> {
  return {
    AUTOEVAL_PR_RELIABILITY_COMMENT: 'true',
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_EVENT_PATH: path,
    GITHUB_REPOSITORY: 'example/repo',
    GITHUB_TOKEN: 'test-token',
    GITHUB_API_URL: 'https://api.github.test',
    GITHUB_SERVER_URL: 'https://github.test',
    GITHUB_RUN_ID: '123',
    GITHUB_JOB: 'gate',
    AUTOEVAL_REPORT_MATRIX_ID: 'node-22',
  };
}

const context: GithubPullRequestContext = {
  apiUrl: 'https://api.github.test',
  repository: 'example/repo',
  pullRequestNumber: 42,
  token: 'test-token',
  expectedAuthorLogin: 'github-actions[bot]',
  actionsRunUrl: 'https://github.test/example/repo/actions/runs/123',
  reportIdentity: 'example/repo\nevals/suite.yaml\ngate\nnode-22',
};

const emptyGate: SuiteGateResult = {
  workspaceId: IDS.workspace,
  suiteDecision: 'PASS',
  counts: { PASS: 0, FAIL: 0, INCONCLUSIVE: 0, ERROR: 0 },
  perEvalDecisions: [],
};

const emptySummary: SuiteSummary = {
  workspaceId: IDS.workspace,
  total: 0,
  completed: 0,
  failed: 0,
  evals: [],
};

describe('GitHub pull-request context', () => {
  it('accepts a same-repository pull request and scopes identity by manifest, job, and matrix', async () => {
    const event = await eventFile();
    try {
      const resolved = await resolveGithubPullRequestContext({
        environment: environment(event.path),
        manifestFile: 'evals/suite.yaml',
      });
      expect(resolved.context).toMatchObject({
        repository: 'example/repo',
        pullRequestNumber: 42,
        actionsRunUrl: 'https://github.test/example/repo/actions/runs/123',
      });
      expect(resolved.context?.reportIdentity).toContain('evals/suite.yaml');
      expect(resolved.context?.reportIdentity).toContain('node-22');

      const equivalentPath = await resolveGithubPullRequestContext({
        environment: environment(event.path),
        manifestFile: './evals/suite.yaml',
      });
      expect(equivalentPath.context?.reportIdentity).toBe(resolved.context?.reportIdentity);
    } finally {
      await event.cleanup();
    }
  });

  it('skips fork pull requests and missing permissions without making a request', async () => {
    const fork = await eventFile('contributor/fork');
    const sameRepo = await eventFile();
    try {
      await expect(
        resolveGithubPullRequestContext({
          environment: environment(fork.path),
          manifestFile: 'evals/suite.yaml',
        }),
      ).resolves.toMatchObject({ reason: 'fork pull requests are not eligible for comments' });
      const noToken = environment(sameRepo.path);
      delete noToken.GITHUB_TOKEN;
      await expect(
        resolveGithubPullRequestContext({
          environment: noToken,
          manifestFile: 'evals/suite.yaml',
        }),
      ).resolves.toMatchObject({ reason: 'GITHUB_TOKEN is unavailable' });
    } finally {
      await fork.cleanup();
      await sameRepo.cleanup();
    }
  });
});

describe('GitHub REST issue-comment upsert', () => {
  it('POSTs exactly once when no matching bot comment exists', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ id: 101 }, 201));
    const marker = createReliabilityReportMarker(context.reportIdentity);

    await expect(
      upsertPullRequestComment({
        context,
        marker,
        body: `${marker}\nreport`,
        fetchImplementation: fetchMock,
      }),
    ).resolves.toEqual({ status: 'created', commentId: 101 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestedUrl(fetchMock.mock.calls[0]?.[0])).toContain(
      '/repos/example/repo/issues/42/comments?per_page=100&page=1',
    );
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('POST');
  });

  it('paginates and PATCHes the matching bot-owned comment on rerun', async () => {
    const marker = createReliabilityReportMarker(context.reportIdentity);
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      body: 'other comment',
      user: { login: 'github-actions[bot]' },
    }));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(firstPage))
      .mockResolvedValueOnce(
        jsonResponse([
          { id: 222, body: `${marker}\nold report`, user: { login: 'github-actions[bot]' } },
        ]),
      )
      .mockResolvedValueOnce(jsonResponse({ id: 222 }));

    await expect(
      upsertPullRequestComment({
        context,
        marker,
        body: `${marker}\nnew report`,
        fetchImplementation: fetchMock,
      }),
    ).resolves.toEqual({ status: 'updated', commentId: 222 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(requestedUrl(fetchMock.mock.calls[1]?.[0])).toContain('page=2');
    expect(requestedUrl(fetchMock.mock.calls[2]?.[0])).toContain('/issues/comments/222');
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe('PATCH');
  });

  it('does not update another author or collide across suite/matrix identities', async () => {
    const marker = createReliabilityReportMarker(context.reportIdentity);
    const otherMarker = createReliabilityReportMarker(`${context.reportIdentity}\nother-matrix`);
    expect(otherMarker).not.toBe(marker);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse([
          { id: 7, body: `${marker}\nspoof`, user: { login: 'someone-else' } },
          { id: 8, body: `${otherMarker}\nother suite`, user: { login: 'github-actions[bot]' } },
        ]),
      )
      .mockResolvedValueOnce(jsonResponse({ id: 9 }, 201));

    await expect(
      upsertPullRequestComment({
        context,
        marker,
        body: `${marker}\nreport`,
        fetchImplementation: fetchMock,
      }),
    ).resolves.toEqual({ status: 'created', commentId: 9 });
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('POST');
  });

  it('rejects an oversized body before network access', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    await expect(
      upsertPullRequestComment({
        context,
        marker: '<!-- marker -->',
        body: 'x'.repeat(65_537),
        fetchImplementation: fetchMock,
      }),
    ).rejects.toThrow('exceeded the GitHub comment limit');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('non-blocking GitHub reporting', () => {
  it('returns a failure result for permission/API errors instead of throwing', async () => {
    const event = await eventFile();
    try {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ message: 'denied' }, 403));
      await expect(
        publishGithubReliabilityReport({
          environment: environment(event.path),
          manifestFile: 'evals/suite.yaml',
          gate: emptyGate,
          summary: emptySummary,
          fetchImplementation: fetchMock,
        }),
      ).resolves.toEqual({
        status: 'failed',
        reason: 'GitHub comment request failed with HTTP 403.',
      });
    } finally {
      await event.cleanup();
    }
  });
});
