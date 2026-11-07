import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FlowEntry } from '../FlowEntry';
import { apiService, ApiError } from '../../services/api';
import { FlowApplicationView, User } from '@quickloan/ui-core/types';

const user = { id: 'user_1', phoneNumber: '+972501234567', fullName: 'Somchai Prasert' } as unknown as User;
const app = { id: 'app_1', needsRegistrationConsent: false } as unknown as FlowApplicationView;

function mockGeolocation(result: 'granted' | 'denied' | 'unavailable') {
  const getCurrentPosition = vi.fn((ok: PositionCallback, fail: PositionErrorCallback) => {
    if (result === 'granted') ok({ coords: { latitude: 32.0853, longitude: 34.7818, accuracy: 20 } } as GeolocationPosition);
    else fail({ code: result === 'denied' ? 1 : 3 } as GeolocationPositionError);
  });
  Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });
  return getCurrentPosition;
}

const renderEntry = (props: Partial<React.ComponentProps<typeof FlowEntry>> = {}) => {
  const onAuthenticated = vi.fn();
  const onApplicationUpdated = vi.fn();
  render(<FlowEntry language="en" mode="auth" onAuthenticated={onAuthenticated} onApplicationUpdated={onApplicationUpdated} {...props} />);
  return { onAuthenticated, onApplicationUpdated };
};

describe('FlowEntry', () => {
  afterEach(() => vi.restoreAllMocks());

  it('starts with sign-in, not with Step 1 or the location request', () => {
    renderEntry();
    expect(screen.getByRole('heading', { name: 'Sign in to QuickLoan' })).toBeInTheDocument();
    expect(screen.queryByText('Location required')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create your account' })).toBeInTheDocument();
  });

  it('signs in with phone + password when the account has a password', async () => {
    const u = userEvent.setup();
    vi.spyOn(apiService, 'lookupPhone').mockResolvedValue({ exists: true, hasPassword: true });
    const login = vi.spyOn(apiService, 'loginWithPassword').mockResolvedValue(user);
    const { onAuthenticated } = renderEntry();

    await u.type(screen.getByLabelText('Mobile phone number or email'), '0501234567');
    await u.click(screen.getByRole('button', { name: 'Continue' }));
    await u.type(await screen.findByLabelText('Password'), 'Secret123!');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(user));
    expect(login).toHaveBeenCalledWith('0501234567', 'Secret123!');
  });

  it('sends an unknown phone number to registration instead of creating an account', async () => {
    const u = userEvent.setup();
    vi.spyOn(apiService, 'lookupPhone').mockResolvedValue({ exists: false, hasPassword: false });
    const otp = vi.spyOn(apiService, 'requestOtp');
    renderEntry();

    await u.type(screen.getByLabelText('Mobile phone number or email'), '0509999999');
    await u.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText(/could not find an account/i)).toBeInTheDocument();
    expect(otp).not.toHaveBeenCalled();
  });

  it('blocks registration while location access is denied', async () => {
    const u = userEvent.setup();
    mockGeolocation('denied');
    renderEntry();

    await u.click(screen.getByRole('button', { name: 'Create your account' }));
    expect(screen.getByText('Registration · step 1 of 3')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Grant location access' }));

    expect(await screen.findByText(/Location access was denied/)).toBeInTheDocument();
    expect(screen.queryByText('Regulatory & Intermediary Disclaimer')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('registers manually after location + conditions, sending the consent with the account', async () => {
    const u = userEvent.setup();
    mockGeolocation('granted');
    vi.spyOn(apiService, 'requestOtp').mockResolvedValue({ demoCode: '123456', expiresInSeconds: 300 });
    const register = vi.spyOn(apiService, 'flowRegister').mockResolvedValue({ user, token: 't', application: app });
    const { onAuthenticated } = renderEntry();

    await u.click(screen.getByRole('button', { name: 'Create your account' }));
    await u.click(screen.getByRole('button', { name: 'Grant location access' }));
    // Conditions must be accepted
    await u.click(await screen.findByRole('button', { name: 'Continue to Registration' }));
    expect(screen.getByText('Please check the box to accept regulatory disclosures.')).toBeInTheDocument();
    await u.click(screen.getByRole('checkbox'));
    await u.click(screen.getByRole('button', { name: 'Continue to Registration' }));

    expect(await screen.findByText('Registration · step 3 of 3')).toBeInTheDocument();
    await u.type(screen.getByLabelText(/Full name/), 'Somchai Prasert');
    await u.type(screen.getByLabelText(/Mobile number/), '0501234567');
    await u.click(screen.getByRole('button', { name: 'Send SMS code' }));
    await u.type(screen.getByLabelText(/Email address/), 'somchai@example.com');
    await u.type(screen.getByLabelText(/^Password/), 'Secret123!');
    await u.type(screen.getByLabelText(/Confirm password/), 'Secret123!');
    await u.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(user, app));
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({
        fullName: 'Somchai Prasert',
        email: 'somchai@example.com',
        code: '123456',
        registration: { disclaimerAccepted: true, locationGranted: true, location: { latitude: 32.0853, longitude: 34.7818, accuracy: 20 } },
      })
    );
  });

  it('moves an unregistered Google account to registration and reuses it after the consent', async () => {
    const u = userEvent.setup();
    mockGeolocation('unavailable'); // permission granted, no fix: allowed without a position
    const google = vi
      .spyOn(apiService, 'flowGoogle')
      .mockRejectedValueOnce(new ApiError('No account was found. Please register first.', 400, { code: 'REGISTRATION_REQUIRED' }))
      .mockResolvedValueOnce({ user, token: 't', application: app });
    const { onAuthenticated } = renderEntry();

    await u.click(screen.getByRole('button', { name: 'Continue with Google' }));
    await u.type(screen.getByLabelText('Google email'), 'maria@gmail.com');
    await u.type(screen.getByLabelText('Name on the Google account'), 'Maria Santos');
    await u.click(screen.getByRole('button', { name: 'Continue with Google' }));

    expect(await screen.findByText(/This Google account is not registered yet/)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Grant location access' }));
    await u.click(await screen.findByRole('checkbox'));
    await u.click(screen.getByRole('button', { name: 'Continue to Registration' }));
    await u.click(await screen.findByRole('button', { name: 'Register with Google' }));
    expect(screen.getByLabelText('Google email')).toHaveValue('maria@gmail.com');
    await u.click(screen.getByRole('button', { name: 'Register with Google' }));

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(user, app));
    expect(google).toHaveBeenLastCalledWith({
      demo: { email: 'maria@gmail.com', name: 'Maria Santos' },
      language: 'en',
      registration: { disclaimerAccepted: true, locationGranted: true, location: null },
    });
  });

  it('asks a signed-in account without consent for location + conditions only', async () => {
    const u = userEvent.setup();
    mockGeolocation('granted');
    const consent = vi.spyOn(apiService, 'submitRegistrationConsent').mockResolvedValue(app);
    const { onApplicationUpdated } = renderEntry({ mode: 'consent' });

    expect(screen.queryByLabelText('Mobile phone number or email')).not.toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Grant location access' }));
    await u.click(await screen.findByRole('checkbox'));
    await u.click(screen.getByRole('button', { name: 'Continue to Registration' }));

    await waitFor(() => expect(onApplicationUpdated).toHaveBeenCalledWith(app));
    expect(consent).toHaveBeenCalledWith(expect.objectContaining({ disclaimerAccepted: true, locationGranted: true }));
  });

  it('asks a Google account only for the missing phone number, verified by SMS', async () => {
    const u = userEvent.setup();
    vi.spyOn(apiService, 'requestOtp').mockResolvedValue({ demoCode: '654321', expiresInSeconds: 300 });
    const complete = vi.spyOn(apiService, 'completeFlowAccountContact').mockResolvedValue({ user, application: app });
    const { onApplicationUpdated } = renderEntry({
      mode: 'contact',
      account: { email: 'maria@gmail.com', phoneNumber: null, fullName: 'Maria Santos', authProvider: 'google' },
    });

    expect(screen.queryByLabelText(/Email address/)).not.toBeInTheDocument();
    await u.type(screen.getByLabelText(/Mobile number/), '0531234567');
    await u.click(screen.getByRole('button', { name: 'Send SMS code' }));
    await u.click(screen.getByRole('button', { name: 'Save & continue' }));

    await waitFor(() => expect(onApplicationUpdated).toHaveBeenCalledWith(app, user));
    expect(complete).toHaveBeenCalledWith({ phoneNumber: '0531234567', code: '654321' });
  });
});
