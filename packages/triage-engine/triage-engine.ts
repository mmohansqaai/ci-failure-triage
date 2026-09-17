import type { EvidenceReference, TriageResult } from '../contracts/src/index.js';
import { collectFailureEvidence } from '../evidence/evidence-collector.js';
import type { EvidenceInput, NormalizedFailureEvidence } from '../evidence/evidence-types.js';
import { evaluateRules, type RuleMatch } from './rule-engine.js';

export interface TriageEngineOutput {
  evidence: NormalizedFailureEvidence;
  result: TriageResult;
}

export function triageFailure(input: EvidenceInput): TriageEngineOutput {
  const evidence = collectFailureEvidence(input);
  const match = evaluateRules(evidence);
  return {
    evidence,
    result: match ? toMatchedResult(match, evidence) : toUnknownResult(evidence)
  };
}

function toMatchedResult(match: RuleMatch, evidence: NormalizedFailureEvidence): TriageResult {
  return {
    id: triageId(evidence),
    classification: match.signature.classification,
    subtype: match.signature.subtype,
    confidence: match.signature.confidence,
    probableCause: match.signature.probableCause,
    evidence: buildEvidenceReferences(evidence, match),
    recommendedAction: match.signature.recommendedAction,
    humanReviewRequired: match.signature.humanReviewRequired,
    createdAt: new Date().toISOString()
  };
}

function toUnknownResult(evidence: NormalizedFailureEvidence): TriageResult {
  return {
    id: triageId(evidence),
    classification: 'UNKNOWN',
    subtype: 'INSUFFICIENT_EVIDENCE',
    confidence: 0.2,
    probableCause: 'Evidence is insufficient for a deterministic classification.',
    evidence: buildEvidenceReferences(evidence),
    recommendedAction: 'Collect additional logs and review the failed step manually.',
    humanReviewRequired: true,
    createdAt: new Date().toISOString()
  };
}

function triageId(evidence: NormalizedFailureEvidence): string {
  return `triage-${evidence.pipelineRun.runId}`;
}

function buildEvidenceReferences(
  evidence: NormalizedFailureEvidence,
  match?: RuleMatch
): EvidenceReference[] {
  const references: EvidenceReference[] = [];
  const primary = evidence.failedSteps[0];

  if (primary) {
    references.push({
      source: 'pipeline',
      summary: `Failed step "${primary.stepName}" in job "${primary.jobName}"`,
      locator: primary.stepName
    });
  } else if (evidence.failedJobs[0]) {
    references.push({
      source: 'pipeline',
      summary: `Failed job "${evidence.failedJobs[0].name}" did not expose a failed step`,
      locator: evidence.failedJobs[0].name
    });
  }

  references.push({
    source: 'tests',
    summary: evidence.testsAppearedToFail
      ? 'Test execution appears to have failed'
      : 'Test execution did not fail'
  });

  references.push({
    source: 'pipeline-stage',
    summary: `Failure occurred during ${stageLabel(evidence.pipelineStageType)}`
  });

  if (!evidence.testsAppearedToFail && isPublishingStage(evidence.pipelineStageType) && primary) {
    references.push({
      source: 'pipeline',
      summary: `Publishing/downstream step "${primary.stepName}" failed`
    });
  }

  if (evidence.artifacts.length > 0 && !evidence.testsAppearedToFail) {
    references.push({
      source: 'artifacts',
      summary: `Artifacts were uploaded (${evidence.artifacts.map((artifact) => artifact.name).join(', ')})`
    });
  }

  if (evidence.detectedErrorSignatures.includes('REPEATED_CURL_TIMEOUT') ||
      evidence.detectedErrorSignatures.includes('CURL_EXIT_28')) {
    references.push({
      source: 'logs',
      summary: evidence.detectedErrorSignatures.includes('REPEATED_CURL_TIMEOUT')
        ? 'Repeated health-check timeout with curl error/exit code 28'
        : 'Health-check or curl timeout with exit code 28'
    });
  } else if (evidence.detectedErrorSignatures.includes('HEALTH_CHECK')) {
    references.push({
      source: 'logs',
      summary: 'Health-check failure was recorded in the logs'
    });
  }

  if (match) {
    references.push({
      source: 'rule',
      summary: `Matched signature ${match.signature.id} (${match.signature.subtype})`,
      locator: match.signature.id
    });
  }

  for (const excerpt of evidence.logExcerpts.slice(0, 6)) {
    references.push({
      source: excerpt.source || 'logs',
      summary: excerpt.text,
      locator: excerpt.stepName
    });
  }

  return references;
}

function isPublishingStage(stage: NormalizedFailureEvidence['pipelineStageType']): boolean {
  return stage === 'DOWNSTREAM_INTEGRATION' || stage === 'ARTIFACT_REPORTING';
}

function stageLabel(stage: NormalizedFailureEvidence['pipelineStageType']): string {
  switch (stage) {
    case 'TEST_EXECUTION':
      return 'test execution';
    case 'SETUP_BUILD':
      return 'setup/build';
    case 'ARTIFACT_REPORTING':
      return 'artifact reporting';
    case 'DOWNSTREAM_INTEGRATION':
      return 'downstream integration';
    case 'CI_INFRASTRUCTURE':
      return 'CI infrastructure';
    default:
      return 'an unknown pipeline stage';
  }
}
