import type { EvidenceReference, FailureCategory, PipelineStatus } from '../contracts/src/index.js';
import type { PipelineStageType } from '../evidence/evidence-types.js';

export type AnalysisMode = 'DETERMINISTIC' | 'AI_ASSISTED';

export const FAILURE_CATEGORIES = [
  'PRODUCT_DEFECT',
  'AUTOMATION_DEFECT',
  'FLAKY_TEST',
  'TEST_DATA',
  'ENVIRONMENT',
  'CI_INFRASTRUCTURE',
  'DEPENDENCY_CONFIG',
  'AUTH_SECURITY',
  'UNKNOWN'
] as const satisfies readonly FailureCategory[];

export const DEFAULT_AI_CONFIDENCE_THRESHOLD = 0.8;

export interface CompactLogExcerpt {
  source: string;
  stepName?: string;
  text: string;
}

export interface CompactDeterministicResult {
  classification: FailureCategory;
  subtype?: string;
  confidence: number;
  probableCause: string;
  humanReviewRequired: boolean;
}

export interface CompactEvidencePayload {
  repository?: string;
  pipeline?: string;
  runId: string;
  failedJob?: string;
  failedStep?: string;
  stageType: PipelineStageType;
  logExcerpts: CompactLogExcerpt[];
  deterministicResult: CompactDeterministicResult;
  artifactsAvailable: Array<{ name: string; contentType?: string }>;
  knownFailureSignatures: string[];
  observations: {
    testsAppearedToFail: boolean;
    pipelineStatus: PipelineStatus;
    failedJobCount: number;
    failedStepCount: number;
  };
}

export interface AiTriageResponse {
  classification: FailureCategory;
  subtype?: string;
  confidence: number;
  probableCause: string;
  evidence: EvidenceReference[];
  recommendedAction: string;
  humanReviewRequired: boolean;
}

export interface AiSettings {
  enabled: boolean;
  apiKey?: string;
  baseUrl: string;
  model: string;
  confidenceThreshold: number;
}

export interface AIAnalyzer {
  readonly provider: string;
  analyze(payload: CompactEvidencePayload): Promise<unknown>;
}

export interface AiFallbackResult {
  result: import('../contracts/src/index.js').TriageResult;
  analysisMode: AnalysisMode;
  aiInvoked: boolean;
}
