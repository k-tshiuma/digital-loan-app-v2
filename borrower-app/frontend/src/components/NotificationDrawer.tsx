import React, { useEffect, useState } from 'react';
import { X, CheckCheck, Bell, MessageSquare, Smartphone, Clock } from 'lucide-react';
import { Language, NotificationItem } from '@quickloan/ui-core/types';
import { apiService } from '../services/api';
import { storageService } from '../services/storage';
import { t } from '@quickloan/ui-core/i18n/translations';
import { formatDateTime } from '@quickloan/ui-core/i18n/format';
import { LtrText } from '@quickloan/ui-core/i18n/LtrText';

interface NotificationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  userId?: string;
  language: Language;
  onUnreadCountChange?: (count: number) => void;
}

export const NotificationDrawer: React.FC<NotificationDrawerProps> = ({
  isOpen,
  onClose,
  userId,
  language,
  onUnreadCountChange,
}) => {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchNotifications = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const data = await apiService.getNotifications(userId);
      if (Array.isArray(data)) {
        setNotifications(data);
        const unread = data.filter((n) => !n.isRead).length;
        onUnreadCountChange?.(unread);
        return;
      }
    } catch {
      // offline fallback
    }

    const local = storageService.getNotifications(userId);
    setNotifications(local);
    const unread = local.filter((n) => !n.isRead).length;
    onUnreadCountChange?.(unread);
    setLoading(false);
  };

  useEffect(() => {
    if (isOpen && userId) {
      fetchNotifications();
    }
  }, [isOpen, userId]);

  const handleMarkAsRead = async (id: string) => {
    try {
      await apiService.markNotificationRead(id);
    } catch {
      storageService.markNotificationRead(id);
    }

    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
    );
    const unread = notifications.filter((n) => n.id !== id && !n.isRead).length;
    onUnreadCountChange?.(unread);
  };

  const handleMarkAllRead = async () => {
    if (!userId) return;
    try {
      await apiService.markAllNotificationsRead(userId);
    } catch {
      storageService.markAllNotificationsRead(userId);
    }

    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    onUnreadCountChange?.(0);
  };

  if (!isOpen) return null;

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/40 backdrop-blur-xs flex justify-end animate-in fade-in duration-200">
      <div
        className="w-full max-w-sm sm:max-w-md bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300"
        role="dialog"
        aria-modal="true"
      >
        {/* Drawer Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-900 flex items-center justify-center font-bold">
              <Bell className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">{t(language, 'notifications')}</h2>
              <span className="text-[11px] text-slate-500">
                {unreadCount > 1
                  ? t(language, 'notif.unreadMany', { n: unreadCount })
                  : unreadCount === 1
                    ? t(language, 'notif.unreadOne')
                    : t(language, 'notif.allCaughtUp')}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-[11px] font-semibold text-blue-900 hover:text-blue-700 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors"
                title={t(language, 'notif.markAllRead')}
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{t(language, 'notif.markAllRead')}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors"
              aria-label={t(language, 'notif.close')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Notifications List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {notifications.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-center p-6">
              <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mb-3">
                <Bell className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-bold text-slate-700">{t(language, 'notif.emptyTitle')}</h4>
              <p className="text-xs text-slate-500 max-w-xs mt-1 leading-relaxed">
                {t(language, 'notif.emptyText')}
              </p>
            </div>
          ) : (
            notifications.map((item) => (
              <div
                key={item.id}
                onClick={() => !item.isRead && handleMarkAsRead(item.id)}
                className={`p-3.5 rounded-2xl border transition-all cursor-pointer relative ${
                  item.isRead
                    ? 'bg-white border-slate-200 hover:border-slate-300'
                    : 'bg-blue-50/60 border-blue-200 hover:border-blue-300 shadow-2xs'
                }`}
              >
                {!item.isRead && (
                  <span className="absolute top-3.5 end-3.5 w-2 h-2 rounded-full bg-blue-600" />
                )}

                <div className="flex items-start gap-2.5">
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                      item.channel === 'sms'
                        ? 'bg-emerald-100 text-emerald-800'
                        : item.channel === 'push'
                        ? 'bg-purple-100 text-purple-800'
                        : 'bg-blue-100 text-blue-800'
                    }`}
                  >
                    {item.channel === 'sms' ? (
                      <MessageSquare className="w-3.5 h-3.5" />
                    ) : item.channel === 'push' ? (
                      <Smartphone className="w-3.5 h-3.5" />
                    ) : (
                      <Bell className="w-3.5 h-3.5" />
                    )}
                  </div>

                  <div className="flex-1 pe-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900 leading-snug">
                        <LtrText text={item.title} />
                      </span>
                    </div>

                    <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                      <LtrText text={item.message} />
                    </p>

                    <div className="flex items-center gap-2 mt-2 pt-1 border-t border-slate-100 text-[10px] text-slate-400">
                      <span className="uppercase font-semibold tracking-wider">
                        {item.channel}
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1 font-mono">
                        <Clock className="w-3 h-3" />
                        {formatDateTime(item.createdAt, language)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer info */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 text-center text-[11px] text-slate-500">
          {t(language, 'notif.footer')}
        </div>
      </div>
    </div>
  );
};
