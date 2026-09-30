import { z } from 'zod';
import type { AnalysisIntent } from './intent';
import type { MarketContext } from './market-context';
import type { Locale } from '@/lib/i18n';
import type { ForecastResult } from './forecast';

export const analysisFactSchema = z.object({
  key: z.string().min(1).max(80),
  label: z.string().min(1).max(180),
  value: z.union([z.string().max(300), z.number(), z.null()]),
  unit: z.string().max(80).nullable(),
  observedAt: z.string().max(100).nullable(),
  sourceStatus: z.enum(['live', 'delayed', 'fallback', 'unavailable', 'user-input', 'calculated']),
  assumption: z.string().max(300).nullable(),
});

export const analysisFactsSchema = z.object({
  responseVersion: z.literal(2),
  goal: z.enum(['buy', 'hold', 'compare', 'market']).nullable(),
  facts: z.array(analysisFactSchema).max(30),
});

export type AnalysisFacts = z.infer<typeof analysisFactsSchema>;

export const analysisDecisionSchema = z.object({
  responseVersion: z.literal(2),
  headline: z.string().min(1).max(240),
  stance: z.enum(['consider', 'wait', 'hold', 'review', 'insufficient-data']),
  summary: z.string().min(1).max(800),
  conditions: z.array(z.string().min(1).max(240)).max(4),
  factKeys: z.array(z.string().min(1).max(80)).max(12),
  nextSteps: z.array(z.string().min(1).max(180)).max(4),
});

export type AnalysisDecision = z.infer<typeof analysisDecisionSchema>;

function fact(
  key: string,
  label: string,
  value: string | number | null,
  unit: string | null,
  sourceStatus: z.infer<typeof analysisFactSchema>['sourceStatus'],
  observedAt: string | null,
  assumption: string | null = null,
) {
  return { key, label, value, unit, sourceStatus, observedAt, assumption };
}

function summarizeInvestments(context: MarketContext | undefined) {
  const investments = context?.investments ?? [];
  if (!investments.length) return undefined;
  if (investments.length === 1) return investments[0];
  const quantityLuong = investments.reduce((sum, item) => sum + item.quantityLuong, 0);
  return {
    productId: 'portfolio',
    label: 'Tổng vị thế đã chọn',
    quantityLuong,
    spreadVndPerLuong: Math.round(
      investments.reduce((sum, item) => sum + item.spreadVndPerLuong * item.quantityLuong, 0) /
        Math.max(quantityLuong, Number.EPSILON),
    ),
    immediateLossVnd: investments.reduce((sum, item) => sum + item.immediateLossVnd, 0),
    profitLossVnd: investments.reduce((sum, item) => sum + item.profitLossVnd, 0),
    breakEvenBuyVndPerLuong: Math.round(
      investments.reduce((sum, item) => sum + item.breakEvenBuyVndPerLuong * item.quantityLuong, 0) /
        Math.max(quantityLuong, Number.EPSILON),
    ),
    feesVnd: investments.reduce((sum, item) => sum + item.feesVnd, 0),
    feesAssumption: investments.some((item) => item.feesAssumption)
      ? 'Một hoặc nhiều khoản chưa biết phí; phép tính tạm tính phí bằng 0.'
      : null,
  };
}

export function buildAnalysisFacts(
  context: MarketContext | undefined,
  intent: AnalysisIntent,
  goal?: AnalysisFacts['goal'],
  locale: Locale = 'vi',
  _forecast?: ForecastResult,
): AnalysisFacts {
  const english = locale === 'en';
  const facts = [] as AnalysisFacts['facts'];
  const selected = context?.rows.find((row) => row.exclusion === null) ?? context?.rows[0];
  if (selected?.comparison) {
    facts.push(
      fact('selected-price', english ? 'Current price' : 'Giá đang dùng', selected.comparison.today, english ? 'VND million/lượng' : 'triệu đồng/lượng', selected.mode, selected.observedAt),
      fact('selected-change', english ? 'Change from comparison date' : 'Thay đổi so với ngày đối chiếu', selected.comparison.change, english ? 'VND million/lượng' : 'triệu đồng/lượng', selected.mode, selected.observedAt),
    );
  }
  const investment = summarizeInvestments(context);
  if (investment) {
    facts.push(
      fact('estimated-pnl', english ? 'Profit/loss at dealer buy price' : 'Lãi/lỗ nếu bán theo giá mua vào', investment.profitLossVnd, english ? 'VND' : 'VNĐ', 'calculated', selected?.observedAt ?? null),
      fact('break-even', english ? 'Dealer buy price to break even' : 'Giá thu mua hòa vốn', investment.breakEvenBuyVndPerLuong, english ? 'VND/lượng' : 'VNĐ/lượng', 'calculated', selected?.observedAt ?? null, english ? 'Unknown fees are assumed to be zero.' : investment.feesAssumption),
      fact('spread', english ? 'Dealer buy/sell spread' : 'Chênh lệch mua/bán', investment.spreadVndPerLuong, english ? 'VND/lượng' : 'VNĐ/lượng', selected?.mode ?? 'unavailable', selected?.observedAt ?? null),
    );
  }
  if (context) {
    facts.push(
      fact('coverage', english ? 'Groups with sufficient data' : 'Nhóm đủ dữ liệu cho tác vụ', `${context.eligible}/${context.requested}`, english ? 'groups' : 'nhóm', 'calculated', context.today),
    );
  }
  return analysisFactsSchema.parse({ responseVersion: 2, goal: goal ?? null, facts });
}

export function buildAnalysisDecision(
  context: MarketContext | undefined,
  intent: AnalysisIntent,
  goal?: AnalysisFacts['goal'],
  locale: Locale = 'vi',
  forecast?: ForecastResult,
): AnalysisDecision {
  const english = locale === 'en';
  const investment = summarizeInvestments(context);
  const factKeys = buildAnalysisFacts(context, intent, goal, locale).facts.map((item) => item.key);
  if (intent.forecast && forecast) {
    const experimental = forecast.status === 'experimental';
    return analysisDecisionSchema.parse({
      responseVersion: 2,
      headline: english
        ? experimental
          ? `Seven-day reference range for ${forecast.targetDate}.`
          : `A numeric range is unavailable for ${forecast.targetDate}.`
        : experimental
          ? `Khoảng tham chiếu 7 ngày cho ${forecast.targetDate}.`
          : `Chưa thể tạo khoảng giá cho ${forecast.targetDate}.`,
      stance: experimental ? 'review' : 'insufficient-data',
      summary: experimental
        ? english
          ? 'Use the downside, base, and upside ranges as historical scenarios for the selected product; confirm the dealer quote on the target date.'
          : 'Dùng ba vùng giảm, cơ sở và tăng như các kịch bản lịch sử cho sản phẩm đang chọn; xác nhận lại giá của cửa hàng vào ngày đích.'
        : forecast.reason ?? (english ? 'More verified history is needed.' : 'Cần thêm lịch sử đã kiểm chứng.'),
      conditions: [
        experimental
          ? english
            ? 'This is an experimental historical estimate, not a probability or guaranteed target.'
            : 'Đây là ước tính lịch sử thực nghiệm, không phải xác suất hay giá mục tiêu bảo đảm.'
          : english
            ? 'Do not treat incomplete or fallback data as a current price.'
            : 'Không xem dữ liệu thiếu hoặc fallback là giá hiện tại.',
      ],
      factKeys,
      nextSteps: english
        ? ['Check the selected dealer again on the target date', 'Ask for a buy/sell comparison']
        : ['Kiểm tra lại giá của thương hiệu vào ngày đích', 'Hỏi so sánh giá mua vào và bán ra'],
    });
  }
  if (!context || context.requested === 0) {
    return analysisDecisionSchema.parse({
      responseVersion: 2,
      headline: english ? 'There is not enough data to conclude.' : 'Chưa đủ dữ liệu để kết luận.',
      stance: 'insufficient-data',
      summary: english ? 'Check the product, price source, or date range and try again.' : 'Hãy kiểm tra lại sản phẩm, nguồn giá hoặc khoảng thời gian rồi thử lại.',
      conditions: [english ? 'Do not treat fallback or incomplete data as a tradeable price.' : 'Không xem giá dự phòng hoặc dữ liệu thiếu là giá có thể giao dịch.'],
      factKeys,
      nextSteps: english ? ['Choose another product', 'Try a shorter question'] : ['Đổi sản phẩm', 'Thử câu hỏi ngắn hơn'],
    });
  }
  if (intent.kind === 'comparison') {
    return analysisDecisionSchema.parse({
      responseVersion: 2,
      headline: english ? `${context.eligible}/${context.requested} groups have sufficient data to compare.` : `Có ${context.eligible}/${context.requested} nhóm đủ dữ liệu để so sánh.`,
      stance: context.eligible ? 'review' : 'insufficient-data',
      summary: english ? 'Match the product, dealer, region, and unit before choosing a price.' : 'Đối chiếu đúng sản phẩm, thương hiệu, khu vực và cùng đơn vị trước khi chọn mức giá.',
      conditions: [english ? 'A listed price does not confirm stock or buyback conditions.' : 'Giá niêm yết không xác nhận tồn kho hoặc điều kiện thu mua.'],
      factKeys,
      nextSteps: english ? ['Compare dealer sell prices', 'Compare dealer buy prices'] : ['So sánh theo giá bán ra', 'So sánh theo giá mua vào'],
    });
  }
  if (investment && investment.profitLossVnd > 0) {
    return analysisDecisionSchema.parse({
      responseVersion: 2,
      headline: english ? 'The current dealer buy price is above break-even.' : 'Đã vượt hòa vốn theo giá thu mua đang có.',
      stance: 'review',
      summary: english ? 'This is estimated profit/loss if you sell today. It is not enough to decide whether to sell or hold without knowing your goals and cash needs.' : 'Đây là lãi/lỗ ước tính nếu bán hôm nay; chưa đủ để kết luận nên bán hay giữ nếu chưa biết mục tiêu và nhu cầu tiền mặt.',
      conditions: english ? ['Unknown fees are assumed to be zero.', 'Dealer buy is what the dealer pays when you sell.'] : ['Phí chưa biết được tạm tính bằng 0.', 'Giá mua vào là giá cửa hàng trả khi bạn bán.'],
      factKeys,
      nextSteps: english ? ['Add transaction fees', 'Share when you may need the cash'] : ['Thêm phí giao dịch', 'Cho biết thời gian cần tiền'],
    });
  }
  return analysisDecisionSchema.parse({
    responseVersion: 2,
    headline: english
      ? intent.needsResearch ? 'Current information needs source verification.' : 'Data is available, but check the conditions before acting.'
      : intent.needsResearch ? 'Cần kiểm tra thông tin cập nhật có nguồn.' : 'Đã có số liệu, nhưng cần xem điều kiện trước khi hành động.',
    stance: intent.needsResearch ? 'review' : 'insufficient-data',
    summary: english ? 'This conclusion applies only to the data and assumptions shown.' : 'Kết luận chỉ áp dụng trong phạm vi dữ liệu và giả định được hiển thị.',
    conditions: [english ? 'Do not infer a price target or probability of return.' : 'Không tự suy ra giá mục tiêu hoặc xác suất lợi nhuận.'],
    factKeys,
    nextSteps: english ? ['Add more context', 'Review source data'] : ['Bổ sung hoàn cảnh', 'Xem số liệu nguồn'],
  });
}
