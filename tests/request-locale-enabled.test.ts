import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ cookie: vi.fn(), reads: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => { state.reads(); return { get: state.cookie }; },
}));
vi.mock('@/lib/i18n', async () => {
  const original = await vi.importActual<typeof import('@/lib/i18n')>('@/lib/i18n');
  return { ...original, englishEnabled: true, interfaceLocaleFromValue: original.localeFromValue };
});

import { getRequestLocale } from '@/lib/request-locale';

beforeEach(() => vi.resetAllMocks());

describe('locale when English is re-enabled', () => {
  it('uses the saved English preference and keeps requests separate', async () => {
    state.cookie.mockReturnValue({ value: 'en' });
    expect(await getRequestLocale()).toBe('en');
    state.cookie.mockReturnValue({ value: 'vi' });
    expect(await getRequestLocale()).toBe('vi');
    expect(state.reads).toHaveBeenCalledTimes(2);
    expect(state.cookie).toHaveBeenCalledWith('kim-tuyen-locale');
  });

  it.each([undefined, { value: 'invalid' }])('defaults to Vietnamese for missing or invalid cookies', async value => {
    state.cookie.mockReturnValue(value);
    expect(await getRequestLocale()).toBe('vi');
    expect(state.reads).toHaveBeenCalledOnce();
  });
});
