/** Deliberately accepts only fields controlled by application code. */
export function logMarketEvent(
  level: 'info' | 'warn' | 'error',
  event: 'market_origin' | 'market_snapshot' | 'market_history_sync',
  fields: Record<string, unknown>,
) {
  console[level](JSON.stringify({ event, ...fields }));
}

export function marketFailureKind(error: unknown) {
  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError') return 'timeout';
  if (name === 'AbortError') return 'cancelled';
  if (name === 'SyntaxError') return 'invalid_payload';
  return 'operation_failed';
}
