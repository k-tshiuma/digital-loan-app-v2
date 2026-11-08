import React, { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { apiService } from '../services/api';
import { storageService } from '@quickloan/ui-core/services/storage';
import { Language } from '@quickloan/ui-core/types';
import { t } from '@quickloan/ui-core/i18n/translations';

interface NotificationBellProps {
  userId?: string;
  onClick: () => void;
  externalUnreadCount?: number;
  language?: Language;
}

export const NotificationBell: React.FC<NotificationBellProps> = ({
  userId,
  onClick,
  externalUnreadCount,
  language = 'en',
}) => {
  const [unreadCount, setUnreadCount] = useState<number>(0);

  const checkUnread = async () => {
    if (!userId) return;
    try {
      const items = await apiService.getNotifications(userId);
      if (Array.isArray(items)) {
        setUnreadCount(items.filter((n) => !n.isRead).length);
        return;
      }
    } catch {
      // offline fallback
    }

    const local = storageService.getNotifications(userId);
    setUnreadCount(local.filter((n) => !n.isRead).length);
  };

  useEffect(() => {
    if (typeof externalUnreadCount === 'number') {
      setUnreadCount(externalUnreadCount);
    } else {
      checkUnread();
    }
  }, [externalUnreadCount, userId]);

  // Periodic polling every 30s
  useEffect(() => {
    if (!userId) return;
    const interval = setInterval(checkUnread, 30000);
    return () => clearInterval(interval);
  }, [userId]);

  return (
    <button
      type="button"
      id="notification-bell-btn"
      onClick={onClick}
      className="relative p-2 text-slate-600 hover:text-blue-900 hover:bg-slate-100 rounded-full transition-colors flex items-center justify-center"
      title={t(language, 'notifications')}
      aria-label={t(language, 'viewNotifications')}
    >
      <Bell className="w-5 h-5" />
      {unreadCount > 0 && (
        <span className="absolute top-1 end-1 min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center animate-pulse">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </button>
  );
};
