import type { TriageResult } from '../contracts/src/index.js';
import { DEFAULT_AI_CONFIDENCE_THRESHOLD, type AiFallbackResult, type AIAnalyzer, type AiSettings, type CompactEvidencePayload } from './ai-types.js';
import { buildAiMessages, buildCompactEvidencePayload } from './prompt-builder.js';
import { validateAiResponse } from './response-validator.js';
import type { NormalizedFailureEvidence } from '../evidence/evidence-types.js';

export function loadAiSettings(env: NodeJS.ProcessEnv = process.env): AiSettings {
  const parsedThreshold = Number(env.AI_CONFIDENCE_THRESHOLD);
  const confidenceThreshold =
    Number.isFinite(parsedThreshold) && parsedThreshold > 0 && parsedThreshold <= 1
      ? parsedThreshold
      : DEFAULT_AI_CONFIDENCE_THRESHOLD;

  return {
    enabled: env.AI_ENABLED === 'true',
    apiKey: env.AI_API_KEY?.trim() || undefined,
    baseUrl: (env.AI_BASE_URL?.trim() || 'https://api.openai.com').replace(/\/$/, ''),
    model: env.AI_MODEL?.trim() || 'gpt-4o-mini',
    confidenceThreshold
  };
}

export function shouldInvokeAi(
  result: TriageResult,
  threshold: number = DEFAULT_AI_CONFIDENCE_THRESHOLD
): boolean {
  if (result.classification === 'UNKNOWN') {
    return true;
  }

  if (result.confidence < threshold) {
    return true;
  }

  return false;
}

export class OpenAiCompatibleAnalyzer implements AIAnalyzer {
  readonly provider = 'openai-compatible';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: {
    apiKey: string;
    baseUrl?: string;
    model?: string;
    fetchImpl?: typeof fetch;
  }) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? 'https://api.openai.com').replace(/\/$/, '');
    this.model = options.model ?? 'gpt-4o-mini';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async analyze(payload: CompactEvidencePayload): Promise<unknown> {
    const messages = buildAiMessages(payload);
    const response = await this.fetchImpl(chatCompletionsUrl(this.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        messages: [
          { role: 'system', content: messages.system },
          { role: 'user', content: messages.user }
        ]
      })
    });

    const body = await response.text();
    if (!response.ok) {
      throw new Error(`AI provider request failed with status ${response.status}. ${body}`);
    }

    const parsed = JSON.parse(body) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = parsed.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('AI provider returned an empty completion');
    }

    return content;
  }
}

export async function applyAiFallback(options: {
  evidence: NormalizedFailureEvidence;
  deterministic: TriageResult;
  analyzer?: AIAnalyzer;
  settings?: AiSettings;
}): Promise<AiFallbackResult> {
  const settings = options.settings ?? loadAiSettings();

  if (!shouldInvokeAi(options.deterministic, settings.confidenceThreshold)) {
    return {
      result: options.deterministic,
      analysisMode: 'DETERMINISTIC',
      aiInvoked: false
    };
  }

  const analyzer = options.analyzer ?? createDefaultAnalyzer(settings);
  if (!analyzer) {
    return {
      result: options.deterministic,
      analysisMode: 'DETERMINISTIC',
      aiInvoked: false
    };
  }

  try {
    const payload = buildCompactEvidencePayload(options.evidence, options.deterministic);
    const raw = await analyzer.analyze(payload);
    const validated = validateAiResponse(raw);
    return {
      result: toTriageResult(validated, options.deterministic),
      analysisMode: 'AI_ASSISTED',
      aiInvoked: true
    };
  } catch {
    return {
      result: options.deterministic,
      analysisMode: 'DETERMINISTIC',
      aiInvoked: false
    };
  }
}

function createDefaultAnalyzer(settings: AiSettings): AIAnalyzer | undefined {
  if (!settings.enabled || !settings.apiKey) {
    return undefined;
  }

  return new OpenAiCompatibleAnalyzer({
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl,
    model: settings.model
  });
}

function toTriageResult(
  ai: ReturnType<typeof validateAiResponse>,
  deterministic: TriageResult
): TriageResult {
  return {
    id: deterministic.id,
    classification: ai.classification,
    subtype: ai.subtype,
    confidence: ai.confidence,
    probableCause: ai.probableCause,
    evidence: [
      {
        source: 'deterministic',
        summary: `Deterministic result was ${deterministic.classification}${deterministic.subtype ? `/${deterministic.subtype}` : ''} at ${Math.round(deterministic.confidence * 100)}% confidence`
      },
      ...ai.evidence
    ],
    recommendedAction: ai.recommendedAction,
    humanReviewRequired: ai.humanReviewRequired,
    createdAt: new Date().toISOString()
  };
}

function chatCompletionsUrl(baseUrl: string): string {
  if (baseUrl.endsWith('/chat/completions')) {
    return baseUrl;
  }

  if (baseUrl.endsWith('/v1')) {
    return `${baseUrl}/chat/completions`;
  }

  return `${baseUrl}/v1/chat/completions`;
}
