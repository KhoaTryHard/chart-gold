import 'server-only';
import {
  MARKET_COMPANIES,
  getMarketProductCategory,
  getMarketProducts,
  getMarketProduct,
  type MarketProduct,
} from '@/lib/market-sources';
import { getMarketData, type MarketData } from '@/lib/server/sjc';
import { withMarketFetch, abortable } from '@/lib/server/market-fetch';
import type { Locale } from '@/lib/i18n';
import { calculateAnalysisMetrics, type AnalysisRange } from './metrics';
import { vietnamDate, shiftDate } from './dates';
import { normalizeQuestion, type AnalysisIntent } from './intent';
import {
  calculateInvestment,
  investmentInputs,
  type InvestorProfile,
} from './investor-profile';
import type { ScenarioInputs } from './experience';
import type { ForecastResult } from './forecast';
import {
  calculateLedgerSummary,
  ledgerProductKeys,
  type LedgerQuote,
  type PortfolioLedger,
} from '@/lib/portfolio-ledger';

export type QuoteGroup = {
  key: string;
  companyId: string;
  product: MarketProduct;
  aliases: string[];
};
export function quoteKey(companyId: string, product: MarketProduct) {
  const location =
    'officialLocation' in product ? product.officialLocation : '';
  return `${companyId}:${product.upstreamCode ?? product.officialMatch ?? product.id}:${location ?? ''}`;
}

export function selectQuoteGroups(
  intent: AnalysisIntent,
  companyId: string,
  productId: string,
) {
  const groups = new Map<string, QuoteGroup>();
  const companies =
    intent.scope === 'selected'
      ? MARKET_COMPANIES.filter((c) => c.id === companyId)
      : intent.companyIds.length
        ? MARKET_COMPANIES.filter((c) => intent.companyIds.includes(c.id))
        : intent.scope === 'companies' && !intent.productIds.length
          ? MARKET_COMPANIES.filter((company) => company.id === companyId)
          : MARKET_COMPANIES;
  for (const company of companies) {
    for (const product of getMarketProducts(company.id)) {
      if (intent.scope === 'selected' && product.id !== productId) continue;
      if (intent.productIds.length && !intent.productIds.includes(product.id))
        continue;
      if (
        intent.category &&
        getMarketProductCategory(product) !== intent.category
      )
        continue;
      const key = quoteKey(company.id, product);
      const existing = groups.get(key);
      if (existing) existing.aliases.push(product.label);
      else
        groups.set(key, {
          key,
          companyId: company.id,
          product,
          aliases: [product.label],
        });
    }
  }
  return [...groups.values()];
}

export type MarketRow = {
  key: string;
  companyId: string;
  productId: string;
  label: string;
  aliases: string[];
  unit: 'triệu đồng/lượng';
  mode: MarketData['mode'];
  source: MarketData['source'];
  historySource: MarketData['historySource'];
  observedAt: string;
  timestampKind: 'source' | 'retrieval-or-date';
  generatedAt: string;
  metrics: ReturnType<typeof calculateAnalysisMetrics>;
  comparison: {
    today: number;
    yesterday: number | null;
    change: number | null;
    percent: number | null;
  } | null;
  exclusion: string | null;
};
export type MarketContext = {
  today: string;
  yesterday: string;
  scope: string;
  unit: string;
  requested: number;
  eligible: number;
  rows: MarketRow[];
  ranking: Array<{
    rank: number;
    key: string;
    label: string;
    value: number;
    change: number | null;
    percent: number | null;
  }>;
  missing: Array<{ label: string; reason: string }>;
  investments: Array<
    { productId: string; label: string } & ReturnType<
      typeof calculateInvestment
    >
  >;
  deployableCapitalVnd?: number;
  portfolioSummary?: ReturnType<typeof calculateLedgerSummary>;
};

export function buildMarketContext(
  groups: QuoteGroup[],
  markets: Array<MarketData | null>,
  intent: AnalysisIntent,
  range: AnalysisRange,
  now = new Date(),
  profile?: InvestorProfile,
  question = '',
  portfolioLedger?: PortfolioLedger,
  scenarioInputs?: ScenarioInputs,
): MarketContext {
  const today = vietnamDate(now),
    yesterday = shiftDate(today, -1);
  const rows: MarketRow[] = [];
  const missing: MarketContext['missing'] = [];
  const investments: MarketContext['investments'] = [];
  const parsedInputs = investmentInputs(question);
  const inputs = {
    quantityLuong: scenarioInputs?.quantityLuong ?? parsedInputs.quantityLuong,
    costPerLuongVnd:
      scenarioInputs?.costPerLuongVnd ?? parsedInputs.costPerLuongVnd,
    feesVnd: scenarioInputs?.feeVnd ?? parsedInputs.feesVnd,
  };
  const hasExplicitInvestment = Boolean(
    scenarioInputs?.quantityLuong ||
    scenarioInputs?.costPerLuongVnd ||
    parsedInputs.quantityLuong ||
    parsedInputs.costPerLuongVnd,
  );
  groups.forEach((group, index) => {
    const market = markets[index];
    if (!market || market.availability !== 'available' || !market.latest) {
      missing.push({
        label: group.product.label,
        reason: market?.unavailableReason ?? 'Nguồn không trả đủ dữ liệu.',
      });
      return;
    }
    const canonical = group.product.upstreamCode
      ? getMarketProducts(group.companyId).find(
          (product) => product.upstreamCode === group.product.upstreamCode,
        )
      : undefined;
    const historyMismatch =
      market.source.official &&
      canonical &&
      canonical.officialMatch !== group.product.officialMatch;
    const valid = market.records.filter(
      (point) =>
        (!historyMismatch || point.date === today) &&
        point.buy > 0 &&
        point.sell >= point.buy &&
        Number.isFinite(point.sell) &&
        point.date <= today,
    );
    const latest = valid.find((point) => point.date === today);
    const prior = valid.find((point) => point.date === yesterday);
    const change =
      latest && prior
        ? Number((latest[intent.side] - prior[intent.side]).toFixed(4))
        : null;
    const comparison = latest
      ? {
          today: latest[intent.side],
          yesterday: prior?.[intent.side] ?? null,
          change,
          percent:
            change !== null && prior
              ? Number(((change / prior[intent.side]) * 100).toFixed(4))
              : null,
        }
      : null;
    const exclusion =
      market.mode === 'fallback'
        ? 'Chỉ có bản dự phòng.'
        : !latest
          ? 'Chưa có giá hôm nay.'
          : intent.daily && historyMismatch
            ? 'Lịch sử gộp không khớp quy cách niêm yết hiện tại.'
            : intent.daily && !prior
              ? 'Thiếu giá ngày hôm qua.'
              : null;
    rows.push({
      key: group.key,
      companyId: group.companyId,
      productId: group.product.id,
      label: group.product.label,
      aliases: group.aliases,
      unit: 'triệu đồng/lượng',
      mode: market.mode,
      source: market.source,
      historySource: market.historySource,
      observedAt: market.observedAt,
      // Several existing HTML adapters stamp retrieval time, not publication time.
      timestampKind: market.timestampKind ?? 'retrieval-or-date',
      generatedAt: market.generatedAt,
      metrics: calculateAnalysisMetrics(valid, range),
      comparison,
      exclusion,
    });
    if (exclusion)
      missing.push({ label: group.product.label, reason: exclusion });
    for (const holding of profile?.holdings ?? []) {
      if (
        holding.companyId === group.companyId &&
        quoteKey(
          holding.companyId,
          getMarketProduct(holding.companyId, holding.productId),
        ) === group.key &&
        latest &&
        !exclusion
      ) {
        investments.push({
          productId: holding.productId,
          label: group.product.label,
          ...calculateInvestment(
            latest.buy,
            latest.sell,
            holding.quantityLuong,
            holding.costPerLuongVnd,
            profile?.feesVnd,
          ),
        });
      }
    }
    if (
      latest &&
      !exclusion &&
      !profile?.holdings?.length &&
      !portfolioLedger?.transactions.length &&
      !hasExplicitInvestment
    )
      investments.push({
        productId: group.product.id,
        label: `${group.product.label} (mua mới 1 lượng)`,
        ...calculateInvestment(latest.buy, latest.sell, 1),
      });
    if (
      latest &&
      !exclusion &&
      inputs.quantityLuong &&
      inputs.quantityLuong > 0 &&
      inputs.quantityLuong <= 1e6 &&
      !profile?.holdings?.length &&
      !portfolioLedger?.transactions.length
    ) {
      investments.push({
        productId: group.product.id,
        label: `${group.product.label} (theo số lượng trong câu hỏi)`,
        ...calculateInvestment(
          latest.buy,
          latest.sell,
          inputs.quantityLuong,
          inputs.costPerLuongVnd,
          inputs.feesVnd ?? profile?.feesVnd,
        ),
      });
    }
  });
  const eligible = rows.filter((row) => !row.exclusion && row.comparison);
  const quotes = new Map<string, LedgerQuote>();
  groups.forEach((group, index) => {
    const market = markets[index];
    // A fallback snapshot may be shown as a reference, but it must never drive
    // a portfolio value or a "sell today" conclusion automatically.
    if (
      market?.availability !== 'available' ||
      !market.latest ||
      market.mode === 'fallback' ||
      market.latest.date !== today
    )
      return;
    quotes.set(`${group.companyId}:${group.product.id}`, {
      companyId: group.companyId,
      productId: group.product.id,
      buy: market.latest.buy * 1_000_000,
      sell: market.latest.sell * 1_000_000,
      observedAt: market.observedAt,
    });
  });
  const portfolioSummary = portfolioLedger
    ? calculateLedgerSummary(portfolioLedger.transactions, quotes)
    : undefined;
  const ranking = eligible
    .map((row) => ({
      rank: 0,
      key: row.key,
      label: row.label,
      value: intent.daily
        ? Math.abs(
            (intent.ranking === 'percent'
              ? row.comparison!.percent
              : row.comparison!.change) ?? 0,
          )
        : row.comparison!.today,
      change: row.comparison!.change,
      percent: row.comparison!.percent,
    }))
    .sort(
      (a, b) =>
        (intent.order === 'asc' ? a.value - b.value : b.value - a.value) ||
        a.key.localeCompare(b.key),
    );
  ranking.forEach((row, index) => {
    row.rank =
      index && row.value === ranking[index - 1].value
        ? ranking[index - 1].rank
        : index + 1;
  });
  return {
    today,
    yesterday,
    scope:
      intent.scope === 'selected'
        ? 'Sản phẩm được chọn'
        : 'Các nhóm sản phẩm phù hợp trong danh mục tích hợp',
    unit: 'triệu đồng/lượng',
    requested: groups.length,
    eligible: eligible.length,
    rows,
    ranking,
    missing,
    investments,
    deployableCapitalVnd:
      profile?.capitalVnd === undefined
        ? undefined
        : profile.capitalVnd - (profile.cashNeededVnd ?? 0),
    portfolioSummary,
  };
}

export async function loadMarketContext(
  intent: AnalysisIntent,
  companyId: string,
  productId: string,
  range: AnalysisRange,
  signal: AbortSignal,
  profile?: InvestorProfile,
  question = '',
  portfolioLedger?: PortfolioLedger,
  scenarioInputs?: ScenarioInputs,
) {
  const groups = selectQuoteGroups(intent, companyId, productId);
  const asksAboutPortfolio =
    intent.kind === 'investment' ||
    /danh muc|so giao dich|lo vang|da mua|dang giu|chot loi|lai lo|portfolio/.test(
      normalizeQuestion(question),
    );
  // A portfolio question also needs the quotes for its explicitly saved holdings.
  if (asksAboutPortfolio)
    for (const holding of profile?.holdings ?? []) {
      const product = getMarketProduct(holding.companyId, holding.productId);
      const key = quoteKey(holding.companyId, product);
      if (!groups.some((group) => group.key === key))
        groups.push({
          key,
          companyId: holding.companyId,
          product,
          aliases: [product.label],
        });
    }
  if (asksAboutPortfolio && portfolioLedger)
    for (const key of ledgerProductKeys(portfolioLedger)) {
      const [ledgerCompanyId, ledgerProductId] = key.split(':');
      const product = getMarketProduct(ledgerCompanyId, ledgerProductId);
      const keyValue = quoteKey(ledgerCompanyId, product);
      if (!groups.some((group) => group.key === keyValue))
        groups.push({
          key: keyValue,
          companyId: ledgerCompanyId,
          product,
          aliases: [product.label],
        });
    }
  const historyDays =
    intent.kind === 'comparison' && intent.daily
      ? 1
      : range === '7N'
        ? 7
        : range === '1T'
          ? 30
          : 365;
  const markets = await withMarketFetch(signal, historyDays, () =>
    abortable(
      Promise.all(
        groups.map(async (group) => {
          try {
            return await getMarketData(group.companyId, group.product.id);
          } catch (error) {
            if (signal.aborted) throw error;
            return null;
          }
        }),
      ),
      signal,
    ),
  );
  signal.throwIfAborted();
  return {
    context: buildMarketContext(
      groups,
      markets,
      intent,
      range,
      new Date(),
      profile,
      question,
      portfolioLedger,
      scenarioInputs,
    ),
    markets,
  };
}

export function factualAnswer(
  context: MarketContext,
  intent: AnalysisIntent,
  locale: Locale = 'vi',
  forecast?: ForecastResult,
) {
  if (locale === 'en') {
    const formatEnglish = (n: number | null) =>
      n === null
        ? '—'
        : n.toLocaleString('en-US', { maximumFractionDigits: 4 });
    const portfolio = context.portfolioSummary;
    const forecastText = forecast
      ? forecast.status === 'experimental'
        ? `\n\n### Seven-day forecast — target ${forecast.targetDate}\n\n- Method: historical seven-day change quantiles from ${forecast.observationCount} observations and ${forecast.pairCount} pairs.\n- Downside: dealer buy ${formatEnglish(forecast.ranges[0]?.buyVndPerLuong ?? null)} VND/lượng; dealer sell ${formatEnglish(forecast.ranges[0]?.sellVndPerLuong ?? null)} VND/lượng.\n- Base: dealer buy ${formatEnglish(forecast.ranges[1]?.buyVndPerLuong ?? null)} VND/lượng; dealer sell ${formatEnglish(forecast.ranges[1]?.sellVndPerLuong ?? null)} VND/lượng.\n- Upside: dealer buy ${formatEnglish(forecast.ranges[2]?.buyVndPerLuong ?? null)} VND/lượng; dealer sell ${formatEnglish(forecast.ranges[2]?.sellVndPerLuong ?? null)} VND/lượng.\n- Experimental estimate, not a probability or guaranteed target.`
        : `\n\n### Seven-day forecast — target ${forecast.targetDate}\n\n- ${forecast.reason ?? 'There is not enough verified history for a numeric range.'}`
      : '';
    const portfolioText =
      portfolio && intent.kind === 'investment'
        ? `\n\n### Your gold ledger today\n\n- Bought ${formatEnglish(portfolio.totalBoughtLuong)} lượng, sold ${formatEnglish(portfolio.totalSoldLuong)} lượng; currently holding ${formatEnglish(portfolio.openQuantityLuong)} lượng.\n- Realized profit/loss: ${formatEnglish(portfolio.realizedPnlVnd)} VND.\n- Estimated profit/loss at the displayed dealer buy price: ${formatEnglish(portfolio.unrealizedPnlVnd)} VND.\n- This is an estimate, not a confirmed buyback offer; verify the product and conditions with the dealer.${portfolio.errors.length ? `\n- Ledger warnings: ${portfolio.errors.length} issue(s) need review.` : ''}`
        : '';
    if (!context.ranking.length)
      return `There is not enough data to conclude across ${context.requested} checked groups.${forecastText}${portfolioText}\n\n${context.missing.map((item) => `- ${item.label}: no usable price data is available.`).join('\n')}`;
    const side =
      intent.side === 'buy' ? 'dealer sell price' : 'dealer buy price';
    const winners = context.ranking
      .filter((row) => row.rank === 1)
      .map((row) => row.label)
      .join(', ');
    const rankingDescription = intent.daily
      ? 'show the largest price movement'
      : intent.order === 'asc'
        ? 'have the lowest price'
        : 'have the highest price';
    const intro =
      intent.kind === 'comparison'
        ? `Among ${context.eligible}/${context.requested} groups with sufficient data, **${winners}** ${rankingDescription} by ${side}.\n\n`
        : `Verified data for ${context.eligible}/${context.requested} product groups:\n\n`;
    const rows = context.ranking
      .slice(0, 10)
      .map((rank) => {
        const row = context.rows.find((item) => item.key === rank.key)!;
        return `| ${rank.label} | ${formatEnglish(row.comparison?.today ?? null)} | ${formatEnglish(rank.change)} | ${formatEnglish(rank.percent)} |`;
      })
      .join('\n');
    const missing = context.missing.length
      ? `\n\nNot ranked because usable price data is unavailable: ${context.missing.map((item) => item.label).join(', ')}.`
      : '';
    const investments =
      intent.kind === 'investment' && context.investments.length
        ? '\n\n### Reference calculations\n\n' +
          context.investments
            .slice(0, 6)
            .map(
              (item) =>
                `- ${item.label}: ${formatEnglish(item.quantityLuong)} lượng; estimated profit/loss on resale ${formatEnglish(item.profitLossVnd)} VND; dealer buy price to break even ${formatEnglish(item.breakEvenBuyVndPerLuong)} VND/lượng. Fees: ${formatEnglish(item.feesVnd)} VND.`,
            )
            .join('\n')
        : '';
    return `${forecast ? '' : intro}${forecastText}\n\nUnit: VND million per lượng. Date: ${context.today}${intent.daily ? ` compared with ${context.yesterday}; the latest quote is compared with the previous dated record, not the same time of day` : ''}.\n\n| Product group | Current price | Change | % |\n| --- | ---: | ---: | ---: |\n${rows}${missing}\n\nDealer buy is what the dealer pays you. Calculate the buy–sell spread before trading.${portfolioText}${investments}`;
  }
  const format = (n: number | null) =>
    n === null ? '—' : n.toLocaleString('vi-VN', { maximumFractionDigits: 4 });
  const portfolio = context.portfolioSummary;
  const forecastText = forecast
    ? forecast.status === 'experimental'
      ? `\n\n### Dự báo 7 ngày — ngày đích ${forecast.targetDate}\n\n- Phương pháp: phân vị thay đổi lịch sử cách 7 ngày từ ${forecast.observationCount} ngày và ${forecast.pairCount} cặp.\n- Kịch bản giảm: mua vào ${format(forecast.ranges[0]?.buyVndPerLuong ?? null)} VNĐ/lượng; bán ra ${format(forecast.ranges[0]?.sellVndPerLuong ?? null)} VNĐ/lượng.\n- Kịch bản cơ sở: mua vào ${format(forecast.ranges[1]?.buyVndPerLuong ?? null)} VNĐ/lượng; bán ra ${format(forecast.ranges[1]?.sellVndPerLuong ?? null)} VNĐ/lượng.\n- Kịch bản tăng: mua vào ${format(forecast.ranges[2]?.buyVndPerLuong ?? null)} VNĐ/lượng; bán ra ${format(forecast.ranges[2]?.sellVndPerLuong ?? null)} VNĐ/lượng.\n- Đây là khoảng ước tính thực nghiệm, không phải xác suất hoặc giá mục tiêu bảo đảm.`
      : `\n\n### Dự báo 7 ngày — ngày đích ${forecast.targetDate}\n\n- ${forecast.reason ?? 'Chưa có đủ lịch sử đã kiểm chứng để tạo khoảng giá.'}`
    : '';
  const portfolioText =
    portfolio && intent.kind === 'investment'
      ? `\n\n### Sổ vàng hôm nay\n\n- Đã mua ${format(portfolio.totalBoughtLuong)} lượng, đã bán ${format(portfolio.totalSoldLuong)} lượng; đang giữ ${format(portfolio.openQuantityLuong)} lượng.\n- Lãi đã chốt: ${format(portfolio.realizedPnlVnd)} VNĐ.\n- Lãi/lỗ ước tính theo giá mua vào đang hiển thị: ${format(portfolio.unrealizedPnlVnd)} VNĐ.\n- Đây là ước tính, không phải cam kết thu mua; hãy xác nhận đúng sản phẩm và điều kiện tại cửa hàng.${portfolio.errors.length ? `\n- Cảnh báo sổ: ${portfolio.errors.join(' ')}` : ''}`
      : '';
  if (!context.ranking.length)
    return `Chưa có đủ dữ liệu để kết luận trong ${context.requested} nhóm đã kiểm tra.${forecastText}${portfolioText}\n\n${context.missing.map((item) => `- ${item.label}: ${item.reason}`).join('\n')}`;
  const side = intent.side === 'buy' ? 'mua vào' : 'bán ra';
  const winners = context.ranking
    .filter((row) => row.rank === 1)
    .map((row) => row.label)
    .join(', ');
  return (
    (intent.kind === 'comparison'
      ? `Trong ${context.eligible}/${context.requested} nhóm đủ dữ liệu, **${winners}** ${intent.daily ? 'có biến động lớn nhất' : intent.order === 'asc' ? 'có giá thấp nhất' : 'có giá cao nhất'} về giá ${side}.\n\n`
      : forecast
        ? ''
        : `Dữ liệu kiểm chứng được cho ${context.eligible}/${context.requested} nhóm sản phẩm:\n\n`) +
    `${forecastText}\n\nĐơn vị: triệu đồng/lượng. Ngày ${context.today}${intent.daily ? ` so với ${context.yesterday}; giá mới nhất so với bản ghi ngày trước, không phải cùng giờ` : ''}.\n\n` +
    '| Nhóm sản phẩm | Giá hiện tại | Thay đổi | % |\n| --- | ---: | ---: | ---: |\n' +
    context.ranking
      .slice(0, 10)
      .map((rank) => {
        const row = context.rows.find((item) => item.key === rank.key)!;
        return `| ${rank.label} | ${format(row.comparison?.today ?? null)} | ${format(rank.change)} | ${format(rank.percent)} |`;
      })
      .join('\n') +
    (context.missing.length
      ? `\n\nKhông xếp hạng: ${context.missing.map((item) => `${item.label} (${item.reason})`).join('; ')}.`
      : '') +
    '\n\nGiá mua vào là giá cửa hàng mua lại từ bạn. Chênh lệch mua–bán cần được tính trước khi giao dịch.' +
    portfolioText +
    (intent.kind === 'investment' && context.investments.length
      ? '\n\n### Phép tính tham khảo\n\n' +
        context.investments
          .slice(0, 6)
          .map(
            (item) =>
              `- ${item.label}: ${format(item.quantityLuong)} lượng; lãi/lỗ nếu bán lại ${format(item.profitLossVnd)} VNĐ; giá cửa hàng cần mua lại để hòa vốn ${format(item.breakEvenBuyVndPerLuong)} VNĐ/lượng. ${item.feesAssumption ?? `Phí ${format(item.feesVnd)} VNĐ.`}`,
          )
          .join('\n')
      : '')
  );
}
