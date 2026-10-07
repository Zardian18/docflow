import { describe, expect, it } from 'vitest';
import { formatAmount, formatFileSize } from './format';

describe('formatAmount', () => {
  it('uses Indian grouping for INR', () => {
    expect(formatAmount('125000.5', 'INR')).toBe('₹1,25,000.50');
  });

  it('uses the currency’s own symbol otherwise', () => {
    expect(formatAmount('1234.5', 'USD')).toBe('$1,234.50');
  });

  it('falls back gracefully for unknown codes', () => {
    expect(formatAmount('10', 'ZZZ')).toMatch(/ZZZ\s?10\.00/);
  });
});

describe('formatFileSize', () => {
  it('picks a readable unit', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(2048)).toBe('2 KB');
    expect(formatFileSize(10 * 1024 * 1024)).toBe('10.0 MB');
  });
});
