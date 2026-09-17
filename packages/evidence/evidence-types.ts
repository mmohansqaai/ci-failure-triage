import type { Artifact, LogArtifact, PipelineJob, PipelineRun } from '../contracts/src/index.js';

export type PipelineStageType =
  | 'TEST_EXECUTION'
  | 'SETUP_BUILD'
  | 'ARTIFACT_REPORTING'
  | 'DOWNSTREAM_INTEGRATION'
  | 'CI_INFRASTRUCTURE'
  | 'UNKNOWN';

export interface EvidenceInput {
  pipelineRun: PipelineRun;
  jobs: PipelineJob[];
  logs: LogArtifact[];
  artifacts: Artifact[];
}

export interface FailedStepEvidence {
  jobId: string;
  jobName: string;
  stepId?: string;
  stepName: string;
  status: string;
}

export interface LogExcerpt {
  source: string;
  jobId?: string;
  stepName?: string;
  text: string;
}

export interface NormalizedFailureEvidence {
  pipelineRun: PipelineRun;
  failedJobs: PipelineJob[];
  failedSteps: FailedStepEvidence[];
  testsAppearedToFail: boolean;
  pipelineStageType: PipelineStageType;
  logExcerpts: LogExcerpt[];
  detectedErrorSignatures: string[];
  artifacts: Artifact[];
  combinedLogText: string;
}
