import {
  normalizeQuestion,
  resolveIntent,
  type AnalysisIntent,
} from './intent';
import type { AnalysisGoal } from './experience';

export type AnswerFocus =
  | 'lookup'
  | 'comparison'
  | 'buy'
  | 'hold'
  | 'market'
  | 'forecast'
  | 'out-of-scope';

/** A goal describes the question; permission to read the account ledger is separate. */
export function answerFocus(
  question: string,
  intent: AnalysisIntent = resolveIntent(question),
  goal?: AnalysisGoal | null,
): AnswerFocus {
  if (intent.kind === 'out-of-scope') return 'out-of-scope';
  if (intent.forecast) return 'forecast';
  if (intent.kind === 'macro') return 'market';
  if (intent.kind === 'comparison') return 'comparison';
  const q = normalizeQuestion(question);
  if (/neu mua|if i buy|if buying/.test(q)) return 'buy';
  if (
    /dang giu|da mua|gia von|vang toi|so vang|lai.*(?:dang giu|da mua)|\b(?:hold|holding|own|bought|cost basis|my gold|my ledger|gold ledger)\b/.test(
      q,
    )
  )
    return 'hold';
  if (
    /\bmua\s+\d|dinh mua|nen mua|mua ngay|ngan sach|\bbuy(?:ing)?\s+(?:\d|one|two|gold|now|some)|\bbudget\b/.test(
      q,
    )
  )
    return 'buy';
  if (intent.kind === 'investment') return goal === 'hold' ? 'hold' : 'buy';
  return 'lookup';
}

export function usesAccountLedger(input: {
  goal?: AnalysisGoal;
  usePortfolioLedger?: boolean;
}) {
  // Older clients used goal=hold as consent. New clients always send the boolean.
  return (
    input.usePortfolioLedger === true ||
    (input.usePortfolioLedger === undefined && input.goal === 'hold')
  );
}

export function needsPriceHistory(question: string, intent: AnalysisIntent) {
  return (
    intent.forecast ||
    intent.daily ||
    /xu huong|bien dong|thang qua|tuan qua|ma7|ma30|drawdown|trend|volatility|moving average|last (?:week|month|year)/.test(
      normalizeQuestion(question),
    )
  );
}

/** Preserve every tie at the cutoff, including a tie beyond the usual five rows. */
export function comparisonRows<T extends { rank: number }>(
  rows: T[],
  limit = 5,
): T[] {
  const cutoff = rows[limit - 1]?.rank;
  return cutoff === undefined
    ? rows
    : rows.filter((row, index) => index < limit || row.rank === cutoff);
}
