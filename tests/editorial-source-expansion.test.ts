import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/db', () => ({ getDatabase: vi.fn() }));
import { validateEditorialSource } from '@/lib/editorial/admin';

describe('expanded editorial source access', () => {
  it.each(['reuters.com', 'www.bloomberg.com', 'apnews.com', 'www.businessinsider.com', 'markets.businessinsider.com'])('accepts a source from %s', (host) => {
    const url = `https://${host}/news/article`;
    expect(validateEditorialSource({ title: 'Nguồn đối chiếu', url })?.url).toBe(url);
  });
  it.each(['https://businessinsider.com.evil.test/a', 'https://fakebusinessinsider.com/a', 'https://reuters.com@evil.test/a', 'http://apnews.com/a', 'https://user:pass@apnews.com/a', 'https://reuters.com:8443/a'])('rejects an unsafe source %s', (url) => {
    expect(validateEditorialSource({ title: 'Nguồn', url })).toBeNull();
  });
  it('keeps existing official HTTPS sources valid', () => {
    expect(validateEditorialSource({ title: 'NHNN', url: 'https://sbv.gov.vn/vi/a' })).not.toBeNull();
  });
});
