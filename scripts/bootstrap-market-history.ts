import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

const { isHistorySyncCompany, recentHistoryWindow, syncAnnualMarketHistory } = await import(
  '@/lib/server/market-history'
);
const { vietnamDate, shiftDate } = await import('@/lib/analysis/dates');

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function validDate(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

const recent = process.argv.includes('--recent');
const requestedCompany = argument('--company');
const syncCompany =
  requestedCompany && isHistorySyncCompany(requestedCompany)
    ? requestedCompany
    : undefined;
const end = argument('--end') ?? vietnamDate();
const start =
  argument('--start') ?? (recent ? recentHistoryWindow().start : shiftDate(end, -364));

if (!validDate(start) || !validDate(end) || start > end) {
  throw new Error('Use --start YYYY-MM-DD --end YYYY-MM-DD with a valid range.');
}
if (requestedCompany && !syncCompany) {
  throw new Error('--company must be one of: sjc, pnj, btmh.');
}

const summary = await syncAnnualMarketHistory(
  start,
  end,
  syncCompany,
);
process.stdout.write(`${JSON.stringify({ start, end, summary }, null, 2)}\n`);
