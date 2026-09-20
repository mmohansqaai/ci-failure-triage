import type { PipelineJob, PipelineStep } from '../contracts/src/index.js';
import type {
  EvidenceInput,
  FailedStepEvidence,
  LogExcerpt,
  NormalizedFailureEvidence,
  PipelineStageType
} from './evidence-types.js';

const INTERESTING_LOG_LINE =
  /\berror\b|\bfail(?:ed|ure)?\b|timeout|exception|denied|unauthorized|forbidden|econnrefused|enotfound|curl:|exit code|strict mode|locator|toBeVisible|getByRole|net::ERR_|50[0234]|401|403|not found|unable to|cannot find|expected:|received:|assertion|killed|no space|module not found|health[- ]check|dashboard|\btoken\b|service unavailable|connection refused|✘/i;

const LOW_VALUE_LOG_LINE =
  /demo_dashboard_failures|deprecationwarning|node\.js 20 is deprecated|ubuntu-latest label will migrate|actions_allow_use_unsecure_node_version/i;

const ERROR_SIGNATURE_DETECTORS: Array<{ id: string; pattern: RegExp }> = [
  { id: 'CURL_EXIT_28', pattern: /curl:\s*\(28\)|exit code 28/i },
  { id: 'CURL_FAILURE', pattern: /curl:\s*\(\d+\)/i },
  { id: 'HEALTH_CHECK', pattern: /health[- ]check/i },
  { id: 'HTTP_401', pattern: /\b401\b|\bunauthorized\b/i },
  { id: 'HTTP_403', pattern: /\b403\b|\bforbidden\b/i },
  { id: 'HTTP_5XX', pattern: /\b(500|502|503|504)\b|service unavailable|bad gateway|gateway timeout/i },
  { id: 'CONNECTION_REFUSED', pattern: /connection refused|econnrefused|err_connection_refused|net::ERR_CONNECTION_REFUSED/i },
  { id: 'DNS_FAILURE', pattern: /could not resolve host|getaddrinfo enotfound/i },
  { id: 'STRICT_MODE', pattern: /strict mode violation/i },
  { id: 'LOCATOR_FAILURE', pattern: /waiting for locator|waiting for getByRole|locator resolved to|element\(s\) not found|toBeVisible/i },
  { id: 'ASSERTION_MISMATCH', pattern: /expect\(received\)|assertionerror|Expected:\s+".+"\s+Received:\s+"/is },
  { id: 'MODULE_NOT_FOUND', pattern: /cannot find module|module not found|err_module_not_found/i },
  { id: 'RETRY_EVIDENCE', pattern: /passed on retry|\(\d+ retried\)/i }
];

export function collectFailureEvidence(input: EvidenceInput): NormalizedFailureEvidence {
  const jobs = input.jobs.length > 0 ? input.jobs : input.pipelineRun.jobs;
  const failedJobs = jobs.filter((job) => job.status === 'failure');
  const failedSteps = collectFailedSteps(failedJobs);
  const primaryFailure = failedSteps[0];
  const pipelineStageType = inferPipelineStageType(
    primaryFailure?.stepName ?? '',
    primaryFailure?.jobName ?? failedJobs[0]?.name ?? input.pipelineRun.pipelineName ?? ''
  );
  const testsAppearedToFail = failedSteps.some(
    (step) => inferPipelineStageType(step.stepName, step.jobName) === 'TEST_EXECUTION'
  );
  const combinedLogText = input.logs.map((log) => stripAnsi(log.content)).join('\n');
  const logExcerpts = extractLogExcerpts(input.logs, primaryFailure);
  const detectedErrorSignatures = detectErrorSignatures(combinedLogText);

  return {
    pipelineRun: {
      ...input.pipelineRun,
      jobs
    },
    failedJobs,
    failedSteps,
    testsAppearedToFail,
    pipelineStageType,
    logExcerpts,
    detectedErrorSignatures,
    artifacts: input.artifacts,
    combinedLogText
  };
}

export function inferPipelineStageType(stepName: string, jobName = ''): PipelineStageType {
  const text = `${stepName} ${jobName}`.toLowerCase();

  if (
    /dashboard|health[- ]check|publish results|webhook|notify|slack|teams|jira|downstream/.test(text)
  ) {
    return 'DOWNSTREAM_INTEGRATION';
  }

  if (
    /upload artifact|upload(?:ing)? .*?(?:report|artifact)|publish (?:report|artifact)|html report|archive artifacts?/.test(
      text
    )
  ) {
    return 'ARTIFACT_REPORTING';
  }

  if (
    /(?:^|\s)(?:set up job|complete job|post-job|runner)\b|lost communication|no space left/.test(text)
  ) {
    return 'CI_INFRASTRUCTURE';
  }

  if (
    /setup|install|build|compile|checkout|cache|dependencies|npm ci|pnpm|yarn|restore/.test(text)
  ) {
    return 'SETUP_BUILD';
  }

  if (/test|playwright|jest|cypress|mocha|pytest|e2e|spec/.test(text)) {
    return 'TEST_EXECUTION';
  }

  return 'UNKNOWN';
}

function collectFailedSteps(failedJobs: PipelineJob[]): FailedStepEvidence[] {
  const failedSteps: FailedStepEvidence[] = [];

  for (const job of failedJobs) {
    for (const step of job.steps) {
      if (isFailedStatus(step)) {
        failedSteps.push({
          jobId: job.id,
          jobName: job.name,
          stepId: step.id,
          stepName: step.name,
          status: step.status
        });
      }
    }
  }

  return failedSteps;
}

function isFailedStatus(step: PipelineStep): boolean {
  return step.status === 'failure';
}

function extractLogExcerpts(
  logs: EvidenceInput['logs'],
  primaryFailure?: FailedStepEvidence
): LogExcerpt[] {
  const candidates: Array<LogExcerpt & { score: number; order: number }> = [];
  let order = 0;

  for (const log of logs) {
    const lines = stripAnsi(log.content).split(/\r?\n/);

    for (const line of lines) {
      const trimmed = stripGithubTimestamp(line).trim();
      if (!trimmed || LOW_VALUE_LOG_LINE.test(trimmed)) {
        continue;
      }

      const matchesFailedStep = primaryFailure
        ? trimmed.toLowerCase().includes(primaryFailure.stepName.toLowerCase())
        : false;
      const score = scoreLogLine(trimmed, matchesFailedStep);
      if (score <= 0) {
        continue;
      }

      candidates.push({
        source: log.source,
        jobId: log.jobId,
        stepName: log.stepName ?? primaryFailure?.stepName,
        text: trimmed.slice(0, 240),
        score,
        order: order++
      });
    }
  }

  candidates.sort((left, right) => right.score - left.score || left.order - right.order);

  const excerpts: LogExcerpt[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.text)) {
      continue;
    }
    seen.add(candidate.text);
    excerpts.push({
      source: candidate.source,
      jobId: candidate.jobId,
      stepName: candidate.stepName,
      text: candidate.text
    });
    if (excerpts.length >= 16) {
      break;
    }
  }

  return excerpts;
}

function scoreLogLine(text: string, matchesFailedStep: boolean): number {
  if (!INTERESTING_LOG_LINE.test(text) && !matchesFailedStep) {
    return 0;
  }

  let score = matchesFailedStep ? 4 : 1;
  if (/expect\(|toBeVisible|element\(s\) not found|strict mode|getByRole|waiting for locator/i.test(text)) {
    score += 40;
  }
  if (/net::ERR_|connection refused|ECONNREFUSED|curl:\s*\(28\)|Request failed with status code/i.test(text)) {
    score += 45;
  }
  if (/Expected:\s+".+"|Received:\s+".+"/i.test(text)) {
    score += 30;
  }
  if (/✘|Error:|##\[error\]/i.test(text)) {
    score += 20;
  }
  return score;
}

export function stripAnsi(text: string): string {
  return text.replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, '');
}

function stripGithubTimestamp(line: string): string {
  return line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+/, '');
}

function detectErrorSignatures(combinedLogText: string): string[] {
  const signatures = ERROR_SIGNATURE_DETECTORS
    .filter((detector) => detector.pattern.test(combinedLogText))
    .map((detector) => detector.id);

  const curlTimeoutCount = combinedLogText.match(/curl:\s*\(28\)|exit code 28/gi)?.length ?? 0;
  if (curlTimeoutCount >= 2 && !signatures.includes('REPEATED_CURL_TIMEOUT')) {
    signatures.push('REPEATED_CURL_TIMEOUT');
  }

  return signatures;
}
