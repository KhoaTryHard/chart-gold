import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

import { SEPAY_TIMESTAMP_TOLERANCE_SECONDS } from './config';

const flexibleString = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim());

export const sepayWebhookPayloadSchema = z.object({
  // SePay's dashboard test delivery uses 0; live transactions are positive.
  id: z.coerce.number().int().nonnegative(),
  gateway: flexibleString.pipe(z.string().min(1).max(100)),
  transactionDate: flexibleString.pipe(z.string().min(1).max(80)),
  accountNumber: flexibleString.pipe(z.string().min(1).max(100)),
  subAccount: flexibleString.nullable().optional(),
  code: flexibleString.pipe(z.string().max(64)).nullable().optional(),
  content: z.string().max(2_000).nullable().optional(),
  description: z.string().max(2_000).nullable().optional(),
  accumulated: z.coerce.number().nonnegative().nullable().optional(),
  transferType: flexibleString.pipe(z.string().min(1).max(20)),
  transferAmount: z.coerce.number().int().positive(),
  referenceCode: flexibleString.pipe(z.string().max(255)).nullable().optional(),
});

export type SepayWebhookPayload = z.infer<typeof sepayWebhookPayloadSchema>;

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * SePay normally fills `code` from its company payment-code templates. As a
 * recovery path, extract a known order prefix from the original bank memo.
 */
export function extractSepayPaymentCode(
  payload: SepayWebhookPayload,
  prefixes: string[],
) {
  const code = payload.code?.trim().toUpperCase();
  if (code) return code;
  const normalizedPrefixes = prefixes
    .map((prefix) => prefix.trim().toUpperCase())
    .filter((prefix) => /^[A-Z]{2,5}$/.test(prefix));
  if (!normalizedPrefixes.length) return null;
  const pattern = new RegExp(
    `(?:^|[^A-Z0-9])(${normalizedPrefixes.map(escapeRegex).join('|')})[A-Z0-9]{10}(?![A-Z0-9])`,
    'i',
  );
  for (const candidate of [
    payload.content,
    payload.description,
    payload.referenceCode,
  ]) {
    const match = candidate?.toUpperCase().match(pattern);
    if (match?.[0]) return match[0].replace(/^[^A-Z0-9]+/, '');
  }
  return null;
}

export function validateSepayPayment({
  payload,
  expectedAccount,
  order,
  transactionDate,
  now,
}: {
  payload: SepayWebhookPayload;
  expectedAccount: string;
  order: { amountVnd: number; status: string; expiresAt: Date } | null;
  transactionDate?: Date | null;
  now: Date;
}) {
  const reasons: string[] = [];
  const effectiveTransactionDate = transactionDate ?? now;
  if (
    !expectedAccount ||
    normalizeBankAccount(payload.accountNumber) !==
      normalizeBankAccount(expectedAccount)
  )
    reasons.push('tài khoản nhận không khớp');
  if (payload.transferType.toLowerCase() !== 'in')
    reasons.push('không phải giao dịch tiền vào');
  if (!payload.code?.trim()) reasons.push('thiếu mã đơn hàng');
  if (!order) reasons.push('không tìm thấy đơn hàng');
  if (order && order.amountVnd !== payload.transferAmount)
    reasons.push('số tiền không khớp');
  if (order && !['pending', 'expired'].includes(order.status))
    reasons.push('đơn hàng không ở trạng thái chờ');
  if (order && effectiveTransactionDate > order.expiresAt)
    reasons.push('đơn hàng đã hết hạn');
  return { valid: reasons.length === 0, reason: reasons.join('; ') };
}

function headerValue(headers: Headers, name: string) {
  return headers.get(name)?.trim() ?? '';
}

export function sha256Hex(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function verifySepaySignature(
  rawBody: string,
  headers: Headers,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
) {
  const timestampText = headerValue(headers, 'X-SePay-Timestamp');
  const signature = headerValue(headers, 'X-SePay-Signature').toLowerCase();
  if (!/^\d+$/.test(timestampText) || !/^sha256=[a-f0-9]{64}$/.test(signature))
    return false;
  const timestamp = Number(timestampText);
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(nowSeconds - timestamp) > SEPAY_TIMESTAMP_TOLERANCE_SECONDS
  )
    return false;
  const expected = `sha256=${createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex')}`;
  const expectedBytes = Buffer.from(expected, 'utf8');
  const receivedBytes = Buffer.from(signature, 'utf8');
  return (
    expectedBytes.length === receivedBytes.length &&
    timingSafeEqual(expectedBytes, receivedBytes)
  );
}

export function normalizeBankAccount(value: string) {
  return value.replace(/\s/g, '').trim();
}

export function maskBankAccount(value: string) {
  const normalized = normalizeBankAccount(value);
  return normalized.length <= 4
    ? '****'
    : `${'*'.repeat(Math.max(4, normalized.length - 4))}${normalized.slice(-4)}`;
}

export function parseSepayTransactionDate(value: string) {
  const match = value
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}+07:00`;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function buildSepayQrUrl({
  amountVnd,
  orderCode,
}: {
  amountVnd: number;
  orderCode: string;
}) {
  const account = normalizeBankAccount(process.env.SEPAY_ACCOUNT_NUMBER ?? '');
  const bank = process.env.SEPAY_BANK_CODE?.trim() ?? '';
  const holder = process.env.SEPAY_ACCOUNT_HOLDER?.trim() ?? '';
  if (!account || !bank || !holder)
    throw new Error(
      'SEPAY_BANK_CODE, SEPAY_ACCOUNT_NUMBER và SEPAY_ACCOUNT_HOLDER are required.',
    );
  const params = new URLSearchParams({
    acc: account,
    bank,
    amount: String(amountVnd),
    des: orderCode,
    template: 'compact',
    showinfo: 'true',
    holder,
  });
  return `https://vietqr.app/img?${params.toString()}`;
}
