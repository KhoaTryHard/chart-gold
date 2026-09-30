import {
  getMarketCompany,
  getMarketProduct,
  getMarketProducts,
  isMarketCompanyId,
  isMarketProductId,
} from '@/lib/market-sources';
import type { AnalysisRange } from './metrics';
import { resolveIntent } from './intent';
import { investmentInputs } from './investor-profile';
import type { AnalysisGoal, ScenarioInputs } from './experience';

export type QuestionContextNeed = {
  key: 'product' | 'quantityLuong' | 'capitalVnd' | 'horizon';
  label: string;
  reason: string;
};

export type QuestionContext = {
  companyId: string;
  productId: string;
  range: AnalysisRange;
  companyLabel: string;
  productLabel: string;
  rangeSource: 'question' | 'link' | 'default';
  scenarioInputs: ScenarioInputs;
  missing: QuestionContextNeed[];
};

const rangeFromText = (question: string): AnalysisRange | null => {
  const value = question.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/7\s*ngay|tuan qua|7 days?|last week/.test(value)) return '7N';
  if (/30\s*ngay|thang qua|30 days?|last month/.test(value)) return '1T';
  if (/365\s*ngay|nam qua|365 days?|last year/.test(value)) return '1N';
  return null;
};

function readCapital(question: string) {
  const normalized = question
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const match = normalized.match(
    /(?:ngan sach|von|budget|capital|danh|dau tu)\s*(?:la|:|=)?\s*(\d[\d.,]*)\s*(trieu|million|m|ty|billion|bn|nghin|ngan|thousand|k|vnd|dong)/,
  );
  if (!match) return undefined;
  const raw = /^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(match[1])
    ? match[1].replace(/\./g, '').replace(',', '.')
    : match[1].replace(',', '.');
  const value = Number(raw);
  const multiplier = /^(?:ty|billion|bn)$/.test(match[2])
    ? 1e9
    : /^(?:trieu|million|m)$/.test(match[2])
      ? 1e6
      : /^(?:nghin|ngan|thousand|k)$/.test(match[2])
        ? 1e3
        : 1;
  const result = value * multiplier;
  return Number.isFinite(result) && result > 0 ? result : undefined;
}

function readHorizon(question: string): ScenarioInputs['horizon'] | undefined {
  const normalized = question.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const match = normalized.match(/(?:giu|hold|holding|trong|for)\s*(?:khoang|about)?\s*(\d+)\s*(tuan|thang|nam|week|weeks|month|months|year|years)/);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unit = match[2];
  if (/nam|year/.test(unit) || amount >= 12) return '12m+';
  if (/thang|month/.test(unit)) return amount <= 3 ? '1-3m' : '6-12m';
  return '1-4w';
}

function companyFromIntent(ids: string[], fallback: string) {
  return ids.find((id) => isMarketCompanyId(id)) ?? fallback;
}

export function inferQuestionContext(input: {
  question: string;
  goal?: AnalysisGoal;
  companyId?: string;
  productId?: string;
  range?: AnalysisRange;
  locale?: 'vi' | 'en';
}) : QuestionContext {
  const locale = input.locale ?? 'vi';
  const intent = resolveIntent(input.question, []);
  const explicitCompany = companyFromIntent(intent.companyIds, input.companyId ?? 'sjc');
  const products = getMarketProducts(explicitCompany);
  const explicitProduct = intent.productIds.find((id) => isMarketProductId(explicitCompany, id));
  const normalizedQuestion = input.question.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const mentionsRing = intent.category === 'ring' || /\bnhan\b|\bring\b/.test(normalizedQuestion);
  const mentionsBar = intent.category === 'bar' || /\bmieng\b|\bbar\b/.test(normalizedQuestion);
  const shapeProduct = mentionsRing && /(?:\d[\d.,]*\s*(?:luong|tael|chi|phan)|one\s*(?:tael|chi))/.test(normalizedQuestion)
    ? products.find((item) => item.id === 'ring-1c')?.id
    : mentionsBar && /1\s*luong|one\s*tael/.test(normalizedQuestion)
      ? products.find((item) => item.id === 'bar-1l')?.id
      : undefined;
  const productId = shapeProduct ?? explicitProduct ?? input.productId ?? products[0]?.id ?? 'bar-1l';
  const questionRange = rangeFromText(input.question);
  const range = questionRange ?? input.range ?? '1T';
  const parsed = investmentInputs(input.question);
  const scenarioInputs: ScenarioInputs = {
    ...(parsed.quantityLuong ? { quantityLuong: parsed.quantityLuong } : {}),
    ...(parsed.costPerLuongVnd ? { costPerLuongVnd: parsed.costPerLuongVnd } : {}),
    ...(parsed.feesVnd !== undefined ? { feeVnd: parsed.feesVnd } : {}),
    ...(readCapital(input.question) ? { capitalVnd: readCapital(input.question) } : {}),
    ...(readHorizon(input.question) ? { horizon: readHorizon(input.question) } : {}),
  };
  const missing: QuestionContextNeed[] = [];
  const productMentioned = Boolean(explicitProduct || shapeProduct);
  if (input.goal === 'buy' && !productMentioned) {
    missing.push({
      key: 'product',
      label: locale === 'en' ? 'Product' : 'Loại vàng',
      reason: locale === 'en' ? 'Name the gold product or brand you want to analyze.' : 'Hãy nêu loại vàng hoặc thương hiệu bạn muốn phân tích.',
    });
  }
  if (input.goal === 'buy' && !scenarioInputs.quantityLuong && !scenarioInputs.capitalVnd) {
    missing.push({
      key: 'quantityLuong',
      label: locale === 'en' ? 'Purchase size' : 'Quy mô mua',
      reason: locale === 'en' ? 'Add a quantity or budget so break-even can be calculated.' : 'Hãy thêm số lượng hoặc ngân sách để tính hòa vốn.',
    });
  }
  if (input.goal === 'buy' && /nen mua|mua ngay|should i buy|buy now|dau tu/.test(input.question.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()) && !scenarioInputs.horizon) {
    missing.push({
      key: 'horizon',
      label: locale === 'en' ? 'Holding period' : 'Thời gian dự định giữ',
      reason: locale === 'en' ? 'Add how long you plan to hold it.' : 'Hãy thêm thời gian bạn dự định giữ vàng.',
    });
  }
  const company = getMarketCompany(explicitCompany);
  const product = getMarketProduct(explicitCompany, productId);
  return {
    companyId: explicitCompany,
    productId,
    range,
    companyLabel: company.shortName,
    productLabel: product.shortLabel,
    rangeSource: questionRange ? 'question' : input.range ? 'link' : 'default',
    scenarioInputs,
    missing: missing.slice(0, 2),
  };
}
