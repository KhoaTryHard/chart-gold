import nextEnv from '@next/env';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';

nextEnv.loadEnvConfig(process.cwd());
// Never print provider error objects: they may contain request credentials.
const checks = [
  [
    'hermes',
    async () => {
      const gateway = process.env.HERMES_BASE_URL?.trim();
      const apiKey = process.env.HERMES_API_KEY?.trim();
      if (!gateway || !apiKey) throw new Error('Hermes is not configured');
      const client = new OpenAI({
        apiKey,
        baseURL: gateway.replace(/\/+$/, '').toLowerCase().endsWith('/v1')
          ? gateway.replace(/\/+$/, '')
          : `${gateway.replace(/\/+$/, '')}/v1`,
        maxRetries: 0,
      });
      const response = await client.chat.completions.create(
        {
          model: process.env.HERMES_MODEL || 'gpt-5.4-mini',
          messages: [{ role: 'user', content: 'Reply with exactly OK.' }],
          stream: false,
          // Hermes gateway accepts the established Chat Completions field.
          // oxlint-disable-next-line typescript/no-deprecated
          max_tokens: 32,
        },
        { signal: AbortSignal.timeout(20000) },
      );
      return {
        model: response.model,
        completed: response.choices[0]?.finish_reason === 'stop',
        text: response.choices[0]?.message?.content,
      };
    },
  ],
  [
    'gemini',
    async () => {
      const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
      const response = await client.models.generateContent({
        model,
        contents: 'Reply with exactly OK.',
        // The first request can spend over 20 seconds on TLS/model warm-up.
        // Keep this diagnostic aligned with the route's 75-second deadline so a
        // healthy Gemini key is not reported as a network failure during cold start.
        config: {
          maxOutputTokens: 128,
          abortSignal: AbortSignal.timeout(60000),
        },
      });
      return {
        model,
        completed: response.candidates?.[0]?.finishReason === 'STOP',
        text: response.text,
      };
    },
  ],
];
await Promise.all(
  checks.map(async ([provider, check]) => {
    try {
      console.log(JSON.stringify({ provider, ...(await check()) }));
    } catch (error) {
      process.exitCode = 1;
      console.log(
        JSON.stringify({
          provider,
          completed: false,
          status: error.status ?? null,
          code: error.code ?? null,
          errorType: error.constructor?.name,
        }),
      );
    }
  }),
);
