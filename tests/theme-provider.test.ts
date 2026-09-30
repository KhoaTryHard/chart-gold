// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach as afterEachTest, describe, expect, it, vi } from 'vitest';

import { ThemeProvider, useTheme } from '@/components/theme-provider';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;

function ThemeProbe() {
  const { preference, resolvedTheme, setPreference } = useTheme();
  return createElement(
    'button',
    { type: 'button', onClick: () => setPreference('dark') },
    `${preference}:${resolvedTheme}`,
  );
}

afterEachTest(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.documentElement.className = '';
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
  localStorage.clear();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('theme provider', () => {
  it('uses the stored preference and persists a user-selected theme', async () => {
    localStorage.setItem('kim-tuyen-theme', 'light');
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);

    await act(async () =>
      root?.render(createElement(ThemeProvider, null, createElement(ThemeProbe))),
    );
    const button = host.querySelector('button')!;
    expect(button.textContent).toBe('light:light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    await act(async () => button.click());
    expect(button.textContent).toBe('dark:dark');
    expect(localStorage.getItem('kim-tuyen-theme')).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('tracks operating-system changes while the system preference is active', async () => {
    let isDark = true;
    let onChange: (() => void) | undefined;
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      get matches() { return isDark; },
      addEventListener: (_event: string, listener: () => void) => { onChange = listener; },
      removeEventListener: vi.fn(),
    })));
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);

    await act(async () =>
      root?.render(createElement(ThemeProvider, null, createElement(ThemeProbe))),
    );
    expect(host.querySelector('button')?.textContent).toBe('system:dark');

    isDark = false;
    await act(async () => onChange?.());
    expect(host.querySelector('button')?.textContent).toBe('system:light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
