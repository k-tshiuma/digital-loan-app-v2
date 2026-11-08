// Date fields follow the app language (21/10/2026 in English, 21.10.2026 in Hebrew), not the
// browser locale that a native <input type="date"> uses.
import fs from 'fs';
import path from 'path';
import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DateInput, dateSeparator, isoToParts, partsToIso } from '@quickloan/ui-core/components/DateInput';
import { t } from '@quickloan/ui-core/i18n/translations';
import { Language } from '@quickloan/ui-core/types';

describe('date helpers', () => {
  it('use the same separator as formatDate', () => {
    expect(dateSeparator('en')).toBe('/');
    expect(dateSeparator('he')).toBe('.');
  });

  it('split and join ISO dates', () => {
    expect(isoToParts('2026-10-21')).toEqual({ day: '21', month: '10', year: '2026' });
    expect(isoToParts('')).toEqual({ day: '', month: '', year: '' });
    expect(partsToIso({ day: '21', month: '10', year: '2026' })).toBe('2026-10-21');
    expect(partsToIso({ day: '5', month: '3', year: '1990' })).toBe('1990-03-05');
  });

  it('accept only real, complete dates', () => {
    expect(partsToIso({ day: '29', month: '02', year: '2028' })).toBe('2028-02-29');
    expect(partsToIso({ day: '31', month: '02', year: '2026' })).toBeNull();
    expect(partsToIso({ day: '21', month: '13', year: '2026' })).toBeNull();
    expect(partsToIso({ day: '21', month: '10', year: '20' })).toBeNull();
  });
});

function Harness({ language, initial = '', onChange }: { language: Language; initial?: string; onChange?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="d">Date</label>
      <DateInput id="d" language={language} value={value} onChange={(v) => { setValue(v); onChange?.(v); }} />
      <output data-testid="value">{value}</output>
      <button type="button">elsewhere</button>
    </>
  );
}

const boxes = (lang: Language) => ({
  day: screen.getByLabelText('Date') as HTMLInputElement,
  month: screen.getByLabelText(t(lang, 'date.month')) as HTMLInputElement,
  year: screen.getByLabelText(t(lang, 'date.year')) as HTMLInputElement,
});

describe('<DateInput>', () => {
  it('Hebrew: day, month and year boxes with "." between them, and an ISO value', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness language="he" />);
    const b = boxes('he');
    expect(b.day.placeholder).toBe(t('he', 'date.dayPlaceholder'));
    expect(container.querySelector('[dir="ltr"]')?.textContent).toContain('.');
    await user.click(b.day);
    await user.keyboard('21102026'); // moves to the next box when one is full
    expect([b.day.value, b.month.value, b.year.value]).toEqual(['21', '10', '2026']);
    expect(screen.getByTestId('value').textContent).toBe('2026-10-21');
  });

  it('English: "/" between the boxes', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness language="en" />);
    expect(container.querySelector('[dir="ltr"]')?.textContent).toContain('/');
    await user.click(boxes('en').day);
    await user.keyboard('05031990');
    expect(screen.getByTestId('value').textContent).toBe('1990-03-05');
  });

  it('a separator after one digit moves on ("5.3.1990")', async () => {
    const user = userEvent.setup();
    render(<Harness language="he" />);
    await user.click(boxes('he').day);
    await user.keyboard('5.3.1990');
    expect(screen.getByTestId('value').textContent).toBe('1990-03-05');
  });

  it('typing over a prefilled date replaces it (each box selects its content on focus)', async () => {
    const user = userEvent.setup();
    render(<Harness language="he" initial="2027-10-21" />);
    const b = boxes('he');
    expect([b.day.value, b.month.value, b.year.value]).toEqual(['21', '10', '2027']);
    await user.click(b.day);
    await user.keyboard('30042028');
    expect(screen.getByTestId('value').textContent).toBe('2028-04-30');
  });

  it('Backspace in an empty box goes back to the previous one', async () => {
    const user = userEvent.setup();
    render(<Harness language="he" />);
    const b = boxes('he');
    await user.click(b.day);
    await user.keyboard('21');
    expect(document.activeElement).toBe(b.month);
    await user.keyboard('{Backspace}');
    expect(document.activeElement).toBe(b.day);
  });

  it('pasting a whole date fills all three boxes', async () => {
    const user = userEvent.setup();
    render(<Harness language="en" />);
    await user.click(boxes('en').day);
    await user.paste('21/10/2026');
    expect(screen.getByTestId('value').textContent).toBe('2026-10-21');
  });

  it('an impossible date gives no value and a message after leaving the field', async () => {
    const user = userEvent.setup();
    render(<Harness language="he" />);
    await user.click(boxes('he').day);
    await user.keyboard('31022026');
    expect(screen.getByTestId('value').textContent).toBe('');
    await user.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.getByText(t('he', 'date.invalid'))).toBeInTheDocument();
  });

  it('the calendar button opens the browser picker, and a picked date fills the boxes', () => {
    const onChange = vi.fn();
    const { container } = render(<Harness language="he" onChange={onChange} />);
    const picker = container.querySelector('input[type="date"]') as HTMLInputElement;
    const showPicker = vi.fn();
    (picker as any).showPicker = showPicker;
    fireEvent.click(screen.getByRole('button', { name: t('he', 'date.openCalendar') }));
    expect(showPicker).toHaveBeenCalled();

    fireEvent.change(picker, { target: { value: '2027-04-30' } });
    expect(onChange).toHaveBeenLastCalledWith('2027-04-30');
    const b = boxes('he');
    expect([b.day.value, b.month.value, b.year.value]).toEqual(['30', '04', '2027']);
  });
});

describe('Guard', () => {
  it('no component shows a native date field directly (they show the browser format)', () => {
    // App components and the shared components (shared/frontend).
    const dirs = [path.resolve(__dirname, '..'), path.resolve(__dirname, '../../../../shared/frontend/components')];
    const offenders = dirs.flatMap((dir) =>
      fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.tsx') && f !== 'DateInput.tsx')
        .filter((f) => /type=["']date["']/.test(fs.readFileSync(path.join(dir, f), 'utf8')))
    );
    expect(offenders).toEqual([]);
  });
});
