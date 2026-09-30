import { describe, expect, it } from 'vitest';
import {
  parseMillionInput,
  parseQuantityInput,
  parseVndInput,
} from '@/lib/input-parsing';

describe('Vietnamese numeric input', () => {
  it('accepts decimal quantities and rejects ambiguous thousands', () => {
    expect(parseQuantityInput('0,5')).toMatchObject({ value: 0.5, error: null });
    expect(parseQuantityInput('0.5')).toMatchObject({ value: 0.5, error: null });
    expect(parseQuantityInput('1.000').error).toBe('ambiguous');
    expect(parseQuantityInput('-2').error).toBe('negative');
    expect(parseQuantityInput('2 chỉ').error).toBe('invalid');
  });

  it('accepts unambiguous VND grouping without deleting invalid characters', () => {
    expect(parseVndInput('29000000').value).toBe(29_000_000);
    expect(parseVndInput('29.000.000').value).toBe(29_000_000);
    expect(parseVndInput('29,000,000').value).toBe(29_000_000);
    expect(parseVndInput('-100').error).toBe('negative');
    expect(parseVndInput('1e6').error).toBe('invalid');
    expect(parseVndInput('29,5').error).toBe('invalid');
  });

  it('parses million-of-VND amounts without turning 29,5 into 295', () => {
    expect(parseMillionInput('29,5').value).toBe(29_500_000);
    expect(parseMillionInput('29.5').value).toBe(29_500_000);
    expect(parseMillionInput('29,5 triệu').error).toBe('invalid');
  });
});
