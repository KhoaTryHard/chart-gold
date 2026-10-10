import {
  isHistorySyncCompany,
  recentHistoryWindow,
  syncAnnualMarketHistory,
} from '@/lib/server/market-history';
import { logMarketEvent, marketFailureKind } from '@/lib/server/market-telemetry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function validDate(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json(
      { error: 'Không có quyền chạy đồng bộ lịch sử.' },
      { status: 401, headers: { 'X-Content-Type-Options': 'nosniff' } },
    );
  }
  const params = new URL(request.url).searchParams;
  const requestedCompany = params.get('company');
  const syncCompany =
    requestedCompany && isHistorySyncCompany(requestedCompany)
      ? requestedCompany
      : undefined;
  if (requestedCompany && !syncCompany) {
    return Response.json(
      { error: 'Thương hiệu chưa có chức năng đồng bộ lịch sử.' },
      { status: 400, headers: { 'X-Content-Type-Options': 'nosniff' } },
    );
  }
  const defaults = recentHistoryWindow();
  const start = params.get('start') ?? defaults.start;
  const end = params.get('end') ?? defaults.end;
  if (!validDate(start) || !validDate(end) || start > end) {
    return Response.json(
      { error: 'Khoảng ngày đồng bộ không hợp lệ.' },
      { status: 400, headers: { 'X-Content-Type-Options': 'nosniff' } },
    );
  }
  const startedAt = performance.now();
  try {
    const conversationsDeleted = process.env.DATABASE_URL
      ? await (await import('@/lib/server/ai-conversations')).purgeExpiredConversations()
      : 0;
    const summary = syncCompany
      ? await syncAnnualMarketHistory(start, end, syncCompany)
      : await syncAnnualMarketHistory(start, end);
    const outcomes = Object.values(summary).map((item) => ({
      companyId: item.companyId,
      status: item.status,
      okDays: item.okDays,
      missingDays: item.missingDays,
      errorDays: item.errorDays,
    }));
    logMarketEvent(
      outcomes.some((item) => item.status === 'partial' || item.status === 'failed') ? 'warn' : 'info',
      'market_history_sync',
      { outcome: 'completed', start, end, outcomes, durationMs: Math.round(performance.now() - startedAt) },
    );
    return Response.json({ start, end, summary, conversationsDeleted });
  } catch (error) {
    logMarketEvent('error', 'market_history_sync', {
      outcome: marketFailureKind(error),
      start, end,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return Response.json(
      { error: 'Đồng bộ lịch sử không hoàn tất.' },
      { status: 503, headers: { 'X-Content-Type-Options': 'nosniff' } },
    );
  }
}
