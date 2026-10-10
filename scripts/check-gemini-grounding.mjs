import nextEnv from '@next/env';
import { GoogleGenAI } from '@google/genai';

nextEnv.loadEnvConfig(process.cwd());
const started = Date.now();
try {
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const stream = await client.models.generateContentStream({
    model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
    contents: 'Tra cứu website chính thức Fed: lịch họp FOMC tháng 9 năm 2026 là ngày nào? Trả lời tiếng Việt trong 80 từ, kèm nguồn. Không dự đoán quyết định lãi suất.',
    config: { tools: [{ googleSearch: {} }], maxOutputTokens: 2000, abortSignal: AbortSignal.timeout(28000) },
  });
  let text = '', finishReason, supports = 0, suggestions = false;
  const sources = new Set();
  for await (const chunk of stream) {
    text += chunk.text ?? '';
    for (const candidate of chunk.candidates ?? []) {
      finishReason = candidate.finishReason ?? finishReason;
      const metadata = candidate.groundingMetadata;
      supports += metadata?.groundingSupports?.length ?? 0;
      suggestions ||= Boolean(metadata?.searchEntryPoint?.renderedContent);
      for (const source of metadata?.groundingChunks ?? []) if (source.web?.uri) sources.add(source.web.uri);
    }
  }
  const passed = finishReason === 'STOP' && supports > 0 && text.length > 0;
  if (!passed) process.exitCode = 1;
  console.log(JSON.stringify({ passed, durationMs: Date.now() - started, finishReason, supports, sourceCount: sources.size, suggestions, text }));
} catch (error) {
  process.exitCode = 1;
  console.log(JSON.stringify({ passed: false, durationMs: Date.now() - started, status: error.status ?? null, errorType: error.constructor?.name }));
}
