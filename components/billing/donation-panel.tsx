'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  CheckCircle2,
  Clipboard,
  Download,
  Heart,
  LoaderCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatVnd } from '@/lib/billing/plans';
import { useLocale } from '@/components/locale-provider';

type DonationOrder = {
  id: string;
  accessToken: string | null;
  amountVnd: number;
  orderCode: string;
  createdAt: string;
  serverTime: string;
  displayName: string | null;
  isAnonymous: boolean;
  status: 'pending' | 'paid' | 'needs_review' | 'expired' | 'cancelled';
  expiresAt: string;
  paidAt: string | null;
  qrUrl: string | null;
  bankCode: string;
  accountNumber: string;
  accountHolder: string;
};

type LeaderboardRow = {
  rank: number;
  displayName: string;
  amountVnd: number;
};

type DonationSummary = {
  month: string;
  donationCount: number;
  amountVnd: number;
  operatingCostVnd: number | null;
  updatedAt: string;
};

const presets = [20_000, 50_000, 100_000];
const subscribeToHydration = () => () => {};
const getHydratedSnapshot = () => true;
const getServerHydratedSnapshot = () => false;

function formatDate(value: string | null, locale: 'vi' | 'en' = 'vi') {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function DonationPanel() {
  const { locale } = useLocale();
  const english = locale === 'en';
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    getHydratedSnapshot,
    getServerHydratedSnapshot,
  );
  const [amount, setAmount] = useState(50_000);
  const [customAmount, setCustomAmount] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [displayName, setDisplayName] = useState('');
  const [order, setOrder] = useState<DonationOrder | null>(null);
  const [previousOrder, setPreviousOrder] = useState<DonationOrder | null>(
    null,
  );
  const [clockMs, setClockMs] = useState(0);
  const [editingName, setEditingName] = useState(false);
  const [replacementName, setReplacementName] = useState('');
  const [replacementAnonymous, setReplacementAnonymous] = useState(false);
  const [leaderboardPeriod, setLeaderboardPeriod] = useState<'month' | 'all'>(
    'month',
  );
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [summary, setSummary] = useState<DonationSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [statusError, setStatusError] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [leaderboardLoading, setLeaderboardLoading] = useState(true);
  const [leaderboardError, setLeaderboardError] = useState(false);
  const leaderboardAbortRef = useRef<AbortController | null>(null);
  const leaderboardRequestRef = useRef(0);
  const leaderboardPeriodRef = useRef(leaderboardPeriod);
  const leaderboardHasRowsRef = useRef(false);
  const displayNameInputRef = useRef<HTMLInputElement>(null);
  const orderId = order?.id;
  const orderStatus = order?.status;
  const expiryMs = order ? new Date(order.expiresAt).getTime() : null;
  const remainingMs =
    expiryMs === null ? null : Math.max(0, expiryMs - clockMs);
  const isOrderExpired =
    order?.status === 'expired' ||
    (order?.status === 'pending' && remainingMs === 0);

  const formatCountdown = (value: number | null) => {
    if (value === null) return '—';
    const totalSeconds = Math.ceil(value / 1_000);
    return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
  };

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const refresh = async () => {
      if (cancelled || inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      try {
        const response = await fetch('/api/donations/summary', {
          cache: 'no-store', signal: AbortSignal.timeout(10_000),
        });
        const body = (await response.json()) as { summary?: DonationSummary | null };
        if (!cancelled && response.ok) setSummary(body.summary ?? null);
      } catch {
        // Keep the last confirmed totals while the next refresh retries.
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 3_000);
    const onVisible = () => void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [orderStatus, previousOrder?.status, refreshVersion]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const savedName = window.localStorage.getItem('kim-tuyen-donation-name-draft') ?? '';
        setDisplayName(savedName);
        setReplacementName(savedName);
        setEditingName(Boolean(savedName));
        setClockMs(Date.now());
      } catch {
        setClockMs(Date.now());
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (order?.id)
      window.localStorage.setItem('kim-tuyen-donation-order', order.id);
    if (order?.accessToken)
      window.localStorage.setItem(
        'kim-tuyen-donation-access-token',
        order.accessToken,
      );
  }, [order?.accessToken, order?.id]);

  useEffect(() => {
    if (!order?.serverTime) return;
    const offset = new Date(order.serverTime).getTime() - Date.now();
    const update = () => setClockMs(Date.now() + offset);
    update();
    const interval = window.setInterval(update, 1_000);
    return () => window.clearInterval(interval);
  }, [order?.serverTime]);

  useEffect(() => {
    if (order) return;
    let cancelled = false;
    const savedId = window.localStorage.getItem('kim-tuyen-donation-order');
    const savedToken = window.localStorage.getItem(
      'kim-tuyen-donation-access-token',
    );
    if (!savedId) return;
    void fetch(`/api/donations/orders/${savedId}`, {
      cache: 'no-store',
      headers: savedToken ? { 'X-Donation-Token': savedToken } : undefined,
    })
      .then(async (response) => {
        const body = (await response.json()) as { order?: DonationOrder };
        if (!cancelled && response.ok && body.order)
          setOrder((current) => current ?? {
            ...body.order!, accessToken: body.order!.accessToken ?? savedToken,
          });
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [order]);

  useEffect(() => {
    window.localStorage.setItem('kim-tuyen-donation-name-draft', displayName);
  }, [displayName]);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const periodChanged = leaderboardPeriodRef.current !== leaderboardPeriod;
    leaderboardPeriodRef.current = leaderboardPeriod;
    if (periodChanged) {
      setLeaderboard([]);
      setLeaderboardError(false);
      leaderboardHasRowsRef.current = false;
    }
    if (periodChanged || !leaderboardHasRowsRef.current)
      setLeaderboardLoading(true);

    const refreshLeaderboard = async () => {
      if (cancelled || inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      leaderboardAbortRef.current?.abort();
      const controller = new AbortController();
      leaderboardAbortRef.current = controller;
      const requestId = ++leaderboardRequestRef.current;
      try {
        const response = await fetch(
          `/api/donations/leaderboard?period=${leaderboardPeriod}`,
          { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) },
        );
        const body = (await response.json()) as { rows?: LeaderboardRow[] };
        if (!response.ok) throw new Error('leaderboard_unavailable');
        if (cancelled || requestId !== leaderboardRequestRef.current) return;
        setLeaderboard(body.rows ?? []);
        leaderboardHasRowsRef.current = Boolean(body.rows?.length);
        setLeaderboardError(false);
      } catch (error) {
        if (
          cancelled ||
          requestId !== leaderboardRequestRef.current ||
          (error instanceof DOMException && error.name === 'AbortError')
        )
          return;
        setLeaderboardError(true);
      } finally {
        inFlight = false;
        if (!cancelled && requestId === leaderboardRequestRef.current)
          setLeaderboardLoading(false);
      }
    };

    void refreshLeaderboard();
    const interval = window.setInterval(() => void refreshLeaderboard(), 3_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshLeaderboard();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      leaderboardAbortRef.current?.abort();
    };
  }, [leaderboardPeriod, order?.status, previousOrder?.status, refreshVersion]);

  useEffect(() => {
    // The bank's transaction time determines acceptance. A webhook can arrive
    // after the QR expires, so expiration must not stop reconciliation checks.
    const pollableStatuses = new Set(['pending', 'needs_review', 'expired']);
    const pollableIds = [
      orderStatus && pollableStatuses.has(orderStatus) ? orderId : null,
      previousOrder?.status && pollableStatuses.has(previousOrder.status)
        ? previousOrder.id
        : null,
    ].filter((id): id is string => Boolean(id));
    if (!pollableIds.length) return;
    let cancelled = false;
    let inFlight = false;
    const controller = new AbortController();
    const checkStatus = async () => {
      if (cancelled || inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      try {
        for (const pendingId of pollableIds) {
          const tokenKey =
            pendingId === orderId
              ? 'kim-tuyen-donation-access-token'
              : 'kim-tuyen-donation-previous-token';
          const token = window.localStorage.getItem(tokenKey);
          const response = await fetch(
            `/api/donations/orders/${pendingId}`,
            {
              cache: 'no-store',
              headers: token ? { 'X-Donation-Token': token } : undefined,
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
            },
          );
          const body = (await response.json()) as {
            order?: DonationOrder;
            error?: string;
          };
          if (cancelled) return;
          if (!response.ok)
            throw new Error(body.error ?? (english ? 'Unable to read order status.' : 'Không đọc được trạng thái.'));
          if (!body.order) continue;
          setStatusError(false);
          const received = { ...body.order, accessToken: body.order.accessToken ?? token };
          if (received.id === orderId)
            setOrder((current) => current?.id === received.id ? received : current);
          if (received.id === previousOrder?.id)
            setPreviousOrder((current) => current?.id === received.id ? received : current);
          if (body.order.status === 'paid')
            setNotice(
              body.order.id === previousOrder?.id
                ? (english ? 'The contribution using the previous code was confirmed.' : 'Khoản ủng hộ theo mã cũ đã được xác nhận.')
                : (english ? 'Thank you. Your contribution was confirmed.' : 'Cảm ơn bạn. Khoản ủng hộ đã được xác nhận.'),
            );
          if (body.order.status === 'expired' && body.order.id === orderId)
            setNotice(english ? 'The QR expired. If you already transferred, we are still checking confirmation; do not pay again.' : 'Mã QR đã hết hạn. Nếu bạn đã chuyển tiền, hệ thống vẫn kiểm tra xác nhận; vui lòng không chuyển lại.');
        }
      } catch {
        if (!cancelled) setStatusError(true);
      } finally {
        inFlight = false;
      }
    };
    void checkStatus();
    const onlyExpired = [orderStatus, previousOrder?.status]
      .filter((status) => status && pollableStatuses.has(status))
      .every((status) => status === 'expired');
    const interval = window.setInterval(() => void checkStatus(), onlyExpired ? 30_000 : 3_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkStatus();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [english, orderId, orderStatus, previousOrder?.id, previousOrder?.status, refreshVersion]);

  const createOrder = async (presetAmount?: number) => {
    const selectedAmount =
      presetAmount ??
      (customAmount ? Number(customAmount.replace(/[^0-9]/g, '')) : amount);
    if (!Number.isSafeInteger(selectedAmount) || selectedAmount < 1_000) {
      setNotice(english ? 'Enter an amount of at least 1,000 VND.' : 'Vui lòng nhập số tiền từ 1.000đ.');
      return;
    }
    const normalizedName = (
      displayNameInputRef.current?.value ?? displayName
    ).trim();
    if (!isAnonymous && !normalizedName) {
      setNotice(english ? 'Enter a display name or choose anonymous.' : 'Vui lòng nhập tên hiển thị hoặc chọn ẩn danh.');
      return;
    }
    setLoading(true);
    setNotice('');
    try {
      const response = await fetch('/api/donations/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountVnd: selectedAmount,
          isAnonymous,
          displayName: isAnonymous ? null : normalizedName,
        }),
      });
      const body = (await response.json()) as {
        order?: DonationOrder;
        error?: string;
      };
      if (!response.ok || !body.order)
        throw new Error(body.error ?? (english ? 'Unable to create a QR code.' : 'Không tạo được mã QR.'));
      if (order && order.id !== body.order.id) {
        setPreviousOrder(order);
        if (order.accessToken)
          window.localStorage.setItem(
            'kim-tuyen-donation-previous-token',
            order.accessToken,
          );
      }
      setOrder(body.order);
      setDisplayName(normalizedName);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : (english ? 'Unable to create a QR code.' : 'Không tạo được mã QR.'),
      );
    } finally {
      setLoading(false);
    }
  };

  const updateOrderDetails = async () => {
    if (!order || (!replacementAnonymous && !replacementName.trim())) {
      setNotice(english ? 'Enter a display name or choose anonymous.' : 'Vui lòng nhập tên hiển thị hoặc chọn ẩn danh.');
      return;
    }
    setLoading(true);
    setNotice('');
    try {
      const response = await fetch(`/api/donations/orders/${order.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(order.accessToken
            ? { 'X-Donation-Token': order.accessToken }
            : {}),
        },
        body: JSON.stringify({
          isAnonymous: replacementAnonymous,
          displayName: replacementAnonymous ? null : replacementName.trim(),
        }),
      });
      const body = (await response.json()) as {
        order?: DonationOrder;
        error?: string;
      };
      if (!response.ok || !body.order)
        throw new Error(body.error ?? (english ? 'Unable to save display details.' : 'Không thể lưu thông tin hiển thị.'));
      setOrder({
        ...body.order,
        accessToken: body.order.accessToken ?? order.accessToken,
      });
      setEditingName(false);
      setDisplayName(body.order.displayName ?? '');
      setIsAnonymous(body.order.isAnonymous);
      setNotice(english ? 'Display details were saved to this order.' : 'Đã lưu thông tin hiển thị trên đơn hiện tại.');
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : (english ? 'Unable to save display details.' : 'Không thể lưu thông tin hiển thị.'),
      );
    } finally {
      setLoading(false);
    }
  };

  const copy = async (value: string, message: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(message);
    } catch {
      setNotice(value);
    }
  };

  return (
    <div data-donation-hydrated={hydrated ? 'true' : 'false'} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <section className="glass-panel tool-panel p-5 sm:p-7">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-accent text-accent-foreground">
            <Heart className="size-5" />
          </span>
          <div>
            <h2 className="font-heading text-xl font-semibold">
              {english ? 'Voluntary support' : 'Ủng hộ tự nguyện'}
            </h2>
            <p className="text-xs text-muted-foreground">
              {english ? 'Does not unlock uses or features.' : 'Không mở khóa lượt hay tính năng.'}
            </p>
          </div>
        </div>
        <p className="mt-5 text-sm leading-6 text-muted-foreground">
          {english ? 'Gold-price tools, comparison, and basic calculations remain free. Contributions help maintain data sources, hosting, and experimental AI usage.' : 'Các công cụ giá vàng, so sánh và tính toán cơ bản vẫn miễn phí. Khoản ủng hộ giúp duy trì nguồn dữ liệu, hosting và các lượt AI thử nghiệm.'}
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          {presets.map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              className="min-h-11 rounded-full px-5"
              disabled={loading}
              aria-pressed={!customAmount && amount === value}
              variant={
                !customAmount && amount === value ? 'default' : 'outline'
              }
              onClick={() => {
                setAmount(value);
                setCustomAmount('');
              }}
            >
              {english ? 'Support' : 'Ủng hộ'} {formatVnd(value)}
            </Button>
          ))}
        </div>
        <label
          className="mt-4 block text-xs font-medium"
          htmlFor="donation-amount"
        >
          {english ? 'Other amount' : 'Số tiền khác'}
          <Input
            id="donation-amount"
            inputMode="numeric"
            min={1_000}
            value={customAmount}
            onChange={(event) => setCustomAmount(event.target.value)}
            placeholder={english ? 'For example: 20000' : 'Ví dụ: 20000'}
            className="mt-1.5 h-11"
          />
        </label>
        <Input
          ref={displayNameInputRef}
          value={displayName}
          disabled={isAnonymous}
          onChange={(event) => setDisplayName(event.target.value)}
          maxLength={120}
          placeholder={english ? 'Display name on the thank-you board' : 'Tên hiển thị trên bảng tri ân'}
          className="mt-3 h-11"
        />
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isAnonymous}
            onChange={(event) => setIsAnonymous(event.target.checked)}
            className="size-4 accent-[var(--gold)]"
          />
          {english ? 'Support anonymously — do not display my name on the board' : 'Ủng hộ ẩn danh — không hiển thị tên trên bảng'}
        </label>
        <Button
          type="button"
          className="mt-5 w-full sm:w-auto"
          disabled={loading}
          onClick={() => void createOrder()}
        >
          {loading ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Heart className="size-4" />
          )}
          {english ? 'Create support QR code' : 'Tạo mã QR ủng hộ'}
        </Button>

        {order ? (
          <div className="mt-6 rounded-2xl border border-accent bg-accent/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold">{formatVnd(order.amountVnd)}</p>
                {order.displayName ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {english ? 'Display name' : 'Tên hiển thị'}: {order.displayName}
                  </p>
                ) : null}
              </div>
              {order.status === 'paid' ? (
                <CheckCircle2 className="size-5 text-emerald-700" />
              ) : null}
            </div>
            {order.status === 'pending' && !isOrderExpired ? (
              <div className="mt-4 flex flex-col gap-4 sm:flex-row">
                {order.qrUrl ? (
                  // oxlint-disable-next-line next/no-img-element
                  <img
                    src={order.qrUrl}
                    alt={english ? 'Kim Tuyến support QR code' : 'QR ủng hộ Kim Tuyến'}
                    className="size-48 rounded-lg bg-white p-1"
                  />
                ) : null}
                <div className="space-y-2 text-xs leading-5 text-muted-foreground">
                  <p>{english ? 'Transfer the exact amount and use this code:' : 'Chuyển đúng số tiền và ghi mã:'}</p>
                  <p className="font-semibold text-foreground">
                    {order.orderCode}
                  </p>
                  <p>
                    {order.bankCode} · {order.accountNumber}
                  </p>
                  <p>{order.accountHolder}</p>
                  <p>
                    {english ? 'Expires' : 'Hết hạn'}: {formatDate(order.expiresAt, locale)} · {english ? 'remaining' : 'còn'}{' '}
                    <strong className="text-foreground">
                      {formatCountdown(remainingMs)}
                    </strong>
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void copy(order.orderCode, english ? 'Support code copied.' : 'Đã sao chép mã ủng hộ.')
                      }
                    >
                      <Clipboard className="size-3.5" /> {english ? 'Copy code' : 'Sao chép mã'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void copy(
                          `${order.accountNumber} ${order.accountHolder}`,
                          english ? 'Account details copied.' : 'Đã sao chép thông tin tài khoản.',
                        )
                      }
                    >
                      <Clipboard className="size-3.5" /> {english ? 'Account' : 'Tài khoản'}
                    </Button>
                    {order.qrUrl ? (
                      <a
                        href={order.qrUrl}
                        download={`kim-tuyen-${order.orderCode}.png`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground"
                      >
                        <Download className="size-3.5" /> {english ? 'Save QR' : 'Lưu QR'}
                      </a>
                    ) : null}
                    <span className="self-center">{english ? 'Waiting for confirmation…' : 'Đang chờ xác nhận…'}</span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="px-0 text-left text-xs text-accent-foreground"
                    onClick={() => {
                      setReplacementName(order.displayName ?? '');
                      setReplacementAnonymous(order.isAnonymous);
                      setEditingName(true);
                    }}
                  >
                    {english ? 'Edit display details' : 'Sửa thông tin hiển thị'}
                  </Button>
                </div>
              </div>
            ) : isOrderExpired ? (
              <div className="mt-4 rounded-xl bg-muted/60 p-4 text-sm">
                <p className="font-semibold">{english ? 'The QR code has expired.' : 'Mã QR đã hết hạn.'}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {english ? 'If you already transferred, do not pay again. We are still checking confirmation for this code. Create a new code only if you have not transferred.' : 'Nếu bạn đã chuyển tiền, vui lòng không chuyển lại. Hệ thống vẫn kiểm tra xác nhận cho mã này. Chỉ tạo mã mới nếu bạn chưa chuyển khoản.'}
                </p>
                <Button
                  type="button"
                  size="sm"
                  className="mt-3"
                  disabled={loading}
                  onClick={() => void createOrder(order.amountVnd)}
                >
                  {english ? 'Create a new code' : 'Tạo mã mới'}
                </Button>
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                {order.status === 'paid'
                  ? (english ? `Confirmed at ${formatDate(order.paidAt, locale)}.` : `Đã xác nhận lúc ${formatDate(order.paidAt, locale)}.`)
                  : english ? `Order status: ${order.status}.` : `Đơn đang ở trạng thái ${order.status}.`}
              </p>
            )}
            {['pending', 'expired', 'needs_review'].includes(order.status) ? (
              <div className="mt-3 text-xs">
                {statusError ? (
                  <output className="mb-2 block text-muted-foreground">
                    {english ? 'Unable to check payment status. Your order is saved; please retry.' : 'Chưa kiểm tra được trạng thái thanh toán. Đơn đã được lưu; bạn có thể thử lại.'}
                  </output>
                ) : null}
                <Button type="button" size="sm" variant="outline" onClick={() => setRefreshVersion((version) => version + 1)}>
                  {english ? 'Check payment' : 'Kiểm tra thanh toán'}
                </Button>
              </div>
            ) : null}
            {editingName ? (
              <div className="mt-4 rounded-xl border border-border bg-card p-4">
                <p className="text-sm font-semibold">
                  {english ? 'Display name on the thank-you board' : 'Tên hiển thị trên bảng tri ân'}
                </p>
                <Input
                  value={replacementName}
                  disabled={replacementAnonymous}
                  onChange={(event) => {
                    const value = event.target.value;
                    setReplacementName(value);
                    window.localStorage.setItem(
                      'kim-tuyen-donation-name-draft',
                      value,
                    );
                  }}
                  maxLength={120}
                  placeholder={english ? 'For example: Nguyen Van A' : 'Ví dụ: Nguyễn Văn A'}
                  className="mt-2 h-11"
                />
                <label className="mt-3 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={replacementAnonymous}
                    onChange={(event) =>
                      setReplacementAnonymous(event.target.checked)
                    }
                    className="size-4 accent-[var(--gold)]"
                  />
                  {english ? 'Support anonymously — do not display my name on the board' : 'Ủng hộ ẩn danh — không hiển thị tên trên bảng'}
                </label>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {english ? 'This information is saved to the current QR code.' : 'Thông tin sẽ được lưu trên chính mã QR hiện tại.'}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={
                      loading ||
                      (!replacementAnonymous && !replacementName.trim())
                    }
                    onClick={() => void updateOrderDetails()}
                  >
                    {english ? 'Save display details' : 'Lưu thông tin hiển thị'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setEditingName(false)}
                  >
                    {english ? 'Cancel' : 'Hủy'}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {notice ? (
          <p role="alert" className="mt-4 text-xs text-amber-800">
            {notice}
          </p>
        ) : null}
      </section>

      <aside className="self-stretch">
        <section
          className="glass-panel flex h-auto min-h-0 flex-col p-5 sm:p-6 lg:h-full lg:min-h-[420px]"
          aria-labelledby="donation-leaderboard-title"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-foreground">
                {english ? 'Community' : 'Cộng đồng'}
              </p>
              <h2
                id="donation-leaderboard-title"
                className="mt-1 font-heading text-xl font-semibold"
              >
                {english ? 'Community supporters' : 'Người đồng hành'}
              </h2>
            </div>
            <span className="text-xs text-muted-foreground">Top 10</span>
          </div>
          {summary ? (
            <>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-xl border border-border/70 bg-muted/50 p-3">
                <span className="block text-muted-foreground">{english ? 'Received this month' : 'Đã nhận tháng này'}</span>
                <strong className="mt-1 block text-sm">{formatVnd(summary.amountVnd)}</strong>
              </div>
              <div className="rounded-xl border border-border/70 bg-muted/50 p-3">
                <span className="block text-muted-foreground">{english ? 'Reconciled contributions' : 'Khoản đã đối soát'}</span>
                <strong className="mt-1 block text-sm">{summary.donationCount}</strong>
              </div>
            </div>
            <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
              {summary.operatingCostVnd === null
                ? (english ? 'Operating cost reconciliation has not been published yet.' : 'Chưa công bố chi phí vận hành đã đối soát.')
                : (english ? `Reconciled operating cost: ${formatVnd(summary.operatingCostVnd)}.` : `Chi phí vận hành đã đối soát: ${formatVnd(summary.operatingCostVnd)}.`)}{' '}
              {english ? 'Next: keep price sources and free tools available.' : 'Mục tiêu tiếp theo: duy trì nguồn giá và công cụ miễn phí.'}
            </p>
            </>
          ) : null}
          <div className="mt-4 grid grid-cols-2 rounded-xl bg-muted/60 p-1 text-xs font-semibold">
            {(['month', 'all'] as const).map((period) => (
              <button
                key={period}
                type="button"
                className={`min-h-10 rounded-lg px-2 ${leaderboardPeriod === period ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}
                onClick={() => setLeaderboardPeriod(period)}
              >
                {period === 'month' ? (english ? 'This month' : 'Tháng này') : (english ? 'All time' : 'Toàn thời gian')}
              </button>
            ))}
          </div>
          <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
            {leaderboardLoading && !leaderboard.length ? (
              <div
                className="mt-4 space-y-2"
                aria-label={english ? 'Loading leaderboard' : 'Đang tải bảng xếp hạng'}
              >
                {Array.from({ length: 4 }, (_, index) => (
                  <span key={index} className="ui-skeleton block h-10" />
                ))}
              </div>
            ) : leaderboard.length ? (
              <>
                {leaderboardError ? (
                  <p
                  className="mb-3 rounded-[16px] border border-border/70 bg-muted/50 p-3 text-center text-xs leading-5 text-muted-foreground"
                    aria-live="polite"
                  >
                    {english ? 'New data has not synced yet. Retrying automatically.' : 'Chưa đồng bộ được dữ liệu mới. Đang tự thử lại.'}
                  </p>
                ) : null}
                <ol className="space-y-2">
                  {leaderboard.map((row) => (
                    <li
                      key={`${row.rank}-${row.displayName}`}
                      className="flex items-center gap-3 rounded-[16px] border border-border/70 bg-card/45 px-3 py-2.5 text-sm"
                    >
                      <span
                        className={`grid size-7 place-items-center rounded-full text-xs font-bold ${row.rank <= 3 ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'}`}
                      >
                        {row.rank}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {row.displayName}
                      </span>
                      <span className="shrink-0 text-xs font-semibold text-accent-foreground">
                        {formatVnd(row.amountVnd)}
                      </span>
                    </li>
                  ))}
                </ol>
              </>
            ) : leaderboardError ? (
              <p
                className="mt-5 rounded-[16px] border border-border/70 bg-muted/50 p-4 text-center text-xs leading-5 text-muted-foreground"
                aria-live="polite"
              >
                {english ? 'The leaderboard could not load. Retrying automatically.' : 'Chưa thể tải bảng xếp hạng. Đang tự thử lại.'}
              </p>
            ) : (
              <div className="flex h-full min-h-48 items-center justify-center rounded-[16px] border border-border/70 bg-muted/50 p-4 text-center text-xs leading-5 text-muted-foreground">
                {english ? 'There are no public contributions in this period yet.' : 'Chưa có khoản ủng hộ công khai trong kỳ này.'}
              </div>
            )}
          </div>
          <p className="mt-4 text-[11px] leading-5 text-muted-foreground">
            {english ? 'Display names are provided by supporters.' : 'Tên hiển thị là thông tin do người ủng hộ tự nhập.'}
          </p>
        </section>
      </aside>
    </div>
  );
}
