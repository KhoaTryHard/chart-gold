'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Calculator,
  ChevronDown,
  CircleHelp,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLocale } from '@/components/locale-provider';
import {
  calculateAdditionalPurchase as calculateAdditional,
  calculateGoldOutcome as calculateOutcome,
  type GoldPurchase,
  type GoldUnit,
  type PurchasePriceMode,
} from '@/lib/gold-calculator';
import {
  MARKET_COMPANIES,
  getMarketCompany,
  getMarketProductCategory,
  getMarketProducts,
  isMarketProductSelectable,
  presentMarketCatalogText,
  presentMarketCompany,
  presentMarketProduct,
  type MarketProductCategory,
} from '@/lib/market-sources';
import {
  resolveMarketQuote,
  type QuoteResponseShape,
} from '@/lib/market-quote';
import {
  inputErrorMessage,
  parseMillionInput,
  parseQuantityInput,
  parseVndInput,
} from '@/lib/input-parsing';

export { convertGoldQuantity } from '@/lib/gold-calculator';

/** Backward-compatible helper for the existing calculator unit tests. */
export function calculateGoldOutcome({
  quantityLuongs,
  costPerLuong,
  buybackPerLuong,
  fees,
}: {
  quantityLuongs: number;
  costPerLuong: number;
  buybackPerLuong: number;
  fees: number;
}) {
  const result = calculateOutcome({
    purchases: [
      {
        quantity: quantityLuongs,
        unit: 'luong',
        priceMode: 'per-luong',
        unitPriceVnd: costPerLuong,
        feeVnd: fees,
      },
    ],
    sellPriceVndPerLuong: buybackPerLuong,
    sellFeeVnd: 0,
  });
  return {
    ...result,
    quantity: result.quantityLuong,
    grams: result.quantityLuong * 37.5,
    chi: result.quantityLuong * 10,
    invested: result.totalCostVnd || null,
    proceeds: result.netProceedsVnd,
    pnl: result.pnlVnd,
    breakeven: result.breakevenVndPerLuong,
  };
}

type ProductOption = {
  key: string;
  companyId: string;
  productId: string;
  label: string;
  group: string;
  category: MarketProductCategory;
  companyLabel: string;
  sourceUrl: string | null;
  selectable: boolean;
  unavailableReason: string | null;
};

const productOptions: ProductOption[] = Array.from(
  new Map(
    MARKET_COMPANIES.filter(
      (company) => company.adapter !== 'unavailable',
    ).flatMap((company) =>
      getMarketProducts(company.id).map((product) => {
        const companyName = presentMarketCompany(company, 'vi').name;
        const selectable = isMarketProductSelectable(product);
        const unavailableReason =
          'unavailableReason' in product
            ? (product.unavailableReason ?? null)
            : null;
        const option: ProductOption = {
          key: `${company.id}:${product.id}`,
          companyId: company.id,
          productId: product.id,
          label: presentMarketProduct(product, 'vi').label,
          group: `${companyName} · ${product.group}`,
          category: getMarketProductCategory(product),
          companyLabel: companyName,
          sourceUrl: company.sourceUrl,
          selectable,
          unavailableReason,
        };
        return [option.key, option] as const;
      }),
    ),
  ).values(),
);

type LinkedCalculatorDraft = {
  productKey: string;
  companyId: string;
  validProduct: boolean;
  quantity: string;
  unit: GoldUnit;
  cost: string;
  buyback: string;
};

function readLinkedCalculatorDraft(
  params: URLSearchParams,
): LinkedCalculatorDraft | null {
  const companyId = params.get('company') ?? '';
  const productId = params.get('product') ?? '';
  const productKey = companyId && productId ? `${companyId}:${productId}` : '';
  const hasValues = Boolean(
    productKey ||
    params.get('quantity') ||
    params.get('cost') ||
    params.get('buyback'),
  );
  if (!hasValues) return null;
  const linkedUnit = params.get('unit');
  return {
    productKey,
    companyId,
    validProduct:
      !productKey ||
      productOptions.some(
        (product) => product.key === productKey && product.selectable,
      ),
    quantity: params.get('quantity') ?? '',
    unit:
      linkedUnit === 'chi' || linkedUnit === 'gram' || linkedUnit === 'luong'
        ? linkedUnit
        : 'luong',
    cost: params.get('cost') ?? '',
    buyback: params.get('buyback') ?? '',
  };
}

const units: Array<{ value: GoldUnit; label: string }> = [
  { value: 'luong', label: 'lượng' },
  { value: 'chi', label: 'chỉ' },
  { value: 'gram', label: 'gram' },
];

const calculatorStorageKey = 'kim-tuyen-profit-calculator:v1';
const defaultProduct =
  productOptions.find(
    (product) => product.key === 'sjc:bar-1l' && product.selectable,
  ) ?? productOptions.find((product) => product.selectable);
const priceableVenues = MARKET_COMPANIES.filter(
  (company) => company.adapter !== 'unavailable',
);
const productOptionGroups = Array.from(
  productOptions.reduce((groups, product) => {
    const group = groups.get(product.group) ?? [];
    group.push(product);
    groups.set(product.group, group);
    return groups;
  }, new Map<string, ProductOption[]>()),
);

type PurchaseDraft = {
  id: string;
  quantity: string;
  unit: GoldUnit;
  priceMode: PurchasePriceMode;
  unitPrice: string;
  totalGold: string;
  moneyUnit: 'vnd' | 'million';
  fee: string;
  date: string;
};

let purchaseSequence = 1;

function createPurchase(id = `purchase-${purchaseSequence++}`): PurchaseDraft {
  return {
    id,
    quantity: '',
    unit: 'chi',
    priceMode: 'total',
    unitPrice: '',
    totalGold: '',
    moneyUnit: 'vnd',
    fee: '0',
    date: '',
  };
}

function parseDecimal(value: string) {
  return parseQuantityInput(value).value ?? 0;
}

function parseVnd(value: string) {
  return parseVndInput(value).value ?? 0;
}

function parsePurchaseMoney(
  value: string,
  moneyUnit: PurchaseDraft['moneyUnit'],
) {
  return (
    (moneyUnit === 'million'
      ? parseMillionInput(value, false)
      : parseVndInput(value, false)
    ).value ?? 0
  );
}

function toPurchase(draft: PurchaseDraft): GoldPurchase | null {
  const quantity = parseDecimal(draft.quantity);
  if (!quantity) return null;
  const purchase: GoldPurchase = {
    quantity,
    unit: draft.unit,
    priceMode: draft.priceMode,
    feeVnd: draft.priceMode === 'total' ? 0 : parseVnd(draft.fee),
    date: draft.date || undefined,
  };
  if (draft.priceMode === 'total') {
    purchase.totalGoldVnd = parsePurchaseMoney(
      draft.totalGold,
      draft.moneyUnit,
    );
    if (!purchase.totalGoldVnd) return null;
  } else {
    purchase.unitPriceVnd = parsePurchaseMoney(
      draft.unitPrice,
      draft.moneyUnit,
    );
    if (!purchase.unitPriceVnd) return null;
  }
  return purchase;
}

function hasPurchaseInput(draft: PurchaseDraft) {
  return Boolean(
    draft.quantity ||
    draft.unitPrice ||
    draft.totalGold ||
    (draft.fee && draft.fee !== '0') ||
    draft.date,
  );
}

function normalizeSavedPurchase(
  value: unknown,
  index: number,
): PurchaseDraft | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<PurchaseDraft>;
  if (typeof raw.quantity !== 'string' || typeof raw.unit !== 'string')
    return null;
  const unit =
    raw.unit === 'luong' || raw.unit === 'chi' || raw.unit === 'gram'
      ? raw.unit
      : 'chi';
  const priceMode = raw.priceMode === 'per-luong' ? 'per-luong' : 'total';
  return {
    id:
      typeof raw.id === 'string' && raw.id
        ? raw.id
        : 'purchase-restored-' + index,
    quantity: raw.quantity,
    unit,
    priceMode,
    unitPrice: typeof raw.unitPrice === 'string' ? raw.unitPrice : '',
    totalGold: typeof raw.totalGold === 'string' ? raw.totalGold : '',
    moneyUnit: raw.moneyUnit === 'million' ? 'million' : 'vnd',
    fee: typeof raw.fee === 'string' ? raw.fee : '0',
    date: typeof raw.date === 'string' ? raw.date : '',
  };
}

function formatVnd(value: number | null | undefined, english: boolean) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? english
      ? 'Not enough data'
      : 'Chưa đủ dữ liệu'
    : `${Math.round(value).toLocaleString(english ? 'en-US' : 'vi-VN')} ${english ? 'VND' : 'đ'}`;
}

function formatInputVnd(value: number, english: boolean) {
  return Math.round(value).toLocaleString(english ? 'en-US' : 'vi-VN');
}

function formatPercent(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function sourceDate(value: string | undefined, english: boolean) {
  if (!value) return english ? 'unknown' : 'chưa rõ';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return english ? 'unknown' : 'chưa rõ';
  const local = new Date(date.getTime() + 7 * 60 * 60 * 1_000);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())} ${pad(local.getUTCDate())}-${pad(local.getUTCMonth() + 1)}`;
}

type QuoteState = {
  priceVndPerLuong: number | null;
  status: 'loading' | 'live' | 'delayed' | 'fallback' | 'unavailable';
  provider: string;
  observedAt: string | null;
  url: string | null;
  reason: string | null;
  canAutofill: boolean;
  timestampKind?: 'source' | 'retrieval-or-date';
};

const emptyQuote: QuoteState = {
  priceVndPerLuong: null,
  status: 'loading',
  provider: '',
  observedAt: null,
  url: null,
  reason: null,
  canAutofill: false,
};

export function ConverterPanel({
  readQueryParams = true,
  sectionId = 'hoa-von',
  queryKey = '',
}: { readQueryParams?: boolean; sectionId?: string; queryKey?: string } = {}) {
  const { locale } = useLocale();
  const english = locale === 'en';
  const localizedUnits = english
    ? units.map((item) => ({
        ...item,
        label:
          item.value === 'luong'
            ? 'lượng (37.5g)'
            : item.value === 'chi'
              ? 'chỉ (3.75g)'
              : 'gram',
      }))
    : units;
  const [productKey, setProductKey] = useState(defaultProduct?.key ?? '');
  const [buyVenueId, setBuyVenueId] = useState(
    defaultProduct?.companyId ?? 'sjc',
  );
  const [sellVenueId, setSellVenueId] = useState(
    defaultProduct?.companyId ?? 'sjc',
  );
  const [otherVenueId, setOtherVenueId] = useState('pnj');
  const [purchases, setPurchases] = useState<PurchaseDraft[]>([
    createPurchase('purchase-1'),
  ]);
  const [sellPriceOverride, setSellPriceOverride] = useState('');
  const [sellPriceMode, setSellPriceMode] = useState<
    'auto' | 'manual' | 'reference'
  >('auto');
  const [sellFee, setSellFee] = useState('0');
  const [otherSellPrice, setOtherSellPrice] = useState('');
  const [otherSellFee, setOtherSellFee] = useState('0');
  const [quote, setQuote] = useState<QuoteState>(emptyQuote);
  const [quoteRefreshNonce, setQuoteRefreshNonce] = useState(0);
  const manualPriceRef = useRef(false);
  const quoteRequestKeyRef = useRef('');
  const [scenarioCustom, setScenarioCustom] = useState('');
  const [additional, setAdditional] = useState({
    quantity: '',
    unit: 'chi' as GoldUnit,
    price: '',
    fee: '0',
  });
  const [notice, setNotice] = useState('');
  const [saved, setSaved] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pendingLinkedDraft, setPendingLinkedDraft] =
    useState<LinkedCalculatorDraft | null>(null);
  const handledQueryKeyRef = useRef('');

  const selectedProduct =
    productOptions.find((product) => product.key === productKey) ??
    defaultProduct;
  const otherVenues = useMemo(() => {
    const preferred = buyVenueId === 'pnj' ? 'sjc' : 'pnj';
    return [
      ...new Set([preferred, ...priceableVenues.map((company) => company.id)]),
    ].filter((id) => id !== buyVenueId);
  }, [buyVenueId]);
  const venueLabel = (companyId: string) =>
    presentMarketCompany(getMarketCompany(companyId), locale).shortName;
  const buyVenueLabel = venueLabel(buyVenueId);
  const sellVenueLabel =
    sellVenueId === buyVenueId ? buyVenueLabel : venueLabel(sellVenueId);

  const applyLinkedDraft = useCallback(
    (draft: LinkedCalculatorDraft) => {
      setPendingLinkedDraft(null);
      if (!draft.validProduct) {
        setNotice(
          english
            ? 'This product is unavailable for this calculation. Choose an available product to continue.'
            : 'Sản phẩm trong liên kết không có báo giá khả dụng. Hãy chọn sản phẩm khác để tiếp tục.',
        );
        return;
      }
      if (draft.productKey) {
        setProductKey(draft.productKey);
        setBuyVenueId(draft.companyId);
        setSellVenueId(draft.companyId);
      }
      if (draft.quantity || draft.cost) {
        setPurchases([
          {
            ...createPurchase('purchase-1'),
            quantity: draft.quantity || '1',
            unit: draft.unit,
            priceMode: 'per-luong',
            unitPrice: draft.cost,
          },
        ]);
      }
      if (draft.buyback) {
        manualPriceRef.current = true;
        setSellPriceOverride(draft.buyback);
        setSellPriceMode('manual');
      }
    },
    [
      english,
      setBuyVenueId,
      setNotice,
      setPendingLinkedDraft,
      setProductKey,
      setPurchases,
      setSellPriceMode,
      setSellPriceOverride,
      setSellVenueId,
    ],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!readQueryParams) return;
      const effectKey = `${readQueryParams}:${queryKey}`;
      if (handledQueryKeyRef.current === effectKey) return;
      handledQueryKeyRef.current = effectKey;
      const params = new URLSearchParams(window.location.search);
      const linkedDraft = readLinkedCalculatorDraft(params);
      const hasUserData =
        purchases.some(hasPurchaseInput) ||
        manualPriceRef.current ||
        sellFee !== '0' ||
        Boolean(otherSellPrice || otherSellFee !== '0');
      if (linkedDraft && hasUserData) setPendingLinkedDraft(linkedDraft);
      else if (linkedDraft) applyLinkedDraft(linkedDraft);
      try {
        setSaved(Boolean(window.localStorage.getItem(calculatorStorageKey)));
      } catch {
        setSaved(false);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    applyLinkedDraft,
    otherSellFee,
    otherSellPrice,
    purchases,
    queryKey,
    readQueryParams,
    sellFee,
  ]);

  useEffect(() => {
    if (!selectedProduct) return;
    const requestKey = `${selectedProduct.companyId}:${selectedProduct.productId}:${sellVenueId}`;
    quoteRequestKeyRef.current = requestKey;
    const controller = new AbortController();
    const resetTimer = window.setTimeout(
      () => setQuote({ ...emptyQuote, status: 'loading' }),
      0,
    );
    const sellerKey = sellVenueId;
    if (sellerKey !== selectedProduct.companyId) {
      const unavailableTimer = window.setTimeout(
        () =>
          setQuote({
            ...emptyQuote,
            status: 'unavailable',
            reason: english
              ? 'A matching automatic quote is unavailable from this dealer. Enter the actual price.'
              : 'Nơi bán khác chưa có báo giá tự động cho đúng sản phẩm.',
          }),
        0,
      );
      return () => {
        controller.abort();
        window.clearTimeout(resetTimer);
        window.clearTimeout(unavailableTimer);
      };
    }
    void fetch(
      `/api/sjc?company=${encodeURIComponent(selectedProduct.companyId)}&product=${encodeURIComponent(selectedProduct.productId)}&view=quote`,
      { cache: 'default', signal: controller.signal },
    )
      .then(async (response) => {
        const body = (await response.json()) as QuoteResponseShape;
        if (!response.ok)
          throw new Error(
            english
              ? 'Unable to load the dealer buyback price.'
              : 'Không lấy được giá mua lại.',
          );
        const resolved = resolveMarketQuote(
          body,
          selectedProduct.companyId,
          selectedProduct.productId,
        );
        if (quoteRequestKeyRef.current !== requestKey) return;
        setQuote({
          ...resolved,
          url: resolved.url ?? selectedProduct.sourceUrl,
        });
        if (resolved.canAutofill && !manualPriceRef.current) {
          setSellPriceMode('auto');
          setSellPriceOverride(
            formatInputVnd(resolved.priceVndPerLuong ?? 0, english),
          );
        }
      })
      .catch(() => {
        if (quoteRequestKeyRef.current === requestKey)
          setQuote({
            ...emptyQuote,
            status: 'unavailable',
            reason: english
              ? 'A matching dealer buyback price is unavailable.'
              : 'Không lấy được giá thu mua phù hợp.',
          });
      });
    const refreshInterval = window.setInterval(
      () => setQuoteRefreshNonce((value) => value + 1),
      4 * 60 * 1_000,
    );
    const refreshOnVisible = () => {
      if (document.visibilityState === 'visible')
        setQuoteRefreshNonce((value) => value + 1);
    };
    document.addEventListener('visibilitychange', refreshOnVisible);
    return () => {
      controller.abort();
      window.clearTimeout(resetTimer);
      window.clearInterval(refreshInterval);
      document.removeEventListener('visibilitychange', refreshOnVisible);
    };
  }, [english, quoteRefreshNonce, selectedProduct, sellVenueId]);

  const purchaseErrors = useMemo(
    () =>
      purchases.map((purchase) => {
        const errors: { quantity?: string; price?: string; fee?: string } = {};
        const quantity = parseQuantityInput(purchase.quantity);
        if (purchase.quantity && quantity.error)
          errors.quantity = inputErrorMessage(quantity.error, english);
        const priceValue =
          purchase.priceMode === 'total'
            ? purchase.totalGold
            : purchase.unitPrice;
        const price =
          purchase.moneyUnit === 'million'
            ? parseMillionInput(priceValue, false)
            : parseVndInput(priceValue, false);
        if (priceValue && price.error)
          errors.price = inputErrorMessage(price.error, english);
        if (
          purchase.priceMode === 'per-luong' &&
          purchase.fee &&
          purchase.fee !== '0'
        ) {
          const fee = parseVndInput(purchase.fee);
          if (fee.error) errors.fee = inputErrorMessage(fee.error, english);
        }
        return errors;
      }),
    [english, purchases],
  );
  const parsedPurchases = useMemo(
    () =>
      purchases
        .map(toPurchase)
        .filter((purchase): purchase is GoldPurchase => Boolean(purchase)),
    [purchases],
  );
  const incompletePurchases = purchases.filter(
    (purchase) => hasPurchaseInput(purchase) && !toPurchase(purchase),
  ).length;
  const canCalculate =
    parsedPurchases.length > 0 &&
    purchases.every((purchase) => Boolean(toPurchase(purchase))) &&
    incompletePurchases === 0;
  const primaryPrice =
    sellPriceMode === 'auto'
      ? sellVenueId === selectedProduct?.companyId && quote.canAutofill
        ? quote.priceVndPerLuong
        : null
      : parseVnd(sellPriceOverride) || null;
  const sellPriceError = sellPriceOverride
    ? inputErrorMessage(parseVndInput(sellPriceOverride, false).error, english)
    : '';
  const sellFeeVnd = parseVnd(sellFee);
  const otherPriceVnd = parseVnd(otherSellPrice);
  const baseInput = {
    purchases: parsedPurchases,
    sellPriceVndPerLuong: primaryPrice,
    sellFeeVnd,
  };
  const result = calculateOutcome(baseInput);
  const otherResult = useMemo(
    () =>
      canCalculate && otherPriceVnd
        ? calculateOutcome({
            purchases: parsedPurchases,
            sellPriceVndPerLuong: otherPriceVnd,
            sellFeeVnd: parseVnd(otherSellFee),
          })
        : null,
    [canCalculate, otherPriceVnd, otherSellFee, parsedPurchases],
  );
  const scenarioPrices = [-5, -2, 0, 2, 5].map((percent) => ({
    percent,
    result:
      canCalculate && primaryPrice
        ? calculateOutcome({
            ...baseInput,
            sellPriceVndPerLuong: primaryPrice * (1 + percent / 100),
          })
        : null,
  }));
  const customScenarioPrice = parseVnd(scenarioCustom);
  const additionalPurchase =
    parseDecimal(additional.quantity) && parseVnd(additional.price)
      ? {
          quantity: parseDecimal(additional.quantity),
          unit: additional.unit,
          priceMode: 'per-luong' as const,
          unitPriceVnd: parseVnd(additional.price),
          feeVnd: parseVnd(additional.fee),
        }
      : null;
  const afterAdditional =
    canCalculate && additionalPurchase
      ? calculateAdditional(baseInput, additionalPurchase)
      : null;

  const updatePurchase = (
    id: string,
    field: keyof PurchaseDraft,
    value: string,
  ) =>
    setPurchases((current) =>
      current.map((purchase) =>
        purchase.id === id ? { ...purchase, [field]: value } : purchase,
      ),
    );
  const selectProduct = (value: string) => {
    const next = productOptions.find((product) => product.key === value);
    if (!next?.selectable) return;
    manualPriceRef.current = false;
    setProductKey(value);
    setBuyVenueId(next.companyId);
    setSellVenueId(next.companyId);
    setSellPriceOverride('');
    setSellPriceMode('auto');
    setQuote(emptyQuote);
  };
  const updateManualSellPrice = (value: string) => {
    manualPriceRef.current = true;
    setSellPriceMode('manual');
    setSellPriceOverride(value);
  };
  const useLatestQuote = () => {
    manualPriceRef.current = false;
    setSellPriceMode('auto');
    setSellPriceOverride(
      quote.priceVndPerLuong
        ? formatInputVnd(quote.priceVndPerLuong, english)
        : '',
    );
  };
  const useReferenceQuote = () => {
    manualPriceRef.current = true;
    setSellPriceMode('reference');
    setSellPriceOverride(
      quote.priceVndPerLuong
        ? formatInputVnd(quote.priceVndPerLuong, english)
        : '',
    );
  };
  const saveDraft = () => {
    try {
      window.localStorage.setItem(
        calculatorStorageKey,
        JSON.stringify({
          version: 1,
          productKey,
          buyVenueId,
          sellVenueId,
          otherVenueId,
          purchases,
          sellPriceOverride,
          sellPriceMode,
          sellFee,
          otherSellPrice,
          otherSellFee,
        }),
      );
      setSaved(true);
      setNotice(
        english
          ? 'Calculation saved on this device.'
          : 'Đã lưu bản tính trên thiết bị.',
      );
    } catch {
      setNotice(
        english
          ? 'This device does not allow the calculation to be saved.'
          : 'Thiết bị không cho phép lưu bản tính.',
      );
    }
  };
  const restoreDraft = () => {
    try {
      const raw = window.localStorage.getItem(calculatorStorageKey);
      if (!raw) return;
      const draft = JSON.parse(raw) as Partial<{
        productKey: string;
        buyVenueId: string;
        sellVenueId: string;
        otherVenueId: string;
        purchases: unknown[];
        sellPriceOverride: string;
        sellPriceMode: 'auto' | 'manual' | 'reference';
        sellFee: string;
        otherSellPrice: string;
        otherSellFee: string;
      }>;
      const savedProduct = productOptions.find(
        (product) => product.key === draft.productKey,
      );
      if (draft.productKey && !savedProduct?.selectable) {
        setNotice(
          english
            ? 'This saved product is unavailable. The current calculation was kept.'
            : 'Sản phẩm trong bản tính đã lưu chưa có báo giá. Bản tính hiện tại được giữ nguyên.',
        );
        return;
      }
      manualPriceRef.current = draft.sellPriceMode !== 'auto';
      if (savedProduct) {
        setProductKey(savedProduct.key);
        setBuyVenueId(savedProduct.companyId);
        setSellVenueId(savedProduct.companyId);
      }
      if (
        draft.otherVenueId &&
        priceableVenues.some((company) => company.id === draft.otherVenueId)
      )
        setOtherVenueId(draft.otherVenueId);
      const restored = Array.isArray(draft.purchases)
        ? draft.purchases
            .map(normalizeSavedPurchase)
            .filter((purchase): purchase is PurchaseDraft => Boolean(purchase))
        : [];
      if (restored.length) setPurchases(restored);
      if (
        draft.sellPriceOverride !== undefined &&
        typeof draft.sellPriceOverride === 'string'
      )
        setSellPriceOverride(draft.sellPriceOverride);
      if (
        draft.sellPriceMode === 'auto' ||
        draft.sellPriceMode === 'manual' ||
        draft.sellPriceMode === 'reference'
      )
        setSellPriceMode(draft.sellPriceMode);
      if (typeof draft.sellFee === 'string') setSellFee(draft.sellFee);
      if (typeof draft.otherSellPrice === 'string')
        setOtherSellPrice(draft.otherSellPrice);
      if (typeof draft.otherSellFee === 'string')
        setOtherSellFee(draft.otherSellFee);
      setNotice(
        english ? 'Saved calculation restored.' : 'Đã khôi phục bản tính.',
      );
    } catch {
      setNotice(
        english
          ? 'Unable to restore the saved calculation.'
          : 'Không thể đọc bản tính đã lưu.',
      );
    }
  };
  const clearDraft = () => {
    try {
      window.localStorage.removeItem(calculatorStorageKey);
      setSaved(false);
      setNotice(
        english ? 'Saved calculation deleted.' : 'Đã xóa bản tính đã lưu.',
      );
    } catch {
      setNotice(
        english
          ? 'Unable to delete the saved calculation.'
          : 'Không thể xóa bản tính.',
      );
    }
  };
  const clearEnteredValues = () => {
    setPurchases([createPurchase()]);
    setSellPriceOverride('');
    setSellPriceMode('auto');
    setSellFee('0');
    setOtherSellPrice('');
    setOtherSellFee('0');
    setScenarioCustom('');
    setAdditional({ quantity: '', unit: 'chi', price: '', fee: '0' });
    setShowAdvanced(false);
    manualPriceRef.current = false;
    setNotice(
      english ? 'Entered values cleared.' : 'Đã xóa toàn bộ dữ liệu đang nhập.',
    );
  };

  const quoteStatusMessage =
    quote.status === 'loading'
      ? english
        ? 'Loading a reference price…'
        : 'Đang lấy giá tham khảo…'
      : quote.priceVndPerLuong &&
          sellVenueId === selectedProduct?.companyId &&
          sellPriceMode === 'auto'
        ? `${english ? (quote.status === 'live' ? 'Live quote' : 'Reference quote') : quote.status === 'live' ? 'Giá trực tiếp' : 'Giá tham khảo'}: ${formatVnd(quote.priceVndPerLuong, english)} / lượng`
        : sellVenueId !== selectedProduct?.companyId
          ? english
            ? 'This dealer has no automatic quote for this product. Enter the actual price.'
            : 'Nơi này chưa có báo giá tự động cho đúng sản phẩm; cần nhập giá thực tế.'
          : sellPriceMode === 'manual'
            ? english
              ? 'Manually entered price'
              : 'Giá bạn nhập'
            : sellPriceMode === 'reference'
              ? english
                ? 'Selected reference price'
                : 'Giá tham khảo bạn chọn'
              : english
                ? 'Enter a price or wait for a quote.'
                : 'Giá do bạn nhập hoặc chưa có dữ liệu';
  const quoteReasonMessage = quote.reason
    ? english
      ? 'A matching dealer buyback price is unavailable. Check with the dealer before trading.'
      : quote.reason
    : null;

  return (
    <section className="glass-panel tool-panel p-5 sm:p-7" id={sectionId}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
            <Calculator className="size-5" />
          </span>
          <div>
            <h2 className="font-heading text-xl font-semibold">
              {english
                ? 'Gold profit, loss, and break-even'
                : 'Tính lãi/lỗ vàng và giá hòa vốn'}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {english
                ? 'By default, sell back to the dealer where you bought. Enter your actual purchase price; market prices are reference only.'
                : 'Mặc định mua đâu, bán lại tại hệ thống đó. Nhập giá mua thật của bạn; giá thị trường chỉ dùng để tham khảo.'}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-10 rounded-full"
            onClick={saveDraft}
          >
            <Save className="mr-1.5 size-4" />
            {english ? 'Save calculation' : 'Lưu bản tính'}
          </Button>
          {saved ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="min-h-10 rounded-full"
              onClick={restoreDraft}
            >
              <RotateCcw className="mr-1.5 size-4" />
              {english ? 'Restore' : 'Khôi phục'}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <label htmlFor="calculator-product" className="text-xs font-medium">
          {english ? 'Product held' : 'Sản phẩm đang giữ'}
          <select
            id="calculator-product"
            value={productKey}
            onChange={(event) => selectProduct(event.target.value)}
            className="mt-1.5 block h-11 w-full rounded-[14px] border border-input bg-[var(--surface-solid)] px-3 text-sm"
          >
            {productOptionGroups.map(([group, products]) => (
              <optgroup
                key={group}
                label={presentMarketCatalogText(group, english ? 'en' : 'vi')}
              >
                {products.map((product) => (
                  <option
                    key={product.key}
                    value={product.key}
                    disabled={!product.selectable}
                    title={product.unavailableReason ?? undefined}
                  >
                    {presentMarketCatalogText(
                      product.label,
                      english ? 'en' : 'vi',
                    )}
                    {!product.selectable
                      ? english
                        ? ' · unavailable'
                        : ' · chưa đủ báo giá'
                      : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label htmlFor="calculator-buy-venue" className="text-xs font-medium">
          {english ? 'Purchased from' : 'Nơi đã mua'}
          <select
            id="calculator-buy-venue"
            value={buyVenueId}
            onChange={(event) => {
              manualPriceRef.current = false;
              setBuyVenueId(event.target.value);
              setSellVenueId(event.target.value);
              setSellPriceOverride('');
              setSellPriceMode('auto');
            }}
            className="mt-1.5 block h-11 w-full rounded-[14px] border border-input bg-[var(--surface-solid)] px-3 text-sm"
          >
            {priceableVenues.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {presentMarketCompany(venue, english ? 'en' : 'vi').name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-6 rounded-[18px] border border-border/70 bg-card/40 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
              {english ? 'Step 2 of 3' : 'Bước 2/3'}
            </p>
            <h3 className="font-heading text-base font-semibold">
              {english ? 'What did you pay?' : 'Bạn đã trả bao nhiêu tiền?'}
            </h3>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              {english
                ? 'Use the total amount on your receipt, including purchase fees.'
                : 'Nhập tổng tiền trên hóa đơn, đã gồm phí mua. Bạn có thể thêm lần mua sau.'}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-11 rounded-full"
            disabled={purchases.length >= 20}
            onClick={() =>
              setPurchases((current) => [...current, createPurchase()])
            }
          >
            <Plus className="mr-1.5 size-4" />
            {english ? 'Add another purchase' : 'Thêm lần mua'}
          </Button>
        </div>
        <div className="mt-4 space-y-4">
          {purchases.map((purchase, index) => (
            <div
              key={purchase.id}
              className="rounded-[16px] border border-border/70 bg-background/35 p-3"
            >
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold">
                  {english ? 'Purchase' : 'Lần mua'} {index + 1}
                </p>
                {purchases.length > 1 ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-9 rounded-full"
                    aria-label={
                      english
                        ? `Remove purchase ${index + 1}`
                        : `Xóa lần mua ${index + 1}`
                    }
                    onClick={() =>
                      setPurchases((current) =>
                        current.filter((item) => item.id !== purchase.id),
                      )
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                ) : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <label
                  htmlFor={`${purchase.id}-quantity`}
                  className="text-sm font-medium"
                >
                  {english ? 'Quantity' : 'Khối lượng'}
                  <Input
                    id={`${purchase.id}-quantity`}
                    value={purchase.quantity}
                    onChange={(event) =>
                      updatePurchase(
                        purchase.id,
                        'quantity',
                        event.target.value,
                      )
                    }
                    placeholder={english ? 'For example: 2' : 'Ví dụ 2'}
                    inputMode="decimal"
                    className="mt-1.5 h-11"
                    aria-describedby={`${purchase.id}-quantity-error`}
                  />
                  {purchaseErrors[index].quantity ? (
                    <span
                      id={`${purchase.id}-quantity-error`}
                      role="alert"
                      className="mt-1 block text-sm font-normal text-red-700"
                    >
                      {purchaseErrors[index].quantity}
                    </span>
                  ) : null}
                </label>
                <label
                  htmlFor={`${purchase.id}-unit`}
                  className="text-sm font-medium"
                >
                  {english ? 'Unit' : 'Đơn vị'}
                  <select
                    id={`${purchase.id}-unit`}
                    value={purchase.unit}
                    onChange={(event) =>
                      updatePurchase(
                        purchase.id,
                        'unit',
                        event.target.value as GoldUnit,
                      )
                    }
                    className="mt-1.5 block h-11 w-full rounded-[14px] border border-input bg-[var(--surface-solid)] px-3 text-sm"
                  >
                    {localizedUnits.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label
                  htmlFor={`${purchase.id}-mode`}
                  className="text-sm font-medium"
                >
                  {english
                    ? 'How will you enter the amount?'
                    : 'Cách nhập số tiền'}
                  <select
                    id={`${purchase.id}-mode`}
                    value={purchase.priceMode}
                    onChange={(event) =>
                      updatePurchase(
                        purchase.id,
                        'priceMode',
                        event.target.value as PurchasePriceMode,
                      )
                    }
                    className="mt-1.5 block h-11 w-full rounded-[14px] border border-input bg-[var(--surface-solid)] px-3 text-sm"
                  >
                    <option value="total">
                      {english
                        ? 'Total paid (including fees)'
                        : 'Tổng đã trả (gồm phí)'}
                    </option>
                    <option value="per-luong">
                      {english ? 'Price per lượng' : 'Giá / lượng'}
                    </option>
                  </select>
                </label>
                <label
                  htmlFor={`${purchase.id}-money-unit`}
                  className="text-sm font-medium"
                >
                  {english ? 'Money unit' : 'Đơn vị tiền'}
                  <select
                    id={`${purchase.id}-money-unit`}
                    value={purchase.moneyUnit}
                    onChange={(event) =>
                      updatePurchase(
                        purchase.id,
                        'moneyUnit',
                        event.target.value as PurchaseDraft['moneyUnit'],
                      )
                    }
                    className="mt-1.5 block h-11 w-full rounded-[14px] border border-input bg-[var(--surface-solid)] px-3 text-base"
                  >
                    <option value="vnd">{english ? 'VND' : 'đồng'}</option>
                    <option value="million">
                      {english ? 'Million VND' : 'triệu đồng'}
                    </option>
                  </select>
                </label>
                <label
                  htmlFor={`${purchase.id}-price`}
                  className="text-sm font-medium"
                >
                  {purchase.priceMode === 'per-luong'
                    ? english
                      ? 'Price per lượng (VND)'
                      : 'Đơn giá / lượng (đ)'
                    : english
                      ? 'Total paid, including fees (VND)'
                      : 'Tổng đã trả, gồm phí (đ)'}
                  <Input
                    id={`${purchase.id}-price`}
                    value={
                      purchase.priceMode === 'per-luong'
                        ? purchase.unitPrice
                        : purchase.totalGold
                    }
                    onChange={(event) =>
                      updatePurchase(
                        purchase.id,
                        purchase.priceMode === 'per-luong'
                          ? 'unitPrice'
                          : 'totalGold',
                        event.target.value,
                      )
                    }
                    placeholder={
                      purchase.priceMode === 'per-luong'
                        ? english
                          ? 'For example: 140000000'
                          : 'Ví dụ: 140000000'
                        : english
                          ? 'For example: 29000000'
                          : 'Ví dụ: 29000000'
                    }
                    inputMode="numeric"
                    className="mt-1.5 h-11"
                  />
                </label>
                <label
                  htmlFor={`${purchase.id}-fee`}
                  className="text-sm font-medium"
                >
                  {english ? 'Purchase fee (VND)' : 'Phí mua (đ)'}
                  <Input
                    id={`${purchase.id}-fee`}
                    value={purchase.fee}
                    disabled={purchase.priceMode === 'total'}
                    onChange={(event) =>
                      updatePurchase(purchase.id, 'fee', event.target.value)
                    }
                    inputMode="numeric"
                    className="mt-1.5 h-11"
                  />
                  {purchase.priceMode === 'total' ? (
                    <span className="mt-1 block text-xs font-normal text-muted-foreground">
                      {english
                        ? 'Included in total paid.'
                        : 'Đã gồm trong tổng tiền.'}
                    </span>
                  ) : null}
                </label>
              </div>
              <label
                htmlFor={`${purchase.id}-date`}
                className="mt-3 block max-w-[220px] text-sm font-medium"
              >
                {english ? 'Purchase date (optional)' : 'Ngày mua (tùy chọn)'}
                <Input
                  id={`${purchase.id}-date`}
                  type="date"
                  value={purchase.date}
                  onChange={(event) =>
                    updatePurchase(purchase.id, 'date', event.target.value)
                  }
                  className="mt-1.5 h-11"
                />
              </label>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 rounded-[18px] border border-border/70 bg-card/40 p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <h3 className="font-heading text-base font-semibold">
            {english ? 'Resale venue' : 'Nơi dự định bán lại'}
          </h3>
          <CircleHelp
            className="size-4 text-muted-foreground"
            aria-label={english ? 'Explanation' : 'Giải thích'}
          />
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {english
            ? 'Selling back to the original dealer usually preserves the right buyback terms. Another dealer may use a different price or deduction; check the quote for the exact product you hold.'
            : 'Mua ở đâu bán ở đó thường giúp giữ đúng điều kiện thu mua. Bán tại hệ thống khác có thể có giá thu mua hoặc khoản khấu trừ riêng; chỉ dùng giá áp dụng đúng sản phẩm bạn đang giữ.'}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label
            htmlFor="calculator-sell-venue"
            className="text-sm font-medium"
          >
            {english ? 'Where will you sell?' : 'Bạn dự định bán ở đâu?'}
            <select
              id="calculator-sell-venue"
              value={sellVenueId}
              onChange={(event) => {
                manualPriceRef.current = false;
                setSellVenueId(event.target.value);
                setSellPriceOverride('');
                setSellPriceMode('auto');
              }}
              className="mt-1.5 block h-11 w-full rounded-[14px] border border-input bg-[var(--surface-solid)] px-3 text-sm"
            >
              <option value={buyVenueId}>
                {buyVenueLabel} · {english ? 'where you bought' : 'nơi đã mua'}
              </option>
              {otherVenues
                .filter((venue) => venue !== buyVenueId)
                .map((venue) => (
                  <option key={venue} value={venue}>
                    {venueLabel(venue)} ·{' '}
                    {english ? 'another dealer' : 'nơi khác'}
                  </option>
                ))}
            </select>
          </label>
          <label
            htmlFor="calculator-sell-price"
            className="text-sm font-medium"
          >
            {english
              ? 'Dealer buyback price per lượng (VND)'
              : 'Giá cửa hàng mua lại / lượng (đ)'}
            <Input
              id="calculator-sell-price"
              value={sellPriceOverride}
              onChange={(event) => updateManualSellPrice(event.target.value)}
              onBlur={(event) => {
                const amount = parseVnd(event.target.value);
                if (amount)
                  setSellPriceOverride(formatInputVnd(amount, english));
              }}
              placeholder={
                sellVenueId === selectedProduct?.companyId &&
                quote.priceVndPerLuong
                  ? `${Math.round(quote.priceVndPerLuong).toLocaleString(english ? 'en-US' : 'vi-VN')}`
                  : english
                    ? 'Enter the price the dealer quoted you'
                    : 'Nhập giá cửa hàng báo'
              }
              inputMode="numeric"
              className="mt-1.5 h-11"
            />
          </label>
          <label htmlFor="calculator-sell-fee" className="text-sm font-medium">
            {english ? 'Selling fee (VND)' : 'Phí bán (đ)'}
            <Input
              id="calculator-sell-fee"
              value={sellFee}
              onChange={(event) => setSellFee(event.target.value)}
              inputMode="numeric"
              className="mt-1.5 h-11"
            />
          </label>
          <div className="rounded-[14px] border border-border/70 bg-muted/45 p-3 text-xs text-muted-foreground">
            <p>{quoteStatusMessage}</p>
            {quote.observedAt ? (
              <p className="mt-1">
                {quote.timestampKind === 'source'
                  ? english
                    ? 'Published'
                    : 'Nguồn công bố'
                  : english
                    ? 'Observed'
                    : 'Quan sát'}
                : {sourceDate(quote.observedAt, english)}
              </p>
            ) : null}
            {quoteReasonMessage && !quote.priceVndPerLuong ? (
              <p className="mt-1 text-amber-700">{quoteReasonMessage}</p>
            ) : null}
          </div>
        </div>
        {sellPriceError ? (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {sellPriceError}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {sellPriceMode !== 'auto' &&
          quote.canAutofill &&
          quote.priceVndPerLuong ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-9 rounded-full text-xs"
              onClick={useLatestQuote}
            >
              {english ? 'Use latest price' : 'Dùng giá mới nhất'}
            </Button>
          ) : null}
          {sellPriceMode === 'auto' &&
          quote.priceVndPerLuong &&
          !quote.canAutofill ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-9 rounded-full text-xs"
              onClick={useReferenceQuote}
            >
              {english ? 'Use this reference price' : 'Dùng giá tham khảo này'}
            </Button>
          ) : null}
        </div>
      </div>

      <Button
        type="button"
        size="sm"
        variant="outline"
        className="mt-5 min-h-11 rounded-full text-sm"
        onClick={() => setShowAdvanced((value) => !value)}
      >
        {showAdvanced
          ? english
            ? 'Hide extra details'
            : 'Ẩn bớt chi tiết'
          : english
            ? 'Add details'
            : 'Thêm chi tiết'}
      </Button>
      {showAdvanced && otherVenueId && sellVenueId === buyVenueId ? (
        <details className="mt-4 rounded-[18px] border border-border/70 bg-card/30 p-4">
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold">
            {english ? 'Selling at another dealer?' : 'Nếu bán ở nơi khác?'}
            <ChevronDown className="size-4" />
          </summary>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label
              htmlFor="calculator-other-venue"
              className="text-xs font-medium"
            >
              {english ? 'Other dealer' : 'Nơi nhận mua khác'}
              <select
                id="calculator-other-venue"
                value={otherVenueId}
                onChange={(event) => setOtherVenueId(event.target.value)}
                className="mt-1.5 block h-11 w-full rounded-[14px] border border-input bg-[var(--surface-solid)] px-3 text-sm"
              >
                {otherVenues
                  .filter((venue) => venue !== buyVenueId)
                  .map((venue) => (
                    <option key={venue} value={venue}>
                      {venueLabel(venue)}
                    </option>
                  ))}
              </select>
            </label>
            <label
              htmlFor="calculator-other-price"
              className="text-xs font-medium"
            >
              {english
                ? 'Other dealer’s quote per lượng (VND)'
                : 'Giá nơi khác báo / lượng (đ)'}
              <Input
                id="calculator-other-price"
                value={otherSellPrice}
                onChange={(event) => setOtherSellPrice(event.target.value)}
                placeholder={
                  english ? 'Enter the actual price' : 'Nhập giá thực tế'
                }
                inputMode="numeric"
                className="mt-1.5 h-11"
              />
            </label>
            <label
              htmlFor="calculator-other-fee"
              className="text-xs font-medium"
            >
              {english
                ? 'Other dealer’s selling fee (VND)'
                : 'Phí bán tại nơi khác (đ)'}
              <Input
                id="calculator-other-fee"
                value={otherSellFee}
                onChange={(event) => setOtherSellFee(event.target.value)}
                inputMode="numeric"
                className="mt-1.5 h-11"
              />
            </label>
          </div>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            {english
              ? 'If a matching buyback price is unavailable, do not infer it from another dealer’s prices.'
              : 'Chưa có giá thu mua đúng sản phẩm thì không suy ra từ giá nội thương hiệu khác.'}
          </p>
        </details>
      ) : null}

      {incompletePurchases ? (
        <p role="alert" className="mt-4 text-sm text-amber-700">
          {english
            ? `${incompletePurchases} purchase${incompletePurchases === 1 ? '' : 's'} need both quantity and price. Complete or remove ${incompletePurchases === 1 ? 'it' : 'them'} to view results.`
            : `${incompletePurchases} lần mua chưa đủ khối lượng và giá; vui lòng hoàn tất hoặc xóa dòng trước khi đọc kết quả.`}
        </p>
      ) : null}
      {pendingLinkedDraft ? (
        <div
          role="alert"
          className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-primary/20 bg-primary/5 p-4 text-sm"
        >
          <p>
            {english
              ? 'The comparison link contains new data. Replace the current calculation?'
              : 'Liên kết từ bảng so sánh có dữ liệu mới. Bạn muốn thay bản tính hiện tại?'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              className="min-h-9 rounded-full"
              onClick={() => applyLinkedDraft(pendingLinkedDraft)}
            >
              {english ? 'Replace calculation' : 'Thay bản tính'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-9 rounded-full"
              onClick={() => setPendingLinkedDraft(null)}
            >
              {english ? 'Keep current' : 'Giữ bản tính'}
            </Button>
          </div>
        </div>
      ) : null}
      {notice ? (
        <output className="mt-4 block text-sm text-primary">{notice}</output>
      ) : null}

      {!canCalculate ? (
        <div
          className="mt-6 rounded-[18px] border border-primary/20 bg-primary/5 p-5 text-sm"
          aria-live="polite"
        >
          <p className="font-semibold">
            {english
              ? 'Enter your quantity and total paid to see the result.'
              : 'Nhập khối lượng và tổng tiền đã trả để xem kết quả.'}
          </p>
          <p className="mt-1 text-muted-foreground">
            {english
              ? 'We will show what you may receive after selling fees.'
              : 'Hệ thống sẽ hiển thị số tiền bạn có thể nhận sau phí bán.'}
          </p>
        </div>
      ) : (
        <div className="mt-6" aria-live="polite">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-primary">
            {english
              ? 'Step 3 of 3 · Your result'
              : 'Bước 3/3 · Kết quả của bạn'}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-[16px] border border-border bg-card/55 p-4">
              <p className="text-sm text-muted-foreground">
                {english
                  ? `Profit / loss at ${sellVenueLabel}`
                  : `Lời/lỗ nếu bán tại ${sellVenueLabel}`}
              </p>
              <p
                className={`mt-1 font-heading text-2xl font-semibold ${result.pnlVnd !== null && result.pnlVnd >= 0 ? 'text-emerald-700' : 'text-red-700'}`}
              >
                {result.pnlVnd === null
                  ? '—'
                  : result.pnlVnd > 0
                    ? `${english ? 'Profit' : 'Lời'} ${formatVnd(result.pnlVnd, english)}`
                    : result.pnlVnd < 0
                      ? `${english ? 'Loss' : 'Lỗ'} ${formatVnd(Math.abs(result.pnlVnd), english)}`
                      : english
                        ? 'Break-even 0 VND'
                        : 'Hòa vốn 0đ'}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatPercent(result.returnPercent)}
              </p>
            </div>
            <div className="rounded-[16px] border border-border bg-card/55 p-4">
              <p className="text-sm text-muted-foreground">
                {english ? 'Price to avoid a loss' : 'Giá bán lại để không lỗ'}
              </p>
              <p className="mt-1 font-semibold">
                {formatVnd(result.breakevenVndPerLuong, english)} / lượng
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {english ? 'Average cost' : 'Giá vốn bình quân'}:{' '}
                {formatVnd(result.averageCostVndPerLuong, english)} / lượng
              </p>
            </div>
            <div className="rounded-[16px] border border-border bg-card/55 p-4">
              <p className="text-sm text-muted-foreground">
                {english ? 'Distance to break-even' : 'Khoảng cách đến hòa vốn'}
              </p>
              <p
                className={`mt-1 font-semibold ${result.gapToBreakevenVndPerLuong !== null && result.gapToBreakevenVndPerLuong >= 0 ? 'text-emerald-700' : 'text-red-700'}`}
              >
                {formatVnd(result.gapToBreakevenVndPerLuong, english)} / lượng
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatPercent(result.gapToBreakevenPercent)}
              </p>
            </div>
            <div className="rounded-[16px] border border-border bg-card/55 p-4">
              <p className="text-sm text-muted-foreground">
                {english
                  ? 'Amount you may receive after fees'
                  : 'Tiền bạn nhận sau phí'}
              </p>
              <p className="mt-1 font-semibold">
                {formatVnd(result.netProceedsVnd, english)}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {result.quantityLuong.toFixed(4)} lượng ·{' '}
                {english ? 'total paid' : 'đã trả'}{' '}
                {formatVnd(result.totalCostVnd, english)}
              </p>
            </div>
          </div>
        </div>
      )}

      {otherResult ? (
        <div className="mt-5 rounded-[18px] border border-primary/20 bg-primary/5 p-4 sm:p-5">
          <h3 className="font-heading text-base font-semibold">
            {english
              ? 'Compare proceeds by dealer'
              : 'So sánh tiền nhận theo nơi bán'}
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground">{sellVenueLabel}</p>
              <p className="mt-1 font-semibold">
                {formatVnd(result.netProceedsVnd, english)} ·{' '}
                {formatVnd(result.pnlVnd, english)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                {venueLabel(otherVenueId)}
              </p>
              <p className="mt-1 font-semibold">
                {formatVnd(otherResult.netProceedsVnd, english)} ·{' '}
                {formatVnd(otherResult.pnlVnd, english)}
              </p>
            </div>
          </div>
          <p className="mt-3 text-sm font-semibold">
            {english ? 'Difference in proceeds' : 'Chênh lệch tiền nhận'}:{' '}
            {formatVnd(
              (otherResult.netProceedsVnd ?? 0) - (result.netProceedsVnd ?? 0),
              english,
            )}
          </p>
        </div>
      ) : null}

      <details className="mt-5 rounded-[18px] border border-border/70 bg-card/30 p-4">
        <summary className="cursor-pointer text-sm font-semibold">
          {english ? 'How the result is calculated' : 'Cách tính kết quả'}
        </summary>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <p>
            {english ? 'Total quantity' : 'Tổng khối lượng'}:{' '}
            <strong>{result.quantityLuong.toFixed(4)} lượng</strong>
          </p>
          <p>
            {english ? 'Total paid' : 'Tổng đã trả'}:{' '}
            <strong>{formatVnd(result.totalCostVnd, english)}</strong>
          </p>
          <p>
            {english ? 'Buyback price used' : 'Giá cửa hàng mua lại đang dùng'}:{' '}
            <strong>
              {formatVnd(result.sellPriceVndPerLuong, english)} / lượng
            </strong>
          </p>
          <p>
            {english ? 'Selling fee' : 'Phí bán'}:{' '}
            <strong>{formatVnd(result.sellFeeVnd, english)}</strong>
          </p>
        </div>
        <p className="mt-4 text-sm leading-5 text-muted-foreground">
          {english
            ? 'Price to avoid a loss = (total paid + selling fee) ÷ total quantity. Actual results can vary with receipts, product condition, and dealer policy.'
            : 'Giá bán lại để không lỗ = (tổng đã trả + phí bán) ÷ tổng khối lượng. Kết quả thực tế có thể thay đổi theo hóa đơn, tình trạng sản phẩm và chính sách từng nơi.'}
        </p>
      </details>

      <section
        className={
          showAdvanced
            ? 'mt-5 rounded-[18px] border border-border/70 bg-card/30 p-4'
            : 'hidden'
        }
        aria-labelledby="scenario-title"
      >
        <h3
          id="scenario-title"
          className="font-heading text-base font-semibold"
        >
          {english ? 'Buyback price scenarios' : 'Kịch bản giá thu mua'}
        </h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {english
            ? 'Illustrations using the current price, not forecasts.'
            : 'Mô phỏng theo giá đang dùng, không phải dự báo giá tương lai.'}
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-5">
          {scenarioPrices.map(({ percent, result: scenario }) => (
            <div
              key={percent}
              className="rounded-[14px] border border-border bg-background/35 p-3 text-xs"
            >
              <p className="font-semibold">
                {percent === 0
                  ? english
                    ? 'Current'
                    : 'Hiện tại'
                  : `${percent > 0 ? '+' : ''}${percent}%`}
              </p>
              <p className="mt-2">
                {scenario
                  ? formatVnd(scenario.pnlVnd, english)
                  : english
                    ? 'No price yet'
                    : 'Chưa có giá'}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <label
            htmlFor="calculator-scenario-price"
            className="text-xs font-medium sm:max-w-xs"
          >
            {english
              ? 'Assumed buyback price / lượng (VND)'
              : 'Giá giả định / lượng (đ)'}
            <Input
              id="calculator-scenario-price"
              value={scenarioCustom}
              onChange={(event) => setScenarioCustom(event.target.value)}
              inputMode="numeric"
              className="mt-1.5 h-11"
            />
          </label>
          {customScenarioPrice ? (
            <p className="rounded-[14px] border border-border bg-background/35 p-3 text-xs">
              {english ? 'Profit / loss' : 'Lãi/lỗ'}:{' '}
              <strong>
                {formatVnd(
                  calculateOutcome({
                    ...baseInput,
                    sellPriceVndPerLuong: customScenarioPrice,
                  }).pnlVnd,
                  english,
                )}
              </strong>
            </p>
          ) : null}
        </div>
      </section>

      <section
        className="mt-5 rounded-[18px] border border-border/70 bg-card/30 p-4"
        aria-labelledby="additional-title"
      >
        <h3
          id="additional-title"
          className="font-heading text-base font-semibold"
        >
          {english ? 'Simulate an additional purchase' : 'Mô phỏng mua thêm'}
        </h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {english
            ? 'This is a scenario only; it does not change the saved calculation.'
            : 'Chỉ là kịch bản, chưa thêm giao dịch vào bản tính đã lưu.'}
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <label
            htmlFor="calculator-additional-quantity"
            className="text-xs font-medium"
          >
            {english ? 'Quantity' : 'Khối lượng'}
            <Input
              id="calculator-additional-quantity"
              value={additional.quantity}
              onChange={(event) =>
                setAdditional((current) => ({
                  ...current,
                  quantity: event.target.value,
                }))
              }
              inputMode="decimal"
              className="mt-1.5 h-11"
            />
          </label>
          <label
            htmlFor="calculator-additional-unit"
            className="text-xs font-medium"
          >
            {english ? 'Unit' : 'Đơn vị'}
            <select
              id="calculator-additional-unit"
              value={additional.unit}
              onChange={(event) =>
                setAdditional((current) => ({
                  ...current,
                  unit: event.target.value as GoldUnit,
                }))
              }
              className="mt-1.5 block h-11 w-full rounded-[14px] border border-input bg-[var(--surface-solid)] px-3 text-sm"
            >
              {localizedUnits.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label
            htmlFor="calculator-additional-price"
            className="text-xs font-medium"
          >
            {english
              ? 'Additional purchase price / lượng (VND)'
              : 'Giá mua thêm / lượng (đ)'}
            <Input
              id="calculator-additional-price"
              value={additional.price}
              onChange={(event) =>
                setAdditional((current) => ({
                  ...current,
                  price: event.target.value,
                }))
              }
              inputMode="numeric"
              className="mt-1.5 h-11"
            />
          </label>
          <label
            htmlFor="calculator-additional-fee"
            className="text-xs font-medium"
          >
            {english ? 'Additional purchase fee (VND)' : 'Phí mua thêm (đ)'}
            <Input
              id="calculator-additional-fee"
              value={additional.fee}
              onChange={(event) =>
                setAdditional((current) => ({
                  ...current,
                  fee: event.target.value,
                }))
              }
              inputMode="numeric"
              className="mt-1.5 h-11"
            />
          </label>
        </div>
        {afterAdditional ? (
          <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
            <p>
              {english ? 'Average cost' : 'Giá vốn bình quân'}:{' '}
              <strong>
                {formatVnd(result.averageCostVndPerLuong, english)} →{' '}
                {formatVnd(afterAdditional.averageCostVndPerLuong, english)}
              </strong>
            </p>
            <p>
              {english ? 'Break-even' : 'Hòa vốn'}:{' '}
              <strong>
                {formatVnd(result.breakevenVndPerLuong, english)} →{' '}
                {formatVnd(afterAdditional.breakevenVndPerLuong, english)}
              </strong>
            </p>
            <p>
              {english
                ? 'Profit / loss at current price'
                : 'Lãi/lỗ tại giá đang dùng'}
              :{' '}
              <strong>
                {formatVnd(result.pnlVnd, english)} →{' '}
                {formatVnd(afterAdditional.pnlVnd, english)}
              </strong>
            </p>
          </div>
        ) : null}
      </section>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="min-h-11 rounded-full text-sm"
          onClick={clearEnteredValues}
        >
          <Trash2 className="mr-1.5 size-3.5" />
          {english ? 'Clear entered values' : 'Xóa dữ liệu nhập'}
        </Button>
        {saved ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="min-h-11 rounded-full text-sm"
            onClick={clearDraft}
          >
            {english ? 'Delete saved calculation' : 'Xóa bản lưu'}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
