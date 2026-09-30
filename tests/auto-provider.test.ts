import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  AutoAnalysisProvider,
  buildModelInput,
  HermesAnalysisProvider,
  type AnalysisEvent,
  type AnalysisProvider,
  type AnalysisRequest,
} from '@/lib/analysis/provider';
import { calculateAnalysisMetrics } from '@/lib/analysis/metrics';
import { resolveIntent } from '@/lib/analysis/intent';
import { SJC_PRODUCTS } from '@/lib/sjc-products';

const request: AnalysisRequest = {
  question: 'Giá hiện tại?',
  messages: [],
  product: SJC_PRODUCTS[0],
  range: '7N',
  records: [],
  metrics: calculateAnalysisMetrics([], '7N'),
  observedAt: '',
};
function provider(name: string, events: AnalysisEvent[], error?: boolean) {
  return {
    name,
    analyze: vi.fn(async function* (
      _request: AnalysisRequest,
      _signal: AbortSignal,
    ) {
      for (const event of events) yield event;
      if (error) throw new Error('provider failure');
    }),
  };
}
const success: AnalysisEvent[] = [
  { type: 'delta', delta: 'Số liệu kiểm chứng.' },
  { type: 'done', model: 'test', usage: null },
];
async function collect(subject: AnalysisProvider, input = request) {
  const events = [];
  for await (const event of subject.analyze(
    input,
    new AbortController().signal,
  ))
    events.push(event);
  return events;
}
afterEach(() => vi.unstubAllEnvs());

describe('automatic provider orchestration', () => {
  it('skips an unconfigured real provider in auto mode', async () => {
    vi.stubEnv('HERMES_BASE_URL', '');
    vi.stubEnv('HERMES_API_KEY', '');
    vi.stubEnv('HERMES_MODEL', '');
    const hermes = new HermesAnalysisProvider();
    const gemini = provider('gemini', success);
    const events = await collect(new AutoAnalysisProvider({ hermes, gemini }));
    expect(events.at(-1)).toMatchObject({ type: 'done', model: 'test' });
    expect(gemini.analyze).toHaveBeenCalledTimes(1);
  });

  it('packages prior user turns as context and marks only the final question for response', () => {
    const input = buildModelInput(
      [
        { role: 'user', content: 'Câu hỏi trước' },
        { role: 'assistant', content: 'Câu trả lời cũ không gửi lại' },
      ],
      'Câu hỏi hiện tại',
    );
    expect(input).toHaveLength(1);
    expect(input[0].content).toContain('Câu hỏi trước');
    expect(input[0].content).toContain(
      'CÂU HỎI HIỆN TẠI (chỉ trả lời câu này)',
    );
    expect(input[0].content).not.toContain('Câu trả lời cũ không gửi lại');
  });

  it('chooses Hermes for prices and Gemini for current macro, without forwarding assistant history', async () => {
    const hermes = provider('hermes', success),
      gemini = provider('gemini', success);
    await collect(new AutoAnalysisProvider({ hermes, gemini }));
    expect(hermes.analyze).toHaveBeenCalledTimes(1);
    expect(gemini.analyze).not.toHaveBeenCalled();
    await collect(new AutoAnalysisProvider({ hermes, gemini }), {
      ...request,
      question: 'Tin Fed mới nhất?',
      messages: [{ role: 'assistant', content: 'Grounded private history' }],
    });
    const call = vi.mocked(gemini.analyze).mock.calls[0][0];
    expect(call.intent?.needsResearch).toBe(true);
    expect(call.messages).toEqual([]);
  });
  it('falls back once on failure before output, retaining research requirement', async () => {
    const hermes = provider('hermes', success),
      gemini = provider('gemini', [], true);
    const events = await collect(new AutoAnalysisProvider({ hermes, gemini }), {
      ...request,
      question: 'Tin Fed mới nhất?',
    });
    expect(events.filter((event) => event.type === 'delta')).toHaveLength(1);
    expect(
      vi.mocked(hermes.analyze).mock.calls[0][0].intent?.needsResearch,
    ).toBe(true);
  });
  it('retries the same provider after emitting a partial answer and never merges a second provider', async () => {
    const hermes = provider('hermes', [success[0]], true),
      gemini = provider('gemini', success);
    await expect(
      collect(new AutoAnalysisProvider({ hermes, gemini })),
    ).rejects.toThrow('provider failure');
    expect(hermes.analyze).toHaveBeenCalledTimes(2);
    expect(gemini.analyze).not.toHaveBeenCalled();
  });

  it('emits reset and replaces a partial answer when same-provider retry succeeds', async () => {
    const analyze = vi.fn()
      .mockImplementationOnce(async function* () {
        yield { type: 'delta', delta: 'Dở dang' } as AnalysisEvent;
        throw new Error('temporary stream failure');
      })
      .mockImplementationOnce(async function* () {
        yield { type: 'delta', delta: 'Kết quả mới' } as AnalysisEvent;
        yield { type: 'done', model: 'retry', usage: null } as AnalysisEvent;
      });
    const hermes = {
      name: 'hermes',
      analyze,
    } as AnalysisProvider;
    const events = await collect(new AutoAnalysisProvider({
      hermes,
      gemini: provider('gemini', success),
    }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'reset', attempt: 1 }));
    expect(events.at(-1)).toMatchObject({ type: 'done', model: 'retry' });
    expect(analyze).toHaveBeenCalledTimes(2);
  });
  it('does not silently complete a stream without a done event', async () => {
    const hermes = provider('hermes', []),
      gemini = provider('gemini', []);
    const events = await collect(new AutoAnalysisProvider({ hermes, gemini }));
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      completion: 'limited',
      provider: 'server',
    });
  });
  it('returns limited factual output when both API keys are missing', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('GEMINI_API_KEY', '');
    const events = await collect(new AutoAnalysisProvider());
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      completion: 'limited',
    });
    expect(events.some((event) => event.type === 'warning')).toBe(true);
  });
  it('honors cancellation before attempting providers', async () => {
    const hermes = provider('hermes', success),
      gemini = provider('gemini', success);
    const abort = new AbortController();
    abort.abort();
    await expect(
      new AutoAnalysisProvider({ hermes, gemini })
        .analyze(request, abort.signal)
        .next(),
    ).rejects.toBeDefined();
    expect(hermes.analyze).not.toHaveBeenCalled();
  });
  it('responds to out-of-scope questions without an AI call', async () => {
    const hermes = provider('hermes', success),
      gemini = provider('gemini', success);
    const events = await collect(new AutoAnalysisProvider({ hermes, gemini }), {
      ...request,
      intent: resolveIntent('Công thức nấu phở'),
    });
    expect(events.at(-1)).toMatchObject({ model: 'scope-check' });
    expect(hermes.analyze).not.toHaveBeenCalled();
  });
});
