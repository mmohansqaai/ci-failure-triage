import type { EvidenceReference, TriageResult } from '../contracts/src/index.js';
import { collectFailureEvidence } from '../evidence/evidence-collector.js';
import type { EvidenceInput, NormalizedFailureEvidence } from '../evidence/evidence-types.js';
import { evaluateAllRules, type RuleMatch } from './rule-engine.js';

export interface TriageEngineOutput {
  evidence: NormalizedFailureEvidence;
  result: TriageResult;
}

export function triageFailure(input: EvidenceInput): TriageEngineOutput {
  const evidence = collectFailureEvidence(input);
  const matches = evaluateAllRules(evidence);
  return {
    evidence,
    result: matches[0] ? toMatchedResult(matches, evidence) : toUnknownResult(evidence)
  };
}

function toMatchedResult(matches: RuleMatch[], evidence: NormalizedFailureEvidence): TriageResult {
  const winner = matches[0];
  if (!winner) {
    return toUnknownResult(evidence);
  }

  const extraClassifications = distinctRelatedFailures(matches);
  const mixed = extraClassifications.length > 0;

  return {
    id: triageId(evidence),
    classification: winner.signature.classification,
    subtype: winner.signature.subtype,
    confidence: mixed ? Math.min(winner.signature.confidence, 0.72) : winner.signature.confidence,
    probableCause: mixed ? mixedProbableCause(matches) : winner.signature.probableCause,
    evidence: buildEvidenceReferences(evidence, matches),
    recommendedAction: mixed
      ? `${winner.signature.recommendedAction} Other failed tests appear to have different root causes and need separate review.`
      : winner.signature.recommendedAction,
    humanReviewRequired: mixed ? true : winner.signature.humanReviewRequired,
    relatedFailures: extraClassifications.length > 0 ? extraClassifications : undefined,
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
  matches: RuleMatch[] = []
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

  if (matches[0]) {
    references.push({
      source: 'rule',
      summary: `Matched signature ${matches[0].signature.id} (${matches[0].signature.subtype})`,
      locator: matches[0].signature.id
    });
  }

  for (const extra of matches.slice(1)) {
    references.push({
      source: 'rule',
      summary: `Also matched ${extra.signature.classification}/${extra.signature.subtype}`,
      locator: extra.signature.id
    });
  }

  for (const testName of extractFailedPlaywrightTests(evidence.combinedLogText).slice(0, 5)) {
    references.push({
      source: 'tests',
      summary: `Failed Playwright test: ${testName}`
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

function distinctRelatedFailures(matches: RuleMatch[]): string[] {
  const winner = matches[0];
  if (!winner) {
    return [];
  }

  const seen = new Set<string>([`${winner.signature.classification}/${winner.signature.subtype}`]);
  const related: string[] = [];

  for (const match of matches.slice(1)) {
    const key = `${match.signature.classification}/${match.signature.subtype}`;
    if (seen.has(key) || match.signature.classification === winner.signature.classification) {
      continue;
    }
    seen.add(key);
    related.push(key);
  }

  return related;
}

function mixedProbableCause(matches: RuleMatch[]): string {
  const winner = matches[0];
  const labels: string[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    if (seen.has(match.signature.classification)) {
      continue;
    }
    seen.add(match.signature.classification);
    labels.push(`${match.signature.classification}/${match.signature.subtype}`);
  }

  return `Multiple distinct failures were found (${labels.join('; ')}). Primary signal: ${winner?.signature.probableCause ?? 'insufficient evidence'}`;
}

function extractFailedPlaywrightTests(logText: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const match of logText.matchAll(/^\s*\d+\)\s+\[[^\]]+\]\s+›\s+(.+)$/gm)) {
    const name = match[1]?.trim();
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    names.push(name);
  }
  return names;
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
