export type MarketFreshness = {
  evaluatedAt: string;
  /** Age of the application's normalized record, not proof of a network fetch. */
  recordAgeSeconds: number | null;
  /** Only measured when the provider supplied a publication timestamp. */
  sourceAgeSeconds: number | null;
};

export type MarketTiming = {
  fetchedAt?: string;
  generatedAt?: string;
  observedAt?: string;
  sourcePublishedAt?: string;
  timestampKind?: 'source' | 'retrieval-or-date';
};

function ageSeconds(timestamp: string | undefined, now: number) {
  const time = timestamp ? Date.parse(timestamp) : Number.NaN;
  return Number.isFinite(time) && time <= now
    ? Math.floor((now - time) / 1_000)
    : null;
}

export function getMarketFreshness(
  market: MarketTiming,
  now = Date.now(),
): MarketFreshness {
  return {
    evaluatedAt: new Date(now).toISOString(),
    recordAgeSeconds: ageSeconds(market.fetchedAt ?? market.generatedAt, now),
    sourceAgeSeconds:
      market.timestampKind === 'source'
        ? ageSeconds(market.sourcePublishedAt ?? market.observedAt, now)
        : null,
  };
}

export function formatMarketAge(seconds: number, english: boolean) {
  if (seconds < 60) return english ? 'just now' : 'vừa xong';
  const [amount, unit] = seconds < 3_600
    ? [Math.floor(seconds / 60), 'minute'] as const
    : seconds < 86_400
      ? [Math.floor(seconds / 3_600), 'hour'] as const
      : [Math.floor(seconds / 86_400), 'day'] as const;
  return new Intl.RelativeTimeFormat(english ? 'en' : 'vi', {
    numeric: 'always',
  }).format(-amount, unit);
}
