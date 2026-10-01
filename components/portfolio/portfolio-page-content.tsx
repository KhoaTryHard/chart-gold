'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { signIn, signOut, useSession } from 'next-auth/react';
import {
  ArrowRight,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  WalletCards,
} from 'lucide-react';

import { LedgerBackup } from '@/components/portfolio/ledger-backup';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLocale } from '@/components/locale-provider';
import { useAccountMenuState } from '@/components/account-menu-context';
import {
  calculateLedgerSummary,
  appendLedgerTransaction,
  ledgerProductKeys,
  ledgerSideLabel,
  LedgerMutationError,
  removeLedgerTransaction,
  readPortfolioLedger,
  mergeLedger,
  updateLedgerTransaction,
  type LedgerQuote,
  type LedgerSide,
  type LedgerTransaction,
  type PortfolioLedger,
} from '@/lib/portfolio-ledger';
import {
  clearPortfolioLedgerCache,
  readPortfolioLedgerCache,
  writePortfolioLedgerCache,
} from '@/lib/portfolio-ledger-cache';
import {
  MARKET_COMPANIES,
  getDefaultMarketProduct,
  getMarketCompany,
  getMarketProducts,
  isMarketCompanyId,
  isMarketProductId,
  isMarketProductSelectable,
  presentMarketCompany,
  presentMarketProduct,
  type MarketCompanyId,
} from '@/lib/market-sources';
import {
  formatVndInput,
  parseQuantityInput,
  parseVndInput,
} from '@/lib/input-parsing';
import { vietnamDate } from '@/lib/analysis/dates';
import {
  isCalendarDate,
  isPortfolioMarketQuote,
  portfolioQuotePriceForSide,
  portfolioPriceVndPerLuongForSave,
  portfolioUnitFactor,
  portfolioUnitPriceFromLuong,
  type PortfolioMarketQuote,
} from '@/lib/portfolio-market-quote';

const EMPTY_LEDGER: PortfolioLedger = { version: 1, transactions: [] };
type GoldUnit = 'luong' | 'chi';
type DraftPriceMode = 'empty' | 'manual' | 'listed';

type LedgerDraft = {
  date: string;
  side: LedgerSide;
  companyId: MarketCompanyId;
  productId: string;
  quantity: string;
  unit: GoldUnit;
  price: string;
  priceMode: DraftPriceMode;
  unitPriceVndPerLuong: number | null;
  fees: string;
  purchaseVenue: string;
  saleVenue: string;
  note: string;
};

const units: Array<{ value: GoldUnit; label: string; factor: number }> = [
  { value: 'chi', label: 'chỉ', factor: 0.1 },
  { value: 'luong', label: 'lượng', factor: 1 },
];

function today() {
  return vietnamDate();
}

function initialDraft(): LedgerDraft {
  return {
    date: today(),
    side: 'buy',
    companyId: 'sjc',
    productId: getMarketProducts('sjc')[0]?.id ?? 'bar-1l',
    quantity: '',
    unit: 'chi',
    price: '',
    priceMode: 'empty',
    unitPriceVndPerLuong: null,
    fees: '',
    purchaseVenue: '',
    saleVenue: '',
    note: '',
  };
}

function formatVnd(value: number | null | undefined, english: boolean) {
  if (value === null || value === undefined || !Number.isFinite(value))
    return english ? 'Unavailable' : 'Chưa có giá';
  return `${Math.round(value).toLocaleString(english ? 'en-US' : 'vi-VN')} ${english ? 'VND' : 'đ'}`;
}

function newId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    return crypto.randomUUID();
  return `manual-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function PortfolioPageContent() {
  const { locale } = useLocale();
  const english = locale === 'en';
  const { status: authStatus, data: session } = useSession();
  const { setState: setAccountMenuState } = useAccountMenuState();
  const account = session?.user?.email?.trim().toLowerCase() ?? '';
  const [ledger, setLedger] = useState<PortfolioLedger>(EMPTY_LEDGER);
  const [draft, setDraft] = useState<LedgerDraft>(() => initialDraft());
  const [draftQuote, setDraftQuote] = useState<{
    key: string;
    quote: PortfolioMarketQuote;
  } | null>(null);
  const [draftQuoteLoading, setDraftQuoteLoading] = useState(false);
  const [draftQuoteNonce, setDraftQuoteNonce] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [quotes, setQuotes] = useState<Map<string, LedgerQuote>>(new Map());
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LedgerTransaction | null>(
    null,
  );
  const [historySide, setHistorySide] = useState<'all' | LedgerSide>('all');
  const [historyProduct, setHistoryProduct] = useState('all');
  const [historyMonth, setHistoryMonth] = useState('');
  const [serverVersion, setServerVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [legacyLedger, setLegacyLedger] = useState<PortfolioLedger | null>(
    null,
  );
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    setAccountMenuState({
      context: 'general',
      busy: saving,
      onSignOut: () => {
        if (saving) {
          setNotice(
            english
              ? 'Please wait for the ledger to finish saving.'
              : 'Hãy chờ Sổ vàng lưu xong trước khi đăng xuất.',
          );
          return;
        }
        const hasDraft = Boolean(
          editingId ||
          draft.quantity ||
          draft.price ||
          draft.fees ||
          draft.note,
        );
        if (
          hasDraft &&
          !window.confirm(
            english
              ? 'You have an unsaved ledger draft. Sign out anyway?'
              : 'Bạn còn bản nháp Sổ vàng chưa lưu. Vẫn đăng xuất?',
          )
        )
          return;
        void clearPortfolioLedgerCache(account).finally(() => {
          void signOut({ redirectTo: '/' });
        });
      },
    });
    return () => setAccountMenuState(null);
  }, [
    authStatus,
    saving,
    editingId,
    draft.quantity,
    draft.price,
    draft.fees,
    draft.note,
    english,
    account,
    setAccountMenuState,
  ]);

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (authStatus !== 'authenticated' || !account) {
      queueMicrotask(() => {
        setLedger(EMPTY_LEDGER);
        setHydrated(true);
      });
      return;
    }
    const controller = new AbortController();
    void fetch('/api/portfolio/ledger', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as {
          ledger?: PortfolioLedger;
          version?: number;
          error?: string;
        };
        if (!response.ok || !body.ledger || typeof body.version !== 'number')
          throw new Error(
            body.error ??
              (english
                ? 'Could not load your ledger.'
                : 'Không thể tải Sổ vàng.'),
          );
        setLedger(body.ledger);
        setServerVersion(body.version);
        const deviceLedger = readPortfolioLedger('device');
        if (
          !body.ledger.transactions.length &&
          deviceLedger?.transactions.length
        )
          setLegacyLedger(deviceLedger);
        await writePortfolioLedgerCache(account, {
          ledger: body.ledger,
          serverVersion: body.version,
          updatedAt: new Date().toISOString(),
        });
      })
      .catch(async () => {
        const cached = await readPortfolioLedgerCache(account);
        if (cached) {
          setLedger(cached.ledger);
          setServerVersion(cached.serverVersion);
          setNotice(
            english
              ? 'Offline cache loaded. Changes need a connection to save.'
              : 'Đã tải bản lưu gần nhất. Cần có mạng để lưu thay đổi.',
          );
        } else {
          setNotice(
            english ? 'Could not load your ledger.' : 'Không thể tải Sổ vàng.',
          );
        }
      })
      .finally(() => {
        setHydrated(true);
      });
    return () => controller.abort();
  }, [account, authStatus, english, refreshNonce]);

  useEffect(() => {
    const wasHidden = { value: false };
    const refresh = () => {
      if (authStatus === 'authenticated') setRefreshNonce((value) => value + 1);
    };
    const onVisibility = () => {
      if (document.hidden) wasHidden.value = true;
      else if (wasHidden.value) {
        wasHidden.value = false;
        refresh();
      }
    };
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [authStatus]);

  useEffect(() => {
    if (!account || typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(`kim-tuyen-ledger:${account}`);
    channel.onmessage = () => window.location.reload();
    return () => channel.close();
  }, [account]);

  const saveRemote = async (next: PortfolioLedger) => {
    if (!account) return false;
    setSaving(true);
    setNotice(english ? 'Saving…' : 'Đang lưu…');
    try {
      const response = await fetch('/api/portfolio/ledger', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          operationId: crypto.randomUUID(),
          baseVersion: serverVersion,
          ledger: next,
        }),
      });
      const body = (await response.json()) as {
        ledger?: PortfolioLedger;
        version?: number;
        error?: string;
      };
      if (
        response.status === 409 &&
        body.ledger &&
        typeof body.version === 'number'
      ) {
        setLedger(body.ledger);
        setServerVersion(body.version);
        setNotice(
          english
            ? 'The ledger changed on another device. Review the latest copy before saving again.'
            : 'Sổ đã thay đổi trên thiết bị khác. Hãy kiểm tra bản mới nhất rồi lưu lại.',
        );
        return false;
      }
      if (!response.ok || !body.ledger || typeof body.version !== 'number')
        throw new Error(
          body.error ??
            (english ? 'Could not save the ledger.' : 'Không thể lưu Sổ vàng.'),
        );
      setLedger(body.ledger);
      setServerVersion(body.version);
      await writePortfolioLedgerCache(account, {
        ledger: body.ledger,
        serverVersion: body.version,
        updatedAt: new Date().toISOString(),
      });
      if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel(`kim-tuyen-ledger:${account}`);
        channel.postMessage({ version: body.version });
        channel.close();
      }
      setNotice(english ? 'Saved.' : 'Đã lưu.');
      return true;
    } catch (error) {
      setNotice(
        error instanceof Error
          ? `${error.message} ${english ? 'Your draft is still here.' : 'Bản nháp vẫn được giữ lại.'}`
          : english
            ? 'Not saved. Draft kept.'
            : 'Chưa lưu. Bản nháp vẫn được giữ.',
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  const importLegacyLedger = async () => {
    if (!legacyLedger) return;
    try {
      const merged = mergeLedger(ledger, legacyLedger.transactions);
      if (await saveRemote(merged)) setLegacyLedger(null);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : english
            ? 'Could not import the old ledger.'
            : 'Không thể nhập Sổ vàng cũ.',
      );
    }
  };

  const discardLegacyPrompt = () => setLegacyLedger(null);

  /* Keep URL preset handling below independent from the server load. */
  useEffect(() => {
    if (!hydrated) return;
    queueMicrotask(() => {
      const params = new URLSearchParams(window.location.search);
      const company = params.get('company');
      const product = params.get('product');
      if (!company && !product) return;
      if (!isMarketCompanyId(company)) {
        setNotice(
          english
            ? 'This brand link is invalid. Choose a brand and product from the list.'
            : 'Liên kết thương hiệu không hợp lệ. Hãy chọn thương hiệu và sản phẩm trong danh sách.',
        );
        return;
      }
      if (!isMarketProductId(company, product)) {
        setNotice(
          english
            ? 'This product does not belong to the linked brand. Choose a product from the list.'
            : 'Sản phẩm trong liên kết không thuộc thương hiệu đã chọn. Hãy chọn sản phẩm trong danh sách.',
        );
        return;
      }
      const linkedProduct = getMarketProducts(company).find(
        (item) => item.id === product,
      );
      if (!linkedProduct || !isMarketProductSelectable(linkedProduct)) {
        const reason =
          linkedProduct && 'unavailableReason' in linkedProduct
            ? linkedProduct.unavailableReason
            : null;
        setNotice(
          reason ??
            (english
              ? 'This product does not have an available quote.'
              : 'Sản phẩm này chưa có báo giá khả dụng.'),
        );
        return;
      }
      setDraft((current) => ({
        ...current,
        companyId: company,
        productId: product,
        side: params.get('side') === 'sell' ? 'sell' : 'buy',
      }));
      window.setTimeout(
        () =>
          document
            .getElementById('so-vang-entry')
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        0,
      );
    });
  }, [english, hydrated]);

  useEffect(() => {
    if (!ledger.transactions.length) {
      queueMicrotask(() => {
        setQuotes(new Map());
        setQuoteLoading(false);
      });
      return;
    }
    const controller = new AbortController();
    queueMicrotask(() => setQuoteLoading(true));
    const keys = ledgerProductKeys(ledger);
    void Promise.all(
      keys.map(async (key) => {
        const [companyId, productId] = key.split(':');
        try {
          const response = await fetch(
            `/api/sjc?${new URLSearchParams({ company: companyId, product: productId, view: 'quote' })}`,
            { signal: controller.signal, cache: 'default' },
          );
          if (!response.ok) return null;
          const body = (await response.json()) as {
            availability?: string;
            latest?: { buy?: number | null; sell?: number | null } | null;
            observedAt?: string;
          };
          const buy = body.latest?.buy;
          if (
            body.availability !== 'available' ||
            typeof buy !== 'number' ||
            !Number.isFinite(buy) ||
            buy <= 0
          )
            return null;
          const quote: LedgerQuote = {
            companyId,
            productId,
            buy: buy * 1_000_000,
            sell:
              (typeof body.latest?.sell === 'number' ? body.latest.sell : buy) *
              1_000_000,
            ...(body.observedAt ? { observedAt: body.observedAt } : {}),
          };
          return [key, quote] as const;
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (controller.signal.aborted) return;
      const entries: Array<readonly [string, LedgerQuote]> = [];
      for (const item of results) if (item) entries.push(item);
      setQuotes(new Map(entries));
      setQuoteLoading(false);
    });
    return () => controller.abort();
  }, [ledger]);

  const summary = useMemo(
    () => calculateLedgerSummary(ledger.transactions, quotes),
    [ledger.transactions, quotes],
  );
  const visibleTransactions = useMemo(
    () =>
      [...ledger.transactions]
        .filter(
          (transaction) =>
            historySide === 'all' || transaction.side === historySide,
        )
        .filter(
          (transaction) =>
            historyProduct === 'all' ||
            `${transaction.companyId}:${transaction.productId}` ===
              historyProduct,
        )
        .filter(
          (transaction) =>
            !historyMonth || transaction.date.startsWith(historyMonth),
        )
        .sort((left, right) => right.date.localeCompare(left.date)),
    [historyMonth, historyProduct, historySide, ledger.transactions],
  );
  const historyProducts = useMemo(
    () => [
      ...new Map(
        ledger.transactions.map((transaction) => [
          `${transaction.companyId}:${transaction.productId}`,
          transaction,
        ]),
      ).values(),
    ],
    [ledger.transactions],
  );
  const products = getMarketProducts(draft.companyId);
  const selectedProduct =
    products.find((product) => product.id === draft.productId) ?? products[0];
  const draftQuoteKey = `${draft.companyId}:${draft.productId}:${draft.date}`;
  const activeDraftQuote =
    draftQuote?.key === draftQuoteKey ? draftQuote.quote : null;
  const quotedUnitPrice = activeDraftQuote
    ? portfolioQuotePriceForSide(activeDraftQuote, draft.side)
    : null;
  const parsedDraftQuantity = parseQuantityInput(draft.quantity);
  const parsedDisplayPrice = parseVndInput(draft.price, false);
  const draftGoldAmount =
    parsedDraftQuantity.value &&
    !parsedDraftQuantity.error &&
    parsedDisplayPrice.value &&
    !parsedDisplayPrice.error
      ? parsedDraftQuantity.value * parsedDisplayPrice.value
      : null;

  const updateDraft = <K extends keyof LedgerDraft>(
    key: K,
    value: LedgerDraft[K],
  ) => {
    setDraft((current) => {
      if (key === 'unit') {
        const unit = value as GoldUnit;
        const canonical = current.unitPriceVndPerLuong;
        return {
          ...current,
          unit,
          price:
            canonical && canonical > 0
              ? formatVndInput(portfolioUnitPriceFromLuong(canonical, unit))
              : current.price,
        };
      }
      const next = { ...current, [key]: value };
      if (
        (key === 'companyId' ||
          key === 'productId' ||
          key === 'date' ||
          key === 'side') &&
        current.priceMode === 'listed'
      ) {
        next.price = '';
        next.priceMode = 'empty';
        next.unitPriceVndPerLuong = null;
      }
      return next;
    });
    setNotice('');
  };

  const updateManualPrice = (value: string) => {
    setDraft((current) => {
      const parsed = parseVndInput(value, false);
      const factor = portfolioUnitFactor(current.unit);
      return {
        ...current,
        price: value,
        priceMode: 'manual',
        unitPriceVndPerLuong:
          parsed.value && !parsed.error
            ? Math.round(parsed.value / factor)
            : null,
      };
    });
    setNotice('');
  };

  const useListedPrice = () => {
    if (!activeDraftQuote || !quotedUnitPrice || quotedUnitPrice <= 0) return;
    setDraft((current) => ({
      ...current,
      price: formatVndInput(
        portfolioUnitPriceFromLuong(quotedUnitPrice, current.unit),
      ),
      priceMode: 'listed',
      unitPriceVndPerLuong: quotedUnitPrice,
    }));
    setNotice('');
  };

  useEffect(() => {
    if (
      !isMarketCompanyId(draft.companyId) ||
      !isMarketProductId(draft.companyId, draft.productId) ||
      !isCalendarDate(draft.date)
    ) {
      queueMicrotask(() => {
        setDraftQuote(null);
        setDraftQuoteLoading(false);
      });
      return;
    }
    const controller = new AbortController();
    const key = draftQuoteKey;
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setDraftQuote(null);
      setDraftQuoteLoading(true);
    });
    const params = new URLSearchParams({
      company: draft.companyId,
      product: draft.productId,
      date: draft.date,
    });
    void fetch(`/api/market-quote?${params}`, {
      signal: controller.signal,
      cache: 'default',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Market quote unavailable');
        const body: unknown = await response.json();
        if (
          !isPortfolioMarketQuote(
            body,
            draft.companyId,
            draft.productId,
            draft.date,
          )
        )
          throw new Error('Market quote identity mismatch');
        if (!controller.signal.aborted) setDraftQuote({ key, quote: body });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setDraftQuote({
            key,
            quote: {
              companyId: draft.companyId,
              productId: draft.productId,
              requestedDate: draft.date,
              quoteDate: null,
              buyVndPerLuong: null,
              sellVndPerLuong: null,
              status: 'unavailable',
              source: null,
              observedAt: null,
              expiresAt: null,
              reason: english
                ? 'Could not load the quote. Enter the price manually.'
                : 'Không tải được giá niêm yết. Bạn có thể nhập giá thủ công.',
            },
          });
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setDraftQuoteLoading(false);
      });
    return () => controller.abort();
  }, [
    draft.companyId,
    draft.productId,
    draft.date,
    draftQuoteKey,
    draftQuoteNonce,
    english,
  ]);

  useEffect(() => {
    if (
      !activeDraftQuote ||
      activeDraftQuote.status === 'unavailable' ||
      !quotedUnitPrice ||
      quotedUnitPrice <= 0 ||
      !parsedDraftQuantity.value ||
      parsedDraftQuantity.error ||
      draft.priceMode === 'manual'
    )
      return;
    const price = formatVndInput(
      portfolioUnitPriceFromLuong(quotedUnitPrice, draft.unit),
    );
    queueMicrotask(() => {
      setDraft((current) => {
        const currentQuantity = parseQuantityInput(current.quantity);
        if (
          current.priceMode === 'manual' ||
          !currentQuantity.value ||
          currentQuantity.error ||
          current.companyId !== activeDraftQuote.companyId ||
          current.productId !== activeDraftQuote.productId ||
          current.date !== activeDraftQuote.requestedDate ||
          current.side !== draft.side ||
          current.unit !== draft.unit ||
          (current.priceMode === 'listed' &&
            current.price === price &&
            current.unitPriceVndPerLuong === quotedUnitPrice)
        )
          return current;
        return {
          ...current,
          price,
          priceMode: 'listed',
          unitPriceVndPerLuong: quotedUnitPrice,
        };
      });
    });
  }, [
    activeDraftQuote,
    quotedUnitPrice,
    parsedDraftQuantity.value,
    parsedDraftQuantity.error,
    draft.priceMode,
    draft.side,
    draft.unit,
  ]);

  const resetDraft = () => {
    setDraft(initialDraft());
    setDraftQuote(null);
    setDraftQuoteLoading(false);
    setDraftQuoteNonce((current) => current + 1);
    setEditingId(null);
  };

  const saveTransaction = async () => {
    const parsedQuantity = parseQuantityInput(draft.quantity);
    const parsedPrice = parseVndInput(draft.price, false);
    const parsedFees = draft.fees.trim()
      ? parseVndInput(draft.fees)
      : { value: 0, error: null };
    const unit =
      units.find((candidate) => candidate.value === draft.unit) ?? units[0];
    if (
      !parsedQuantity.value ||
      parsedQuantity.error ||
      !parsedPrice.value ||
      parsedPrice.error ||
      parsedFees.error
    ) {
      setNotice(
        english
          ? 'Enter a positive quantity and price. Fees may be left empty.'
          : 'Nhập khối lượng và giá lớn hơn 0. Phí có thể để trống.',
      );
      return;
    }
    if (!selectedProduct) {
      setNotice(english ? 'Choose a product.' : 'Hãy chọn sản phẩm.');
      return;
    }
    const transaction: LedgerTransaction = {
      id: editingId ?? newId(),
      date: draft.date || today(),
      side: draft.side,
      companyId: draft.companyId,
      productId: selectedProduct.id,
      quantityLuong: parsedQuantity.value * unit.factor,
      unitPriceVnd: portfolioPriceVndPerLuongForSave(
        parsedPrice.value,
        draft.unit,
        draft.unitPriceVndPerLuong,
      ),
      feesVnd: parsedFees.value ?? 0,
      ...(draft.purchaseVenue.trim()
        ? { purchaseVenue: draft.purchaseVenue.trim() }
        : {}),
      ...(draft.saleVenue.trim() ? { saleVenue: draft.saleVenue.trim() } : {}),
      note: draft.note.trim(),
    };
    try {
      const next = editingId
        ? updateLedgerTransaction(ledger, transaction)
        : appendLedgerTransaction(ledger, transaction);
      if (await saveRemote(next)) resetDraft();
    } catch (error) {
      setNotice(
        error instanceof LedgerMutationError && error.issues[0]
          ? error.message
          : error instanceof Error
            ? error.message
            : english
              ? 'Could not save the transaction.'
              : 'Không thể lưu giao dịch.',
      );
    }
  };

  const editTransaction = (transaction: LedgerTransaction) => {
    setEditingId(transaction.id);
    setDraft({
      date: transaction.date,
      side: transaction.side,
      companyId: transaction.companyId as MarketCompanyId,
      productId: transaction.productId,
      quantity: String(transaction.quantityLuong * 10),
      unit: 'chi',
      price: formatVndInput(
        portfolioUnitPriceFromLuong(transaction.unitPriceVnd, 'chi'),
      ),
      priceMode: 'manual',
      unitPriceVndPerLuong: transaction.unitPriceVnd,
      fees: transaction.feesVnd ? formatVndInput(transaction.feesVnd) : '',
      purchaseVenue: transaction.purchaseVenue ?? '',
      saleVenue: transaction.saleVenue ?? '',
      note: transaction.note ?? '',
    });
    window.setTimeout(
      () =>
        document
          .getElementById('so-vang-entry')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      0,
    );
  };

  const deleteTransaction = (id: string) => {
    const target = ledger.transactions.find(
      (transaction) => transaction.id === id,
    );
    if (target) setDeleteTarget(target);
  };

  const confirmDeleteTransaction = async () => {
    if (!deleteTarget) return;
    try {
      const next = removeLedgerTransaction(ledger, deleteTarget.id);
      if (await saveRemote(next)) {
        if (editingId === deleteTarget.id) resetDraft();
        setDeleteTarget(null);
      }
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : english
            ? 'Could not delete the transaction.'
            : 'Không thể xóa giao dịch.',
      );
    }
  };

  const handleImportedLedger = (next: PortfolioLedger | undefined) => {
    const value = next ?? EMPTY_LEDGER;
    return saveRemote(value);
  };

  if (authStatus === 'loading')
    return (
      <main className="tool-page-content">
        <p className="text-sm text-muted-foreground">
          {english ? 'Checking your account…' : 'Đang kiểm tra tài khoản…'}
        </p>
      </main>
    );
  if (authStatus !== 'authenticated')
    return (
      <main
        className="tool-page-content"
        aria-labelledby="portfolio-login-title"
      >
        <section className="glass-panel mx-auto max-w-2xl p-6 sm:p-8">
          <h1
            id="portfolio-login-title"
            className="font-heading text-2xl font-semibold"
          >
            {english
              ? 'Sign in to use your Gold Ledger'
              : 'Đăng nhập để sử dụng Sổ vàng'}
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {english
              ? 'Your transactions are stored with your Google account and available on your other devices.'
              : 'Giao dịch được lưu theo tài khoản Google và có thể sử dụng trên các thiết bị khác của bạn.'}
          </p>
          <Button
            type="button"
            className="mt-5"
            onClick={() => void signIn('google', { redirectTo: '/so-vang' })}
          >
            {english ? 'Sign in with Google' : 'Đăng nhập Google'}
          </Button>
        </section>
      </main>
    );

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="tool-page-content"
      aria-labelledby="portfolio-page-title"
    >
      <div className="tool-intro">
        <p className="tool-eyebrow">
          <span aria-hidden="true" />
          {english
            ? 'Private account ledger · Synced across your devices'
            : 'Sổ riêng theo tài khoản · Đồng bộ giữa các thiết bị'}
        </p>
        <h1 id="portfolio-page-title">
          {english ? 'Gold ledger' : 'Sổ vàng tích sản'}
        </h1>
        <p className="tool-description">
          {english
            ? 'Record real buy and sell transactions, see your holdings valued at dealer buyback prices, and keep a backup on this device.'
            : 'Ghi lại giao dịch mua bán thực tế, xem tài sản theo giá cửa hàng mua lại và chủ động sao lưu trên thiết bị này.'}
        </p>
      </div>

      <section
        className="glass-panel mb-6 p-5 sm:p-7"
        aria-labelledby="portfolio-summary-title"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-primary">
              <WalletCards className="size-4" aria-hidden="true" />
              {english ? 'Your holdings' : 'Tài sản của bạn'}
            </p>
            <h2
              id="portfolio-summary-title"
              className="mt-2 font-heading text-2xl font-semibold"
            >
              {summary.openQuantityLuong.toFixed(4)}{' '}
              {english ? 'lượng held' : 'lượng đang giữ'}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {english
                ? 'Values use each product’s dealer buyback quote.'
                : 'Giá trị dùng giá cửa hàng mua lại của từng sản phẩm.'}{' '}
              {quoteLoading ? (
                <RefreshCw
                  className="ml-1 inline size-3.5 animate-spin"
                  aria-label={
                    english ? 'Refreshing quotes' : 'Đang cập nhật giá'
                  }
                />
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/cong-cu-vang?tool=lai-lo#hoa-von"
              className="inline-flex min-h-10 items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 text-sm font-semibold text-primary"
            >
              {english ? 'Open calculator' : 'Mở tính lãi/lỗ'}
              <ArrowRight className="size-4" />
            </Link>
            {summary.transactionCount && !summary.errors.length ? (
              <Link
                href="/phan-tich?preset=hold"
                className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border bg-card/70 px-4 text-sm font-semibold"
              >
                {english ? 'Ask AI about this ledger' : 'Hỏi AI về sổ này'}
                <ArrowRight className="size-4" />
              </Link>
            ) : null}
          </div>
        </div>
        {hydrated && summary.transactionCount === 0 ? (
          <div className="mt-5 flex flex-col items-start gap-3 rounded-2xl border border-primary/20 bg-accent/60 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              {english
                ? 'Your ledger is empty. Add your first gold purchase to see how much you hold and its estimated value today.'
                : 'Sổ vàng đang trống. Hãy ghi lần mua đầu tiên để xem bạn đang giữ bao nhiêu vàng và giá trị ước tính hôm nay.'}
            </p>
            <Link
              href="/so-vang#so-vang-entry"
              className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground"
            >
              <Plus className="size-4" aria-hidden="true" />
              {english ? 'Add your first purchase' : 'Thêm lần mua đầu tiên'}
            </Link>
          </div>
        ) : null}
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            label={english ? 'Estimated value' : 'Giá trị ước tính'}
            value={
              summary.errors.length
                ? english
                  ? 'Review ledger'
                  : 'Cần sửa sổ'
                : formatVnd(summary.currentValueVnd, english)
            }
          />
          <SummaryCard
            label={
              english
                ? 'Amount paid for gold still held'
                : 'Tiền đã trả cho vàng đang giữ'
            }
            value={
              summary.errors.length
                ? english
                  ? 'Review ledger'
                  : 'Cần sửa sổ'
                : formatVnd(summary.openCostBasisVnd, english)
            }
          />
          <SummaryCard
            label={
              english ? 'Profit / loss from sales' : 'Lãi/lỗ từ vàng đã bán'
            }
            value={
              summary.errors.length
                ? english
                  ? 'Not verified'
                  : 'Chưa hợp lệ'
                : formatVnd(summary.realizedPnlVnd, english)
            }
            tone={
              summary.errors.length
                ? undefined
                : summary.realizedPnlVnd >= 0
                  ? 'positive'
                  : 'negative'
            }
          />
          <SummaryCard
            label={
              english
                ? 'Estimated profit / loss if sold today'
                : 'Ước tính nếu bán hôm nay'
            }
            value={
              summary.errors.length
                ? english
                  ? 'Not verified'
                  : 'Chưa hợp lệ'
                : formatVnd(summary.unrealizedPnlVnd, english)
            }
            tone={
              summary.errors.length || summary.unrealizedPnlVnd === null
                ? undefined
                : summary.unrealizedPnlVnd >= 0
                  ? 'positive'
                  : 'negative'
            }
          />
        </div>
        {summary.errors.length ? (
          <div className="mt-4 rounded-xl border border-amber-300/60 bg-amber-50/70 p-3 text-sm text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/20 dark:text-amber-100">
            <p className="font-semibold">
              {english
                ? 'Review ledger entries before trusting P&L'
                : 'Cần sửa sổ trước khi tin số lãi/lỗ'}
            </p>
            {summary.errors.map((error) => (
              <p key={error} className="mt-1">
                {error}
              </p>
            ))}
          </div>
        ) : null}
        {summary.positions.length ? (
          <div className="mt-6">
            <h3 className="font-heading text-lg font-semibold">
              {english ? 'Open positions' : 'Tài sản đang giữ'}
            </h3>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              {summary.positions.map((position) => (
                <div
                  key={`${position.companyId}:${position.productId}`}
                  className="rounded-[16px] border border-border bg-card/55 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">
                        {getMarketCompany(position.companyId).shortName}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {position.label}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-semibold ${summary.errors.length ? 'bg-amber-100 text-amber-800' : position.status === 'profit' ? 'bg-emerald-100 text-emerald-800' : position.status === 'loss' ? 'bg-red-100 text-red-800' : 'bg-muted text-muted-foreground'}`}
                    >
                      {summary.errors.length
                        ? english
                          ? 'Review ledger'
                          : 'Cần sửa sổ'
                        : position.status === 'profit'
                          ? english
                            ? 'Profit'
                            : 'Lãi'
                          : position.status === 'loss'
                            ? english
                              ? 'Loss'
                              : 'Lỗ'
                            : position.status === 'no-quote'
                              ? english
                                ? 'No quote'
                                : 'Chưa có giá'
                              : english
                                ? 'Flat'
                                : 'Hòa vốn'}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                    <p>
                      <span className="block text-xs text-muted-foreground">
                        {english ? 'Quantity' : 'Khối lượng'}
                      </span>
                      <strong>
                        {(position.quantityLuong * 10).toFixed(3)} chỉ
                      </strong>
                    </p>
                    <p>
                      <span className="block text-xs text-muted-foreground">
                        {english ? 'Average cost' : 'Giá vốn bình quân'}
                      </span>
                      <strong>
                        {formatVnd(position.averageCostPerLuongVnd, english)} /
                        lượng
                      </strong>
                    </p>
                    <p>
                      <span className="block text-xs text-muted-foreground">
                        {english ? 'Buyback value' : 'Giá trị mua lại'}
                      </span>
                      <strong>
                        {summary.errors.length
                          ? english
                            ? 'Not verified'
                            : 'Chưa hợp lệ'
                          : formatVnd(position.currentValueVnd, english)}
                      </strong>
                    </p>
                    <p>
                      <span className="block text-xs text-muted-foreground">
                        {english ? 'P&L' : 'Lãi/lỗ'}
                      </span>
                      <strong>
                        {summary.errors.length
                          ? english
                            ? 'Not verified'
                            : 'Chưa hợp lệ'
                          : formatVnd(position.unrealizedPnlVnd, english)}
                      </strong>
                    </p>
                  </div>
                  <Link
                    href={`/cong-cu-vang?tool=lai-lo&company=${position.companyId}&product=${position.productId}&quantity=${position.quantityLuong}&unit=luong&cost=${Math.round(position.averageCostPerLuongVnd)}${position.currentBuyVndPerLuong ? `&buyback=${Math.round(position.currentBuyVndPerLuong)}` : ''}#hoa-von`}
                    className="mt-4 inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-primary underline underline-offset-2"
                  >
                    {english ? 'Simulate selling' : 'Mô phỏng bán'}
                    <ArrowRight className="size-3.5" />
                  </Link>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section
        id="so-vang-entry"
        className="glass-panel mb-6 scroll-mt-24 p-5 sm:p-7"
        aria-labelledby="portfolio-entry-title"
      >
        <div className="flex items-start gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <Plus className="size-5" />
          </span>
          <div>
            <h2
              id="portfolio-entry-title"
              className="font-heading text-xl font-semibold"
            >
              {editingId
                ? english
                  ? 'Edit transaction'
                  : 'Sửa giao dịch'
                : english
                  ? 'Add a transaction'
                  : 'Thêm giao dịch'}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {english
                ? 'Prices are stored as VND per lượng. Quantity defaults to chỉ for easier daily entry.'
                : 'Giá được lưu theo VNĐ/lượng. Khối lượng mặc định là chỉ để nhập nhanh hằng ngày.'}
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-medium">
            {english ? 'Type' : 'Loại'}
            <select
              value={draft.side}
              onChange={(event) =>
                updateDraft('side', event.target.value as LedgerSide)
              }
              className="mt-1.5 block h-11 w-full rounded-[14px] border border-input bg-[var(--surface-solid)] px-3"
            >
              <option value="buy">{english ? 'Buy' : 'Mua'}</option>
              <option value="sell">{english ? 'Sell' : 'Bán'}</option>
            </select>
          </label>
          <label className="text-sm font-medium">
            {english ? 'Date' : 'Ngày'}
            <Input
              type="date"
              value={draft.date}
              onChange={(event) => updateDraft('date', event.target.value)}
              className="mt-1.5 h-11"
            />
          </label>
          <label className="text-sm font-medium">
            {english ? 'Brand' : 'Thương hiệu'}
            <select
              value={draft.companyId}
              onChange={(event) => {
                const companyId = event.target.value as MarketCompanyId;
                updateDraft('companyId', companyId);
                updateDraft(
                  'productId',
                  getDefaultMarketProduct(companyId)?.id ?? '',
                );
              }}
              className="mt-1.5 block h-11 w-full rounded-[14px] border border-input bg-[var(--surface-solid)] px-3"
            >
              {MARKET_COMPANIES.map((company) => (
                <option key={company.id} value={company.id}>
                  {presentMarketCompany(company, locale).name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            {english ? 'Product' : 'Sản phẩm'}
            <select
              value={selectedProduct?.id ?? ''}
              onChange={(event) => updateDraft('productId', event.target.value)}
              className="mt-1.5 block h-11 w-full rounded-[14px] border border-input bg-[var(--surface-solid)] px-3"
            >
              {products.map((product) => {
                const selectable = isMarketProductSelectable(product);
                const reason =
                  'unavailableReason' in product
                    ? product.unavailableReason
                    : undefined;
                return (
                  <option
                    key={product.id}
                    value={product.id}
                    disabled={!selectable}
                    title={reason}
                  >
                    {presentMarketProduct(product, locale).label}
                    {selectable
                      ? ''
                      : english
                        ? ' · unavailable'
                        : ' · chưa đủ báo giá'}
                  </option>
                );
              })}
            </select>
          </label>
          <label className="text-sm font-medium">
            {english ? 'Quantity' : 'Khối lượng'}
            <Input
              value={draft.quantity}
              onChange={(event) => updateDraft('quantity', event.target.value)}
              inputMode="decimal"
              placeholder={english ? 'For example: 2' : 'Ví dụ: 2'}
              className="mt-1.5 h-11"
            />
            <span className="mt-1 block text-xs font-normal text-muted-foreground">
              {units.find((unit) => unit.value === draft.unit)?.label}
            </span>
          </label>
          <label className="text-sm font-medium">
            {english ? 'Unit' : 'Đơn vị'}
            <select
              value={draft.unit}
              onChange={(event) =>
                updateDraft('unit', event.target.value as GoldUnit)
              }
              className="mt-1.5 block h-11 w-full rounded-[14px] border border-input bg-[var(--surface-solid)] px-3"
            >
              {units.map((unit) => (
                <option key={unit.value} value={unit.value}>
                  {unit.label}
                </option>
              ))}
            </select>
          </label>
          <div className="text-sm font-medium">
            <label htmlFor="ledger-actual-price">
              {english
                ? `Actual price / ${draft.unit === 'chi' ? 'chỉ' : 'lượng'} (VND)`
                : `Giá thực tế / ${draft.unit === 'chi' ? 'chỉ' : 'lượng'} (đ)`}
            </label>
            <Input
              id="ledger-actual-price"
              value={draft.price}
              onChange={(event) => updateManualPrice(event.target.value)}
              inputMode="numeric"
              placeholder={
                draft.unit === 'chi'
                  ? english
                    ? 'For example: 15,000,000'
                    : 'Ví dụ: 15.000.000'
                  : english
                    ? 'For example: 150,000,000'
                    : 'Ví dụ: 150.000.000'
              }
              className="mt-1.5 h-11"
            />
            <p
              className="mt-1 min-h-8 text-xs font-normal text-muted-foreground"
              aria-live="polite"
            >
              {draft.priceMode === 'manual'
                ? english
                  ? 'Manual price is kept when you change the selection.'
                  : 'Đang dùng giá bạn nhập; giá tay được giữ khi đổi lựa chọn.'
                : draftQuoteLoading
                  ? english
                    ? 'Loading the quote for this product and date…'
                    : 'Đang tải giá niêm yết đúng sản phẩm và ngày giao dịch…'
                  : activeDraftQuote?.status === 'unavailable'
                    ? (activeDraftQuote.reason ??
                      (english
                        ? 'No verified quote for this date. Enter the price manually.'
                        : 'Chưa có giá xác minh đúng ngày; vui lòng nhập tay.'))
                    : activeDraftQuote && quotedUnitPrice
                      ? draft.priceMode === 'listed'
                        ? `${
                            activeDraftQuote.status === 'current'
                              ? english
                                ? 'Current listed quote'
                                : 'Giá niêm yết hiện tại'
                              : english
                                ? 'Historical quote'
                                : 'Giá lịch sử'
                          } · ${
                            draft.side === 'buy'
                              ? english
                                ? 'dealer sell price'
                                : 'giá cửa hàng bán ra'
                              : english
                                ? 'dealer buy price'
                                : 'giá cửa hàng mua vào'
                          } · ${activeDraftQuote.source?.provider ?? ''} · ${
                            activeDraftQuote.quoteDate
                              ?.split('-')
                              .reverse()
                              .join('/') ?? ''
                          }`
                        : english
                          ? 'A quote is available. Enter a positive quantity to fill it automatically.'
                          : 'Đã có giá niêm yết; nhập khối lượng lớn hơn 0 để tự điền.'
                      : english
                        ? 'No verified quote for this date. Enter the price manually.'
                        : 'Chưa có báo giá xác minh đúng ngày; vui lòng nhập giá thủ công.'}
            </p>
            {activeDraftQuote &&
            activeDraftQuote.status !== 'unavailable' &&
            quotedUnitPrice ? (
              <Button
                type="button"
                variant="outline"
                className="mt-1 h-8 px-2 text-xs"
                onClick={useListedPrice}
              >
                {english ? 'Use listed price' : 'Dùng giá niêm yết'}
              </Button>
            ) : null}
            {draftGoldAmount !== null ? (
              <p className="mt-1 text-xs font-normal text-muted-foreground">
                {english ? 'Gold amount:' : 'Tiền vàng theo khối lượng:'}{' '}
                {formatVnd(draftGoldAmount, english)}.{' '}
                {english
                  ? 'Fees are entered separately.'
                  : 'Phí được nhập riêng.'}
              </p>
            ) : null}
          </div>
          <label className="text-sm font-medium">
            {english ? 'Fees (VND)' : 'Phí (đ)'}
            <Input
              value={draft.fees}
              onChange={(event) => updateDraft('fees', event.target.value)}
              inputMode="numeric"
              placeholder="0"
              className="mt-1.5 h-11"
            />
          </label>
          <label className="text-sm font-medium sm:col-span-2">
            {english ? 'Purchase venue (optional)' : 'Nơi mua (không bắt buộc)'}
            <Input
              value={draft.purchaseVenue}
              onChange={(event) =>
                updateDraft('purchaseVenue', event.target.value)
              }
              className="mt-1.5 h-11"
            />
          </label>
          <label className="text-sm font-medium sm:col-span-2">
            {english ? 'Sale venue (optional)' : 'Nơi bán (không bắt buộc)'}
            <Input
              value={draft.saleVenue}
              onChange={(event) => updateDraft('saleVenue', event.target.value)}
              className="mt-1.5 h-11"
            />
          </label>
          <label className="text-sm font-medium sm:col-span-4">
            {english ? 'Note (optional)' : 'Ghi chú (không bắt buộc)'}
            <Input
              value={draft.note}
              onChange={(event) => updateDraft('note', event.target.value)}
              className="mt-1.5 h-11"
            />
          </label>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={saving}
            onClick={() => void saveTransaction()}
          >
            {saving
              ? english
                ? 'Saving…'
                : 'Đang lưu…'
              : editingId
                ? english
                  ? 'Update transaction'
                  : 'Cập nhật giao dịch'
                : english
                  ? 'Save transaction'
                  : 'Lưu giao dịch'}
          </Button>
          {editingId ? (
            <Button type="button" variant="outline" onClick={resetDraft}>
              {english ? 'Cancel edit' : 'Hủy sửa'}
            </Button>
          ) : null}
        </div>
        {notice ? (
          <output className="mt-3 block text-sm text-primary">{notice}</output>
        ) : null}
      </section>

      <section
        className="glass-panel mb-6 p-5 sm:p-7"
        aria-labelledby="portfolio-history-title"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2
              id="portfolio-history-title"
              className="font-heading text-xl font-semibold"
            >
              {english ? 'Transaction history' : 'Lịch sử giao dịch'}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {visibleTransactions.length}/{summary.transactionCount}{' '}
              {english
                ? 'shown · profit and loss follows earlier purchases'
                : 'giao dịch đang hiện · lãi/lỗ tính theo các lần mua trước đó'}
            </p>
          </div>
        </div>
        {ledger.transactions.length ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-semibold">
              {english ? 'Type' : 'Loại'}
              <select
                value={historySide}
                onChange={(event) =>
                  setHistorySide(event.target.value as 'all' | LedgerSide)
                }
                className="mt-1 block h-10 w-full rounded-xl border border-input bg-[var(--surface-solid)] px-3 text-sm"
              >
                <option value="all">{english ? 'All' : 'Tất cả'}</option>
                <option value="buy">{english ? 'Buy' : 'Mua'}</option>
                <option value="sell">{english ? 'Sell' : 'Bán'}</option>
              </select>
            </label>
            <label className="text-xs font-semibold">
              {english ? 'Product' : 'Sản phẩm'}
              <select
                value={historyProduct}
                onChange={(event) => setHistoryProduct(event.target.value)}
                className="mt-1 block h-10 w-full rounded-xl border border-input bg-[var(--surface-solid)] px-3 text-sm"
              >
                <option value="all">
                  {english ? 'All products' : 'Tất cả sản phẩm'}
                </option>
                {historyProducts.map((transaction) => {
                  const product = getMarketProducts(transaction.companyId).find(
                    (candidate) => candidate.id === transaction.productId,
                  );
                  return (
                    <option
                      key={`${transaction.companyId}:${transaction.productId}`}
                      value={`${transaction.companyId}:${transaction.productId}`}
                    >
                      {
                        presentMarketCompany(
                          getMarketCompany(transaction.companyId),
                          locale,
                        ).shortName
                      }{' '}
                      ·{' '}
                      {product
                        ? presentMarketProduct(product, locale).shortLabel
                        : transaction.productId}
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="text-xs font-semibold">
              {english ? 'Month' : 'Tháng'}
              <Input
                type="month"
                value={historyMonth}
                onChange={(event) => setHistoryMonth(event.target.value)}
                className="mt-1 h-10"
              />
            </label>
          </div>
        ) : null}
        {!ledger.transactions.length ? (
          <p className="mt-5 rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
            {english
              ? 'No transactions yet. Add your first purchase above or restore a backup below.'
              : 'Chưa có giao dịch. Hãy thêm lần mua đầu tiên ở trên hoặc khôi phục bản sao lưu bên dưới.'}
          </p>
        ) : !visibleTransactions.length ? (
          <p className="mt-5 rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
            {english
              ? 'No transactions match these filters.'
              : 'Không có giao dịch phù hợp với bộ lọc.'}
          </p>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-muted text-xs">
                <tr>
                  <th className="p-3">{english ? 'Date' : 'Ngày'}</th>
                  <th className="p-3">{english ? 'Type' : 'Loại'}</th>
                  <th className="p-3">{english ? 'Product' : 'Sản phẩm'}</th>
                  <th className="p-3 text-right">
                    {english ? 'Quantity' : 'Khối lượng'}
                  </th>
                  <th className="p-3 text-right">
                    {english ? 'Unit price' : 'Đơn giá'}
                  </th>
                  <th className="p-3 text-right">
                    {english ? 'Actions' : 'Thao tác'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleTransactions.map((transaction) => {
                  const product = getMarketProducts(transaction.companyId).find(
                    (candidate) => candidate.id === transaction.productId,
                  );
                  return (
                    <tr
                      key={transaction.id}
                      className="border-t border-border align-top"
                    >
                      <td className="p-3">{transaction.date}</td>
                      <td className="p-3">
                        {ledgerSideLabel(transaction.side, locale)}
                      </td>
                      <td className="p-3">
                        <span className="font-semibold">
                          {
                            presentMarketCompany(
                              getMarketCompany(transaction.companyId),
                              locale,
                            ).shortName
                          }
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {product
                            ? presentMarketProduct(product, locale).label
                            : transaction.productId}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        {(transaction.quantityLuong * 10).toFixed(3)} chỉ
                      </td>
                      <td className="p-3 text-right">
                        {formatVnd(transaction.unitPriceVnd, english)}
                      </td>
                      <td className="p-3">
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={
                              english ? 'Edit transaction' : 'Sửa giao dịch'
                            }
                            onClick={() => editTransaction(transaction)}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={
                              english ? 'Delete transaction' : 'Xóa giao dịch'
                            }
                            onClick={() => deleteTransaction(transaction.id)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {legacyLedger ? (
        <section
          className="glass-panel mb-6 border-primary/30 p-5 sm:p-7"
          aria-live="polite"
        >
          <h2 className="font-heading text-xl font-semibold">
            {english
              ? 'Import your previous device ledger?'
              : 'Nhập Sổ vàng cũ trên thiết bị?'}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {english
              ? `We found ${legacyLedger.transactions.length} transaction(s) saved on this device. Review them before adding them to ${account}.`
              : `Tìm thấy ${legacyLedger.transactions.length} giao dịch trên thiết bị. Hãy xác nhận trước khi nhập vào tài khoản ${account}.`}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => void importLegacyLedger()}
              disabled={saving}
            >
              {english ? 'Import into my account' : 'Nhập vào tài khoản'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={discardLegacyPrompt}
            >
              {english ? 'Keep local copy' : 'Giữ bản trên thiết bị'}
            </Button>
          </div>
        </section>
      ) : null}
      {hydrated ? (
        <LedgerBackup
          account={account}
          ledger={ledger}
          disabled={saving}
          locale={locale}
          onChange={handleImportedLedger}
        />
      ) : (
        <div className="h-16" aria-hidden="true" />
      )}
      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {english ? 'Delete this transaction?' : 'Xóa giao dịch này?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? english
                  ? `Delete the ${ledgerSideLabel(deleteTarget.side, 'en').toLowerCase()} dated ${deleteTarget.date}? The ledger will be rechecked before saving.`
                  : `Xóa giao dịch ${ledgerSideLabel(deleteTarget.side, 'vi')} ngày ${deleteTarget.date}? Sổ sẽ được kiểm tra lại trước khi lưu.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{english ? 'Cancel' : 'Hủy'}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteTransaction}>
              {english ? 'Delete transaction' : 'Xóa giao dịch'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        {english
          ? 'Your account ledger is saved on the server. A local cache keeps the latest copy visible while offline; drafts are not confirmed until the server saves them.'
          : 'Sổ theo tài khoản được lưu trên máy chủ. Bản cache cục bộ giúp xem bản mới nhất khi mất mạng; giao dịch chỉ được xác nhận sau khi máy chủ lưu thành công.'}
      </p>
    </main>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'negative';
}) {
  return (
    <div className="rounded-[16px] border border-border bg-card/55 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p
        className={`mt-1 font-heading text-xl font-semibold ${tone === 'positive' ? 'text-emerald-700' : tone === 'negative' ? 'text-red-700' : ''}`}
      >
        {value}
      </p>
    </div>
  );
}
