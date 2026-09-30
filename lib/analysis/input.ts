import type { AnalysisRequestPayload } from './request';
import type { Locale } from '@/lib/i18n';
import {
  normalizeQuestion,
  resolveIntent,
  type AnalysisIntent,
} from './intent';
import { investmentInputs } from './investor-profile';
import { missingAnalysisInputs, type ScenarioInputs } from './experience';
import type { AiCapability } from '@/lib/billing/plans';

export type ResolvedScenario = {
  /** Canonical quantity for deterministic calculations; unit is preserved for the UI. */
  quantity?: number;
  unit: 'luong';
  priceBasis: 'per-luong' | 'total';
  costVnd?: number;
  quantityLuong?: number;
  costPerLuongVnd?: number;
  feeVnd?: number;
  companyId: string;
  productId: string;
  source: 'form' | 'chat' | 'profile' | 'ledger';
  confidence: 'confirmed' | 'inferred' | 'missing';
};

/** Normalize all personal inputs before they reach deterministic calculations or an AI provider. */
export function resolveScenario(
  scenario: ScenarioInputs | undefined,
  question: string,
  companyId: string,
  productId: string,
  source: ResolvedScenario['source'] = 'form',
): ResolvedScenario {
  const extracted = investmentInputs(question);
  const quantityLuong = scenario?.quantityLuong ?? extracted.quantityLuong;
  const costPerLuongVnd =
    scenario?.costPerLuongVnd ?? extracted.costPerLuongVnd;
  const feeVnd = scenario?.feeVnd ?? extracted.feesVnd;
  const hasInputs = quantityLuong !== undefined || costPerLuongVnd !== undefined || feeVnd !== undefined;
  return {
    quantity: quantityLuong,
    unit: 'luong',
    priceBasis: costPerLuongVnd === undefined ? 'total' : 'per-luong',
    costVnd:
      quantityLuong !== undefined && costPerLuongVnd !== undefined
        ? quantityLuong * costPerLuongVnd
        : undefined,
    quantityLuong,
    costPerLuongVnd,
    feeVnd,
    companyId,
    productId,
    source,
    confidence: hasInputs ? (scenario ? 'confirmed' : 'inferred') : 'missing',
  };
}

/** UI units are explicit: money fields are millions/thousands, quantity is luong. */
export function parseVietnameseNumber(
  raw: string,
  locale: Locale = 'vi',
  messageLocale: Locale = locale,
): number | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  let normalized = text;
  if (locale === 'en') {
    if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text))
      normalized = text.replace(/,/g, '');
    else if (!/^\d+(?:\.\d+)?$/.test(text))
      throw new Error(
        messageLocale === 'en'
          ? 'Use a number such as 145.5 or 1,000; the unit is shown beside the field.'
          : 'Dùng số như 145,5 hoặc 1.000; đơn vị đã ghi bên cạnh ô nhập.',
      );
  } else if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(text))
    normalized = text.replace(/\./g, '').replace(',', '.');
  else if (/^\d+(?:[.,]\d+)?$/.test(text)) normalized = text.replace(',', '.');
  else
    throw new Error(
      messageLocale === 'en'
        ? 'Use a number such as 145.5 or 1,000; the unit is shown beside the field.'
        : 'Dùng số như 145,5 hoặc 1.000; đơn vị đã ghi bên cạnh ô nhập.',
    );
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0)
    throw new Error(messageLocale === 'en' ? 'Value must be a non-negative number.' : 'Giá trị phải là số không âm.');
  return value;
}

export function prepareAnalysisInput(
  payload: AnalysisRequestPayload,
  classified?: AnalysisIntent,
) {
  const intent = {
    ...(classified ?? resolveIntent(payload.question, payload.messages)),
  };
  if (payload.responseVersion !== 2)
    return {
      intent,
      payload,
      needs: [],
      capability: undefined as AiCapability | undefined,
      resolvedScenario: undefined as ResolvedScenario | undefined,
    };
  if (payload.analysisDepth) intent.depth = payload.analysisDepth;
  const personal =
    intent.kind === 'investment' ||
    /dang giu|vang toi|toi dang|cua toi|da mua|mua \d|giu \d|ban \d|\b(?:i|my)\b.*\b(?:hold|holding|own|bought|buy|sell|sold|portfolio)\b|\b(?:my gold|my position|my portfolio)\b/.test(
      normalizeQuestion(payload.question),
    );
  const goal = personal
    ? payload.goal
    : intent.kind === 'macro'
      ? 'market'
      : intent.kind === 'comparison'
        ? 'compare'
        : undefined;
  const profile =
    personal && payload.useInvestorProfile === true
      ? payload.investorProfile
      : undefined;
  const ledger =
    personal && payload.usePortfolioLedger === true
      ? payload.portfolioLedger
      : undefined;
  const extracted = investmentInputs(payload.question);
  const scenario: ScenarioInputs = personal
    ? { ...payload.scenarioInputs }
    : {};
  const needs: ReturnType<typeof missingAnalysisInputs> = [];
  for (const [key, value] of Object.entries({
    quantityLuong: extracted.quantityLuong,
    costPerLuongVnd: extracted.costPerLuongVnd,
    feeVnd: extracted.feesVnd,
  })) {
    if (value === undefined) continue;
    const field = key as 'quantityLuong' | 'costPerLuongVnd' | 'feeVnd';
    if (scenario[field] !== undefined && scenario[field] !== value) {
      needs.push({
        key: field,
        label:
          payload.locale === 'en'
            ? field === 'quantityLuong'
              ? 'Quantity'
              : field === 'feeVnd'
                ? 'Transaction fee'
                : 'Cost basis per lượng'
            : field === 'quantityLuong'
              ? 'Số lượng'
              : field === 'feeVnd'
                ? 'Phí giao dịch'
                : 'Giá vốn mỗi lượng',
        reason: payload.locale === 'en'
          ? 'This differs from the entered value. Make them consistent before analysis.'
          : 'Giá trị trong câu hỏi khác ô nhập. Hãy sửa cho thống nhất trước khi phân tích.',
      });
    } else scenario[field] = value;
  }
  if (profile && ledger?.transactions.length)
    needs.push({
      key: 'personalContext',
      label: payload.locale === 'en' ? 'Position source' : 'Nguồn vị thế',
      reason: payload.locale === 'en'
        ? 'Choose either the profile or the gold ledger for this request to avoid counting a position twice.'
        : 'Chọn hồ sơ hoặc sổ vàng cho lượt này để tránh tính trùng vị thế.',
    });
  needs.push(
    ...missingAnalysisInputs({
      goal,
      intent,
      scenario,
      investorProfile: profile,
      portfolioLedger: ledger,
      question: payload.question,
      locale: payload.locale,
    }),
  );
  const capability: AiCapability =
    intent.depth === 'deep'
      ? 'deep'
      : intent.needsResearch
        ? 'research'
        : profile || ledger
          ? 'portfolio'
          : 'standard';
  const resolvedScenario = resolveScenario(
    scenario,
    payload.question,
    payload.companyId,
    payload.productId,
    ledger ? 'ledger' : profile ? 'profile' : payload.scenarioInputs ? 'form' : 'chat',
  );
  return {
    intent,
    capability,
    needs: needs.slice(0, 2),
    resolvedScenario,
    payload: {
      ...payload,
      goal,
      scenarioInputs: scenario,
      investorProfile: profile,
      portfolioLedger: ledger,
    },
  };
}
