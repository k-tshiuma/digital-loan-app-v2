// Login/reload bug: after a backend login the app saved a locally made-up user id, so after a
// reload every API call for the user (active application, notifications, history) returned 403.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { LanguageProvider } from '../i18n/LanguageContext';
import { storageService } from '../services/storage';
import { authTokens } from '../services/api';
import { t } from '../i18n/translations';
import { User } from '../types';

const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwtFor = (sub: string) => `${b64({ alg: 'HS256' })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;

const serverUser = (id: string, phoneNumber: string): User => ({
  id,
  phoneNumber,
  preferredLanguage: 'en',
  roles: ['borrower'],
  isActive: true,
  createdAt: '2026-10-22T00:00:00Z',
  updatedAt: '2026-10-22T00:00:00Z',
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  storageService.logout();
  authTokens.clear();
});

describe('storageService.adoptUser', () => {
  it('keeps the backend id and merges the local copy (drafts, notifications, offline password)', () => {
    const phone = `+97250${Math.floor(1000000 + Math.random() * 8999999)}`;
    const local = storageService.registerUser({ email: '', fullName: 'Local Copy', phoneNumber: phone, password: 'Secret#123', preferredLanguage: 'en' }).user!;
    const draft = storageService.getOrCreateActiveApplication(local, 'en');
    storageService.createNotification({ userId: local.id, channel: 'sms', title: 'T', message: 'M' });

    const adopted = storageService.adoptUser(serverUser('user_server_1', phone));

    expect(adopted.id).toBe('user_server_1');
    expect(storageService.getCurrentUser()?.id).toBe('user_server_1');
    expect(storageService.getAllApplications().find((a) => a.id === draft.id)?.userId).toBe('user_server_1');
    expect(storageService.getNotifications('user_server_1').some((n) => n.title === 'T')).toBe(true);
    expect(storageService.findUserByPhone(phone)?.id).toBe('user_server_1');
    expect(adopted.password).toBe('Secret#123');
    expect(adopted.fullName).toBe('Local Copy');
  });
});

describe('storageService.restoreSession', () => {
  it('repairs a browser that saved a local user id: the session takes the id in the token', () => {
    const phone = `+97252${Math.floor(1000000 + Math.random() * 8999999)}`;
    const local = storageService.registerUser({ email: '', fullName: 'Old Session', phoneNumber: phone, password: 'Secret#123', preferredLanguage: 'he' }).user!;
    const draft = storageService.getOrCreateActiveApplication(local, 'he');

    const restored = storageService.restoreSession('user_server_2');

    expect(restored?.id).toBe('user_server_2');
    expect(restored?.preferredLanguage).toBe('he');
    expect(storageService.getAllApplications().find((a) => a.id === draft.id)?.userId).toBe('user_server_2');
  });

  it('without a token it returns the saved local user unchanged (offline mode)', () => {
    const phone = `+97253${Math.floor(1000000 + Math.random() * 8999999)}`;
    const local = storageService.registerUser({ email: '', fullName: 'Offline', phoneNumber: phone, password: 'Secret#123', preferredLanguage: 'en' }).user!;
    expect(storageService.restoreSession(null)?.id).toBe(local.id);
  });
});

describe('OTP login, then reload (App)', () => {
  let calls: string[] = [];
  const SERVER_ID = 'user_srv_reload_1';
  const local = `50${Math.floor(1000000 + Math.random() * 8999999)}`;

  beforeEach(() => {
    calls = [];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.scrollTo = vi.fn() as any;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url).replace(/^.*\/api/, '');
        calls.push(`${init?.method || 'GET'} ${path}`);
        const ok = (body: object) => new Response(JSON.stringify({ success: true, ...body }), { status: 200 });
        if (path === '/users/lookup') return ok({ exists: true, hasPassword: false });
        if (path === '/users/request-otp') return ok({ expiresInSeconds: 300, demoCode: '123456' });
        if (path === '/users/verify-otp') return ok({ user: serverUser(SERVER_ID, `+972${local}`), token: jwtFor(SERVER_ID) });
        if (path.startsWith(`/applications/active/${SERVER_ID}`)) return ok({ application: null });
        if (path.startsWith(`/notifications/${SERVER_ID}`)) return ok({ notifications: [], unreadCount: 0 });
        if (path.startsWith('/applications/active/') || path.startsWith('/notifications/')) {
          return new Response(JSON.stringify({ success: false, error: 'Forbidden' }), { status: 403 });
        }
        return ok({});
      })
    );
  });

  // The whole App renders here. With the full suite running files in parallel this can take longer
  // than waitFor's 1 s default, so the waits get more room.
  const slow = { timeout: 5000 };

  const renderApp = () =>
    render(
      <LanguageProvider initialLanguage="en">
        <App />
      </LanguageProvider>
    );

  it('keeps the backend user id across a reload, and sign-out drops the token', async () => {
    const ui = userEvent.setup();
    const first = renderApp();

    await ui.clear(document.querySelector('#signin-phone-input') as HTMLInputElement);
    await ui.type(document.querySelector('#signin-phone-input') as HTMLInputElement, local);
    await ui.click(screen.getByRole('button', { name: t('en', 'continue') }));
    const boxes = await waitFor(() => {
      const found = document.querySelectorAll<HTMLInputElement>('input[inputmode="numeric"][maxlength="1"]');
      expect(found.length).toBe(6);
      return found;
    }, slow);
    // Step2Auth focuses the first box 150 ms after the code is sent. Typing before that lets the late
    // focus steal a digit (the code is then never complete), so wait for it like a user would.
    await waitFor(() => expect(document.activeElement).toBe(boxes[0]), slow);
    for (let i = 0; i < 6; i++) await ui.type(boxes[i], String(i + 1));

    await waitFor(() => expect(storageService.getCurrentUser()?.id).toBe(SERVER_ID), slow);
    expect(authTokens.subject()).toBe(SERVER_ID);

    // "Reload": unmount and mount the app again.
    first.unmount();
    calls = [];
    renderApp();
    await waitFor(() => expect(calls).toContain(`GET /applications/active/${SERVER_ID}`), slow);
    expect(calls.filter((c) => c.startsWith('GET /applications/active/') && !c.endsWith(SERVER_ID))).toEqual([]);

    // Sign out clears the token, so a reload does not sign the user back in.
    await ui.click(document.querySelector('#header-user-menu-btn') as HTMLElement);
    await ui.click(document.querySelector('#user-signout-btn') as HTMLElement);
    expect(authTokens.get()).toBeNull();
    expect(storageService.getCurrentUser()).toBeNull();
  }, 20000);
});
