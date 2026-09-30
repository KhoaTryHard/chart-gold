'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  formatVnd,
  PLAN_CATALOG,
  PAID_PLANS,
  type PaidPlanCode,
} from '@/lib/billing/plans';

type BillingData = {
  orders: Array<{
    id: string;
    email: string;
    planName: string;
    amountVnd: number;
    orderCode: string;
    status: string;
    expiresAt: string;
    paidAt: string | null;
    createdAt: string;
  }>;
  donations: Array<{
    id: string;
    amountVnd: number;
    orderCode: string;
    status: string;
    isAnonymous: boolean;
    displayName: string | null;
    expiresAt: string;
    paidAt: string | null;
    createdAt: string;
  }>;
  transactions: Array<{
    sepayId: number;
    orderCode: string | null;
    amountVnd: number;
    status: string;
    gateway: string;
    referenceCode: string | null;
    receivedAt: string;
  }>;
  audits: Array<{
    id: string;
    eventType: string;
    entityType: string;
    entityId: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
  }>;
};

export function AdminBillingPanel() {
  const [data, setData] = useState<BillingData | null>(null);
  const [email, setEmail] = useState('');
  const [plan, setPlan] = useState<PaidPlanCode>('basic');
  const [donationId, setDonationId] = useState('');
  const [sepayId, setSepayId] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/billing', { cache: 'no-store' });
      const body = (await response.json()) as BillingData & { error?: string };
      if (!response.ok)
        throw new Error(body.error ?? 'Không tải được billing.');
      setData(body);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Không tải được billing.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const mutate = async (action: 'grant' | 'revoke' | 'confirmDonation') => {
    if (action !== 'confirmDonation' && !email.trim()) return;
    if (action === 'confirmDonation' && (!donationId.trim() || !sepayId.trim()))
      return;
    setLoading(true);
    setNotice('');
    try {
      const response = await fetch('/api/admin/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          action === 'confirmDonation'
            ? { action, donationId, sepayId: Number(sepayId) }
            : { action, email, ...(action === 'grant' ? { plan } : {}) },
        ),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(body.error ?? 'Không thực hiện được thao tác.');
      setNotice(
        action === 'grant'
          ? 'Đã cấp gói.'
          : action === 'revoke'
            ? 'Đã thu hồi gói.'
            : 'Đã ghép và xác nhận khoản ủng hộ.',
      );
      await load();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : 'Không thực hiện được thao tác.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-[20px] border border-border bg-card/70 p-5">
        <h2 className="font-heading text-lg font-semibold">
          Cấp hoặc thu hồi gói
        </h2>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="min-w-64 flex-1 text-xs">
            Email Google
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              className="mt-1 min-h-11 w-full rounded-[14px] border border-input bg-[var(--surface-solid)] px-3 py-2"
              placeholder="khach@example.com"
            />
          </label>
          <label className="text-xs">
            Gói
            <select
              value={plan}
              onChange={(event) => setPlan(event.target.value as PaidPlanCode)}
              className="mt-1 block min-h-11 rounded-[14px] border border-input bg-[var(--surface-solid)] px-3 py-2"
            >
              {PAID_PLANS.map((code) => (
                <option key={code} value={code}>
                  {PLAN_CATALOG[code].name} ·{' '}
                  {formatVnd(PLAN_CATALOG[code].priceVnd)}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            disabled={loading || !email.trim()}
            onClick={() => void mutate('grant')}
          >
            Cấp 30 ngày
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={loading || !email.trim()}
            onClick={() => void mutate('revoke')}
          >
            Thu hồi
          </Button>
        </div>
        {notice ? (
          <p role="alert" className="mt-3 text-sm text-muted-foreground">
            {notice}
          </p>
        ) : null}
      </div>

      <section>
        <h2 className="font-heading text-lg font-semibold">
          Đơn thanh toán gần đây
        </h2>
        <div className="mt-3 overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-muted text-xs">
              <tr>
                <th className="p-2">Email</th>
                <th className="p-2">Gói</th>
                <th className="p-2">Mã</th>
                <th className="p-2">Số tiền</th>
                <th className="p-2">Trạng thái</th>
                <th className="p-2">Tạo lúc</th>
              </tr>
            </thead>
            <tbody>
              {data?.orders.map((order) => (
                <tr key={order.id} className="border-t border-border">
                  <td className="p-2">{order.email}</td>
                  <td className="p-2">{order.planName}</td>
                  <td className="p-2">{order.orderCode}</td>
                  <td className="p-2">{formatVnd(order.amountVnd)}</td>
                  <td className="p-2">{order.status}</td>
                  <td className="p-2">{order.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="font-heading text-lg font-semibold">
          Ghép giao dịch ngoại lệ
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Chỉ dùng sau khi đã kiểm tra giao dịch MB trong SePay; số tiền phải
          khớp đơn.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="min-w-64 flex-1 text-xs">
            ID đơn ủng hộ
            <input
              value={donationId}
              onChange={(event) => setDonationId(event.target.value)}
              className="mt-1 min-h-11 w-full rounded-[14px] border border-input bg-[var(--surface-solid)] px-3 py-2"
            />
          </label>
          <label className="text-xs">
            SePay ID
            <input
              value={sepayId}
              onChange={(event) => setSepayId(event.target.value)}
              inputMode="numeric"
              className="mt-1 min-h-11 w-36 rounded-[14px] border border-input bg-[var(--surface-solid)] px-3 py-2"
            />
          </label>
          <Button
            type="button"
            disabled={loading || !donationId.trim() || !sepayId.trim()}
            onClick={() => void mutate('confirmDonation')}
          >
            Xác nhận ngoại lệ
          </Button>
        </div>
      </section>

      <section>
        <h2 className="font-heading text-lg font-semibold">
          Đơn ủng hộ gần đây
        </h2>
        <div className="mt-3 overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-muted text-xs">
              <tr>
                <th className="p-2">Tên</th>
                <th className="p-2">Mã</th>
                <th className="p-2">Số tiền</th>
                <th className="p-2">Trạng thái</th>
                <th className="p-2">Thanh toán</th>
                <th className="p-2">Tạo lúc</th>
              </tr>
            </thead>
            <tbody>
              {data?.donations.map((donation) => (
                <tr key={donation.id} className="border-t border-border">
                  <td className="p-2">
                    {donation.isAnonymous
                      ? 'Ẩn danh'
                      : (donation.displayName ?? 'Không tên')}
                  </td>
                  <td className="p-2">{donation.orderCode}</td>
                  <td className="p-2">{formatVnd(donation.amountVnd)}</td>
                  <td className="p-2">{donation.status}</td>
                  <td className="p-2">{donation.paidAt ?? '—'}</td>
                  <td className="p-2">{donation.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="font-heading text-lg font-semibold">Nhật ký billing</h2>
        <div className="mt-3 overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="bg-muted text-xs">
              <tr>
                <th className="p-2">Thời gian</th>
                <th className="p-2">Sự kiện</th>
                <th className="p-2">Đối tượng</th>
                <th className="p-2">Chi tiết an toàn</th>
              </tr>
            </thead>
            <tbody>
              {data?.audits.map((audit) => (
                <tr key={audit.id} className="border-t border-border">
                  <td className="p-2">{audit.createdAt}</td>
                  <td className="p-2">{audit.eventType}</td>
                  <td className="p-2">
                    {audit.entityType} · {audit.entityId ?? '—'}
                  </td>
                  <td className="max-w-[320px] truncate p-2 text-xs">
                    {JSON.stringify(audit.metadata)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="font-heading text-lg font-semibold">
          Giao dịch SePay cần theo dõi
        </h2>
        <div className="mt-3 overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-muted text-xs">
              <tr>
                <th className="p-2">SePay ID</th>
                <th className="p-2">Mã đơn</th>
                <th className="p-2">Số tiền</th>
                <th className="p-2">Ngân hàng</th>
                <th className="p-2">Trạng thái</th>
                <th className="p-2">Nhận lúc</th>
              </tr>
            </thead>
            <tbody>
              {data?.transactions.map((transaction) => (
                <tr
                  key={transaction.sepayId}
                  className="border-t border-border"
                >
                  <td className="p-2">{transaction.sepayId}</td>
                  <td className="p-2">{transaction.orderCode ?? '—'}</td>
                  <td className="p-2">{formatVnd(transaction.amountVnd)}</td>
                  <td className="p-2">{transaction.gateway}</td>
                  <td className="p-2">{transaction.status}</td>
                  <td className="p-2">{transaction.receivedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
