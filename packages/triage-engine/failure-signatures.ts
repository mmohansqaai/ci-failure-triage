import type { FailureCategory } from '../contracts/src/index.js';
import type { NormalizedFailureEvidence } from '../evidence/evidence-types.js';

export interface FailureSignature {
  id: string;
  classification: FailureCategory;
  subtype: string;
  patterns: RegExp[];
  minMatches?: number;
  confidence: number;
  probableCause: string;
  recommendedAction: string;
  humanReviewRequired: boolean;
  /** Lower number is evaluated first and wins when multiple signatures match. */
  priority: number;
  appliesTo?: (evidence: NormalizedFailureEvidence) => boolean;
}

function isTestStage(evidence: NormalizedFailureEvidence): boolean {
  return evidence.testsAppearedToFail || evidence.pipelineStageType === 'TEST_EXECUTION';
}

function isNonTestStage(evidence: NormalizedFailureEvidence): boolean {
  return !isTestStage(evidence);
}

function isDownstreamOrReporting(evidence: NormalizedFailureEvidence): boolean {
  if (
    evidence.pipelineStageType === 'DOWNSTREAM_INTEGRATION' ||
    evidence.pipelineStageType === 'ARTIFACT_REPORTING'
  ) {
    return true;
  }

  return evidence.failedSteps.some((step) =>
    /dashboard|publish results|health[- ]check|webhook|notify/.test(step.stepName)
  );
}

export const FAILURE_SIGNATURES: FailureSignature[] = [
  {
    id: 'auth-http-401-token',
    classification: 'AUTH_SECURITY',
    subtype: 'TOKEN_OR_UNAUTHORIZED',
    priority: 10,
    confidence: 0.88,
    humanReviewRequired: false,
    probableCause: 'The pipeline or tests received an authentication failure such as HTTP 401 or an expired/invalid token.',
    recommendedAction: 'Refresh credentials, tokens, and secrets used by the pipeline, then re-run.',
    patterns: [
      /\b401\s*Unauthorized\b/i,
      /status(?: code)?[:\s]*401\b/i,
      /Request failed with status code 401/i,
      /\bunauthorized\b/i,
      /invalid(?: or expired)? token/i,
      /token(?: has)? expired/i,
      /authentication failed/i
    ]
  },
  {
    id: 'auth-http-403',
    classification: 'AUTH_SECURITY',
    subtype: 'FORBIDDEN',
    priority: 11,
    confidence: 0.86,
    humanReviewRequired: false,
    probableCause: 'The pipeline or tests were denied access with HTTP 403 or a forbidden/unauthorized permission error.',
    recommendedAction: 'Check role, scope, and repository permissions for the identity used by CI.',
    patterns: [
      /\b403\s*Forbidden\b/i,
      /status(?: code)?[:\s]*403\b/i,
      /Request failed with status code 403/i,
      /\bforbidden\b/i,
      /access denied/i
    ]
  },
  {
    id: 'ci-downstream-service-unavailable',
    classification: 'CI_INFRASTRUCTURE',
    subtype: 'DOWNSTREAM_SERVICE_UNAVAILABLE',
    priority: 20,
    confidence: 0.91,
    humanReviewRequired: false,
    probableCause: 'Downstream dashboard/service did not respond to health checks.',
    recommendedAction: 'Verify dashboard/health-check endpoint availability and retry publishing once the service recovers.',
    appliesTo: isDownstreamOrReporting,
    minMatches: 1,
    patterns: [
      /curl:\s*\(28\)/i,
      /exit code 28/i,
      /operation timed out/i,
      /connection timed out/i,
      /dashboard.{0,120}(?:timeout|unavailable|timed out|failed)/i,
      /health[- ]check.{0,80}(?:timeout|timed out|fail)/i
    ]
  },
  {
    id: 'ci-dns-failure',
    classification: 'CI_INFRASTRUCTURE',
    subtype: 'DNS_FAILURE',
    priority: 21,
    confidence: 0.9,
    humanReviewRequired: false,
    probableCause: 'DNS resolution failed while the runner tried to reach a remote host.',
    recommendedAction: 'Inspect runner DNS, network policies, and the target hostname, then re-run the job.',
    patterns: [
      /could not resolve host/i,
      /getaddrinfo ENOTFOUND/i,
      /curl:\s*\(6\)/i,
      /ENOTFOUND/
    ]
  },
  {
    id: 'ci-curl-or-network-failure',
    classification: 'CI_INFRASTRUCTURE',
    subtype: 'NETWORK_OR_CURL_FAILURE',
    priority: 22,
    confidence: 0.84,
    humanReviewRequired: false,
    probableCause: 'A CI network/curl command failed while talking to infrastructure, not while executing product tests.',
    recommendedAction: 'Inspect the failing curl/network command, target URL, and runner connectivity.',
    appliesTo: isNonTestStage,
    patterns: [
      /curl:\s*\(\d+\)/i,
      /exit code 28/i,
      /network is unreachable/i,
      /failed to connect to/i
    ]
  },
  {
    id: 'ci-artifact-publish-failure',
    classification: 'CI_INFRASTRUCTURE',
    subtype: 'ARTIFACT_PUBLISHING_FAILURE',
    priority: 23,
    confidence: 0.87,
    humanReviewRequired: false,
    probableCause: 'Artifact or report publishing infrastructure failed after the job had already produced outputs.',
    recommendedAction: 'Retry artifact upload and check GitHub Actions artifact storage quota and permissions.',
    appliesTo: (evidence) =>
      evidence.pipelineStageType === 'ARTIFACT_REPORTING' || isNonTestStage(evidence),
    patterns: [
      /unable to upload artifact/i,
      /failed to createartifact/i,
      /artifact storage quota/i,
      /error uploading artifact/i
    ]
  },
  {
    id: 'ci-runner-failure',
    classification: 'CI_INFRASTRUCTURE',
    subtype: 'RUNNER_FAILURE',
    priority: 24,
    confidence: 0.85,
    humanReviewRequired: false,
    probableCause: 'The CI runner lost capacity or communication before the job completed cleanly.',
    recommendedAction: 'Re-run on a fresh runner and inspect self-hosted runner health if applicable.',
    patterns: [
      /lost communication with the server/i,
      /the runner has received a shutdown signal/i,
      /the runner process was stopped/i,
      /this runner is offline/i
    ]
  },
  {
    id: 'ci-resource-exhaustion',
    classification: 'CI_INFRASTRUCTURE',
    subtype: 'RESOURCE_EXHAUSTION',
    priority: 25,
    confidence: 0.89,
    humanReviewRequired: false,
    probableCause: 'The CI environment ran out of disk, memory, or other runner resources.',
    recommendedAction: 'Increase runner resources, clear disk, or split the job, then re-run.',
    patterns: [
      /no space left on device/i,
      /javascript heap out of memory/i,
      /ENOMEM/,
      /killed process .* memory/i
    ]
  },
  {
    id: 'env-http-5xx',
    classification: 'ENVIRONMENT',
    subtype: 'HTTP_5XX_UNAVAILABLE',
    priority: 30,
    confidence: 0.84,
    humanReviewRequired: false,
    probableCause: 'The target application or service returned HTTP 5xx / service-unavailable responses.',
    recommendedAction: 'Check application/cluster health, recent deploys, and upstream dependencies before re-running tests.',
    patterns: [
      /Request failed with status code 50[0234]/i,
      /status(?: code)?[:\s]*50[0234]\b/i,
      /\b50[0234]\s*Service Unavailable\b/i,
      /\b502\s*Bad Gateway\b/i,
      /\b504\s*Gateway Timeout\b/i,
      /\b500\s*Internal Server Error\b/i,
      /service unavailable/i
    ]
  },
  {
    id: 'env-connection-refused',
    classification: 'ENVIRONMENT',
    subtype: 'SERVICE_CONNECTION_REFUSED',
    priority: 31,
    confidence: 0.83,
    humanReviewRequired: false,
    probableCause: 'The target application or service refused connections and was unavailable during the run.',
    recommendedAction: 'Confirm the application is listening and reachable from CI, then re-run.',
    appliesTo: isTestStage,
    patterns: [
      /ECONNREFUSED/,
      /connection refused/i,
      /net::ERR_CONNECTION_REFUSED/i,
      /ERR_CONNECTION_REFUSED/
    ]
  },
  {
    id: 'dep-module-not-found',
    classification: 'DEPENDENCY_CONFIG',
    subtype: 'MODULE_NOT_FOUND',
    priority: 40,
    confidence: 0.86,
    humanReviewRequired: false,
    probableCause: 'A required package or module was missing from the CI install.',
    recommendedAction: 'Install the missing dependency, refresh lockfiles, and verify package manager install steps.',
    patterns: [
      /Cannot find module/i,
      /Cannot find package/i,
      /MODULE_NOT_FOUND/,
      /ERR_MODULE_NOT_FOUND/,
      /Module not found/i
    ]
  },
  {
    id: 'dep-missing-config',
    classification: 'DEPENDENCY_CONFIG',
    subtype: 'INVALID_OR_MISSING_CONFIG',
    priority: 41,
    confidence: 0.8,
    humanReviewRequired: false,
    probableCause: 'Required configuration was missing or invalid.',
    recommendedAction: 'Restore the missing config file or environment variable and re-run the pipeline.',
    patterns: [
      /ENOENT: no such file or directory.*(?:config|\.env)/i,
      /missing required (?:env|environment|config)/i,
      /configuration file .* not found/i,
      /Invalid configuration/i
    ]
  },
  {
    id: 'flaky-retry-success',
    classification: 'FLAKY_TEST',
    subtype: 'RETRY_THEN_SUCCESS',
    priority: 50,
    confidence: 0.7,
    humanReviewRequired: true,
    probableCause: 'Retry/timing evidence indicates an intermittent test rather than a stable product failure.',
    recommendedAction: 'Inspect retry history, quarantine or harden the intermittent test, and re-run to confirm.',
    appliesTo: isTestStage,
    patterns: [
      /passed on retry/i,
      /\(\d+ retried\)/i,
      /restored from retry/i,
      /retrying, attempt/i
    ]
  },
  {
    id: 'auto-playwright-strict-mode',
    classification: 'AUTOMATION_DEFECT',
    subtype: 'PLAYWRIGHT_STRICT_MODE',
    priority: 60,
    confidence: 0.9,
    humanReviewRequired: false,
    probableCause: 'Playwright strict mode rejected a locator that resolved to multiple elements.',
    recommendedAction: 'Tighten the locator so it uniquely identifies one element, then re-run the test.',
    appliesTo: isTestStage,
    patterns: [
      /strict mode violation/i,
      /resolved to \d+ elements/i
    ]
  },
  {
    id: 'auto-selector-failure',
    classification: 'AUTOMATION_DEFECT',
    subtype: 'SELECTOR_FAILURE',
    priority: 61,
    confidence: 0.86,
    humanReviewRequired: false,
    probableCause: 'A selector used by automation was invalid or could not be parsed.',
    recommendedAction: 'Fix the CSS/XPath/Playwright selector syntax and re-run the failing test.',
    appliesTo: isTestStage,
    patterns: [
      /invalid (?:css |xpath )?selector/i,
      /malformed selector/i,
      /engine "[\w-]+" is unknown/i
    ]
  },
  {
    id: 'auto-locator-failure',
    classification: 'AUTOMATION_DEFECT',
    subtype: 'LOCATOR_FAILURE',
    priority: 62,
    confidence: 0.85,
    humanReviewRequired: false,
    probableCause: 'A UI locator failed to target the intended element during test execution.',
    recommendedAction: 'Update the locator/test to match the current UI, then re-run.',
    appliesTo: isTestStage,
    patterns: [
      /waiting for locator/i,
      /locator\.(?:click|fill|check|hover|press|waitFor)/i,
      /Error: locator\s/i
    ]
  },
  {
    id: 'auto-element-not-found',
    classification: 'AUTOMATION_DEFECT',
    subtype: 'ELEMENT_NOT_FOUND',
    priority: 63,
    confidence: 0.84,
    humanReviewRequired: false,
    probableCause: 'Automation expected an element that was not found or not visible.',
    recommendedAction: 'Confirm the element exists in this environment and update the test if the UI changed.',
    appliesTo: isTestStage,
    patterns: [
      /resolved to 0 elements/i,
      /element (?:is )?not (?:found|visible|attached)/i,
      /error: element not found/i,
      /no node found for selector/i
    ]
  },
  {
    id: 'product-assertion-mismatch',
    classification: 'PRODUCT_DEFECT',
    subtype: 'ASSERTION_MISMATCH',
    priority: 80,
    confidence: 0.62,
    humanReviewRequired: true,
    probableCause: 'A business assertion compared expected and actual values and they did not match.',
    recommendedAction: 'Have a human confirm whether the product behavior or the test expectation is wrong.',
    appliesTo: isTestStage,
    patterns: [
      /expect\(received\)\.to(?:Be|Equal|StrictEqual|Contain)/i,
      /AssertionError/i,
      /Expected:\s+.+\s+Received:/is
    ]
  }
];
