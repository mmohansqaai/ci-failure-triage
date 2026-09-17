import { describe, expect, it } from 'vitest';
import type { Artifact, PipelineJob, PipelineRun, PipelineStatus } from '../packages/contracts/src/index.js';
import { collectFailureEvidence } from '../packages/evidence/index.js';
import {
  formatTriageReport,
  MAX_HUMAN_READABLE_EVIDENCE,
  selectHumanReadableEvidence,
  triageFailure
} from '../packages/triage-engine/index.js';

function buildInput(options: {
  pipelineName?: string;
  jobName?: string;
  runId?: string;
  steps: Array<{ name: string; status: PipelineStatus }>;
  log: string;
  artifacts?: Artifact[];
}) {
  const jobs: PipelineJob[] = [
    {
      id: 'job-1',
      name: options.jobName ?? 'e2e',
      status: 'failure',
      steps: options.steps.map((step, index) => ({
        id: String(index + 1),
        name: step.name,
        status: step.status
      }))
    }
  ];

  const pipelineRun: PipelineRun = {
    provider: 'github-actions',
    pipelineId: '.github/workflows/playwright.yml',
    runId: options.runId ?? '9001',
    pipelineName: options.pipelineName ?? 'Playwright Tests',
    repository: 'acme/shop',
    branch: 'main',
    status: 'failure',
    jobs,
    metadata: {}
  };

  return {
    pipelineRun,
    jobs,
    logs: [
      {
        id: 'job-1-logs',
        source: options.jobName ?? 'e2e',
        content: options.log,
        jobId: 'job-1'
      }
    ],
    artifacts: options.artifacts ?? []
  };
}

const playwrightJobSteps = [
  { name: 'Set up job', status: 'success' as const },
  { name: 'Install dependencies', status: 'success' as const },
  { name: 'Run Playwright tests', status: 'success' as const },
  { name: 'Upload Playwright report', status: 'success' as const },
  { name: 'Publish results to dashboard', status: 'failure' as const }
];

describe('evidence collector', () => {
  it('does not treat a pipeline failure as a test failure when the failed step is publishing', () => {
    const evidence = collectFailureEvidence(
      buildInput({
        jobName: 'Playwright Tests',
        steps: playwrightJobSteps,
        log: '12 passed (1.2m)\nArtifact playwright-report uploaded successfully',
        artifacts: [{ id: '11', name: 'playwright-report', sizeBytes: 2048 }]
      })
    );

    expect(evidence.testsAppearedToFail).toBe(false);
    expect(evidence.pipelineStageType).toBe('DOWNSTREAM_INTEGRATION');
    expect(evidence.failedSteps.map((step) => step.stepName)).toEqual([
      'Publish results to dashboard'
    ]);
  });
});

describe('deterministic triage engine', () => {
  it('classifies downstream dashboard curl timeouts as CI_INFRASTRUCTURE', () => {
    const { evidence, result } = triageFailure(
      buildInput({
        pipelineName: 'Playwright Tests',
        jobName: 'Playwright Tests',
        runId: '18882',
        steps: playwrightJobSteps,
        artifacts: [{ id: '11', name: 'playwright-report', sizeBytes: 4096 }],
        log: `
Run Playwright tests
  12 passed (1.2m)

Upload Playwright report
  Artifact playwright-report uploaded successfully

Publish results to dashboard
Checking dashboard health...
curl: (28) Operation timed out after 30000 milliseconds with 0 bytes received
##[error]Process completed with exit code 28.
Checking dashboard health...
curl: (28) Operation timed out after 30000 milliseconds with 0 bytes received
##[error]Process completed with exit code 28.
`
      })
    );

    expect(evidence.testsAppearedToFail).toBe(false);
    expect(result.classification).toBe('CI_INFRASTRUCTURE');
    expect(result.subtype).toBe('DOWNSTREAM_SERVICE_UNAVAILABLE');
    expect(result.humanReviewRequired).toBe(false);
    expect(result.probableCause).toMatch(/dashboard\/service did not respond to health checks/i);

    const summaries = result.evidence.map((item) => item.summary).join('\n');
    expect(summaries).toMatch(/test execution did not fail/i);
    expect(summaries).toMatch(/publishing\/downstream step/i);
    expect(summaries).toMatch(/health-check timeout/i);
    expect(summaries).toMatch(/curl error\/exit code 28/i);
  });

  it('classifies Playwright strict mode violations as AUTOMATION_DEFECT', () => {
    const { result } = triageFailure(
      buildInput({
        steps: [
          { name: 'Set up job', status: 'success' },
          { name: 'Run Playwright tests', status: 'failure' }
        ],
        log: `
Error: strict mode violation: getByRole('button', { name: 'Submit' }) resolved to 2 elements:
  1) <button>Save</button>
  2) <button>Submit</button>
`
      })
    );

    expect(result.classification).toBe('AUTOMATION_DEFECT');
    expect(result.subtype).toBe('PLAYWRIGHT_STRICT_MODE');
    expect(result.humanReviewRequired).toBe(false);
  });

  it('classifies HTTP 503 clusters as ENVIRONMENT', () => {
    const { result } = triageFailure(
      buildInput({
        steps: [
          { name: 'Set up job', status: 'success' },
          { name: 'Run Playwright tests', status: 'failure' }
        ],
        log: `
api.internal.acme.local returned 503 Service Unavailable
Error: Request failed with status code 503
Error: Request failed with status code 503
Error: Request failed with status code 503
`
      })
    );

    expect(result.classification).toBe('ENVIRONMENT');
    expect(result.subtype).toBe('HTTP_5XX_UNAVAILABLE');
    expect(result.humanReviewRequired).toBe(false);
  });

  it('classifies HTTP 401 token failures as AUTH_SECURITY', () => {
    const { result } = triageFailure(
      buildInput({
        steps: [
          { name: 'Set up job', status: 'success' },
          { name: 'Run Playwright tests', status: 'failure' }
        ],
        log: `
Error: Request failed with status code 401
Unauthorized: token expired
GET /account 401 Unauthorized
`
      })
    );

    expect(result.classification).toBe('AUTH_SECURITY');
    expect(result.subtype).toBe('TOKEN_OR_UNAUTHORIZED');
    expect(result.humanReviewRequired).toBe(false);
  });

  it('classifies assertion mismatches as PRODUCT_DEFECT with human review', () => {
    const { result } = triageFailure(
      buildInput({
        steps: [
          { name: 'Set up job', status: 'success' },
          { name: 'Run Playwright tests', status: 'failure' }
        ],
        log: `
Error: expect(received).toBe(expected)

Expected: "Order confirmed"
Received: "Order pending"
`
      })
    );

    expect(result.classification).toBe('PRODUCT_DEFECT');
    expect(result.subtype).toBe('ASSERTION_MISMATCH');
    expect(result.humanReviewRequired).toBe(true);
  });

  it('classifies insufficient evidence as UNKNOWN', () => {
    const { result } = triageFailure(
      buildInput({
        pipelineName: 'Nightly',
        jobName: 'pipeline',
        steps: [{ name: 'Run mystery task', status: 'failure' }],
        log: 'Process completed with exit code 1.'
      })
    );

    expect(result.classification).toBe('UNKNOWN');
    expect(result.subtype).toBe('INSUFFICIENT_EVIDENCE');
    expect(result.confidence).toBeLessThan(0.5);
    expect(result.humanReviewRequired).toBe(true);
  });

  it('does not classify a Playwright timeout as automation when the service is unavailable', () => {
    const { result } = triageFailure(
      buildInput({
        steps: [
          { name: 'Set up job', status: 'success' },
          { name: 'Run Playwright tests', status: 'failure' }
        ],
        log: `
Timeout 30000ms exceeded.
waiting for locator('button.submit')
Error: Request failed with status code 503
api.internal returned 503 Service Unavailable
`
      })
    );

    expect(result.classification).toBe('ENVIRONMENT');
    expect(result.classification).not.toBe('AUTOMATION_DEFECT');
  });
});

describe('report formatter', () => {
  it('renders the historical dashboard timeout scenario in human-readable form', () => {
    const { evidence, result } = triageFailure(
      buildInput({
        pipelineName: 'Playwright Tests',
        jobName: 'Playwright Tests',
        runId: '18882',
        steps: playwrightJobSteps,
        artifacts: [{ id: '11', name: 'playwright-report' }],
        log: `
12 passed (1.2m)
Checking dashboard health...
curl: (28) Operation timed out after 30000 milliseconds with 0 bytes received
##[error]Process completed with exit code 28.
Checking dashboard health...
curl: (28) Operation timed out after 30000 milliseconds with 0 bytes received
##[error]Process completed with exit code 28.
`
      })
    );

    const report = formatTriageReport(evidence, result);

    expect(report).toContain('CI FAILURE TRIAGE');
    expect(report).toContain('Repository:\nacme/shop');
    expect(report).toContain('Pipeline:\nPlaywright Tests');
    expect(report).toContain('Run:\n18882');
    expect(report).toContain('Pipeline Status:\nFAILED');
    expect(report).toContain('Analysis Mode:\nDETERMINISTIC');
    expect(report).toContain('Failed Job:\nPlaywright Tests');
    expect(report).toContain('Failed Step:\nPublish results to dashboard');
    expect(report).toContain('Classification:\nCI_INFRASTRUCTURE');
    expect(report).toContain('Subtype:\nDOWNSTREAM_SERVICE_UNAVAILABLE');
    expect(report).toContain('Human Review Required:\nNO');
    expect(report).toMatch(/Test execution did not fail/i);
  });

  it('ranks signature and failed-step evidence first and hides generic setup lines', () => {
    const { evidence, result } = triageFailure(
      buildInput({
        pipelineName: 'Playwright Tests',
        jobName: 'Playwright Tests',
        runId: '18882',
        steps: playwrightJobSteps,
        artifacts: [{ id: '11', name: 'playwright-report' }],
        log: `
Set up job
Getting GitHub token
##[group]Run actions/setup-node@v4
Download action repository 'actions/checkout@v4'
Run Playwright tests
12 passed (1.2m)
Publish results to dashboard
Checking dashboard health...
curl: (28) Operation timed out after 30000 milliseconds with 0 bytes received
##[error]Process completed with exit code 28.
Checking dashboard health...
curl: (28) Operation timed out after 30000 milliseconds with 0 bytes received
##[error]Process completed with exit code 28.
`
      })
    );

    const rawSummaries = result.evidence.map((item) => item.summary);
    expect(rawSummaries.some((summary) => /Getting GitHub token/i.test(summary))).toBe(true);

    const selected = selectHumanReadableEvidence(result, evidence);
    const selectedSummaries = selected.map((item) => item.summary);

    expect(selected.length).toBeGreaterThan(0);
    expect(selected.length).toBeLessThanOrEqual(MAX_HUMAN_READABLE_EVIDENCE);
    expect(selected.length).toBeLessThan(rawSummaries.length);
    expect(selectedSummaries.join('\n')).not.toMatch(/Getting GitHub token/i);
    expect(selectedSummaries.join('\n')).not.toMatch(/Run actions\/setup-node/i);
    expect(selectedSummaries.some((summary) => /curl: \(28\)|exit code 28|health-check timeout/i.test(summary))).toBe(true);

    const firstStrongIndex = selectedSummaries.findIndex((summary) =>
      /curl: \(28\)|exit code 28|health-check timeout|Failed step "Publish results to dashboard"/i.test(summary)
    );
    const setupIndex = selectedSummaries.findIndex((summary) => /token|setup-node|checkout/i.test(summary));
    expect(firstStrongIndex).toBeGreaterThanOrEqual(0);
    if (setupIndex >= 0) {
      expect(firstStrongIndex).toBeLessThan(setupIndex);
    }

    const report = formatTriageReport(evidence, result);
    const evidenceSection = report.split('Evidence:\n')[1]?.split('\nRecommended Action:')[0] ?? '';
    const evidenceLines = evidenceSection.split('\n').filter((line) => line.startsWith('- '));
    expect(evidenceLines.length).toBeLessThanOrEqual(MAX_HUMAN_READABLE_EVIDENCE);
    expect(evidenceSection).toMatch(/curl: \(28\)|health-check timeout|exit code 28/i);
    expect(evidenceSection).not.toMatch(/Getting GitHub token/i);
  });
});
