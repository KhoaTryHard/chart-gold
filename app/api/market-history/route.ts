import { getAnnualMarketHistory } from '@/lib/server/market-history';
import {
  isMarketCompanyId,
  isMarketProductId,
} from '@/lib/market-sources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const range = params.get('range');
  if (range !== '1N') {
    return Response.json(
      { error: 'Chỉ hỗ trợ lịch sử 1 năm.' },
      { status: 400, headers: { 'X-Content-Type-Options': 'nosniff' } },
    );
  }
  const company = params.get('company') ?? 'sjc';
  const product = params.get('product') ?? 'bar-1l';
  if (!isMarketCompanyId(company) || !isMarketProductId(company, product)) {
    return Response.json(
      { error: 'Thương hiệu hoặc sản phẩm không hợp lệ.' },
      { status: 400, headers: { 'X-Content-Type-Options': 'nosniff' } },
    );
  }
  try {
    const history = await getAnnualMarketHistory(
      company,
      product,
    );
    const cacheControl =
      history.status === 'ready'
        ? 'public, max-age=60, s-maxage=300, stale-while-revalidate=60'
        : 'public, max-age=15, s-maxage=30, stale-while-revalidate=30';
    return Response.json(history, {
      headers: {
        'Cache-Control': cacheControl,
        'Vercel-CDN-Cache-Control':
          history.status === 'ready'
            ? 's-maxage=300, stale-while-revalidate=60'
            : 's-maxage=30, stale-while-revalidate=30',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
      },
    });
  } catch {
    return Response.json(
      {
        error:
          'Chưa thể đọc kho lịch sử giá. Giá hiện tại vẫn được hiển thị riêng.',
      },
      { status: 503, headers: { 'X-Content-Type-Options': 'nosniff' } },
    );
  }
}
