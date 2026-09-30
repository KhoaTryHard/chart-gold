'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { htmlLang, type Locale } from '@/lib/i18n';

type LocaleContextValue = {
  locale: Locale;
  isChangingLocale: boolean;
  localeError: string | null;
  setLocale: (locale: Locale) => Promise<void>;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

function applyLocale(locale: Locale) {
  document.documentElement.lang = htmlLang(locale);
  document.documentElement.dataset.locale = locale;
}

function pageTitle(pathname: string, locale: Locale) {
  const titles: Record<string, string> = locale === 'en'
    ? {
        '/': 'Vietnam gold prices — Kim Tuyến',
        '/cong-cu-vang': 'Gold tools — Kim Tuyến',
        '/so-vang': 'Gold ledger — Kim Tuyến',
        '/phan-tich': 'AI Analysis — Kim Tuyến',
        '/nhip-vang': 'Gold Pulse — Kim Tuyến',
        '/huong-dan': 'User guide — Kim Tuyến',
        '/donate': 'Support Kim Tuyến',
        '/privacy': 'Privacy policy — Kim Tuyến',
        '/terms': 'Terms of use — Kim Tuyến',
        '/bien-tap': 'Gold Pulse editorial method — Kim Tuyến',
      }
    : {
        '/': 'Giá vàng hôm nay, biểu đồ giá vàng Việt Nam — Kim Tuyến',
        '/cong-cu-vang': 'So sánh giá vàng, tính lãi lỗ và hòa vốn — Kim Tuyến',
        '/so-vang': 'Sổ vàng tích sản — Kim Tuyến',
        '/phan-tich': 'Phân tích AI giá vàng — Kim Tuyến',
        '/nhip-vang': 'Nhịp vàng — Tin tức giá vàng và thị trường tài chính | Kim Tuyến',
        '/huong-dan': 'Hướng dẫn sử dụng Kim Tuyến',
        '/donate': 'Ủng hộ dự án — Kim Tuyến',
        '/privacy': 'Chính sách bảo mật — Kim Tuyến',
        '/terms': 'Điều khoản sử dụng — Kim Tuyến',
        '/bien-tap': 'Phương pháp biên tập Nhịp vàng — Kim Tuyến',
      };
  if (pathname in titles) return titles[pathname];
  if (pathname.startsWith('/so-sanh/')) {
    const heading = document.querySelector('#tool-page-title')?.textContent?.trim();
    return `${heading || (locale === 'en' ? 'Gold comparison' : 'So sánh giá vàng')} — Kim Tuyến`;
  }
  if (pathname.startsWith('/nhip-vang/')) {
    const heading = document.querySelector('article.editorial-article h1')?.textContent?.trim();
    return `${heading || (locale === 'en' ? 'Gold Pulse' : 'Nhịp vàng')} — ${locale === 'en' ? 'Gold Pulse' : 'Nhịp vàng'} | Kim Tuyến`;
  }
  return 'Kim Tuyến';
}

function visiblePageDescription(pathname: string) {
  const selectors = pathname.startsWith('/nhip-vang/')
    ? ['article.editorial-article h1 + p']
    : pathname === '/nhip-vang'
      ? ['.editorial-page__header > p:not(.tool-eyebrow)']
      : pathname === '/'
        ? ['.market-intro > div > p']
        : pathname === '/phan-tich'
          ? ['.ai-page-heading > div > p']
          : pathname === '/privacy' || pathname === '/terms'
            ? ['main article > p']
            : ['.tool-intro > .tool-description'];
  for (const selector of selectors) {
    const value = document.querySelector(selector)?.textContent?.trim();
    if (value) return value;
  }
  return undefined;
}

function setMetaContent(selector: string, content: string) {
  const tag = document.head.querySelector<HTMLMetaElement>(selector);
  if (tag) tag.content = content;
}

export function LocaleProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale: Locale;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [locale, setLocaleState] = useState(initialLocale);
  const [isChangingLocale, setIsChangingLocale] = useState(false);
  const [localeError, setLocaleError] = useState<string | null>(null);

  useEffect(() => {
    applyLocale(locale);
    const title = pageTitle(pathname, locale);
    const applyPageMetadata = () => {
      if (document.title !== title) document.title = title;
      setMetaContent('meta[name="title"]', title);
      setMetaContent('meta[property="og:title"]', title);
      setMetaContent('meta[name="twitter:title"]', title);
      setMetaContent('meta[property="og:locale"]', locale === 'en' ? 'en_US' : 'vi_VN');
      const description = visiblePageDescription(pathname);
      if (description) {
        setMetaContent('meta[name="description"]', description);
        setMetaContent('meta[property="og:description"]', description);
        setMetaContent('meta[name="twitter:description"]', description);
      }
    };
    applyPageMetadata();
    const observer = new MutationObserver(applyPageMetadata);
    observer.observe(document.head, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [locale, pathname]);

  const setLocale = useCallback(
    async (nextLocale: Locale) => {
      if (nextLocale === locale || isChangingLocale) return;
      const previousLocale = locale;
      setLocaleError(null);
      setLocaleState(nextLocale);
      setIsChangingLocale(true);
      try {
        const response = await fetch('/api/locale', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locale: nextLocale }),
          credentials: 'same-origin',
        });
        if (!response.ok) throw new Error('Locale preference was not saved.');
        if (
          pathname !== '/' &&
          pathname !== '/cong-cu-vang' &&
          pathname !== '/phan-tich' &&
          pathname !== '/donate' &&
          !pathname.startsWith('/so-sanh/')
        ) {
          router.refresh();
        }
      } catch {
        setLocaleState(previousLocale);
        setLocaleError(
          previousLocale === 'en'
            ? 'Your language preference could not be saved. Please try again.'
            : 'Không thể lưu lựa chọn ngôn ngữ. Hãy thử lại.',
        );
      } finally {
        setIsChangingLocale(false);
      }
    },
    [isChangingLocale, locale, pathname, router],
  );

  const value = useMemo(
    () => ({ locale, isChangingLocale, localeError, setLocale }),
    [isChangingLocale, locale, localeError, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context)
    throw new Error('useLocale must be used within LocaleProvider.');
  return context;
}
