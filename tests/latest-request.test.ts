import { describe, expect, it } from 'vitest';

import { createLatestRequestGuard } from '@/lib/latest-request';

describe('createLatestRequestGuard', () => {
  it('only allows the newest response to commit', () => {
    const guard = createLatestRequestGuard();
    const first = guard.begin();
    const second = guard.begin();

    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });

  it('does not consider an unstarted request current', () => {
    const guard = createLatestRequestGuard();

    expect(guard.isCurrent(1)).toBe(false);
  });
});
