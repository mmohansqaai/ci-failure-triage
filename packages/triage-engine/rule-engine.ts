import type { NormalizedFailureEvidence } from '../evidence/evidence-types.js';
import { FAILURE_SIGNATURES, type FailureSignature } from './failure-signatures.js';

export interface RuleMatch {
  signature: FailureSignature;
  matchedPatternSources: string[];
}

export function evaluateRules(evidence: NormalizedFailureEvidence): RuleMatch | undefined {
  return evaluateAllRules(evidence)[0];
}

export function evaluateAllRules(evidence: NormalizedFailureEvidence): RuleMatch[] {
  const haystack = buildHaystack(evidence);
  const matches: RuleMatch[] = [];

  for (const signature of FAILURE_SIGNATURES) {
    if (signature.appliesTo && !signature.appliesTo(evidence)) {
      continue;
    }

    const matchedPatternSources = signature.patterns
      .filter((pattern) => pattern.test(haystack))
      .map((pattern) => pattern.source);

    if (matchedPatternSources.length >= (signature.minMatches ?? 1)) {
      matches.push({ signature, matchedPatternSources });
    }
  }

  matches.sort((left, right) => {
    if (left.signature.priority !== right.signature.priority) {
      return left.signature.priority - right.signature.priority;
    }

    if (left.matchedPatternSources.length !== right.matchedPatternSources.length) {
      return right.matchedPatternSources.length - left.matchedPatternSources.length;
    }

    return right.signature.confidence - left.signature.confidence;
  });

  return uniqueSignatures(matches);
}

function uniqueSignatures(matches: RuleMatch[]): RuleMatch[] {
  const seen = new Set<string>();
  return matches.filter((match) => {
    if (seen.has(match.signature.id)) {
      return false;
    }
    seen.add(match.signature.id);
    return true;
  });
}

function buildHaystack(evidence: NormalizedFailureEvidence): string {
  const failedStepNames = evidence.failedSteps.map((step) => step.stepName).join('\n');
  const excerpts = evidence.logExcerpts.map((excerpt) => excerpt.text).join('\n');
  return `${failedStepNames}\n${excerpts}\n${evidence.combinedLogText}`;
}
