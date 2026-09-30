import type { EditorialSource } from './types';

export type EditorialLane = 'domestic' | 'global' | 'explainer';

export type ScoutedItem = {
  lane: Exclude<EditorialLane, 'explainer'>;
  sourceName: string;
  sourceType: 'official' | 'research';
  title: string;
  url: string;
  publishedAt?: string;
  summary?: string;
  relevanceScore: number;
  eventFingerprint: string;
};

export type SourceEvidence = EditorialSource & {
  excerpt: string;
  sourceType: 'official' | 'research';
};

type SourceDefinition = {
  name: string;
  lane: Exclude<EditorialLane, 'explainer'>;
  sourceType: 'official' | 'research';
  feedUrl: string;
  allowedHosts: readonly string[];
  format: 'rss' | 'listing';
};

const sourceDefinitions: readonly SourceDefinition[] = [
  {
    name: 'Federal Reserve',
    lane: 'global',
    sourceType: 'official',
    feedUrl: 'https://www.federalreserve.gov/feeds/press_monetary.xml',
    allowedHosts: ['federalreserve.gov'],
    format: 'rss',
  },
  {
    name: 'BLS CPI',
    lane: 'global',
    sourceType: 'official',
    feedUrl: 'https://www.bls.gov/feed/cpi.rss',
    allowedHosts: ['bls.gov'],
    format: 'rss',
  },
  {
    name: 'BLS Employment Situation',
    lane: 'global',
    sourceType: 'official',
    feedUrl: 'https://www.bls.gov/feed/empsit.rss',
    allowedHosts: ['bls.gov'],
    format: 'rss',
  },
  {
    name: 'Ngân hàng Nhà nước Việt Nam',
    lane: 'domestic',
    sourceType: 'official',
    feedUrl: 'https://sbv.gov.vn/vi/thong-cao-bao-chi',
    allowedHosts: ['sbv.gov.vn'],
    format: 'listing',
  },
  {
    name: 'World Gold Council',
    lane: 'global',
    sourceType: 'research',
    feedUrl: 'https://www.gold.org/goldhub/research/library',
    allowedHosts: ['gold.org'],
    format: 'listing',
  },
];

const relevantTerms = [
  'gold',
  'vang',
  'vàng',
  'lãi suất',
  'lai suat',
  'interest rate',
  'fomc',
  'inflation',
  'cpi',
  'employment',
  'tỷ giá',
  'ty gia',
  'ngoại hối',
  'ngoai hoi',
  'dollar',
  'usd',
  'central bank',
  'ngân hàng',
  'ngan hang',
  'monetary',
  'etf',
  'bullion',
];

function decodeHtml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(Number(code)),
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function textTag(block: string, name: string) {
  const match = block.match(
    new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'),
  );
  return match ? decodeHtml(match[1]) : '';
}

function normalizeUrl(value: string, baseUrl: string) {
  try {
    const url = new URL(value.trim(), baseUrl);
    url.hash = '';
    const trackingParameters: string[] = [];
    url.searchParams.forEach((_, parameter) => {
      if (/^(utm_|fbclid$|gclid$)/i.test(parameter))
        trackingParameters.push(parameter);
    });
    for (const parameter of trackingParameters)
      url.searchParams.delete(parameter);
    return url.toString();
  } catch {
    return null;
  }
}

function hostAllowed(url: string, allowedHosts: readonly string[]) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return allowedHosts.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`),
    );
  } catch {
    return false;
  }
}

function dateValue(value: string | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function editorialEventFingerprint(value: string) {
  return decodeHtml(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180);
}

export function scoreEditorialRelevance(
  title: string,
  summary = '',
  sourceType: 'official' | 'research' = 'official',
) {
  const haystack = `${title} ${summary}`.toLocaleLowerCase('vi-VN');
  const matched = relevantTerms.filter((term) =>
    haystack.includes(term),
  ).length;
  return Math.min(100, (sourceType === 'official' ? 34 : 22) + matched * 11);
}

export function parseRssItems(
  xml: string,
  source: SourceDefinition,
): ScoutedItem[] {
  const blocks = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) ?? [];
  return blocks.flatMap((block) => {
    const title = textTag(block, 'title');
    const link =
      textTag(block, 'link') ||
      block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] ||
      '';
    const url = normalizeUrl(link, source.feedUrl);
    if (!title || !url || !hostAllowed(url, source.allowedHosts)) return [];
    const summary = textTag(block, 'description') || textTag(block, 'summary');
    return [
      {
        lane: source.lane,
        sourceName: source.name,
        sourceType: source.sourceType,
        title,
        url,
        publishedAt: dateValue(
          textTag(block, 'pubDate') ||
            textTag(block, 'published') ||
            textTag(block, 'updated'),
        ),
        summary: summary || undefined,
        relevanceScore: scoreEditorialRelevance(
          title,
          summary,
          source.sourceType,
        ),
        eventFingerprint: editorialEventFingerprint(title),
      },
    ];
  });
}

export function parseListingItems(
  html: string,
  source: SourceDefinition,
): ScoutedItem[] {
  const links = [
    ...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi),
  ];
  const seen = new Set<string>();
  return links.flatMap((match) => {
    const title = decodeHtml(match[2]);
    const url = normalizeUrl(match[1], source.feedUrl);
    if (
      !title ||
      title.length < 16 ||
      !url ||
      !hostAllowed(url, source.allowedHosts) ||
      seen.has(url)
    )
      return [];
    seen.add(url);
    return [
      {
        lane: source.lane,
        sourceName: source.name,
        sourceType: source.sourceType,
        title: title.slice(0, 280),
        url,
        relevanceScore: scoreEditorialRelevance(title, '', source.sourceType),
        eventFingerprint: editorialEventFingerprint(title),
      },
    ];
  });
}

async function fetchText(url: string, signal?: AbortSignal) {
  const response = await fetch(url, {
    headers: {
      Accept:
        'application/rss+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.1',
      'User-Agent':
        'KimTuyenEditorialBot/1.0 (+https://www.vanghomnay.online/bien-tap)',
    },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
      : AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Nguồn trả HTTP ${response.status}`);
  return response.text();
}

export async function scoutEditorialSources(signal?: AbortSignal) {
  const all = await Promise.allSettled(
    sourceDefinitions.map(async (source) => {
      const body = await fetchText(source.feedUrl, signal);
      return source.format === 'rss'
        ? parseRssItems(body, source)
        : parseListingItems(body, source);
    }),
  );
  const errors: Array<{ sourceName: string; message: string }> = [];
  const byUrl = new Map<string, ScoutedItem>();
  all.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      for (const item of result.value) {
        const existing = byUrl.get(item.url);
        if (!existing || item.relevanceScore > existing.relevanceScore)
          byUrl.set(item.url, item);
      }
    } else {
      errors.push({
        sourceName: sourceDefinitions[index]!.name,
        message:
          result.reason instanceof Error
            ? result.reason.message.slice(0, 240)
            : 'Không thể đọc nguồn.',
      });
    }
  });
  return {
    items: [...byUrl.values()]
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 36),
    errors,
  };
}

export async function fetchEditorialEvidence(
  item: ScoutedItem,
  signal?: AbortSignal,
): Promise<SourceEvidence> {
  const source = sourceDefinitions.find(
    (candidate) => candidate.name === item.sourceName,
  );
  if (!source || !hostAllowed(item.url, source.allowedHosts))
    throw new Error('Nguồn không thuộc danh sách biên tập được phép.');
  const body = await fetchText(item.url, signal);
  const excerpt = decodeHtml(body).slice(0, 12_000);
  if (excerpt.length < 120)
    throw new Error('Nguồn không có nội dung có thể kiểm chứng.');
  return {
    title: item.title,
    url: item.url,
    publishedAt: item.publishedAt,
    accessedAt: new Date().toISOString(),
    excerpt,
    sourceType: item.sourceType,
  };
}

export function selectDailyEditorialTopics(
  items: ScoutedItem[],
  market?: { buy: number; sell: number; observedAt: string } | null,
) {
  const domestic = items.find(
    (item) => item.lane === 'domestic' && item.relevanceScore >= 34,
  );
  const global = items.find(
    (item) => item.lane === 'global' && item.relevanceScore >= 34,
  );
  const marketContext = market
    ? `Giá vàng miếng SJC quan sát lúc ${market.observedAt}: mua vào ${market.buy.toFixed(2)} triệu đồng/lượng, bán ra ${market.sell.toFixed(2)} triệu đồng/lượng.`
    : 'Nguồn giá vàng SJC chưa có dữ liệu khả dụng tại thời điểm soạn; không đưa số giá hoặc gọi đây là giá hiện tại.';
  return [
    domestic
      ? {
          lane: 'domestic' as const,
          category: 'news' as const,
          topic: `${domestic.title}. Phân tích dữ kiện này có thể liên quan thế nào tới giá vàng trong nước, không suy diễn khi nguồn chưa đủ. ${marketContext}`,
          items: [domestic],
        }
      : {
          lane: 'domestic' as const,
          category: 'explain' as const,
          topic: `Giá vàng trong nước hôm nay: cách đọc biên mua – bán, thời điểm niêm yết và điều cần kiểm tra trước giao dịch. ${marketContext}`,
          items: [],
        },
    global
      ? {
          lane: 'global' as const,
          category: 'news' as const,
          topic: `${global.title}. Giải thích cơ chế có thể ảnh hưởng tới vàng thế giới và chênh lệch với giá vàng Việt Nam. ${marketContext}`,
          items: [global],
        }
      : {
          lane: 'global' as const,
          category: 'explain' as const,
          topic: `Mối liên hệ giữa lãi suất, USD và giá vàng: cách theo dõi mà không biến phân tích thành dự báo. ${marketContext}`,
          items: [],
        },
    {
      lane: 'explainer' as const,
      category: 'practice' as const,
      topic: `Hướng dẫn kiểm tra một tin có ảnh hưởng tới giá vàng Việt Nam: nguồn gốc, thời điểm, tỷ giá, lãi suất và biên mua – bán. ${marketContext}`,
      items: [],
    },
  ];
}
