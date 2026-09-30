import { portfolioLedgerSchema, type PortfolioLedger } from './portfolio-ledger';

const DB_NAME = 'kim-tuyen-portfolio';
const STORE_NAME = 'ledgers';
const FALLBACK_PREFIX = 'kim-tuyen:portfolio-cache:v1:';

export type CachedPortfolioLedger = {
  ledger: PortfolioLedger;
  serverVersion: number;
  updatedAt: string;
};

function cacheKey(account: string) {
  return `${FALLBACK_PREFIX}${encodeURIComponent(account.trim().toLowerCase())}`;
}

function normalize(value: unknown): CachedPortfolioLedger | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<CachedPortfolioLedger>;
  const ledger = portfolioLedgerSchema.safeParse(item.ledger);
  if (!ledger.success || typeof item.serverVersion !== 'number' || typeof item.updatedAt !== 'string')
    return null;
  return { ledger: ledger.data, serverVersion: item.serverVersion, updatedAt: item.updatedAt };
}

function fallbackRead(account: string) {
  try {
    return normalize(JSON.parse(window.localStorage.getItem(cacheKey(account)) ?? 'null'));
  } catch {
    return null;
  }
}

function fallbackWrite(account: string, value: CachedPortfolioLedger) {
  try {
    window.localStorage.setItem(cacheKey(account), JSON.stringify(value));
  } catch {
    // Cache is optional; server data remains authoritative.
  }
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !window.indexedDB) return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = window.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

export async function readPortfolioLedgerCache(account: string) {
  const database = await openDatabase();
  if (!database) return fallbackRead(account);
  return new Promise<CachedPortfolioLedger | null>((resolve) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(account);
    request.onsuccess = () => resolve(normalize(request.result));
    request.onerror = () => resolve(fallbackRead(account));
  });
}

export async function writePortfolioLedgerCache(account: string, value: CachedPortfolioLedger) {
  const normalized = normalize(value);
  if (!normalized) return;
  const database = await openDatabase();
  if (!database) {
    fallbackWrite(account, normalized);
    return;
  }
  await new Promise<void>((resolve) => {
    const request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(normalized, account);
    request.onsuccess = () => resolve();
    request.onerror = () => {
      fallbackWrite(account, normalized);
      resolve();
    };
  });
}

export async function clearPortfolioLedgerCache(account: string) {
  const database = await openDatabase();
  if (!database) {
    try { window.localStorage.removeItem(cacheKey(account)); } catch { /* optional */ }
    return;
  }
  await new Promise<void>((resolve) => {
    const request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(account);
    request.onsuccess = request.onerror = () => resolve();
  });
  try { window.localStorage.removeItem(cacheKey(account)); } catch { /* optional */ }
}
