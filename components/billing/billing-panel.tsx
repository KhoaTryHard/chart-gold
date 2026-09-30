'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import {
  formatPlanDate,
  formatVnd,
  BETA_PAID_PLANS,
  PLAN_CATALOG,
  type EntitlementView,
  type PaidPlanCode,
} from '@/lib/billing/plans';

type PaymentOrder = {
  id: string;
  plan: PaidPlanCode;
  planName: string;
  amountVnd: number;
  orderCode: string;
  status: 'pending' | 'paid' | 'needs_review' | 'expired' | 'cancelled';
  expiresAt: string;
  paidAt: string | null;
  qrUrl: string | null;
};

export function BillingPanel({
  onEntitlementChange,
  entitlementOverride,
}: {
  onEntitlementChange: (entitlement: EntitlementView | undefined) => void;
  entitlementOverride?: EntitlementView;
}) {
  const [enabled, setEnabled] = useState(false);
  const [salesEnabled, setSalesEnabled] = useState(false);
  const [entitlement, setEntitlement] = useState<EntitlementView>();
  const [order, setOrder] = useState<PaymentOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<PaidPlanCode | null>(null);
  const [notice, setNotice] = useState('');
  const [panelOpen, setPanelOpen] = useState(true);

  const applyEntitlement = useCallback(
    (value: EntitlementView | undefined) => {
      setEntitlement(value);
      onEntitlementChange(value);
    },
    [onEntitlementChange],
  );

  const loadEntitlement = useCallback(async () => {
    try {
      const response = await fetch('/api/account/entitlements', {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const body = (await response.json()) as {
        billingEnabled?: boolean;
        salesEnabled?: boolean;
        entitlement?: EntitlementView;
        error?: string;
      };
      if (!response.ok)
        throw new Error(body.error ?? 'Không tải được quyền AI.');
      setEnabled(body.billingEnabled === true);
      setSalesEnabled(body.salesEnabled === true);
      applyEntitlement(body.entitlement);
      return body.entitlement;
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Không tải được quyền AI.',
      );
      return undefined;
    } finally {
      setLoading(false);
    }
  }, [applyEntitlement]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadEntitlement(), 0);
    return () => window.clearTimeout(timer);
  }, [loadEntitlement]);

  useEffect(() => {
    if (!order || order.status !== 'pending') return;
    const interval = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/billing/orders/${order.id}`, {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        const body = (await response.json()) as {
          order?: PaymentOrder;
          error?: string;
        };
        if (!response.ok)
          throw new Error(body.error ?? 'Không đọc được trạng thái đơn.');
        if (!body.order) return;
        setOrder(body.order);
        if (body.order.status === 'paid') {
          setNotice('Thanh toán đã được xác nhận. Gói mới đã sẵn sàng.');
          await loadEntitlement();
        }
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : 'Không kiểm tra được thanh toán.',
        );
      }
    }, 3_000);
    return () => window.clearInterval(interval);
  }, [loadEntitlement, order]);

  const currentEntitlement = entitlementOverride ?? entitlement;

  const createOrder = async (plan: PaidPlanCode) => {
    setSelectedPlan(plan);
    setNotice('');
    try {
      const response = await fetch('/api/billing/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ plan }),
      });
      const body = (await response.json()) as {
        order?: PaymentOrder;
        error?: string;
      };
      if (!response.ok || !body.order)
        throw new Error(body.error ?? 'Không tạo được đơn thanh toán.');
      setOrder(body.order);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : 'Không tạo được đơn thanh toán.',
      );
    } finally {
      setSelectedPlan(null);
    }
  };

  if (loading || !enabled) return null;

  const copyOrderCode = async () => {
    if (!order) return;
    try {
      await navigator.clipboard.writeText(order.orderCode);
      setNotice('Đã sao chép mã chuyển khoản.');
    } catch {
      setNotice(`Mã chuyển khoản: ${order.orderCode}`);
    }
  };

  return (
    <details
      open={panelOpen}
      onToggle={(event) => setPanelOpen(event.currentTarget.open)}
      className="rounded-[16px] border border-border bg-card/70 p-3 text-xs"
    >
      <summary className="cursor-pointer font-medium">
        Gói AI · {currentEntitlement?.planName ?? 'Chưa đăng ký'} ·{' '}
        {currentEntitlement?.unlimited
          ? 'không giới hạn'
          : `${currentEntitlement?.remaining ?? 0}/${currentEntitlement?.limit ?? 0} lượt còn lại`}
      </summary>
      <div className="mt-2 text-muted-foreground">
        {currentEntitlement?.periodEnd
          ? `Có hiệu lực đến ${formatPlanDate(currentEntitlement.periodEnd)}.`
          : currentEntitlement?.plan === 'trial'
            ? 'Ba lượt cơ bản được cấp lại theo tháng lịch Việt Nam cho tài khoản Google này.'
            : 'Chọn gói để tiếp tục phân tích AI.'}
      </div>
      {!salesEnabled ? (
        <div className="mt-3 rounded-[14px] border border-accent bg-accent/30 p-3 text-muted-foreground">
          <p>
            Giai đoạn cộng đồng hiện đang miễn phí; gói beta phân tích khoản
            vàng cá nhân sẽ mở sau khi hoàn tất kiểm chứng chất lượng và chi phí.
          </p>
          <Link
            href="/donate"
            className="mt-2 inline-flex font-semibold text-foreground underline-offset-4 hover:underline"
          >
            Ủng hộ để duy trì dữ liệu và AI →
          </Link>
        </div>
      ) : !currentEntitlement?.unlimited ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-1 md:grid-cols-3">
          {BETA_PAID_PLANS.map((code) => {
            const plan = PLAN_CATALOG[code];
            const active = currentEntitlement?.plan === code;
            return (
              <div
                key={code}
                className={`rounded-[14px] border p-3 ${active ? 'border-primary bg-accent/40' : 'border-border bg-card/45'}`}
              >
                <p className="font-semibold">{plan.name}</p>
                <p className="mt-1 text-sm font-medium">
                  {formatVnd(plan.priceVnd)} / 30 ngày
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {plan.description}
                </p>
                <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                  {plan.features.map((feature) => (
                    <li key={feature}>• {feature}</li>
                  ))}
                </ul>
                <Button
                  type="button"
                  size="sm"
                  variant={active ? 'outline' : 'default'}
                  className="mt-3 w-full"
                  disabled={Boolean(selectedPlan) || active}
                  onClick={() => void createOrder(code)}
                >
                  {selectedPlan === code
                    ? 'Đang tạo…'
                    : active
                      ? 'Đang dùng'
                      : 'Chọn gói'}
                </Button>
              </div>
            );
          })}
        </div>
      ) : null}
      {order ? (
        <div className="mt-3 rounded-[14px] border border-accent bg-accent/30 p-3">
          <p className="font-medium">
            Thanh toán {order.planName} · {formatVnd(order.amountVnd)}
          </p>
          {order.status === 'pending' && order.qrUrl ? (
            <div className="mt-3 flex flex-col items-start gap-3 sm:flex-row">
              {/* QR is a user-specific dynamic URL; Next image optimization is not useful here. */}
              {/* oxlint-disable-next-line next/no-img-element */}
              <img
                src={order.qrUrl}
                alt={`QR thanh toán ${order.planName}`}
                className="size-44 rounded-md bg-white p-1"
              />
              <div className="space-y-1 text-muted-foreground">
                <p>Quét QR và chuyển đúng {formatVnd(order.amountVnd)}.</p>
                <p>
                  Mã nội dung:{' '}
                  <span className="font-semibold text-foreground">
                    {order.orderCode}
                  </span>
                </p>
                <p>Đơn hết hạn: {formatPlanDate(order.expiresAt)}.</p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void copyOrderCode()}
                  >
                    Sao chép mã
                  </Button>
                  <span className="self-center">Đang chờ xác nhận…</span>
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-muted-foreground">
              {order.status === 'paid'
                ? `Đã thanh toán lúc ${formatPlanDate(order.paidAt)}.`
                : `Đơn đang ở trạng thái ${order.status}.`}
            </p>
          )}
        </div>
      ) : null}
      {notice ? (
        <p role="alert" className="mt-2 text-amber-800 dark:text-amber-300">
          {notice}
        </p>
      ) : null}
    </details>
  );
}
