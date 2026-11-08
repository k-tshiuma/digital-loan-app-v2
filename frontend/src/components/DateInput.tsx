import React, { useEffect, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { Language } from '../types';
import { t } from '../i18n/translations';
import { formatDate } from '../i18n/format';

/**
 * Date field in the app's format: day, month and year boxes with the language's separator
 * (21/10/2026 in English, 21.10.2026 in Hebrew). A native <input type="date"> shows the
 * browser's own format instead (mm/dd/yyyy in an English-locale browser).
 *
 * Separate boxes avoid the caret problems of a single masked field (typing into a full or
 * prefilled date). The value is an ISO date ("2026-10-21"), or '' while the date is empty or
 * incomplete, so forms keep their validation. The calendar button opens the browser's picker.
 */
interface DateInputProps {
  /** Given to the day box, so <label htmlFor={id}> focuses it. */
  id: string;
  value: string | undefined;
  onChange: (isoDate: string) => void;
  language: Language;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  /** Border and focus classes for the boxes (e.g. error state). */
  className?: string;
}

type Parts = { day: string; month: string; year: string };

/** The separator the language uses in dates, taken from formatDate so both stay the same. */
export const dateSeparator = (lang: Language) => formatDate('2026-01-02', lang).replace(/\d/g, '').charAt(0) || '/';

export function isoToParts(iso: string | undefined): Parts {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? { day: m[3], month: m[2], year: m[1] } : { day: '', month: '', year: '' };
}

/** A complete, real date as ISO, or null (incomplete, or impossible such as 31.02). */
export function partsToIso({ day, month, year }: Parts): string | null {
  if (!/^\d{1,2}$/.test(day) || !/^\d{1,2}$/.test(month) || !/^\d{4}$/.test(year)) return null;
  const [d, m, y] = [Number(day), Number(month), Number(year)];
  if (y < 1900 || m < 1 || m > 12 || d < 1) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const SIZES: Record<keyof Parts, number> = { day: 2, month: 2, year: 4 };
const ORDER: Array<keyof Parts> = ['day', 'month', 'year'];

export const DateInput: React.FC<DateInputProps> = ({ id, value, onChange, language, min, max, required, disabled = false, className = '' }) => {
  const [parts, setParts] = useState<Parts>(() => isoToParts(value));
  const [touched, setTouched] = useState(false);
  const dayRef = useRef<HTMLInputElement>(null);
  const monthRef = useRef<HTMLInputElement>(null);
  const yearRef = useRef<HTMLInputElement>(null);
  const refs = { day: dayRef, month: monthRef, year: yearRef };
  const groupRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);

  // Outside changes (prefill, calendar picker) replace the boxes; a date being typed is kept.
  useEffect(() => {
    if ((value || '') !== (partsToIso(parts) || '') && (value || partsToIso(parts))) setParts(isoToParts(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const update = (next: Parts) => {
    setParts(next);
    const iso = partsToIso(next) || '';
    if (iso !== (value || '')) onChange(iso);
  };

  const handleChange = (field: keyof Parts, raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, SIZES[field]);
    update({ ...parts, [field]: digits });
    // Move on when the box is full, or when the user typed a separator after one digit ("1.").
    const nextField = ORDER[ORDER.indexOf(field) + 1];
    if (nextField && (digits.length === SIZES[field] || (/\D$/.test(raw) && digits.length > 0))) {
      refs[nextField].current?.focus();
      refs[nextField].current?.select();
    }
  };

  const handleKeyDown = (field: keyof Parts, e: React.KeyboardEvent<HTMLInputElement>) => {
    const prevField = ORDER[ORDER.indexOf(field) - 1];
    if (e.key === 'Backspace' && parts[field] === '' && prevField) {
      e.preventDefault();
      refs[prevField].current?.focus();
    }
  };

  // Paste "21.10.2026" or "21/10/2026" into any box.
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const m = /^\s*(\d{1,2})\D(\d{1,2})\D(\d{4})\s*$/.exec(e.clipboardData.getData('text'));
    if (!m) return;
    e.preventDefault();
    update({ day: m[1].padStart(2, '0'), month: m[2].padStart(2, '0'), year: m[3] });
    refs.year.current?.focus();
  };

  const openPicker = () => {
    const picker = pickerRef.current;
    if (!picker) return;
    try {
      if (typeof picker.showPicker === 'function') picker.showPicker();
      else picker.click();
    } catch {
      picker.click();
    }
  };

  const filledAny = ORDER.some((f) => parts[f] !== '');
  const invalid = touched && filledAny && partsToIso(parts) === null;
  const sep = dateSeparator(language);
  const box = (field: keyof Parts, width: string) => (
    <input
      ref={refs[field]}
      id={field === 'day' ? id : `${id}-${field}`}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      maxLength={SIZES[field] + 1}
      required={required}
      disabled={disabled}
      value={parts[field]}
      placeholder={t(language, `date.${field}Placeholder`)}
      aria-label={field === 'day' ? undefined : t(language, `date.${field}`)}
      title={t(language, `date.${field}`)}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? `${id}-invalid` : undefined}
      onChange={(e) => handleChange(field, e.target.value)}
      onKeyDown={(e) => handleKeyDown(field, e)}
      onPaste={handlePaste}
      onFocus={(e) => e.target.select()}
      className={`${width} min-w-0 px-2 py-3 rounded-xl border bg-white text-slate-900 text-sm font-medium text-center tabular-nums focus:outline-none focus:ring-2 transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
        invalid ? 'border-red-400 focus:ring-red-200' : className
      }`}
    />
  );

  return (
    <div className="space-y-1">
      <div className="flex items-stretch gap-2">
        {/* Day, month, year read left to right in both languages, like the dates shown elsewhere. */}
        <div
          ref={groupRef}
          dir="ltr"
          className="flex-1 min-w-0 flex items-center gap-1.5"
          onBlur={(e) => {
            if (!groupRef.current?.contains(e.relatedTarget as Node | null)) setTouched(true);
          }}
        >
          {box('day', 'w-14')}
          <span className="text-slate-400 font-bold" aria-hidden="true">{sep}</span>
          {box('month', 'w-14')}
          <span className="text-slate-400 font-bold" aria-hidden="true">{sep}</span>
          {box('year', 'flex-1 max-w-24')}
        </div>
        <div className="relative shrink-0">
          <button
            type="button"
            disabled={disabled}
            onClick={openPicker}
            aria-label={t(language, 'date.openCalendar')}
            title={t(language, 'date.openCalendar')}
            className="h-full w-12 rounded-xl border border-slate-300 bg-white text-slate-600 hover:text-blue-900 hover:border-blue-900 flex items-center justify-center transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <CalendarDays className="w-5 h-5" />
          </button>
          {/* The browser's date picker, opened by the button. Not focusable or announced on its own. */}
          <input
            ref={pickerRef}
            type="date"
            tabIndex={-1}
            aria-hidden="true"
            disabled={disabled}
            min={min}
            max={max}
            value={value || ''}
            onChange={(e) => {
              setTouched(false);
              setParts(isoToParts(e.target.value));
              onChange(e.target.value);
            }}
            className="absolute inset-0 opacity-0 pointer-events-none"
          />
        </div>
      </div>
      {invalid && (
        <p id={`${id}-invalid`} className="text-xs text-red-600">
          {t(language, 'date.invalid')}
        </p>
      )}
    </div>
  );
};
