import { z } from 'zod';
import { getMarketProducts, MARKET_COMPANIES } from '@/lib/market-sources';
import { normalizeQuestion } from './intent';

const money = z.number().nonnegative().max(1e15);
export const investorProfileSchema = z
  .object({
    capitalVnd: money.optional(),
    horizon: z.enum(['1-4w', '1-3m', '6-12m']).optional(),
    risk: z.enum(['low', 'balanced', 'high']).optional(),
    cashNeededVnd: money.optional(),
    feesVnd: money.optional(),
    holdings: z
      .array(
        z
          .object({
            companyId: z.string().max(50),
            productId: z.string().max(100),
            quantityLuong: z.number().positive().max(1e6),
            costPerLuongVnd: money.refine((value) => value > 0),
          })
          .refine(
            (holding) =>
              MARKET_COMPANIES.some(
                (company) => company.id === holding.companyId,
              ) &&
              getMarketProducts(holding.companyId).some(
                (product) => product.id === holding.productId,
              ),
            'Sản phẩm nắm giữ không hợp lệ.',
          ),
      )
      .max(20)
      .default([]),
  })
  .refine(
    (profile) =>
      profile.capitalVnd === undefined ||
      profile.cashNeededVnd === undefined ||
      profile.cashNeededVnd <= profile.capitalVnd,
    'Tiền cần giữ không được vượt vốn dự kiến.',
  );

export type InvestorProfile = z.infer<typeof investorProfileSchema>;

export function profileKey(account: string) {
  return `kim-tuyen:investor:v1:${encodeURIComponent(account.trim().toLowerCase())}`;
}

export function readInvestorProfile(
  account: string,
): InvestorProfile | undefined {
  try {
    const saved = JSON.parse(
      localStorage.getItem(profileKey(account)) ?? 'null',
    );
    if (saved?.version !== 1 || typeof saved.updatedAt !== 'string') return;
    const result = investorProfileSchema.safeParse(saved.profile);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

export function saveInvestorProfile(account: string, profile: InvestorProfile) {
  localStorage.setItem(
    profileKey(account),
    JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      profile: investorProfileSchema.parse(profile),
    }),
  );
}

export function calculateInvestment(
  buy: number,
  sell: number,
  quantityLuong: number,
  costPerLuongVnd = sell * 1e6,
  feesVnd?: number,
) {
  const fees = feesVnd ?? 0;
  const acquisition = quantityLuong * costPerLuongVnd;
  const proceeds = quantityLuong * buy * 1e6;
  return {
    quantityLuong,
    spreadVndPerLuong: Math.round((sell - buy) * 1e6),
    immediateLossVnd: Math.round(quantityLuong * (sell - buy) * 1e6 + fees),
    profitLossVnd: Math.round(proceeds - acquisition - fees),
    breakEvenBuyVndPerLuong: Math.round(costPerLuongVnd + fees / quantityLuong),
    feesVnd: fees,
    feesAssumption:
      feesVnd === undefined
        ? 'Chưa biết phí; phép tính tạm tính phí bằng 0.'
        : null,
  };
}

/** Parse only explicitly labeled numbers; uncertain values stay unknown. */
export function investmentInputs(question: string) {
  const q = normalizeQuestion(question);
  const number = (raw: string) => {
    const value = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(raw)
      ? raw.replace(/,/g, '')
      : /^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(raw)
        ? raw.replace(/\./g, '').replace(',', '.')
        : raw.replace(',', '.');
    return Number(value);
  };
  const amount = (match: RegExpMatchArray | null, normalizePerLuong = false) => {
    if (
      !match ||
      q
        .slice((match.index ?? 0) + match[0].length)
        .trimStart()
        .startsWith('%')
    )
      return undefined;
    if (!match[2]) return undefined; // An unlabeled price/fee is ambiguous.
    const rawValue =
      number(match[1]) *
      (/^(?:ty|billion|bn)$/.test(match[2])
        ? 1e9
        : /^(?:trieu|million|m)$/.test(match[2])
          ? 1e6
          : /^(?:nghin|ngan|thousand|k)$/.test(match[2])
            ? 1e3
            : 1);
    const basis = match[3]?.toLowerCase();
    const divisor =
      normalizePerLuong && /^(?:chi|chis)$/.test(basis ?? '')
        ? 10
        : normalizePerLuong && /^(?:phan|phan)$/.test(basis ?? '')
          ? 100
          : normalizePerLuong && /^(?:gram|grams)$/.test(basis ?? '')
            ? 37.5
            : 1;
    const value = rawValue * divisor;
    return Number.isFinite(value) && value >= 0 && value <= 1e15
      ? value
      : undefined;
  };
  const quantity = q.match(
    /(?:mua|giu|ban|co|buy|bought|hold|holding|own|sell|selling|sold)\s+(\d[\d.,]*)(?:\s*)(luong|luongs|tael|taels|chi|chis|grams?)/,
  );
  const cost = q.match(
    /(?:gia von|gia mua|mua voi gia|mua gia|cost basis|cost per luong|purchase price|buy price|bought at)\s*(?:[:=]|of|at|is)?\s*(\d[\d.,]*)\s*(trieu|million|m|ty|billion|bn|nghin|ngan|thousand|k|dong|vnd)?\s*(?:dong|vnd)?\s*(?:\/|per)?\s*(luong|tael|chi|chis|phan|gram|grams)?/,
  );
  const fees = q.match(
    /(?:phi giao dich|muc phi|phi|transaction fee|fees?|fee)\s*(?:[:=]|of|is|are)?\s*(\d[\d.,]*)\s*(trieu|million|m|ty|billion|bn|nghin|ngan|thousand|k|dong|vnd)?/,
  );
  return {
    quantityLuong: quantity
      ? number(quantity[1]) /
        (/^(?:chi|chis)$/.test(quantity[2])
          ? 10
          : /^(?:gram|grams)$/.test(quantity[2])
            ? 37.5
            : 1)
      : undefined,
    costPerLuongVnd: amount(cost, true),
    feesVnd: amount(fees),
  };
}
