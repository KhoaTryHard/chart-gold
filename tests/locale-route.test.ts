import { beforeEach, describe, expect, it, vi } from 'vitest';
import { englishEnabled, localeCookieName } from '@/lib/i18n';

const cookieStore = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), read: vi.fn() }));

// @ts-expect-error server-only is a Next.js virtual module, not a test dependency.
vi.mock('server-only', () => ({}), { virtual: true });
vi.mock('next/headers', () => ({ cookies: async () => { cookieStore.read(); return cookieStore; } }));

import { POST } from '@/app/api/locale/route';
import { getRequestLocale } from '@/lib/request-locale';

function preferenceRequest(locale: string) {
  return new Request('https://example.test/api/locale', {
    method: 'POST',
    headers: { origin: 'https://example.test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ locale }),
  });
}

beforeEach(() => vi.resetAllMocks());

describe('website language preference', () => {
  it('uses Vietnamese without a saved preference', async () => {
    expect(await getRequestLocale()).toBe('vi');
    expect(cookieStore.set).not.toHaveBeenCalled();
    if (!englishEnabled) expect(cookieStore.read).not.toHaveBeenCalled();
  });

  it('applies the website language policy to an old English cookie without overwriting it', async () => {
    cookieStore.get.mockReturnValue({ value: 'en' });
    expect(await getRequestLocale()).toBe(englishEnabled ? 'en' : 'vi');
    if (englishEnabled) expect(cookieStore.get).toHaveBeenCalledWith(localeCookieName);
    else expect(cookieStore.get).not.toHaveBeenCalled();
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it('rejects English preferences while English is disabled', async () => {
    const response = await POST(preferenceRequest('en'));
    if (englishEnabled) {
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ locale: 'en' });
    } else {
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'INVALID_LOCALE' });
      expect(cookieStore.set).not.toHaveBeenCalled();
    }
  });

  it('still saves Vietnamese with the existing cookie contract', async () => {
    const response = await POST(preferenceRequest('vi'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ locale: 'vi' });
    expect(cookieStore.set).toHaveBeenCalledWith(localeCookieName, 'vi', {
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 365,
      path: '/',
      sameSite: 'lax',
      secure: true,
    });
  });
});
