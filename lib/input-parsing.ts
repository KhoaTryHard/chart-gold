export type InputError =
  | 'empty'
  | 'invalid'
  | 'negative'
  | 'ambiguous'
  | 'non-positive';

export type ParsedInput = {
  value: number | null;
  error: InputError | null;
};

function result(value: number | null, error: InputError | null): ParsedInput {
  return { value, error };
}

function clean(value: string) {
  return value.trim().replace(/[\s\u00a0]/g, '');
}

function hasNegative(value: string) {
  return value.startsWith('-') || value.includes('−');
}

/**
 * Parse a quantity using Vietnamese-friendly decimal notation. A single
 * separator followed by exactly three digits is rejected because `1.000`
 * could mean one thousand or one point zero; users must choose an unambiguous
 * spelling for a gold quantity.
 */
export function parseQuantityInput(value: string): ParsedInput {
  const compact = clean(value);
  if (!compact) return result(null, 'empty');
  if (hasNegative(compact)) return result(null, 'negative');
  if (!/^\d[\d.,]*$/.test(compact)) return result(null, 'invalid');

  const separators = compact.match(/[.,]/g) ?? [];
  if (separators.length > 0) {
    const separator = separators.at(-1)!;
    const index = compact.lastIndexOf(separator);
    const fraction = compact.slice(index + 1);
    const integer = compact.slice(0, index).replace(/[.,]/g, '');
    if (!integer || !fraction || !/^\d+$/.test(integer) || !/^\d+$/.test(fraction))
      return result(null, 'invalid');
    if (separators.length === 1 && fraction.length === 3)
      return result(null, 'ambiguous');
    const parsed = Number(`${integer}.${fraction}`);
    return Number.isFinite(parsed) && parsed > 0
      ? result(parsed, null)
      : result(null, 'non-positive');
  }

  const parsed = Number(compact);
  return Number.isFinite(parsed) && parsed > 0
    ? result(parsed, null)
    : result(null, 'non-positive');
}

/** Parse a VND amount, accepting 29000000, 29.000.000 and 29,000,000. */
export function parseVndInput(value: string, allowZero = true): ParsedInput {
  const compact = clean(value);
  if (!compact) return result(null, 'empty');
  if (hasNegative(compact)) return result(null, 'negative');
  if (!/^\d[\d.,]*$/.test(compact)) return result(null, 'invalid');

  const groups = compact.split(/[.,]/);
  if (groups.length > 1 && !groups.every((group, index) => /^\d+$/.test(group) && (index === 0 || group.length === 3)))
    return result(null, 'invalid');
  const parsed = Number(compact.replace(/[.,]/g, ''));
  if (!Number.isFinite(parsed) || (!allowZero && parsed <= 0))
    return result(null, parsed === 0 ? 'non-positive' : 'invalid');
  return result(parsed, null);
}

/** Parse a price expressed in millions of VND, e.g. `29,5` or `29.5`. */
export function parseMillionInput(value: string, allowZero = false): ParsedInput {
  const compact = clean(value);
  if (!compact) return result(null, 'empty');
  if (hasNegative(compact)) return result(null, 'negative');
  if (!/^\d+(?:[.,]\d+)?$/.test(compact)) return result(null, 'invalid');
  const parsed = Number(compact.replace(',', '.')) * 1_000_000;
  if (!Number.isFinite(parsed) || (!allowZero && parsed <= 0))
    return result(null, parsed === 0 ? 'non-positive' : 'invalid');
  return result(parsed, null);
}

export function formatVndInput(value: number) {
  return Math.round(value).toLocaleString('vi-VN');
}

export function inputErrorMessage(error: InputError | null, english = false) {
  if (!error || error === 'empty') return '';
  if (english) {
    return error === 'negative'
      ? 'Use a positive number.'
      : error === 'ambiguous'
        ? 'Use an unambiguous quantity, such as 1 or 1000.'
        : error === 'non-positive'
          ? 'Enter a number greater than zero.'
          : 'Use numbers only; decimals use a comma or a dot.';
  }
  return error === 'negative'
    ? 'Vui lòng nhập số dương.'
    : error === 'ambiguous'
      ? 'Vui lòng nhập rõ 1 hoặc 1000, không dùng 1.000 cho khối lượng.'
      : error === 'non-positive'
        ? 'Vui lòng nhập số lớn hơn 0.'
        : 'Chỉ nhập chữ số; số thập phân dùng dấu phẩy hoặc dấu chấm.';
}
