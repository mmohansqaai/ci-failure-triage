import type { Artifact, LogArtifact, PipelineJob, PipelineRun, PipelineStatus, PipelineStep } from '../../contracts/src/index.js';
import type { GitHubArtifact, GitHubJob, GitHubStep, GitHubWorkflowRun } from './github-actions.types.js';

const ACTIVE_STATUS_MAP: Record<string, PipelineStatus> = {
  queued: 'queued',
  waiting: 'queued',
  requested: 'queued',
  pending: 'queued',
  in_progress: 'in_progress'
};

const CONCLUSION_MAP: Record<string, PipelineStatus> = {
  success: 'success',
  failure: 'failure',
  timed_out: 'failure',
  startup_failure: 'failure',
  cancelled: 'cancelled',
  skipped: 'skipped'
};

export function mapGitHubStatus(
  status?: string | null,
  conclusion?: string | null
): PipelineStatus {
  const normalizedStatus = status?.toLowerCase();
  const normalizedConclusion = conclusion?.toLowerCase();

  if (normalizedStatus && normalizedStatus in ACTIVE_STATUS_MAP) {
    return ACTIVE_STATUS_MAP[normalizedStatus];
  }

  if (normalizedConclusion) {
    return CONCLUSION_MAP[normalizedConclusion] ?? 'unknown';
  }

  if (normalizedStatus) {
    return CONCLUSION_MAP[normalizedStatus] ?? 'unknown';
  }

  return 'unknown';
}

export function mapWorkflowRun(run: GitHubWorkflowRun, repository: string): PipelineRun {
  const completed = Boolean(run.conclusion) || run.status?.toLowerCase() === 'completed';

  return {
    provider: 'github-actions',
    pipelineId: run.path ?? String(run.workflow_id),
    runId: String(run.id),
    pipelineName: run.name,
    repository,
    branch: run.head_branch ?? undefined,
    commitSha: run.head_sha,
    triggeredBy: run.triggering_actor?.login ?? run.actor?.login,
    startedAt: run.run_started_at ?? run.created_at,
    completedAt: completed ? run.updated_at : undefined,
    status: mapGitHubStatus(run.status, run.conclusion),
    jobs: [],
    metadata: {
      htmlUrl: run.html_url,
      event: run.event,
      runAttempt: run.run_attempt,
      runNumber: run.run_number,
      workflowId: run.workflow_id,
      displayTitle: run.display_title
    }
  };
}

export function mapStep(step: GitHubStep): PipelineStep {
  return {
    id: String(step.number),
    name: step.name,
    status: mapGitHubStatus(step.status, step.conclusion),
    startedAt: step.started_at ?? undefined,
    completedAt: step.completed_at ?? undefined
  };
}

export function mapJob(job: GitHubJob): PipelineJob {
  return {
    id: String(job.id),
    name: job.name,
    status: mapGitHubStatus(job.status, job.conclusion),
    steps: (job.steps ?? []).map(mapStep),
    startedAt: job.started_at ?? undefined,
    completedAt: job.completed_at ?? undefined
  };
}

export function mapArtifact(artifact: GitHubArtifact): Artifact {
  return {
    id: String(artifact.id),
    name: artifact.name,
    contentType: 'application/zip',
    downloadUrl: artifact.archive_download_url,
    sizeBytes: artifact.size_in_bytes,
    metadata: {
      expired: artifact.expired,
      expiresAt: artifact.expires_at,
      url: artifact.url
    }
  };
}

export function mapJobLogs(job: GitHubJob, content: string): LogArtifact {
  return {
    id: `job-${job.id}`,
    source: job.name,
    content,
    jobId: String(job.id)
  };
}
