export const supportedLocales = ['vi', 'en'] as const;

export type Locale = (typeof supportedLocales)[number];

export const defaultLocale: Locale = 'vi';
export const localeCookieName = 'kim-tuyen-locale';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && supportedLocales.includes(value as Locale);
}

export function localeFromValue(value: unknown): Locale {
  return isLocale(value) ? value : defaultLocale;
}

export function localeFromCookieHeader(value: string | null | undefined): Locale {
  if (!value) return defaultLocale;
  const cookie = value
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${localeCookieName}=`));
  if (!cookie) return defaultLocale;
  const raw = cookie.slice(localeCookieName.length + 1);
  try {
    return localeFromValue(decodeURIComponent(raw));
  } catch {
    return defaultLocale;
  }
}

export function htmlLang(locale: Locale) {
  return locale === 'en' ? 'en' : 'vi';
}

export function intlLocale(locale: Locale) {
  return locale === 'en' ? 'en-US' : 'vi-VN';
}

export const localeLabels: Record<Locale, string> = {
  vi: 'Tiếng Việt',
  en: 'English',
};
