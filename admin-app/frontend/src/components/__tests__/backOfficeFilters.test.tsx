// Found in the browser check: the "All statuses" chip showed the server's 3-step count (112) while the
// table listed every application (302), and Escape did not close the detail window.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BackOffice } from '../BackOffice';
import { flowGroupLabel } from '@quickloan/ui-core/i18n/options';
import { t } from '@quickloan/ui-core/i18n/translations';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const renderBackOffice = () =>
  render(<BackOffice language="en" currentRole="credit_reviewer" onRoleChange={() => {}} onCloseBackOffice={() => {}} />);

/** Rows in the applications table (without the header), or 0 when the "no matches" message shows. */
function tableRows(): number {
  if (screen.queryByText(t('en', 'bo.noMatches'))) return 0;
  return within(screen.getByRole('table')).getAllByRole('row').length - 1;
}

const countIn = (label: string) => Number(/\((\d+)\)\s*$/.exec(label)?.[1]);

describe('Back office filter chips', () => {
  it('each chip shows the number of rows the table lists when it is selected', async () => {
    const user = userEvent.setup();
    renderBackOffice();
    const chips = [
      t('en', 'bo.allStatuses', { n: '' }).replace(' ()', ''),
      ...['pending', 'in_progress', 'approved_stage', 'completed', 'approved_final', 'rejected'].map((g) => flowGroupLabel('en', g)),
    ];
    let checked = 0;
    for (const prefix of chips) {
      const chip = screen.getAllByRole('button').find((b) => b.textContent?.startsWith(`${prefix} (`));
      expect(chip, prefix).toBeTruthy();
      await user.click(chip!);
      expect(tableRows(), prefix).toBe(countIn(chip!.textContent || ''));
      checked++;
    }
    expect(checked).toBe(7);
  });
});

describe('Back office detail window', () => {
  it('closes with Escape, but not while typing in a field', async () => {
    const user = userEvent.setup();
    renderBackOffice();
    const firstInspect = within(screen.getByRole('table')).getAllByRole('button', { name: new RegExp(t('en', 'bo.inspect')) })[0];
    await user.click(firstInspect);
    const closeButton = () => screen.queryAllByRole('button').find((b) => /close/i.test(b.getAttribute('aria-label') || b.textContent || ''));
    expect(closeButton()).toBeTruthy();

    const field = screen.queryAllByRole('textbox').find((el) => el.closest('.fixed'));
    if (field) {
      field.focus();
      await user.keyboard('{Escape}');
      expect(closeButton()).toBeTruthy();
      (document.activeElement as HTMLElement | null)?.blur();
    }

    await user.keyboard('{Escape}');
    expect(closeButton()).toBeFalsy();
  });
});
