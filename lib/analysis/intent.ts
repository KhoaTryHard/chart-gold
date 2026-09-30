import {
  getMarketProductCategory,
  MARKET_COMPANIES,
  MARKET_PRODUCTS,
  type MarketProductCategory,
} from '@/lib/market-sources';
import { isForecastQuestion, resolveForecastTargetDate } from './forecast';

export function normalizeQuestion(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

function productSearchKey(value: string) {
  return normalizeQuestion(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export type AnalysisIntent = {
  kind: 'lookup' | 'comparison' | 'investment' | 'macro' | 'out-of-scope';
  needsResearch: boolean;
  depth: 'short' | 'standard' | 'deep';
  scope: 'selected' | 'companies' | 'market';
  companyIds: string[];
  productIds: string[];
  category: MarketProductCategory | null;
  side: 'buy' | 'sell';
  ranking: 'absolute' | 'percent';
  order: 'asc' | 'desc';
  daily: boolean;
  horizon: '1-4w' | '1-3m' | '6-12m';
  ambiguous: boolean;
  range?: '7N' | '1T' | '1N';
  forecast: boolean;
  targetDate: string | null;
};

export function resolveIntent(
  question: string,
  history: Array<{ role: string; content: string }> = [],
  now = new Date(),
): AnalysisIntent {
  const currentQuestion = normalizeQuestion(question);
  const forecast = isForecastQuestion(question);
  const targetDate = forecast ? resolveForecastTargetDate(question, now) : null;
  let q = currentQuestion;
  // "Nếu mua..." is commonly a standalone investment scenario. Only merge
  // short, clearly referential follow-ups with the previous user turn.
  if (
    /^(con |vay |the |so voi |loai do|san pham do|and |then |what about |how about |that )/.test(
      q,
    )
  ) {
    const prior = history.filter((message) => message.role === 'user').at(-1);
    if (prior) q = `${normalizeQuestion(prior.content)} ${q}`;
  }
  const findCompanies = (text: string) =>
    MARKET_COMPANIES.filter((company) => {
      const names = [company.id, company.shortName, company.name].map(
        normalizeQuestion,
      );
      return names.some((name) =>
        new RegExp(`(?:^|[^a-z])${name}(?=$|[^a-z])`).test(text),
      );
    }).map((company) => company.id);
  let companyIds = findCompanies(currentQuestion);
  if (!companyIds.length) companyIds = findCompanies(q);
  if (/bao tin minh chau|\bbtmc\b/.test(q))
    companyIds = companyIds.filter((id) => id !== 'baotin');
  if (/bao tin manh hai|\bbtmh\b/.test(q))
    companyIds = companyIds.filter((id) => id !== 'baotin');
  const matchedProducts = MARKET_PRODUCTS.flatMap((product) => {
    const aliases = [
      product.id,
      product.label,
      product.shortLabel,
      'officialMatch' in product &&
      product.officialMatch &&
      product.officialMatch.trim().includes(' ')
        ? product.officialMatch
        : null,
      ...('searchAliases' in product ? (product.searchAliases ?? []) : []),
    ]
      .filter((value): value is string => Boolean(value))
      .map(productSearchKey)
      .filter((alias) => alias.length >= 2)
      .sort((left, right) => right.length - left.length);
    const normalizedQuery = ` ${productSearchKey(q)} `;
    const alias = aliases.find((candidate) =>
      normalizedQuery.includes(` ${candidate} `),
    );
    return alias ? [{ product, alias }] : [];
  });
  const specificProducts = matchedProducts.filter(
    ({ product, alias }) =>
      !matchedProducts.some(
        (candidate) =>
          candidate.product.id !== product.id &&
          candidate.product.companyId === product.companyId &&
          candidate.alias.length > alias.length &&
          candidate.alias.startsWith(`${alias} `),
      ),
  );
  const productIds = specificProducts.map(({ product }) => product.id);
  const productCategories = new Set(
    specificProducts.map(({ product }) => getMarketProductCategory(product)),
  );
  const categoryText = q.replace(/nguyen nhan/g, '');
  const category =
    productCategories.size === 1
      ? [...productCategories][0]!
      : /\bnhan\b|\bring\b/.test(categoryText)
        ? 'ring'
        : /mieng|\bbar\b/.test(q)
          ? 'bar'
          : /dong vang|\bcoin\b/.test(q)
            ? 'coin'
            : /qua tang|\bgift\b/.test(q)
              ? 'gift'
              : /nguyen lieu|raw material/.test(q)
                ? 'raw-material'
                : /(?:vang|gold).*tich luy|tich luy.*(?:vang|gold)|accumulation|kim gia bao|tieu kim cat/.test(
                      q,
                    )
                  ? 'investment-gold'
                  : /nu trang|trang suc|jewell?ry/.test(q)
                    ? 'jewelry'
                    : null;
  const comparison =
    /so sanh|doi chieu|loai nao|dau la loai|lon nhat|manh nhat|cao nhat|thap nhat|xep hang|top\s*\d|thuong hieu nao|bien dong nhat|re nhat|dat nhat|\bcompare\b|\bversus\b|\bvs\b|which (?:one|brand|product)|highest|lowest|cheapest|most expensive|rank(?:ing)?|best price/.test(
      q,
    );
  const investment =
    /phan bo|phan bo von|giai ngan|mua ngay|cho them|nen mua|nen ban|tich luy|danh muc|hoa von|lai lo|lo bao nhieu|lai bao nhieu|mat bao nhieu|lo ngay|phi giao dich|gia von|thanh khoan|rui ro|kich ban|giu tien|von|chot loi|cat lo|\binvest(?:ment|ing)?\b|buy now|should i (?:buy|sell)|\bportfolio\b|break[ -]?even|profit|loss|\bpnl\b|cost basis|liquidity|risk|scenario|hold(?:ing)?|take profit|stop loss/.test(
      q,
    );
  const research =
    /tin tuc|tin moi|vi mo|fed|cpi|lam phat|lai suat|ty gia|usd|dxy|quoc te|the gioi|chinh sach|ngan hang trung uong|etf|dia chinh tri|tai sao|vi sao|nguyen nhan|trien vong|du bao|du doan|tuong lai|thang toi|nam toi|tuan toi|tuan sau|xu huong|\bnews\b|macro|inflation|interest rates?|exchange rate|international|world gold|policy|central bank|geopolit|why|reason|outlook|forecast|future|next (?:week|month|year)|\btrend\b/.test(
      q,
    );
  const marketComparison =
    comparison &&
    (!investment ||
      /loai|gia|thuong hieu|san pham|hom qua|pnj|sjc|doji|product|price|brand|yesterday/.test(
        q,
      ));
  const out =
    /viet code|lap trinh|cong thuc nau|bong da|thoi tiet|lam banh|\bcod(?:e|ing)\b|programming|football|weather|recipe|cooking/.test(
      q,
    ) && !/vang|dau tu|gold|invest/.test(q);
  const deep =
    /phan tich sau|chi tiet|kich ban|phan bo|danh muc|dai han|6.thang|12.thang|deep analysis|detailed|scenario|allocation|long term|6.month|12.month/.test(
      q,
    );
  return {
    kind: out
      ? 'out-of-scope'
      : research
        ? 'macro'
        : marketComparison
          ? 'comparison'
          : investment
            ? 'investment'
            : 'lookup',
    needsResearch: !out && research,
    depth: deep ? 'deep' : research || investment ? 'standard' : 'short',
    scope:
      productIds.length || companyIds.length
        ? 'companies'
        : marketComparison ||
            /toan thi truong|cac thuong hieu|cac loai vang|whole market|all brands?|all gold products?|gia vang hom nay|gold price|\bmarket\b/.test(
              q,
            )
          ? 'market'
          : category
            ? 'companies'
            : 'selected',
    companyIds,
    productIds,
    category,
    side:
      /ban ra|gia ban|sell price|dealer sell/.test(currentQuestion) &&
      !/mua vao|buy price|dealer buy/.test(currentQuestion)
        ? 'sell'
        : /mua vao|buy price|dealer buy/.test(currentQuestion)
          ? 'buy'
          : /ban ra|gia ban|sell price|dealer sell/.test(q) &&
              !/mua vao|buy price|dealer buy/.test(q)
            ? 'sell'
            : 'buy',
    ranking: /phan tram|ty le|%|percent(?:age)?|rate/.test(q)
      ? 'percent'
      : 'absolute',
    order: /thap nhat|re nhat|nho nhat|lowest|cheapest|smallest/.test(q)
      ? 'asc'
      : 'desc',
    daily:
      /hom qua|bien dong|thay doi|tang|giam|yesterday|movement|change|increas|decreas/.test(
        q,
      ),
    horizon:
      /6.thang|12.thang|dai han|nam toi|6.month|12.month|long term|next year/.test(
        q,
      )
        ? '6-12m'
        : /tuan|ngan han|week|short term/.test(q)
          ? '1-4w'
          : '1-3m',
    ambiguous:
      !out &&
      !research &&
      !comparison &&
      !investment &&
      !/vang|gia|spread|ma7|ma30|drawdown|mua|ban|chi|luong|gold|price|buy|sell|ounce|gram|luong/.test(
        q,
      ),
    range: forecast
      ? '1N'
      : /7 ngay|tuan qua|7 days?|last week/.test(q)
        ? '7N'
        : /30 ngay|thang qua|30 days?|last month/.test(q)
          ? '1T'
          : /365 ngay|nam qua|365 days?|last year/.test(q)
            ? '1N'
            : undefined,
    forecast,
    targetDate,
  };
}

export function outputBudget(intent?: AnalysisIntent) {
  return intent?.depth === 'deep'
    ? 8_000
    : intent?.depth === 'standard'
      ? 4_000
      : 2_000;
}

// Display-only assistant text (especially Google grounded results) is never
// reused as model input. Keep user intent, with explicit byte-independent bounds.
export function buildUserHistory(
  messages: Array<{ role: string; content: string }>,
) {
  let remaining = 12_000;
  return messages
    .filter((message) => message.role === 'user' && message.content.trim())
    .slice(-8)
    .reverse()
    .flatMap((message) => {
      const content = message.content.slice(0, Math.min(4_000, remaining));
      remaining -= content.length;
      return content ? [{ role: 'user' as const, content }] : [];
    })
    .reverse();
}
