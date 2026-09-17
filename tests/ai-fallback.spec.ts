import { describe, expect, it } from 'vitest';
import {
  applyAiFallback,
  buildCompactEvidencePayload,
  loadAiSettings,
  shouldInvokeAi,
  validateAiResponse,
  type AIAnalyzer
} from '../packages/ai/index.js';
import type { PipelineJob, PipelineRun } from '../packages/contracts/src/index.js';
import { triageFailure } from '../packages/triage-engine/index.js';
import { formatTriageReport } from '../packages/triage-engine/index.js';

function unknownInput() {
  const jobs: PipelineJob[] = [
    {
      id: 'job-1',
      name: 'pipeline',
      status: 'failure',
      steps: [{ id: '1', name: 'Run mystery task', status: 'failure' }]
    }
  ];

  const pipelineRun: PipelineRun = {
    provider: 'github-actions',
    pipelineId: 'nightly.yml',
    runId: '77',
    pipelineName: 'Nightly',
    repository: 'acme/shop',
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
        source: 'pipeline',
        content: 'Process completed with exit code 1.',
        jobId: 'job-1'
      }
    ],
    artifacts: []
  };
}

function infrastructureInput() {
  const jobs: PipelineJob[] = [
    {
      id: 'job-1',
      name: 'Playwright Tests',
      status: 'failure',
      steps: [
        { id: '1', name: 'Set up job', status: 'success' },
        { id: '2', name: 'Install dependencies', status: 'success' },
        { id: '3', name: 'Run Playwright tests', status: 'success' },
        { id: '4', name: 'Upload Playwright report', status: 'success' },
        { id: '5', name: 'Publish results to dashboard', status: 'failure' }
      ]
    }
  ];

  const pipelineRun: PipelineRun = {
    provider: 'github-actions',
    pipelineId: '.github/workflows/playwright.yml',
    runId: '18882',
    pipelineName: 'Playwright Tests',
    repository: 'acme/shop',
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
        source: 'Playwright Tests',
        content: `
12 passed (1.2m)
Checking dashboard health...
curl: (28) Operation timed out after 30000 milliseconds with 0 bytes received
##[error]Process completed with exit code 28.
Checking dashboard health...
curl: (28) Operation timed out after 30000 milliseconds with 0 bytes received
##[error]Process completed with exit code 28.
`,
        jobId: 'job-1'
      }
    ],
    artifacts: [{ id: '11', name: 'playwright-report' }]
  };
}

function mockAnalyzer(response: unknown, onAnalyze?: (payload: unknown) => void): AIAnalyzer & { calls: number } {
  const analyzer = {
    provider: 'mock',
    calls: 0,
    async analyze(payload: unknown) {
      analyzer.calls += 1;
      onAnalyze?.(payload);
      return response;
    }
  };

  return analyzer;
}

describe('AI fallback policy', () => {
  it('does not invoke AI for a 91% deterministic infrastructure result', async () => {
    const { evidence, result } = triageFailure(infrastructureInput());
    expect(result.classification).toBe('CI_INFRASTRUCTURE');
    expect(result.subtype).toBe('DOWNSTREAM_SERVICE_UNAVAILABLE');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(shouldInvokeAi(result, 0.8)).toBe(false);

    const analyzer = mockAnalyzer({ classification: 'UNKNOWN' });
    const fallback = await applyAiFallback({
      evidence,
      deterministic: result,
      analyzer,
      settings: loadAiSettings({ AI_ENABLED: 'true', AI_API_KEY: 'test-key' })
    });

    expect(analyzer.calls).toBe(0);
    expect(fallback.aiInvoked).toBe(false);
    expect(fallback.analysisMode).toBe('DETERMINISTIC');
    expect(fallback.result.classification).toBe('CI_INFRASTRUCTURE');
  });

  it('invokes AI for an UNKNOWN deterministic result and does not send raw logs', async () => {
    const { evidence, result } = triageFailure(unknownInput());
    expect(result.classification).toBe('UNKNOWN');

    let receivedPayload: unknown;
    const analyzer = mockAnalyzer(
      {
        classification: 'DEPENDENCY_CONFIG',
        subtype: 'MISSING_TOOLING',
        confidence: 0.55,
        probableCause: 'The mystery task failed with exit code 1 and no stronger signature was present.',
        evidence: [
          {
            source: 'logs',
            summary: 'Process completed with exit code 1.'
          }
        ],
        recommendedAction: 'Inspect the mystery task command and its configuration.',
        humanReviewRequired: true
      },
      (payload) => {
        receivedPayload = payload;
      }
    );

    const fallback = await applyAiFallback({
      evidence,
      deterministic: result,
      analyzer,
      settings: loadAiSettings({ AI_ENABLED: 'true', AI_API_KEY: 'test-key' })
    });

    expect(analyzer.calls).toBe(1);
    expect(fallback.analysisMode).toBe('AI_ASSISTED');
    expect(fallback.result.classification).toBe('DEPENDENCY_CONFIG');
    expect(JSON.stringify(receivedPayload)).not.toContain('combinedLogText');
    expect(receivedPayload).toMatchObject({
      failedStep: 'Run mystery task',
      stageType: 'UNKNOWN',
      deterministicResult: { classification: 'UNKNOWN' }
    });

    const compact = buildCompactEvidencePayload(evidence, result);
    expect(compact).not.toHaveProperty('combinedLogText');
    expect(compact.logExcerpts.every((excerpt) => excerpt.text.length <= 200)).toBe(true);
  });

  it('rejects a malformed AI response and keeps the deterministic result', async () => {
    const { evidence, result } = triageFailure(unknownInput());
    const analyzer = mockAnalyzer('this is not json');

    const fallback = await applyAiFallback({
      evidence,
      deterministic: result,
      analyzer
    });

    expect(analyzer.calls).toBe(1);
    expect(fallback.analysisMode).toBe('DETERMINISTIC');
    expect(fallback.result.classification).toBe('UNKNOWN');
    expect(fallback.result.humanReviewRequired).toBe(true);
  });

  it('does not break deterministic triage when no API key is present', async () => {
    const { evidence, result } = triageFailure(unknownInput());

    const fallback = await applyAiFallback({
      evidence,
      deterministic: result,
      settings: {
        enabled: true,
        apiKey: undefined,
        baseUrl: 'https://api.openai.com',
        model: 'gpt-4o-mini',
        confidenceThreshold: 0.8
      }
    });

    expect(fallback.aiInvoked).toBe(false);
    expect(fallback.analysisMode).toBe('DETERMINISTIC');
    expect(fallback.result).toEqual(result);
  });

  it('keeps AI UNKNOWN results human-review-required', async () => {
    const { evidence, result } = triageFailure(unknownInput());
    const analyzer = mockAnalyzer({
      classification: 'UNKNOWN',
      subtype: 'INSUFFICIENT_EVIDENCE',
      confidence: 0.18,
      probableCause: 'The supplied excerpts do not identify a specific failure class.',
      evidence: [{ source: 'logs', summary: 'Process completed with exit code 1.' }],
      recommendedAction: 'Collect additional logs and review the failed step manually.',
      humanReviewRequired: false
    });

    const fallback = await applyAiFallback({
      evidence,
      deterministic: result,
      analyzer
    });

    expect(fallback.analysisMode).toBe('AI_ASSISTED');
    expect(fallback.result.classification).toBe('UNKNOWN');
    expect(fallback.result.humanReviewRequired).toBe(true);

    const report = formatTriageReport(evidence, fallback.result, fallback.analysisMode);
    expect(report).toContain('Analysis Mode:\nAI_ASSISTED');
    expect(report).toContain('Human Review Required:\nYES');
  });
});

describe('AI response validator', () => {
  it('rejects classifications outside the existing taxonomy', () => {
    expect(() =>
      validateAiResponse({
        classification: 'NETWORK_GLITCH',
        confidence: 0.4,
        probableCause: 'Invented class',
        evidence: [],
        recommendedAction: 'Retry',
        humanReviewRequired: true
      })
    ).toThrow();
  });
});
