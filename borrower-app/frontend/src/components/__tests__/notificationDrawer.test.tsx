// Notifications from the backend (sent in the user's language, Phase 6) must show in the drawer.
// Regression: the drawer expected an array but the API returns { notifications }, so it always
// fell back to the (empty) local list.
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { NotificationDrawer } from '../NotificationDrawer';
import { apiService, authTokens } from '../../services/api';

const serverNotifications = [
  {
    id: 'notif_1', userId: 'user_1', channel: 'sms', notificationType: 'STATUS_Approved', language: 'he',
    title: 'QuickLoan: אושרה', message: '[REQ-2026-100001] מזל טוב! ההלוואה שלך אושרה.',
    deliveryStatus: 'delivered', read: false, createdAt: '2026-10-21T10:00:00Z',
  },
  {
    id: 'notif_2', userId: 'user_1', channel: 'sms', notificationType: 'SUBMISSION_CONFIRMATION', language: 'he',
    title: 'הבקשה הוגשה', message: '[REQ-2026-100001] מספר הבקשה שלך: REQ-2026-100001. נא לשמור אותו.',
    deliveryStatus: 'delivered', read: true, createdAt: '2026-10-21T09:00:00Z',
  },
];

function mockServer() {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(
    JSON.stringify({ success: true, notifications: serverNotifications, unreadCount: 1 }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )));
}

afterEach(() => {
  vi.unstubAllGlobals();
  authTokens.clear();
});

describe('Notifications from the backend', () => {
  it('apiService.getNotifications returns a list with isRead taken from read', async () => {
    mockServer();
    const list = await apiService.getNotifications('user_1');
    expect(list.map((n) => [n.id, n.isRead])).toEqual([['notif_1', false], ['notif_2', true]]);
  });

  it('the drawer shows them, with the unread count', async () => {
    mockServer();
    const onUnread = vi.fn();
    render(<NotificationDrawer isOpen onClose={() => {}} userId="user_1" language="he" onUnreadCountChange={onUnread} />);
    expect(await screen.findByText('QuickLoan: אושרה')).toBeInTheDocument();
    expect(screen.getByText('הבקשה הוגשה')).toBeInTheDocument();
    await waitFor(() => expect(onUnread).toHaveBeenLastCalledWith(1));
  });
});

describe('Request numbers inside notification text', () => {
  it('are kept left-to-right and unbroken', async () => {
    mockServer();
    const { container } = render(<NotificationDrawer isOpen onClose={() => {}} userId="user_1" language="he" />);
    await screen.findByText('QuickLoan: אושרה');
    const isolated = [...container.querySelectorAll('bdi[dir="ltr"]')].map((b) => b.textContent);
    expect(isolated).toContain('REQ-2026-100001');
    expect(container.querySelector('bdi[dir="ltr"]')?.className).toContain('whitespace-nowrap');
  });
});
