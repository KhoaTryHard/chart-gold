'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, LoaderCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLocale } from '@/components/locale-provider';
import {
  getComparisonCatalogProduct,
  getComparisonSet,
  presentComparisonCatalogProduct,
  presentComparisonSet,
} from '@/lib/comparison-catalog';
import { presentMarketCatalogText } from '@/lib/market-sources';
import { inputErrorMessage, parseQuantityInput } from '@/lib/input-parsing';

type ComparisonSet = string;
type ComparisonMode = 'same-group' | 'cross-group';
type Unit = 'luong' | 'chi' | 'gram';

type CompareRow = {
  id?: string;
  companyId?: string;
  productId?: string;
  brandId?: string;
  company: string;
  product: string;
  group?: string;
  productGroup?: string;
  category?: string;
  purity?: string | number | null;
  region?: string | null;
  regionId?: string | null;
  latest: { buy: number; sell: number; spread: number } | null;
  mode: 'live' | 'delayed' | 'fallback' | 'unavailable';
  availability: 'available' | 'unavailable';
  unavailableReason: string | null;
  observedAt: string;
  timestampKind?: 'source' | 'retrieval-or-date';
  publishedAt?: string | null;
  source: { provider: string; url: string | null; official: boolean };
  sourceIdentity?: string;
  comparable?: boolean;
  rankingEligible?: boolean;
  eligibleForRanking?: boolean;
};

export type CompareResponse = {
  set?: ComparisonSet;
  label: string;
  unit: string;
  comparisonMode?: ComparisonMode;
  mode?: ComparisonMode;
  rows: CompareRow[];
  generatedAt: string;
};

const EMPTY_ROWS: CompareRow[] = [];
const validComparisonSets = new Set(['sjc-bar', 'ring-9999', 'ring-9999-vs-sjc']);

const unitLabels: Record<Unit, string> = { luong: 'lượng', chi: 'chỉ', gram: 'gram' };

function convertToLuong(value: number, unit: Unit) {
  if (unit === 'chi') return value / 10;
  if (unit === 'gram') return value / 37.5;
  return value;
}

function formatVnd(value: number, english: boolean) {
  return `${Math.round(value).toLocaleString(english ? 'en-US' : 'vi-VN')} ${english ? 'VND' : 'đ'}`;
}

function compactDate(value?: string | null, locale: 'vi' | 'en' = 'vi') {
  if (!value) return locale === 'en' ? 'unknown' : 'chưa rõ';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return locale === 'en' ? 'unknown' : 'chưa rõ';
  const local = new Date(date.getTime() + 7 * 60 * 60 * 1_000);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())} ${pad(local.getUTCDate())}-${pad(local.getUTCMonth() + 1)}`;
}

function modeLabel(
  mode: CompareRow['mode'],
  locale: 'vi' | 'en',
) {
  return locale === 'en'
    ? { live: 'Live', delayed: 'Delayed', fallback: 'Fallback', unavailable: 'Unavailable' }[mode]
    : { live: 'Trực tiếp', delayed: 'Cập nhật chậm', fallback: 'Dự phòng', unavailable: 'Chưa có' }[mode];
}

function rowKey(row: CompareRow) {
  return row.id ?? `${row.companyId ?? row.company}-${row.productId ?? row.product}`;
}

function isRankingEligible(row: CompareRow) {
  return row.rankingEligible ?? row.eligibleForRanking ?? true;
}

export function ComparePanel({ initialSet = 'sjc-bar', initialPayload, readQueryParams = true, queryKey = '', initialShowAll = false, initialDirection = 'buy' }: { initialSet?: ComparisonSet; initialPayload?: CompareResponse; readQueryParams?: boolean; queryKey?: string; initialShowAll?: boolean; initialDirection?: 'buy' | 'sell' }) {
  const { locale } = useLocale();
  const english = locale === 'en';
  const localizedUnitLabels: Record<Unit, string> = english
    ? { luong: 'lượng (37.5g)', chi: 'chỉ (3.75g)', gram: 'gram' }
    : unitLabels;
  const [set, setSet] = useState<ComparisonSet>(initialSet);
  const [direction, setDirection] = useState<'buy' | 'sell'>(initialDirection);
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState<Unit>('luong');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sharedIds, setSharedIds] = useState<string[]>([]);
  const [brandFilter, setBrandFilter] = useState('all');
  const [regionFilter, setRegionFilter] = useState('all');
  const [showAll, setShowAll] = useState(initialShowAll);
  const initialPayloadRef = useRef(initialPayload);
  const [payload, setPayload] = useState<CompareResponse | null>(initialPayload ?? null);
  const [loading, setLoading] = useState(!initialPayload);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const [parsedQueryKey, setParsedQueryKey] = useState(() => (readQueryParams ? '' : queryKey));

  const persistDraftInput = (nextQuantity: string, nextUnit: Unit) => {
    try {
      window.localStorage.setItem(
        'kim-tuyen-last-comparison',
        JSON.stringify({ set, direction, quantity: nextQuantity, unit: nextUnit, ids: selectedIds }),
      );
    } catch {
      // Storage is optional; the comparison remains usable when it is blocked.
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      let savedDraft: { set?: string; quantity?: string; unit?: Unit } | null = null;
      try {
        const raw = window.localStorage.getItem('kim-tuyen-last-comparison');
        savedDraft = raw ? JSON.parse(raw) as { set?: string; quantity?: string; unit?: Unit } : null;
      } catch {
        savedDraft = null;
      }
      if (savedDraft?.set && validComparisonSets.has(savedDraft.set)) setSet(savedDraft.set as ComparisonSet);
      if (savedDraft?.set === set) {
        if (savedDraft.quantity) setQuantity(savedDraft.quantity);
        if (savedDraft.unit === 'luong' || savedDraft.unit === 'chi' || savedDraft.unit === 'gram') setUnit(savedDraft.unit);
      }
      if (!readQueryParams) {
        setParsedQueryKey(queryKey);
        return;
      }
      const params = new URLSearchParams(window.location.search);
      const sharedSet = params.get('set');
      if (sharedSet && validComparisonSets.has(sharedSet)) setSet(sharedSet);
      const sharedDirection = params.get('direction');
      if (sharedDirection === 'buy' || sharedDirection === 'sell') setDirection(sharedDirection);
      const sharedQuantity = params.get('quantity');
      if (sharedQuantity) setQuantity(sharedQuantity);
      const sharedUnit = params.get('unit');
      if (sharedUnit === 'luong' || sharedUnit === 'chi' || sharedUnit === 'gram') setUnit(sharedUnit);
      const ids = params.get('products')?.split(',').filter(Boolean).slice(0, 3) ?? [];
      if (ids.length) setSharedIds(ids);
      setParsedQueryKey(queryKey);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [queryKey, readQueryParams, set]);

  useEffect(() => {
    if (readQueryParams && parsedQueryKey !== queryKey) return;
    if (initialPayloadRef.current && set === initialSet) {
      initialPayloadRef.current = undefined;
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    void fetch(`/api/compare?${new URLSearchParams({ set, locale, direction })}`, {
      cache: 'default',
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as CompareResponse & { error?: string };
        if (!response.ok) throw new Error(body.error ?? 'Không tải được bảng so sánh.');
        if (!cancelled) { setPayload(body); setNotice(''); }
      })
      .catch((error) => {
        if (!cancelled && !controller.signal.aborted) setNotice(error instanceof Error ? error.message : 'Không tải được bảng so sánh.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    const refreshInterval = window.setInterval(() => {
      if (document.visibilityState === 'visible') setRefreshNonce((value) => value + 1);
    }, 4 * 60 * 1_000);
    const refreshOnVisible = () => {
      if (document.visibilityState === 'visible') setRefreshNonce((value) => value + 1);
    };
    document.addEventListener('visibilitychange', refreshOnVisible);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(refreshInterval);
      document.removeEventListener('visibilitychange', refreshOnVisible);
    };
  }, [direction, initialSet, locale, parsedQueryKey, queryKey, readQueryParams, refreshNonce, set]);

  useEffect(() => {
    if (!payload) return;
    const eligible = payload.rows.filter((row) => row.latest && isRankingEligible(row)).map(rowKey);
    let restored: string[] = [];
    try {
      const raw = window.localStorage.getItem('kim-tuyen-last-comparison');
      const saved = raw ? (JSON.parse(raw) as { set?: string; ids?: string[]; quantity?: string; unit?: Unit }) : null;
      if (saved?.set === set && Array.isArray(saved.ids)) restored = saved.ids.filter((id) => eligible.includes(id)).slice(0, 3);
      queueMicrotask(() => {
        if (saved?.set === set && typeof saved.quantity === 'string' && saved.quantity) setQuantity(saved.quantity);
        if (saved?.set === set && (saved.unit === 'luong' || saved.unit === 'chi' || saved.unit === 'gram')) setUnit(saved.unit);
      });
    } catch {
      // Storage can be blocked by privacy mode; the comparison remains usable.
    }
    const timer = window.setTimeout(() => {
      const fromUrl = sharedIds.filter((id) => eligible.includes(id));
      const fallback = eligible.slice(0, 3);
      if ((payload.comparisonMode ?? payload.mode) === 'cross-group' && eligible.length > 1) {
        const firstGroup = payload.rows.find((row) => row.latest && isRankingEligible(row))?.productGroup;
        const secondGroup = payload.rows.find((row) => row.latest && isRankingEligible(row) && row.productGroup !== firstGroup);
        if (secondGroup) fallback.splice(1, 0, rowKey(secondGroup));
      }
      setSelectedIds(fromUrl.length ? fromUrl : restored.length ? restored : [...new Set(fallback)].slice(0, 3));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [payload, set, sharedIds]);

  useEffect(() => {
    if (!payload || !selectedIds.length) return;
    try { window.localStorage.setItem('kim-tuyen-last-comparison', JSON.stringify({ set, direction, quantity, unit, ids: selectedIds })); } catch { /* Storage is optional. */ }
  }, [direction, payload, quantity, selectedIds, set, unit]);

  const quantityParsed = parseQuantityInput(quantity);
  const amount = quantityParsed.value ?? 0;
  const quantityError = quantity.trim()
    ? inputErrorMessage(quantityParsed.error, english)
    : '';
  const amountLuong = convertToLuong(amount, unit);
  const allRows = payload?.rows ?? EMPTY_ROWS;
  const displayedRows = useMemo(() => {
    const comparisonSet = getComparisonSet(set);
    return allRows.map((row) => {
      const product = row.companyId && row.productId
        ? getComparisonCatalogProduct(
            comparisonSet,
            row.id ?? `${row.companyId}:${row.productId}`,
          )
        : undefined;
      if (!product) return row;
      const presentation = presentComparisonCatalogProduct(product, locale);
      return {
        ...row,
        company: presentation.brandName,
        product: presentation.label,
        productGroup: presentation.productGroup,
        region: presentation.region,
        unavailableReason: row.unavailableReason
          ? presentMarketCatalogText(row.unavailableReason, locale)
          : null,
      };
    });
  }, [allRows, locale, set]);
  const displayRowsByKey = useMemo(
    () => new Map(displayedRows.map((row) => [rowKey(row), row])),
    [displayedRows],
  );
  const brands = useMemo(() => {
    const labels = new Map<string, string>();
    allRows.forEach((row) => {
      const id = row.brandId ?? row.companyId ?? row.company;
      const displayed = displayRowsByKey.get(rowKey(row));
      if (!labels.has(id)) labels.set(id, displayed?.company ?? row.company);
    });
    return [...labels].map(([id, label]) => ({ id, label }));
  }, [allRows, displayRowsByKey]);
  const regions = useMemo(
    () => [...new Set(allRows.map((row) => row.regionId ?? row.region).filter((region): region is string => Boolean(region)))],
    [allRows],
  );
  const filteredRows = useMemo(
    () => allRows
      .filter((row) => brandFilter === 'all' || (row.brandId ?? row.companyId ?? row.company) === brandFilter)
      .filter((row) => regionFilter === 'all' || (row.regionId ?? row.region) === regionFilter),
    [allRows, brandFilter, regionFilter],
  );
  const currentMode = payload?.comparisonMode ?? payload?.mode;
  const rows = useMemo(() => {
    const source = [...filteredRows];
    if (currentMode === 'cross-group') return source;
    return source.sort((left, right) => {
      if (!left.latest) return right.latest ? 1 : 0;
      if (!right.latest) return -1;
      const leftValue = left.latest[direction === 'buy' ? 'sell' : 'buy'];
      const rightValue = right.latest[direction === 'buy' ? 'sell' : 'buy'];
      return direction === 'buy' ? leftValue - rightValue : rightValue - leftValue;
    });
  }, [currentMode, direction, filteredRows]);
  const selectedRows = rows.filter((row) => selectedIds.includes(rowKey(row)));
  const visibleRows = showAll || selectedRows.length === 0 ? rows : selectedRows;
  const rankingRows = showAll ? rows : selectedRows;
  const eligible = rankingRows.filter((row) => row.latest && isRankingEligible(row));
  const ranked = [...eligible].sort((left, right) => {
    const leftValue = left.latest?.[direction === 'buy' ? 'sell' : 'buy'] ?? 0;
    const rightValue = right.latest?.[direction === 'buy' ? 'sell' : 'buy'] ?? 0;
    return direction === 'buy' ? leftValue - rightValue : rightValue - leftValue;
  });
  const isCrossGroup = currentMode === 'cross-group';
  const bestRow = isCrossGroup ? undefined : ranked[0];
  const best = bestRow?.latest;
  const comparisonDifference = isCrossGroup || ranked.length < 2 || quantityError ? null : Math.abs((ranked[ranked.length - 1].latest?.[direction === 'buy' ? 'sell' : 'buy'] ?? 0) - (ranked[0].latest?.[direction === 'buy' ? 'sell' : 'buy'] ?? 0)) * amountLuong;

  const toggleSelection = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length >= 3 ? current : [...current, id]);
  const copyLink = async () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('set', set); url.searchParams.set('direction', direction); url.searchParams.set('products', selectedIds.join(','));
      url.searchParams.set('quantity', quantity); url.searchParams.set('unit', unit);
      await navigator.clipboard.writeText(url.toString()); setCopied(true); window.setTimeout(() => setCopied(false), 1600);
    } catch { setNotice(english ? 'This device cannot copy the link.' : 'Không thể sao chép liên kết trên thiết bị này.'); }
  };
  const breakEvenHref = (() => { const params = new URLSearchParams({ tool: 'lai-lo', quantity: String(amount), unit, intent: 'purchase' }); if (best) { params.set('cost', String(Math.round(best.sell * 1_000_000))); params.set('buyback', String(Math.round(best.buy * 1_000_000))); } if (bestRow?.companyId && bestRow.productId) { params.set('company', bestRow.companyId); params.set('product', bestRow.productId); } return `/cong-cu-vang?${params.toString()}#hoa-von`; })();
  const changeSet = (next: ComparisonSet) => { if (next === set) return; setNotice(''); setBrandFilter('all'); setRegionFilter('all'); setSelectedIds([]); setPayload(null); setLoading(true); setSet(next); };

  return (
    <section className="glass-panel tool-panel p-5 sm:p-7" aria-busy={loading}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><h2 className="font-heading text-xl font-semibold">{payload ? presentComparisonSet(getComparisonSet(set), locale).label : (english ? 'Comparable sources' : 'Nguồn tương đương')}</h2><p className="mt-1 text-sm text-muted-foreground">{english ? 'Prices refresh automatically every 4 minutes.' : 'Giá tự cập nhật khoảng 4 phút một lần.'}</p></div>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label={english ? 'Product group' : 'Nhóm sản phẩm'}>
          <Button type="button" size="sm" variant={set === 'sjc-bar' ? 'default' : 'outline'} aria-pressed={set === 'sjc-bar'} className="min-h-11 rounded-full" onClick={() => changeSet('sjc-bar')}>{english ? 'SJC gold bars' : 'Vàng miếng SJC'}</Button>
          <Button type="button" size="sm" variant={set === 'ring-9999' ? 'default' : 'outline'} aria-pressed={set === 'ring-9999'} className="min-h-11 rounded-full" onClick={() => changeSet('ring-9999')}>{english ? '9999 gold rings' : 'Vàng nhẫn 9999'}</Button>
          <Button type="button" size="sm" variant={set === 'ring-9999-vs-sjc' ? 'default' : 'outline'} aria-pressed={set === 'ring-9999-vs-sjc'} className="min-h-11 rounded-full" onClick={() => changeSet('ring-9999-vs-sjc')}>{english ? 'Rings and bars' : 'Nhẫn và miếng'}</Button>
        </div>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label htmlFor="compare-direction" className="text-sm font-medium">{english ? 'What are you doing?' : 'Bạn đang muốn làm gì?'}<select id="compare-direction" value={direction} onChange={(event) => { setLoading(true); setDirection(event.target.value as 'buy' | 'sell'); }} className="mt-1.5 block h-11 w-full rounded-[14px] border border-input bg-[var(--surface-solid)] px-3 text-base"><option value="buy">{english ? 'Buy gold' : 'Mua vàng'}</option><option value="sell">{english ? 'Sell gold' : 'Bán vàng'}</option></select></label>
        <label htmlFor="compare-quantity" className="text-sm font-medium">{english ? 'How much?' : 'Bạn có bao nhiêu?'}<Input id="compare-quantity" value={quantity} onChange={(event) => { const value = event.target.value; setQuantity(value); persistDraftInput(value, unit); }} inputMode="decimal" placeholder={english ? 'For example: 2' : 'Ví dụ: 2'} className="mt-1.5 h-11 text-base" aria-describedby="compare-quantity-help" /><span id="compare-quantity-help" className="mt-1 block text-sm font-normal text-muted-foreground">{english ? 'Use a quantity, such as 2 chỉ.' : 'Nhập số lượng, ví dụ 2 chỉ.'}</span>{quantityError ? <span role="alert" className="mt-1 block text-sm font-normal text-red-700">{quantityError}</span> : null}</label>
        <label htmlFor="compare-unit" className="text-sm font-medium">{english ? 'Unit' : 'Đơn vị'}<select id="compare-unit" value={unit} onChange={(event) => { const value = event.target.value as Unit; setUnit(value); persistDraftInput(quantity, value); }} className="mt-1.5 block h-11 w-full rounded-[14px] border border-input bg-[var(--surface-solid)] px-3 text-base">{(Object.keys(localizedUnitLabels) as Unit[]).map((key) => <option key={key} value={key}>{localizedUnitLabels[key]}</option>)}</select></label>
        <div className="rounded-[14px] border border-border/70 bg-muted/50 p-3 text-sm text-muted-foreground"><p>{isCrossGroup ? (english ? 'Compare these groups side by side' : 'Đối chiếu hai nhóm cạnh nhau') : direction === 'buy' ? (english ? 'Lowest price you pay' : 'Nơi bạn cần trả ít nhất') : (english ? 'Highest price a dealer pays you' : 'Nơi trả bạn cao nhất')}</p>{quantityError ? <p role="alert" className="mt-1 text-red-700">{quantityError}</p> : best ? <p className="mt-1 font-semibold text-foreground">{english ? 'Estimated total' : 'Tổng ước tính'}: {Math.round((direction === 'buy' ? best.sell : best.buy) * amountLuong * 1_000_000).toLocaleString(english ? 'en-US' : 'vi-VN')} {english ? 'VND' : 'đ'}</p> : null}</div>
      </div>
      {(brands.length > 1 || regions.length > 1) ? <div className="mt-4 flex flex-wrap gap-2">{brands.length > 1 ? <label className="text-xs font-medium">{english ? 'Dealer' : 'Thương hiệu'}<select value={brandFilter} onChange={(event) => setBrandFilter(event.target.value)} className="ml-2 h-9 rounded-full border border-input bg-[var(--surface-solid)] px-3 text-xs"><option value="all">{english ? 'All' : 'Tất cả'}</option>{brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.label}</option>)}</select></label> : null}{regions.length > 1 ? <label className="text-xs font-medium">{english ? 'Region' : 'Khu vực'}<select value={regionFilter} onChange={(event) => setRegionFilter(event.target.value)} className="ml-2 h-9 rounded-full border border-input bg-[var(--surface-solid)] px-3 text-xs"><option value="all">{english ? 'All' : 'Tất cả'}</option>{regions.map((region) => <option key={region} value={region}>{presentMarketCatalogText(region, locale)}</option>)}</select></label> : null}</div> : null}
      {!loading && rows.length ? <div className="mt-5 rounded-[16px] border border-border/70 bg-card/45 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold">{english ? 'Select up to 3 products' : 'Chọn tối đa 3 sản phẩm'} ({selectedIds.length}/3)</p><div className="flex gap-2"><Button type="button" size="sm" variant="ghost" className="min-h-9 rounded-full text-xs" onClick={() => setShowAll((value) => !value)}>{showAll ? (english ? 'Selected only' : 'Chỉ hiện đã chọn') : (english ? 'Show all' : 'Hiện tất cả')}</Button><Button type="button" size="sm" variant="outline" className="min-h-9 rounded-full text-xs" onClick={copyLink}>{copied ? <Check className="mr-1 size-3.5" /> : <Copy className="mr-1 size-3.5" />}{copied ? (english ? 'Copied' : 'Đã sao chép') : (english ? 'Copy link' : 'Sao chép liên kết')}</Button></div></div><div className="mt-3 flex flex-wrap gap-2">{rows.map((row) => { const id = rowKey(row); const display = displayRowsByKey.get(id) ?? row; const checked = selectedIds.includes(id); return <button key={id} type="button" aria-pressed={checked} disabled={!row.latest || (!checked && selectedIds.length >= 3)} onClick={() => toggleSelection(id)} className={`min-h-10 rounded-full border px-3 text-xs font-semibold transition-colors ${checked ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background/50 text-muted-foreground'} disabled:cursor-not-allowed disabled:opacity-45`}>{display.company}{display.region ? ` · ${display.region}` : ''}{checked ? ' ✓' : ''}</button>; })}</div></div> : null}
      {loading ? <div className="mt-6 overflow-hidden rounded-xl border border-border" aria-label={english ? 'Loading prices from sources' : 'Đang lấy giá từ các nguồn'}><div className="space-y-3 p-4 sm:p-5"><div className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> {english ? 'Loading prices from sources…' : 'Đang lấy giá từ các nguồn…'}</div>{Array.from({ length: 4 }, (_, index) => <div key={index} className="grid grid-cols-4 gap-3"><span className="ui-skeleton h-4" /><span className="ui-skeleton h-4" /><span className="ui-skeleton h-4" /><span className="ui-skeleton h-4" /></div>)}</div></div> : null}
      {notice ? <p role="alert" className="mt-5 text-sm text-amber-800">{notice}</p> : null}
      {!loading && !notice ? <>
        {comparisonDifference !== null ? <div className="mt-5 flex flex-wrap items-center gap-3 rounded-[16px] border border-primary/20 bg-primary/5 p-4 text-sm"><span><strong>{english ? 'Price difference' : 'Chênh lệch thành tiền'}:</strong> {Math.round(comparisonDifference * 1_000_000).toLocaleString(english ? 'en-US' : 'vi-VN')}đ {english ? 'for' : 'cho'} {amount} {localizedUnitLabels[unit]}.</span><Link href={breakEvenHref} className="font-semibold text-primary underline-offset-4 hover:underline">{english ? 'Calculate profit, loss, and break-even' : 'Tính lãi/lỗ và hòa vốn'}</Link></div> : isCrossGroup ? <p className="mt-5 rounded-[16px] border border-border bg-muted/40 p-4 text-sm text-muted-foreground">{english ? 'The two groups are shown side by side. We do not rank a 9999 ring against an SJC gold bar as “cheapest” because they have different conditions and characteristics.' : 'Hai nhóm được trình bày cạnh nhau. Không xếp “rẻ nhất” giữa nhẫn 9999 và vàng miếng SJC vì điều kiện và bản chất sản phẩm khác nhau.'}</p> : null}
      <div className="compare-table-wrap mt-6 overflow-x-auto rounded-xl border border-border"><table className="compare-table w-full min-w-[900px] text-left text-sm"><thead className="bg-muted text-xs"><tr><th className="p-3">{english ? 'Source / product' : 'Nguồn / quy cách'}</th><th className="p-3">{english ? 'Shop buyback' : 'Cửa hàng mua lại'}</th><th className="p-3">{english ? 'Price you pay' : 'Giá bạn mua'}</th><th className="p-3">{english ? 'Buy–sell gap' : 'Chênh lệch mua – bán'}</th><th className="p-3">{english ? `Total for ${localizedUnitLabels[unit]}` : `Tổng tiền cho ${localizedUnitLabels[unit]}`}</th><th className="p-3">{english ? 'Data' : 'Dữ liệu'}</th></tr></thead><tbody>{visibleRows.map((row) => { const display = displayRowsByKey.get(rowKey(row)) ?? row; return <tr key={rowKey(row)} className="border-t border-border align-top"><td data-label={english ? 'Source / product' : 'Nguồn / quy cách'} className="p-3"><p className="font-semibold">{display.company}</p><p className="mt-1 max-w-[260px] text-xs text-muted-foreground">{display.product}</p>{row.purity !== null && row.purity !== undefined ? <p className="mt-1 text-[11px] text-muted-foreground">{row.purity}{display.region ? ` · ${display.region}` : ''}</p> : null}</td><td data-label={english ? 'Shop buyback' : 'Cửa hàng mua lại'} className="p-3">{row.latest ? formatVnd(row.latest.buy * 1_000_000, english) : '—'}</td><td data-label={english ? 'Price you pay' : 'Giá bạn mua'} className="p-3">{row.latest ? formatVnd(row.latest.sell * 1_000_000, english) : '—'}</td><td data-label={english ? 'Buy–sell gap' : 'Chênh lệch mua – bán'} className="p-3">{row.latest ? formatVnd(row.latest.spread * 1_000_000, english) : '—'}</td><td data-label={english ? `Total for ${localizedUnitLabels[unit]}` : `Tổng tiền cho ${localizedUnitLabels[unit]}`} className="p-3">{row.latest && !quantityError ? formatVnd((direction === 'buy' ? row.latest.sell : row.latest.buy) * amountLuong * 1_000_000, english) : '—'}</td><td data-label={english ? 'Data' : 'Dữ liệu'} className="p-3 text-sm text-muted-foreground"><p>{modeLabel(row.mode, locale)}</p><p>{row.timestampKind === 'source' ? (english ? 'Published' : 'Nguồn công bố') : (english ? 'Observed' : 'Quan sát')}: {compactDate(row.observedAt, locale)}</p>{display.unavailableReason ? <p className="mt-1 max-w-[180px]">{display.unavailableReason}</p> : null}</td></tr>; })}</tbody></table></div>
      </> : null}
      <p className="mt-4 text-sm leading-5 text-muted-foreground">{english ? `${eligible.length}/${rows.length} choices have two-sided pricing. Dealer buyback is what the shop pays you; dealer sell is what you pay the shop. Call to confirm before trading.` : `${eligible.length}/${rows.length} lựa chọn có đủ giá hai chiều. Giá mua lại là khoản cửa hàng trả bạn; giá bán là khoản bạn trả cửa hàng. Hãy gọi xác nhận trước giao dịch.`}</p>
    </section>
  );
}
