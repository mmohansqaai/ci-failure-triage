import type { EvidenceReference, TriageResult } from '../contracts/src/index.js';
import type { NormalizedFailureEvidence } from '../evidence/evidence-types.js';
import { FAILURE_SIGNATURES, type FailureSignature } from './failure-signatures.js';

export const MAX_HUMAN_READABLE_EVIDENCE = 8;

const GENERIC_SETUP_LINE =
  /getting github token|set up job|complete job|post[- ]job|runner (?:version|name|image)|operating system|prepare (?:all required actions|workflow|the existing)|download action repository|##\[group\]run actions\/|run actions\/(?:checkout|setup-node|setup-python|cache)|added matcher|removed matcher|##\[command\]|git (?:init|remote|fetch|submodule|config|checkout)|temp(?:orary)? directory|workspace directory|requested labels|job is about to start|waiting for a runner|cleaning up orphan processes|terminate orphan process|^shell: |^env: |^with: /i;

interface RankingContext {
  result: TriageResult;
  signature?: FailureSignature;
  failedStep?: string;
}

export function selectHumanReadableEvidence(
  result: TriageResult,
  collected?: NormalizedFailureEvidence
): EvidenceReference[] {
  const signature = findWinningSignature(result);
  const failedStep =
    collected?.failedSteps[0]?.stepName ??
    result.evidence.find((item) => item.source === 'pipeline')?.locator;

  const ranked = result.evidence
    .map((item, index) => ({
      item,
      index,
      score: scoreEvidence(item, { result, signature, failedStep })
    }))
    .filter((entry): entry is { item: EvidenceReference; index: number; score: number } => entry.score !== null)
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const unique: EvidenceReference[] = [];
  const seen = new Set<string>();

  for (const entry of ranked) {
    const key = normalizeSummary(entry.item.summary);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(entry.item);

    if (unique.length >= MAX_HUMAN_READABLE_EVIDENCE) {
      break;
    }
  }

  if (unique.length === 0) {
    return result.evidence.slice(0, MAX_HUMAN_READABLE_EVIDENCE);
  }

  return unique;
}

function findWinningSignature(result: TriageResult): FailureSignature | undefined {
  const ruleLocator = result.evidence.find((item) => item.source === 'rule')?.locator;
  if (ruleLocator) {
    return FAILURE_SIGNATURES.find((signature) => signature.id === ruleLocator);
  }

  return FAILURE_SIGNATURES.find(
    (signature) =>
      signature.classification === result.classification && signature.subtype === result.subtype
  );
}

function scoreEvidence(item: EvidenceReference, context: RankingContext): number | null {
  if (isBareFailedStepName(item, context.failedStep)) {
    return null;
  }

  const contributes = contributesToClassification(item, context);
  if (GENERIC_SETUP_LINE.test(item.summary) && !contributes) {
    return null;
  }

  let score = 10;

  if (contributes || matchesWinningSignature(item.summary, context.signature)) {
    score += 50;
  }

  if (associatedWithFailedStep(item, context.failedStep)) {
    score += 20;
  }

  switch (item.source) {
    case 'logs':
      score += isSynthesizedLogSummary(item.summary) ? 35 : 18;
      break;
    case 'pipeline':
      score += 30;
      break;
    case 'tests':
      score += 28;
      break;
    case 'pipeline-stage':
      score += 16;
      break;
    case 'artifacts':
      score += 12;
      break;
    case 'rule':
      score += 14;
      break;
    case 'deterministic':
      score += 8;
      break;
    default:
      break;
  }

  return score;
}

function contributesToClassification(item: EvidenceReference, context: RankingContext): boolean {
  if (matchesWinningSignature(item.summary, context.signature)) {
    return true;
  }

  const text = item.summary;
  switch (context.result.classification) {
    case 'CI_INFRASTRUCTURE':
      return /curl:|exit code 28|enotfound|could not resolve host|no space left|lost communication|runner (?:offline|shutdown)|health-check timeout|dashboard/i.test(text);
    case 'ENVIRONMENT':
      return /50[0234]|service unavailable|econnrefused|connection refused/i.test(text);
    case 'AUTH_SECURITY':
      return /401|403|unauthorized|forbidden|expired token|invalid token|authentication failed/i.test(text);
    case 'DEPENDENCY_CONFIG':
      return /cannot find module|module not found|missing required|invalid configuration|npm err/i.test(text);
    case 'AUTOMATION_DEFECT':
      return /strict mode|locator|selector|element not found|resolved to \d+ elements/i.test(text);
    case 'PRODUCT_DEFECT':
      return /expect\(received\)|assertionerror|expected:|received:/i.test(text);
    default:
      return false;
  }
}

function matchesWinningSignature(summary: string, signature?: FailureSignature): boolean {
  if (!signature) {
    return false;
  }

  return signature.patterns.some((pattern) => pattern.test(summary));
}

function associatedWithFailedStep(item: EvidenceReference, failedStep?: string): boolean {
  if (!failedStep) {
    return false;
  }

  const needle = failedStep.toLowerCase();
  return (
    item.locator?.toLowerCase() === needle ||
    item.summary.toLowerCase().includes(needle)
  );
}

function isBareFailedStepName(item: EvidenceReference, failedStep?: string): boolean {
  if (!failedStep) {
    return false;
  }

  return normalizeSummary(item.summary) === normalizeSummary(failedStep);
}

function isSynthesizedLogSummary(summary: string): boolean {
  return /health-check timeout|curl error\/exit code|health-check failure was recorded/i.test(summary);
}

function normalizeSummary(summary: string): string {
  return summary.toLowerCase().replace(/\s+/g, ' ').trim();
}
