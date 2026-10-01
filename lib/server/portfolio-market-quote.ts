import 'server-only';

import { and, desc, eq } from 'drizzle-orm';

import { getDatabase } from '@/db';
import { marketHistoryPoints } from '@/db/schema';
import { shiftDate, vietnamDate } from '@/lib/analysis/dates';
import {
  getCalendarWindow,
  type MarketHistoryCapability,
} from '@/lib/market-history';
import {
  getMarketCompany,
  getMarketHistoryCapability,
  getMarketProduct,
  isMarketProductSelectable,
} from '@/lib/market-sources';
import {
  isValidTwoSidedQuote,
  resolveCurrentPortfolioQuote,
  resolveHistoricalPortfolioQuote,
  unavailablePortfolioQuote,
  type PortfolioMarketQuote,
} from '@/lib/portfolio-market-quote';
import { withMarketFetch } from '@/lib/server/market-fetch';
import { getMarketData } from '@/lib/server/sjc';

const ROLLING_DAYS: Partial<Record<MarketHistoryCapability, number>> = {
  'rolling-7': 7,
  'rolling-30': 30,
};

function canUseExactPrices(buy: number | null, sell: number | null) {
  return isValidTwoSidedQuote(buy, sell);
}

export async function getPortfolioMarketQuote(
  companyId: string,
  productId: string,
  requestedDate: string,
  signal: AbortSignal,
): Promise<PortfolioMarketQuote> {
  const company = getMarketCompany(companyId);
  const product = getMarketProduct(company.id, productId);
  const today = vietnamDate();

  if (!isMarketProductSelectable(product)) {
    return unavailablePortfolioQuote(
      company.id,
      product.id,
      requestedDate,
      'Sản phẩm hiện chưa có báo giá hai chiều để tự điền.',
    );
  }
  if (requestedDate > today) {
    return unavailablePortfolioQuote(
      company.id,
      product.id,
      requestedDate,
      'Ngày giao dịch ở tương lai chưa có báo giá.',
    );
  }

  if (requestedDate === today) {
    try {
      const market = await withMarketFetch(signal, 7, () =>
        getMarketData(company.id, product.id, { view: 'quote' }),
      );
      const quote = resolveCurrentPortfolioQuote(
        {
          companyId: market.company.id,
          productId: market.product.id,
          availability: market.availability,
          mode: market.mode,
          latest: market.latest,
          observedAt: market.observedAt,
          timestampKind: market.timestampKind,
          sourcePublishedAt: market.sourcePublishedAt,
          generatedAt: market.generatedAt,
          source: market.source,
        },
        company.id,
        product.id,
        requestedDate,
        today,
      );
      return (
        quote ??
        unavailablePortfolioQuote(
          company.id,
          product.id,
          requestedDate,
          'Chưa có báo giá hiện tại còn hạn cho đúng sản phẩm này.',
        )
      );
    } catch {
      return unavailablePortfolioQuote(
        company.id,
        product.id,
        requestedDate,
        'Không tải được báo giá hiện tại. Bạn có thể nhập giá thủ công.',
      );
    }
  }

  const capability = getMarketHistoryCapability(company.id, product.id);
  if (capability === 'annual') {
    const { start } = getCalendarWindow(365, today);
    if (requestedDate < start) {
      return unavailablePortfolioQuote(
        company.id,
        product.id,
        requestedDate,
        'Ngày đã chọn nằm ngoài phạm vi lịch sử 365 ngày.',
      );
    }
    try {
      const db = getDatabase();
      const rows = await db
        .select()
        .from(marketHistoryPoints)
        .where(
          and(
            eq(marketHistoryPoints.companyId, company.id),
            eq(marketHistoryPoints.productId, product.id),
            eq(marketHistoryPoints.date, requestedDate),
            eq(marketHistoryPoints.status, 'ok'),
          ),
        )
        .orderBy(desc(marketHistoryPoints.retrievedAt));
      const preferred = rows
        .filter((row) =>
          canUseExactPrices(row.buyVndPerLuong, row.sellVndPerLuong),
        )
        .sort((left, right) => {
          const leftPublished = left.publishedAt?.getTime() ?? 0;
          const rightPublished = right.publishedAt?.getTime() ?? 0;
          return (
            rightPublished - leftPublished ||
            right.retrievedAt.getTime() - left.retrievedAt.getTime()
          );
        })[0];
      return resolveHistoricalPortfolioQuote({
        companyId: company.id,
        productId: product.id,
        requestedDate,
        record: preferred
          ? {
              date: preferred.date,
              buy: preferred.buyVndPerLuong,
              sell: preferred.sellVndPerLuong,
            }
          : null,
        source: preferred
          ? {
              provider: preferred.provider,
              url: preferred.sourceUrl,
              official: preferred.provider.toLowerCase().includes('official'),
            }
          : null,
        observedAt:
          preferred?.publishedAt?.toISOString() ??
          preferred?.retrievedAt.toISOString(),
        reason: 'Không có bản ghi lịch sử đã xác minh đúng ngày này.',
      });
    } catch {
      return unavailablePortfolioQuote(
        company.id,
        product.id,
        requestedDate,
        'Không đọc được lịch sử giá cho ngày đã chọn.',
      );
    }
  }

  const days = ROLLING_DAYS[capability];
  if (!days) {
    return unavailablePortfolioQuote(
      company.id,
      product.id,
      requestedDate,
      'Nguồn này không có lịch sử đã xác minh cho ngày đã chọn.',
    );
  }
  const start = shiftDate(today, -days);
  if (requestedDate < start) {
    return unavailablePortfolioQuote(
      company.id,
      product.id,
      requestedDate,
      `Ngày đã chọn nằm ngoài phạm vi lịch sử ${days} ngày của nguồn.`,
    );
  }

  try {
    const market = await withMarketFetch(signal, days, () =>
      getMarketData(company.id, product.id, {
        view: 'history',
        historyDays: days,
      }),
    );
    if (market.company.id !== company.id || market.product.id !== product.id) {
      return unavailablePortfolioQuote(
        company.id,
        product.id,
        requestedDate,
        'Nguồn trả về dữ liệu không khớp sản phẩm đã chọn.',
      );
    }
    const record = market.records.find((point) => point.date === requestedDate);
    return resolveHistoricalPortfolioQuote({
      companyId: company.id,
      productId: product.id,
      requestedDate,
      record: record
        ? {
            date: record.date,
            buy: Math.round(record.buy * 1_000_000),
            sell: Math.round(record.sell * 1_000_000),
          }
        : null,
      source: record
        ? {
            provider: market.historySource.provider,
            url: market.historySource.url,
            official: market.source.official,
          }
        : null,
      observedAt: record ? `${record.date}T12:00:00+07:00` : null,
      reason: 'Không có báo giá đã xác minh đúng ngày này.',
    });
  } catch {
    return unavailablePortfolioQuote(
      company.id,
      product.id,
      requestedDate,
      'Không tải được lịch sử giá cho ngày đã chọn.',
    );
  }
}
