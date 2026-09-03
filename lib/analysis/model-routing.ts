// Gemini is the default provider. These stable model IDs support Google Search
// grounding through the official @google/genai SDK.
export const DEFAULT_ANALYSIS_MODEL = 'gemini-2.5-flash';
export const DEEP_ANALYSIS_MODEL = 'gemini-2.5-pro';

// OpenAI remains available as an explicitly selected, optional provider. Keep
// its model IDs separate so changing the default provider cannot send Gemini
// model IDs to the OpenAI adapter.
export const OPENAI_DEFAULT_ANALYSIS_MODEL = 'gpt-5.4-mini-2026-03-17';
export const OPENAI_DEEP_ANALYSIS_MODEL = 'gpt-5.4-2026-03-05';

export type AnalysisInputMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export function shouldEscalateModel(question: string) {
  return /(?:\bdeep\b|in[- ]depth|phân tích sâu|đào sâu|chi tiết|\bcompare\b|\bcomparison\b|\bversus\b|\bvs\.?\b|so sánh|đối chiếu|multi[- ]?scenario|nhiều kịch bản|kịch bản)/i.test(
    question,
  );
}

export function routeAnalysisModel(question: string) {
  return shouldEscalateModel(question)
    ? DEEP_ANALYSIS_MODEL
    : DEFAULT_ANALYSIS_MODEL;
}

export function routeOpenAIModel(question: string) {
  return shouldEscalateModel(question)
    ? OPENAI_DEEP_ANALYSIS_MODEL
    : OPENAI_DEFAULT_ANALYSIS_MODEL;
}

export function buildAnalysisInput(
  messages: readonly AnalysisInputMessage[],
  question: string,
): AnalysisInputMessage[] {
  return [...messages, { role: 'user', content: question }];
}

export type GeminiContent = {
  role: 'user' | 'model';
  parts: [{ text: string }];
};

export function buildGeminiContents(
  messages: readonly AnalysisInputMessage[],
  question: string,
): GeminiContent[] {
  return buildAnalysisInput(messages, question).map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }],
  }));
}
