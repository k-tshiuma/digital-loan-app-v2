// Phase 5 (T5.1): amounts and dates follow the app language, not the browser locale.
// ICU spacing varies (narrow no-break spaces, RTL marks), so assertions use regex on normalised text.
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { formatCurrency, formatDate, formatDateTime, formatNumber, formatTime } from '../../i18n/format';
import { LanguageProvider, useI18n } from '../../i18n/LanguageContext';

// Drop bidi marks and turn every kind of space into a plain one.
const norm = (s: string) => s.replace(/[‎‏؜]/g, '').replace(/[\s  ]+/g, ' ').trim();

describe('formatCurrency', () => {
  it('Hebrew: 12,500 followed by ₪', () => {
    expect(norm(formatCurrency(12500, 'he'))).toMatch(/^12,500 ?₪$/);
  });

  it('English: ₪ before 12,500', () => {
    expect(norm(formatCurrency(12500, 'en'))).toMatch(/^₪ ?12,500$/);
  });

  it('keeps two decimals only for fractional amounts', () => {
    expect(norm(formatCurrency(1234.5, 'en'))).toMatch(/1,234\.50/);
    expect(norm(formatCurrency(500, 'en'))).not.toMatch(/\./);
  });

  it('accepts numeric strings and shows a dash for missing values', () => {
    expect(norm(formatCurrency('3000', 'he'))).toMatch(/3,000/);
    expect(formatCurrency(undefined, 'he')).toBe('—');
    expect(formatCurrency(null, 'en')).toBe('—');
    expect(formatCurrency('abc', 'en')).toBe('—');
  });

  it('uses Western digits in Hebrew', () => {
    expect(formatCurrency(9876, 'he')).toMatch(/9,876/);
  });
});

describe('formatNumber', () => {
  it('groups thousands in both languages', () => {
    expect(formatNumber(8000, 'en')).toBe('8,000');
    expect(formatNumber(8000, 'he')).toBe('8,000');
  });
});

describe('formatDate', () => {
  it('Hebrew uses day.month.year', () => {
    expect(norm(formatDate('2026-10-21', 'he'))).toBe('21.10.2026');
  });

  it('English uses day/month/year (Israeli order)', () => {
    expect(norm(formatDate('2026-10-21', 'en'))).toBe('21/10/2026');
  });

  it('does not shift date-only values across time zones', () => {
    expect(norm(formatDate('2026-01-01', 'he'))).toBe('01.01.2026');
  });

  it('formats timestamps in Israel time', () => {
    // 22:30 UTC on 21 Oct is already 22 Oct in Israel (UTC+3 in October).
    expect(norm(formatDate('2026-10-21T22:30:00Z', 'he'))).toBe('22.10.2026');
  });

  it('returns unparseable strings unchanged and a dash for empty values', () => {
    expect(formatDate('not a date', 'en')).toBe('not a date');
    expect(formatDate(undefined, 'en')).toBe('—');
  });
});

describe('formatTime / formatDateTime', () => {
  it('uses a 24-hour clock in Israel time', () => {
    expect(norm(formatTime('2026-10-21T14:05:00Z', 'en'))).toBe('17:05');
    expect(norm(formatTime('2026-10-21T14:05:00Z', 'he'))).toBe('17:05');
  });

  it('joins date and time', () => {
    expect(norm(formatDateTime('2026-10-21T14:05:00Z', 'he'))).toBe('21.10.2026, 17:05');
  });
});

describe('useI18n formatters', () => {
  it('follow the current language', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(LanguageProvider, { initialLanguage: 'en', children });
    const { result } = renderHook(() => useI18n(), { wrapper });
    expect(norm(result.current.formatCurrency(12500))).toMatch(/^₪ ?12,500$/);
    act(() => result.current.setLanguage('he'));
    expect(norm(result.current.formatCurrency(12500))).toMatch(/^12,500 ?₪$/);
    expect(norm(result.current.formatDate('2026-10-21'))).toBe('21.10.2026');
  });
});
