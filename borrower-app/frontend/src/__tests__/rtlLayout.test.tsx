// Phase 4 (T4.2): in Hebrew, phone numbers, codes, IDs and emails stay left-to-right.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Step2Auth } from '../components/Step2Auth';
import { Step10SubmissionSuccess } from '../components/Step10SubmissionSuccess';
import { Step11StatusTimeline } from '../components/Step11StatusTimeline';
import { t } from '@quickloan/ui-core/i18n/translations';
import { LoanApplication } from '@quickloan/ui-core/types';

/** The direction an element gets from its nearest `dir` attribute (as the browser would). */
const dirOf = (el: Element | null) => el?.closest('[dir]')?.getAttribute('dir');

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  document.documentElement.dir = 'rtl';
  document.documentElement.lang = 'he';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const submittedApp = {
  id: 'app_rtl',
  requestNumber: 'QL-2026-0042',
  status: 'Received',
  isSubmitted: true,
  documents: [],
  statusHistory: [],
  guarantors: [{ id: 'g1', fullName: 'דנה', passportOrIdNumber: 'AB123', mobilePhoneNumber: '+972501112233', relationship: 'Friend' }],
} as unknown as LoanApplication;

describe('Left-to-right content inside Hebrew screens (T4.2)', () => {
  it('sign-in phone field (country code + number) is LTR', () => {
    const { container } = render(<Step2Auth language="he" onAuthenticated={() => {}} onBack={() => {}} />);
    expect(dirOf(container.querySelector('#signin-phone-input'))).toBe('ltr');
    expect(dirOf(container.querySelector('#signin-country-code-select'))).toBe('ltr');
  });

  it('OTP boxes and the phone number they were sent to are LTR', async () => {
    const user = userEvent.setup();
    const { container } = render(<Step2Auth language="he" onAuthenticated={() => {}} onBack={() => {}} />);
    // The phone field is pre-filled with a demo number; continuing opens the SMS code screen.
    await user.click(screen.getByRole('button', { name: t('he', 'continue') }));
    const boxes = await screen.findAllByRole('textbox');
    const otpRow = boxes[0].parentElement!;
    expect(otpRow.children.length).toBe(6);
    expect(dirOf(otpRow)).toBe('ltr');
    const phone = [...container.querySelectorAll('span')].find((s) => s.textContent?.startsWith('+972'));
    expect(dirOf(phone!)).toBe('ltr');
  });

  it('registration email and phone inputs are LTR', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: {} }) },
    });
    const { container } = render(<Step2Auth language="he" onAuthenticated={() => {}} onBack={() => {}} />);
    await user.click(screen.getByRole('button', { name: t('he', 'auth.createYourAccount') }));
    await user.click(screen.getByRole('button', { name: t('he', 'auth.grantLocation') }));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: t('he', 'auth.continueToRegistration') }));

    expect(dirOf(container.querySelector('#reg-email-input'))).toBe('ltr');
    expect(dirOf(container.querySelector('#reg-phone-input'))).toBe('ltr');
    // The name field takes Hebrew or Latin text, so it follows the page direction.
    expect(dirOf(container.querySelector('#reg-fullname-input'))).toBe('rtl');
  });

  it('request number on the success screen is LTR', () => {
    render(<Step10SubmissionSuccess language="he" application={submittedApp} onTrackStatus={() => {}} />);
    expect(dirOf(screen.getByText('QL-2026-0042'))).toBe('ltr');
  });

  it('request number, guarantor ID and phone on the status screen are LTR', async () => {
    const user = userEvent.setup();
    render(
      <Step11StatusTimeline language="he" application={submittedApp} onApplicationUpdated={() => {}} onStartNewApplication={() => {}} />
    );
    expect(dirOf(screen.getByText('QL-2026-0042'))).toBe('ltr');
    await user.click(screen.getByRole('button', { name: t('he', 'status.loanPackage') }));
    expect(dirOf(screen.getByText('AB123'))).toBe('ltr');
    expect(dirOf(screen.getByText('+972501112233'))).toBe('ltr');
  });
});
