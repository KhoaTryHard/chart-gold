export type GoldUnit = 'luong' | 'chi' | 'gram';
export type PurchasePriceMode = 'per-luong' | 'total';

export type GoldPurchase = {
  quantity: number;
  unit: GoldUnit;
  priceMode: PurchasePriceMode;
  unitPriceVnd?: number;
  totalGoldVnd?: number;
  feeVnd?: number;
  date?: string;
};

export type GoldCalculatorInput = {
  purchases: readonly GoldPurchase[];
  sellPriceVndPerLuong?: number | null;
  sellFeeVnd?: number;
};

export type GoldCalculatorResult = {
  quantityLuong: number;
  totalCostVnd: number;
  averageCostVndPerLuong: number | null;
  sellPriceVndPerLuong: number | null;
  sellFeeVnd: number;
  netProceedsVnd: number | null;
  pnlVnd: number | null;
  returnPercent: number | null;
  breakevenVndPerLuong: number | null;
  gapToBreakevenVndPerLuong: number | null;
  gapToBreakevenPercent: number | null;
};

export function convertGoldQuantity(value: number, unit: GoldUnit) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (unit === 'chi') return value / 10;
  if (unit === 'gram') return value / 37.5;
  return value;
}

function positive(value: number | undefined | null) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

export function purchaseCostVnd(purchase: GoldPurchase) {
  const quantityLuong = convertGoldQuantity(purchase.quantity, purchase.unit);
  const goldCost =
    purchase.priceMode === 'total'
      ? positive(purchase.totalGoldVnd)
      : quantityLuong * positive(purchase.unitPriceVnd);
  return {
    quantityLuong,
    totalCostVnd: goldCost + Math.max(0, positive(purchase.feeVnd)),
  };
}

export function calculateGoldOutcome({
  purchases,
  sellPriceVndPerLuong = null,
  sellFeeVnd = 0,
}: GoldCalculatorInput): GoldCalculatorResult {
  const normalized = purchases.map(purchaseCostVnd);
  const quantityLuong = normalized.reduce(
    (total, purchase) => total + purchase.quantityLuong,
    0,
  );
  const totalCostVnd = normalized.reduce(
    (total, purchase) => total + purchase.totalCostVnd,
    0,
  );
  const fee = Math.max(0, positive(sellFeeVnd));
  const sellPrice = positive(sellPriceVndPerLuong) || null;
  const averageCostVndPerLuong =
    quantityLuong > 0 ? totalCostVnd / quantityLuong : null;
  const breakevenVndPerLuong =
    quantityLuong > 0 ? (totalCostVnd + fee) / quantityLuong : null;
  const netProceedsVnd =
    sellPrice === null ? null : quantityLuong * sellPrice - fee;
  const pnlVnd =
    netProceedsVnd === null ? null : netProceedsVnd - totalCostVnd;
  const returnPercent =
    pnlVnd === null || totalCostVnd <= 0 ? null : (pnlVnd / totalCostVnd) * 100;
  const gapToBreakevenVndPerLuong =
    sellPrice === null || breakevenVndPerLuong === null
      ? null
      : sellPrice - breakevenVndPerLuong;
  const gapToBreakevenPercent =
    gapToBreakevenVndPerLuong === null || breakevenVndPerLuong === null || breakevenVndPerLuong <= 0
      ? null
      : (gapToBreakevenVndPerLuong / breakevenVndPerLuong) * 100;

  return {
    quantityLuong,
    totalCostVnd,
    averageCostVndPerLuong,
    sellPriceVndPerLuong: sellPrice,
    sellFeeVnd: fee,
    netProceedsVnd,
    pnlVnd,
    returnPercent,
    breakevenVndPerLuong,
    gapToBreakevenVndPerLuong,
    gapToBreakevenPercent,
  };
}

export function calculateAdditionalPurchase(
  current: GoldCalculatorInput,
  additional: GoldPurchase,
) {
  return calculateGoldOutcome({
    purchases: [...current.purchases, additional],
    sellPriceVndPerLuong: current.sellPriceVndPerLuong,
    sellFeeVnd: current.sellFeeVnd,
  });
}


