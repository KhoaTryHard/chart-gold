export function b2cAiEnabled() {
  return /^(1|true|yes|on)$/i.test(
    process.env.B2C_AI_ENABLED?.trim() ??
      process.env.B2C_SUBSCRIPTIONS_ENABLED?.trim() ??
      '',
  );
}

/** Backward-compatible name used by the existing billing/auth code. */
export const subscriptionsEnabled = b2cAiEnabled;

/** B2C AI access is independent from whether paid plans are currently sold. */
export function subscriptionSalesEnabled() {
  return /^(1|true|yes|on)$/i.test(
    process.env.SUBSCRIPTIONS_SALES_ENABLED?.trim() ?? '',
  );
}

export function donationsEnabled() {
  const configured = process.env.DONATIONS_ENABLED?.trim();
  return configured === undefined || /^(1|true|yes|on)$/i.test(configured);
}

export function databaseConfigured() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function sepayConfigured() {
  return Boolean(
    process.env.SEPAY_WEBHOOK_SECRET?.trim() &&
    process.env.SEPAY_BANK_CODE?.trim() &&
    process.env.SEPAY_ACCOUNT_NUMBER?.trim() &&
    process.env.SEPAY_ACCOUNT_HOLDER?.trim(),
  );
}

export const SEPAY_ORDER_TTL_MS = 24 * 60 * 60 * 1_000;
export const AI_RESERVATION_TTL_MS = 10 * 60 * 1_000;
export const SEPAY_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;
/** New donation QR codes are intentionally short-lived. Existing rows keep their stored expiry. */
export const DONATION_ORDER_TTL_MS = 5 * 60 * 1_000;

export function sepayPaymentPrefix() {
  const configured = (
    process.env.SEPAY_PAYMENT_PREFIX?.trim() || 'KT'
  ).toUpperCase();
  return /^[A-Z0-9]{2,5}$/.test(configured) ? configured : 'KT';
}

export function donationPaymentPrefix() {
  const configured = (
    process.env.DONATION_PAYMENT_PREFIX?.trim() || 'DN'
  ).toUpperCase();
  return /^[A-Z0-9]{2,5}$/.test(configured) ? configured : 'DN';
}

function positiveEnvNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

function nonnegativeEnvNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : fallback;
}

export function communityAiMonthlyLimit() {
  return positiveEnvNumber(
    'AI_COMMUNITY_MONTHLY_LIMIT',
    positiveEnvNumber('AI_COMMUNITY_DAILY_LIMIT', 3),
  );
}

/** Backward-compatible export; community allowance is monthly in the beta. */
export const communityAiDailyLimit = communityAiMonthlyLimit;

export function aiBudgetConfig() {
  return {
    // Free/community and paid beta budgets are accounted separately. Their
    // combined default is 600,000 VND/month, leaving room for hosting, data,
    // payments and editorial work inside the agreed 1,000,000 VND ceiling.
    monthlyLimitVnd: positiveEnvNumber('AI_MONTHLY_BUDGET_VND', 300_000),
    dailyLimitVnd: positiveEnvNumber('AI_DAILY_BUDGET_VND', 10_000),
    subscriptionMonthlyLimitVnd: positiveEnvNumber('AI_SUBSCRIPTION_MONTHLY_BUDGET_VND', 300_000),
    subscriptionDailyLimitVnd: positiveEnvNumber('AI_SUBSCRIPTION_DAILY_BUDGET_VND', 30_000),
    reservationVnd: positiveEnvNumber('AI_COST_RESERVATION_VND', 1_000),
    inputCostPer1kVnd: nonnegativeEnvNumber('AI_INPUT_COST_PER_1K_VND', -1),
    outputCostPer1kVnd: nonnegativeEnvNumber('AI_OUTPUT_COST_PER_1K_VND', -1),
  };
}
