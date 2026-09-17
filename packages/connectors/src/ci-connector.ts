import type { Artifact, LogArtifact, PipelineJob, PipelineRun } from '../../contracts/src/index.js';

export interface CiConnectorContext {
  repository: string;
  runId: string;
}

export interface CiConnector {
  readonly provider: string;

  getPipelineRun(context: CiConnectorContext): Promise<PipelineRun>;
  getJobs(context: CiConnectorContext): Promise<PipelineJob[]>;
  getLogs(context: CiConnectorContext): Promise<LogArtifact[]>;
  getArtifacts(context: CiConnectorContext): Promise<Artifact[]>;
}
