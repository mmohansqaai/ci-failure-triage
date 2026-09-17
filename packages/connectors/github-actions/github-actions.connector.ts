import type { Artifact, LogArtifact, PipelineJob, PipelineRun } from '../../contracts/src/index.js';
import type { CiConnector, CiConnectorContext } from '../src/ci-connector.js';
import { GitHubActionsClient } from './github-actions.client.js';
import { mapArtifact, mapJob, mapJobLogs, mapWorkflowRun } from './github-actions.mapper.js';

export class GitHubActionsConnector implements CiConnector {
  readonly provider = 'github-actions';
  private readonly client: GitHubActionsClient;

  constructor(client?: GitHubActionsClient) {
    this.client = client ?? new GitHubActionsClient();
  }

  async getPipelineRun(context: CiConnectorContext): Promise<PipelineRun> {
    const run = await this.client.getWorkflowRun(context.repository, context.runId);
    return mapWorkflowRun(run, context.repository);
  }

  async getJobs(context: CiConnectorContext): Promise<PipelineJob[]> {
    const jobs = await this.client.getJobs(context.repository, context.runId);
    return jobs.map(mapJob);
  }

  async getLogs(context: CiConnectorContext): Promise<LogArtifact[]> {
    const jobs = await this.client.getJobs(context.repository, context.runId);
    return Promise.all(
      jobs.map(async (job) => {
        const content = await this.client.getJobLogs(context.repository, String(job.id));
        return mapJobLogs(job, content);
      })
    );
  }

  async getArtifacts(context: CiConnectorContext): Promise<Artifact[]> {
    const artifacts = await this.client.getArtifacts(context.repository, context.runId);
    return artifacts.map(mapArtifact);
  }
}
