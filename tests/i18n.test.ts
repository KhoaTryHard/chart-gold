import { describe, expect, it } from 'vitest';
import {
  defaultLocale,
  htmlLang,
  intlLocale,
  isLocale,
  localeFromValue,
} from '@/lib/i18n';
import { parseVietnameseNumber } from '@/lib/analysis/input';

describe('locale utilities', () => {
  it('only accepts the two supported locales and safely falls back to Vietnamese', () => {
    expect(isLocale('vi')).toBe(true);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('en-US')).toBe(false);
    expect(localeFromValue('unexpected')).toBe(defaultLocale);
    expect(htmlLang('en')).toBe('en');
    expect(intlLocale('vi')).toBe('vi-VN');
  });

  it('parses both Vietnamese and English grouping conventions without changing value', () => {
    expect(parseVietnameseNumber(' 145,5 ')).toBe(145.5);
    expect(parseVietnameseNumber('1.000')).toBe(1000);
    expect(parseVietnameseNumber('1.000,5')).toBe(1000.5);
    expect(parseVietnameseNumber('1,000.5', 'en')).toBe(1000.5);
    expect(parseVietnameseNumber('145.5', 'en')).toBe(145.5);
    expect(parseVietnameseNumber('1,000', 'en')).toBe(1000);
    expect(parseVietnameseNumber('  ', 'en')).toBeUndefined();
    expect(() => parseVietnameseNumber('1,000,5', 'en')).toThrow();
  });

  it('rejects malformed separators and whitespace instead of silently changing a draft', () => {
    for (const value of ['1,000.5', '12.00,5', '1 2', '-1', '1abc'])
      expect(() => parseVietnameseNumber(value)).toThrow();
    for (const value of ['1.000,5', '1,00.5', '1 2', '-1', '1abc'])
      expect(() => parseVietnameseNumber(value, 'en')).toThrow();
    expect(() => parseVietnameseNumber('1,000.5', 'vi', 'en')).toThrow(
      'Use a number such as 145.5 or 1,000',
    );
  });
});
