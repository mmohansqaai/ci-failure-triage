export interface GitHubActor {
  login: string;
}

export interface GitHubWorkflowRun {
  id: number;
  name?: string;
  display_title?: string;
  head_branch?: string | null;
  head_sha?: string;
  path?: string;
  run_number?: number;
  event?: string;
  status: string;
  conclusion: string | null;
  workflow_id: number;
  html_url?: string;
  url?: string;
  created_at?: string;
  updated_at?: string;
  run_started_at?: string;
  actor?: GitHubActor;
  triggering_actor?: GitHubActor;
  run_attempt?: number;
}

export interface GitHubStep {
  name: string;
  status: string;
  conclusion: string | null;
  number: number;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface GitHubJob {
  id: number;
  run_id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  html_url?: string;
  steps?: GitHubStep[];
}

export interface GitHubJobsResponse {
  total_count: number;
  jobs: GitHubJob[];
}

export interface GitHubArtifact {
  id: number;
  name: string;
  size_in_bytes?: number;
  url?: string;
  archive_download_url?: string;
  expired?: boolean;
  created_at?: string;
  expires_at?: string;
  updated_at?: string;
}

export interface GitHubArtifactsResponse {
  total_count: number;
  artifacts: GitHubArtifact[];
}
