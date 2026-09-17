import type { TriageResult } from '../contracts/src/index.js';
import type { NormalizedFailureEvidence } from '../evidence/evidence-types.js';
import type { CompactEvidencePayload } from './ai-types.js';

const MAX_EXCERPTS = 8;
const MAX_EXCERPT_CHARS = 200;

export function buildCompactEvidencePayload(
  evidence: NormalizedFailureEvidence,
  deterministic: TriageResult
): CompactEvidencePayload {
  const primary = evidence.failedSteps[0];

  return {
    repository: evidence.pipelineRun.repository,
    pipeline: evidence.pipelineRun.pipelineName ?? evidence.pipelineRun.pipelineId,
    runId: evidence.pipelineRun.runId,
    failedJob: primary?.jobName ?? evidence.failedJobs[0]?.name,
    failedStep: primary?.stepName,
    stageType: evidence.pipelineStageType,
    logExcerpts: evidence.logExcerpts.slice(0, MAX_EXCERPTS).map((excerpt) => ({
      source: excerpt.source,
      stepName: excerpt.stepName,
      text: excerpt.text.slice(0, MAX_EXCERPT_CHARS)
    })),
    deterministicResult: {
      classification: deterministic.classification,
      subtype: deterministic.subtype,
      confidence: deterministic.confidence,
      probableCause: deterministic.probableCause,
      humanReviewRequired: deterministic.humanReviewRequired
    },
    artifactsAvailable: evidence.artifacts.map((artifact) => ({
      name: artifact.name,
      contentType: artifact.contentType
    })),
    knownFailureSignatures: evidence.detectedErrorSignatures,
    observations: {
      testsAppearedToFail: evidence.testsAppearedToFail,
      pipelineStatus: evidence.pipelineRun.status,
      failedJobCount: evidence.failedJobs.length,
      failedStepCount: evidence.failedSteps.length
    }
  };
}

export function buildAiMessages(payload: CompactEvidencePayload): { system: string; user: string } {
  return {
    system: [
      'You are a CI failure triage assistant.',
      'Use only the supplied compact evidence. Do not invent files, errors, stack frames, or facts.',
      'If the evidence is insufficient, classify as UNKNOWN with low confidence and humanReviewRequired=true.',
      'Ambiguous product vs test assertion cases must require human review.',
      'Evidence summaries must reference information actually present in the payload.',
      'Return JSON only with keys: classification, subtype, confidence, probableCause, evidence, recommendedAction, humanReviewRequired.',
      'classification must be one of: PRODUCT_DEFECT, AUTOMATION_DEFECT, FLAKY_TEST, TEST_DATA, ENVIRONMENT, CI_INFRASTRUCTURE, DEPENDENCY_CONFIG, AUTH_SECURITY, UNKNOWN.',
      'confidence must be a number between 0 and 1.',
      'evidence must be an array of { source, summary, locator? }.'
    ].join(' '),
    user: JSON.stringify(payload)
  };
}
