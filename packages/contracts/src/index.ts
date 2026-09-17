export type CiProvider = 'github-actions' | 'jenkins' | 'azure-devops' | 'gitlab-ci' | 'circleci' | 'unknown';

export type PipelineStatus = 'queued' | 'in_progress' | 'success' | 'failure' | 'cancelled' | 'skipped' | 'unknown';

export interface PipelineStep {
  id?: string;
  name: string;
  status: PipelineStatus;
  startedAt?: string;
  completedAt?: string;
  logs?: string;
}

export interface PipelineJob {
  id: string;
  name: string;
  status: PipelineStatus;
  steps: PipelineStep[];
  startedAt?: string;
  completedAt?: string;
}

export interface Artifact {
  id: string;
  name: string;
  contentType?: string;
  downloadUrl?: string;
  sizeBytes?: number;
  metadata?: Record<string, unknown>;
}

export interface LogArtifact {
  id: string;
  source: string;
  content: string;
  jobId?: string;
  stepName?: string;
}

export interface PipelineRun {
  provider: CiProvider;
  pipelineId: string;
  runId: string;
  pipelineName?: string;
  repository?: string;
  branch?: string;
  commitSha?: string;
  triggeredBy?: string;
  startedAt?: string;
  completedAt?: string;
  status: PipelineStatus;
  jobs: PipelineJob[];
  metadata: Record<string, unknown>;
}

export type FailureCategory =
  | 'PRODUCT_DEFECT'
  | 'AUTOMATION_DEFECT'
  | 'FLAKY_TEST'
  | 'TEST_DATA'
  | 'ENVIRONMENT'
  | 'CI_INFRASTRUCTURE'
  | 'DEPENDENCY_CONFIG'
  | 'AUTH_SECURITY'
  | 'UNKNOWN';

export interface EvidenceReference {
  source: string;
  summary: string;
  locator?: string;
}

export interface TriageResult {
  id: string;
  classification: FailureCategory;
  subtype?: string;
  confidence: number;
  probableCause: string;
  evidence: EvidenceReference[];
  recommendedAction: string;
  ownerSuggestion?: string;
  humanReviewRequired: boolean;
  relatedFailures?: string[];
  createdAt: string;
}
