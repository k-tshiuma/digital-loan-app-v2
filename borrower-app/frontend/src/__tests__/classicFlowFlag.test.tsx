// The classic wizard bypasses the 3-step approvals, so its entry link only shows when
// VITE_ENABLE_CLASSIC_FLOW=true.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { LanguageProvider } from '@quickloan/ui-core/i18n/LanguageContext';
import { storageService } from '../services/storage';
import { t } from '@quickloan/ui-core/i18n/translations';
import { isClassicFlowEnabled } from '../utils/featureFlags';

beforeEach(() => {
  // Backend offline.
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  window.scrollTo = vi.fn() as any;
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  storageService.logout();
});

describe('isClassicFlowEnabled', () => {
  it('is off unless the setting is exactly true', () => {
    expect(isClassicFlowEnabled()).toBe(false);
    for (const off of ['', 'false', '0', 'yes']) {
      vi.stubEnv('VITE_ENABLE_CLASSIC_FLOW', off);
      expect(isClassicFlowEnabled()).toBe(false);
    }
    vi.stubEnv('VITE_ENABLE_CLASSIC_FLOW', 'true');
    expect(isClassicFlowEnabled()).toBe(true);
    vi.stubEnv('VITE_ENABLE_CLASSIC_FLOW', ' TRUE ');
    expect(isClassicFlowEnabled()).toBe(true);
  });
});

/** Tests start in the classic wizard; go to the 3-step flow, where the link lives. */
async function openThreeStepFlow() {
  render(<LanguageProvider><App /></LanguageProvider>);
  await userEvent.click(await screen.findByText(t('en', 'flow.backToFlow')));
}

describe('classic wizard link on the 3-step flow', () => {
  it('is hidden by default', async () => {
    await openThreeStepFlow();
    expect(screen.queryByText(t('en', 'flow.classicWizard'))).toBeNull();
  });

  it('shows and opens the classic wizard when the setting is on', async () => {
    vi.stubEnv('VITE_ENABLE_CLASSIC_FLOW', 'true');
    await openThreeStepFlow();
    await userEvent.click(screen.getByText(t('en', 'flow.classicWizard')));
    expect(await screen.findByText(t('en', 'flow.backToFlow'))).toBeTruthy();
  });
});
