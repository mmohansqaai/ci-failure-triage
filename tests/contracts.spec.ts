import { describe, expect, it } from 'vitest';
import type { PipelineRun, TriageResult } from '../packages/contracts/src/index.js';

describe('core contracts', () => {
  it('represents a provider-neutral pipeline run', () => {
    const run: PipelineRun = {
      provider: 'github-actions',
      pipelineId: 'playwright.yml',
      runId: '123',
      status: 'failure',
      jobs: [],
      metadata: {}
    };

    expect(run.provider).toBe('github-actions');
    expect(run.status).toBe('failure');
  });

  it('allows UNKNOWN as a safe triage result', () => {
    const result: TriageResult = {
      id: 'triage-1',
      classification: 'UNKNOWN',
      confidence: 0,
      probableCause: 'Insufficient evidence',
      evidence: [],
      recommendedAction: 'Human review required',
      humanReviewRequired: true,
      createdAt: new Date().toISOString()
    };

    expect(result.classification).toBe('UNKNOWN');
    expect(result.humanReviewRequired).toBe(true);
  });
});
