import type {
  GitHubArtifact,
  GitHubArtifactsResponse,
  GitHubJob,
  GitHubJobsResponse,
  GitHubWorkflowRun
} from './github-actions.types.js';

export interface GitHubActionsClientOptions {
  token?: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

export class GitHubApiError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body?: string;

  constructor(status: number, url: string, body?: string) {
    const bodySuffix = body ? ` Body: ${body}` : '';
    super(`GitHub API request failed with status ${status} for ${url}.${bodySuffix}`);
    this.name = 'GitHubApiError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

export class GitHubActionsClient {
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(options: GitHubActionsClientOptions = {}) {
    const token = options.token ?? process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error('GITHUB_TOKEN is required to authenticate with the GitHub API');
    }

    this.token = token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = (options.baseUrl ?? 'https://api.github.com').replace(/\/$/, '');
  }

  async getWorkflowRun(repository: string, runId: string): Promise<GitHubWorkflowRun> {
    return this.requestJson<GitHubWorkflowRun>(this.repoPath(repository, `/actions/runs/${encodeURIComponent(runId)}`));
  }

  async getJobs(repository: string, runId: string): Promise<GitHubJob[]> {
    const response = await this.requestJson<GitHubJobsResponse>(
      `${this.repoPath(repository, `/actions/runs/${encodeURIComponent(runId)}/jobs`)}?per_page=100`
    );
    return response.jobs ?? [];
  }

  async getJobLogs(repository: string, jobId: string): Promise<string> {
    return this.requestText(this.repoPath(repository, `/actions/jobs/${encodeURIComponent(jobId)}/logs`));
  }

  async getArtifacts(repository: string, runId: string): Promise<GitHubArtifact[]> {
    const response = await this.requestJson<GitHubArtifactsResponse>(
      `${this.repoPath(repository, `/actions/runs/${encodeURIComponent(runId)}/artifacts`)}?per_page=100`
    );
    return response.artifacts ?? [];
  }

  private repoPath(repository: string, suffix: string): string {
    const { owner, repo } = parseRepository(repository);
    return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${suffix}`;
  }

  private async requestJson<T>(path: string): Promise<T> {
    const { url, response } = await this.request(path, 'application/vnd.github+json');
    const body = await response.text();

    try {
      return JSON.parse(body) as T;
    } catch {
      throw new Error(`GitHub API returned non-JSON response for ${url}`);
    }
  }

  private async requestText(path: string): Promise<string> {
    const { response } = await this.request(path, '*/*');
    return response.text();
  }

  private async request(path: string, accept: string): Promise<{ url: string; response: Response }> {
    const url = `${this.baseUrl}${path}`;
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: accept,
        Authorization: `Bearer ${this.token}`,
        'User-Agent': 'ci-failure-triage',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      redirect: 'follow'
    });

    if (!response.ok) {
      const body = await response.text();
      throw new GitHubApiError(response.status, url, body);
    }

    return { url, response };
  }
}

export function parseRepository(repository: string): { owner: string; repo: string } {
  const [owner, repo, extra] = repository.split('/').filter(Boolean);
  if (!owner || !repo || extra) {
    throw new Error(`Invalid repository "${repository}". Expected owner/name format.`);
  }

  return { owner, repo };
}
