import { z } from 'zod';
import type { EvidenceReference } from '../contracts/src/index.js';
import { FAILURE_CATEGORIES, type AiTriageResponse } from './ai-types.js';

const evidenceReferenceSchema = z.object({
  source: z.string().min(1),
  summary: z.string().min(1),
  locator: z.string().optional()
});

const aiResponseSchema = z.object({
  classification: z.enum(FAILURE_CATEGORIES),
  subtype: z.string().optional(),
  confidence: z.number().min(0).max(1),
  probableCause: z.string().min(1),
  evidence: z.array(evidenceReferenceSchema),
  recommendedAction: z.string().min(1),
  humanReviewRequired: z.boolean()
});

export function validateAiResponse(raw: unknown): AiTriageResponse {
  const candidate = typeof raw === 'string' ? parseJsonObject(raw) : unwrapContent(raw);
  const parsed = aiResponseSchema.parse(candidate);
  const evidence: EvidenceReference[] = parsed.evidence.map((item) => ({
    source: item.source,
    summary: item.summary,
    locator: item.locator
  }));

  return {
    classification: parsed.classification,
    subtype: parsed.subtype,
    confidence: parsed.confidence,
    probableCause: parsed.probableCause,
    evidence,
    recommendedAction: parsed.recommendedAction,
    humanReviewRequired: parsed.classification === 'UNKNOWN' ? true : parsed.humanReviewRequired
  };
}

function unwrapContent(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && 'classification' in raw) {
    return raw;
  }

  if (raw && typeof raw === 'object' && 'content' in raw && typeof (raw as { content: unknown }).content === 'string') {
    return parseJsonObject((raw as { content: string }).content);
  }

  throw new Error('AI response is not a JSON object');
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(body);
  } catch {
    throw new Error('AI response is not valid JSON');
  }
}
