import type { PipelineStatus, TriageResult } from '../contracts/src/index.js';
import type { NormalizedFailureEvidence } from '../evidence/evidence-types.js';
import { selectHumanReadableEvidence } from './human-evidence.js';

export function formatTriageReport(
  evidence: NormalizedFailureEvidence,
  result: TriageResult,
  analysisMode: 'DETERMINISTIC' | 'AI_ASSISTED' = 'DETERMINISTIC'
): string {
  const primary = evidence.failedSteps[0];
  const failedJob = primary?.jobName ?? evidence.failedJobs[0]?.name ?? 'Unknown';
  const failedStep = primary?.stepName ?? 'Unknown';

  return [
    'CI FAILURE TRIAGE',
    '================================================',
    '',
    'Repository:',
    evidence.pipelineRun.repository ?? 'Unknown',
    '',
    'Pipeline:',
    evidence.pipelineRun.pipelineName ?? evidence.pipelineRun.pipelineId,
    '',
    'Run:',
    evidence.pipelineRun.runId,
    '',
    'Pipeline Status:',
    formatPipelineStatus(evidence.pipelineRun.status),
    '',
    'Analysis Mode:',
    analysisMode,
    '',
    'Failed Job:',
    failedJob,
    '',
    'Failed Step:',
    failedStep,
    '',
    'Classification:',
    result.classification,
    '',
    'Subtype:',
    result.subtype ?? 'UNKNOWN',
    '',
    'Confidence:',
    formatConfidence(result.confidence),
    '',
    'Probable Cause:',
    result.probableCause,
    '',
    'Evidence:',
    ...formatEvidenceLines(result, evidence),
    '',
    'Recommended Action:',
    result.recommendedAction,
    '',
    'Human Review Required:',
    result.humanReviewRequired ? 'YES' : 'NO',
    ''
  ].join('\n');
}

function formatPipelineStatus(status: PipelineStatus): string {
  switch (status) {
    case 'failure':
      return 'FAILED';
    case 'success':
      return 'SUCCESS';
    case 'in_progress':
      return 'IN PROGRESS';
    case 'queued':
      return 'QUEUED';
    case 'cancelled':
      return 'CANCELLED';
    case 'skipped':
      return 'SKIPPED';
    default:
      return 'UNKNOWN';
  }
}

function formatConfidence(confidence: number): string {
  const percent = confidence <= 1 ? confidence * 100 : confidence;
  return `${Math.round(percent)}%`;
}

function formatEvidenceLines(result: TriageResult, collected: NormalizedFailureEvidence): string[] {
  const selected = selectHumanReadableEvidence(result, collected);
  if (selected.length === 0) {
    return ['- None'];
  }

  return selected.map((item) => `- ${item.summary}`);
}
