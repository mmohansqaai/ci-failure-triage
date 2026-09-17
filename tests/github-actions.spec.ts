import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GitHubActionsClient,
  GitHubActionsConnector,
  GitHubApiError,
  mapGitHubStatus
} from '../packages/connectors/github-actions/index.js';
import type { GitHubArtifact, GitHubJob, GitHubWorkflowRun } from '../packages/connectors/github-actions/index.js';

const repository = 'octo-org/octo-repo';
const runId = '30433642';
const jobId = 399444496;

const successfulRun: GitHubWorkflowRun = {
  id: 30433642,
  name: 'CI',
  display_title: 'Add connector',
  head_branch: 'main',
  head_sha: 'acb5820ced9479c074f688cc0f2f0c9fcd53bdb7',
  path: '.github/workflows/ci.yml',
  run_number: 42,
  event: 'push',
  status: 'completed',
  conclusion: 'success',
  workflow_id: 159038,
  html_url: 'https://github.com/octo-org/octo-repo/actions/runs/30433642',
  created_at: '2020-01-22T19:33:08Z',
  updated_at: '2020-01-22T19:40:00Z',
  run_started_at: '2020-01-22T19:33:08Z',
  actor: { login: 'octocat' },
  triggering_actor: { login: 'octocat' },
  run_attempt: 1
};

const failedJob: GitHubJob = {
  id: jobId,
  run_id: 30433642,
  name: 'test',
  status: 'completed',
  conclusion: 'failure',
  started_at: '2020-01-22T19:33:10Z',
  completed_at: '2020-01-22T19:39:00Z',
  html_url: 'https://github.com/octo-org/octo-repo/actions/runs/30433642/job/399444496',
  steps: [
    {
      name: 'Set up job',
      status: 'completed',
      conclusion: 'success',
      number: 1,
      started_at: '2020-01-22T19:33:10Z',
      completed_at: '2020-01-22T19:33:12Z'
    },
    {
      name: 'Run tests',
      status: 'completed',
      conclusion: 'failure',
      number: 2,
      started_at: '2020-01-22T19:33:12Z',
      completed_at: '2020-01-22T19:38:50Z'
    }
  ]
};

const artifact: GitHubArtifact = {
  id: 11,
  name: 'test-results',
  size_in_bytes: 2048,
  url: 'https://api.github.com/repos/octo-org/octo-repo/actions/artifacts/11',
  archive_download_url: 'https://api.github.com/repos/octo-org/octo-repo/actions/artifacts/11/zip',
  expired: false,
  created_at: '2020-01-22T19:39:00Z',
  expires_at: '2020-02-21T19:39:00Z'
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { 'Content-Type': 'application/json' }
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    statusText: status === 200 ? 'OK' : 'Error'
  });
}

function createFetchMock(overrides: Record<string, Response> = {}): typeof fetch {
  return async (input) => {
    const url = String(input);

    for (const [pattern, response] of Object.entries(overrides)) {
      if (url.includes(pattern)) {
        return response.clone();
      }
    }

    if (url.includes(`/actions/runs/${runId}/jobs`)) {
      return jsonResponse({ total_count: 1, jobs: [failedJob] });
    }

    if (url.includes(`/actions/runs/${runId}/artifacts`)) {
      return jsonResponse({ total_count: 1, artifacts: [artifact] });
    }

    if (url.includes(`/actions/runs/${runId}`)) {
      return jsonResponse(successfulRun);
    }

    if (url.includes(`/actions/jobs/${jobId}/logs`)) {
      return textResponse('##[error]Test failed');
    }

    return jsonResponse({ message: 'Not Found' }, 404);
  };
}

describe('GitHub Actions connector', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('maps a successful workflow run onto the provider-neutral contract', async () => {
    const connector = new GitHubActionsConnector(
      new GitHubActionsClient({ token: 'test-token', fetchImpl: createFetchMock() })
    );

    const run = await connector.getPipelineRun({ repository, runId });

    expect(run).toMatchObject({
      provider: 'github-actions',
      pipelineId: '.github/workflows/ci.yml',
      runId,
      pipelineName: 'CI',
      repository,
      branch: 'main',
      commitSha: 'acb5820ced9479c074f688cc0f2f0c9fcd53bdb7',
      triggeredBy: 'octocat',
      status: 'success'
    });
    expect(run.jobs).toEqual([]);
  });

  it('maps a failed job and failed step onto pipeline contracts', async () => {
    const connector = new GitHubActionsConnector(
      new GitHubActionsClient({ token: 'test-token', fetchImpl: createFetchMock() })
    );

    const [job] = await connector.getJobs({ repository, runId });

    expect(job).toMatchObject({
      id: String(jobId),
      name: 'test',
      status: 'failure'
    });
    expect(job.steps).toEqual([
      expect.objectContaining({ id: '1', name: 'Set up job', status: 'success' }),
      expect.objectContaining({ id: '2', name: 'Run tests', status: 'failure' })
    ]);
  });

  it('maps GitHub artifacts onto the provider-neutral artifact contract', async () => {
    const connector = new GitHubActionsConnector(
      new GitHubActionsClient({ token: 'test-token', fetchImpl: createFetchMock() })
    );

    const [mapped] = await connector.getArtifacts({ repository, runId });

    expect(mapped).toEqual({
      id: '11',
      name: 'test-results',
      contentType: 'application/zip',
      downloadUrl: artifact.archive_download_url,
      sizeBytes: 2048,
      metadata: {
        expired: false,
        expiresAt: artifact.expires_at,
        url: artifact.url
      }
    });
  });

  it('maps GitHub queued, in-progress, and timeout states onto PipelineStatus', () => {
    expect(mapGitHubStatus('queued', null)).toBe('queued');
    expect(mapGitHubStatus('in_progress', null)).toBe('in_progress');
    expect(mapGitHubStatus('completed', 'timed_out')).toBe('failure');
    expect(mapGitHubStatus('completed', 'cancelled')).toBe('cancelled');
    expect(mapGitHubStatus('completed', 'skipped')).toBe('skipped');
  });

  it('maps unrecognized GitHub statuses to unknown', async () => {
    expect(mapGitHubStatus('completed', 'action_required')).toBe('unknown');
    expect(mapGitHubStatus('mystery-state', null)).toBe('unknown');
    expect(mapGitHubStatus(undefined, undefined)).toBe('unknown');

    const connector = new GitHubActionsConnector(
      new GitHubActionsClient({
        token: 'test-token',
        fetchImpl: createFetchMock({
          [`/actions/runs/${runId}`]: jsonResponse({
            ...successfulRun,
            status: 'completed',
            conclusion: 'action_required'
          })
        })
      })
    );

    const run = await connector.getPipelineRun({ repository, runId });
    expect(run.status).toBe('unknown');
  });

  it('throws a useful error when the GitHub API returns a non-2xx response', async () => {
    const fetchImpl = createFetchMock({
      [`/actions/runs/${runId}`]: jsonResponse({ message: 'Not Found' }, 404)
    });
    const client = new GitHubActionsClient({ token: 'test-token', fetchImpl });

    const error = await client.getWorkflowRun(repository, runId).catch((caught) => caught);

    expect(error).toBeInstanceOf(GitHubApiError);
    expect(error).toMatchObject({
      status: 404,
      name: 'GitHubApiError'
    });
    expect(error.message).toContain('404');
    expect(error.message).toContain(`/repos/octo-org/octo-repo/actions/runs/${runId}`);
    expect(error.message).toContain('Not Found');
  });

  it('retrieves job logs as log artifacts', async () => {
    const connector = new GitHubActionsConnector(
      new GitHubActionsClient({ token: 'test-token', fetchImpl: createFetchMock() })
    );

    const [log] = await connector.getLogs({ repository, runId });

    expect(log).toEqual({
      id: `job-${jobId}`,
      source: 'test',
      content: '##[error]Test failed',
      jobId: String(jobId)
    });
  });
});
