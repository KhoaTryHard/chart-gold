export const DEFAULT_ANALYSIS_MODEL = 'gpt-5.4-mini-2026-03-17';
export const DEEP_ANALYSIS_MODEL = 'gpt-5.4-2026-03-05';

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

export function buildAnalysisInput(
  messages: readonly AnalysisInputMessage[],
  question: string,
): AnalysisInputMessage[] {
  return [...messages, { role: 'user', content: question }];
}
