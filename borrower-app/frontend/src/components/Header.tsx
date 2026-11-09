import React, { useEffect, useRef, useState } from 'react';
import {
  HelpCircle,
  Globe,
  Shield,
  ChevronDown,
  Check,
  Wifi,
  WifiOff,
  User as UserIcon,
  LogOut,
  FileText,
  Bell,
  Phone,
} from 'lucide-react';
import { Language, User, UserRole } from '@quickloan/ui-core/types';
import { ENABLED_LANGUAGES, t } from '@quickloan/ui-core/i18n/translations';
import { NotificationBell } from './NotificationBell';
import { SUPPORT_CONFIG } from '@quickloan/ui-core/config/appConfig';
import { Linking } from '../utils/linking';

interface HeaderProps {
  currentLanguage: Language;
  onLanguageChange: (lang: Language) => void;
  currentUser: User | null;
  onSignOut: () => void;
  currentRole?: UserRole;
  onRoleChange?: (role: UserRole) => void;
  isBackOfficeOpen?: boolean;
  onToggleBackOffice?: () => void;
  onOpenHelp: () => void;
  isOnline: boolean;
  draftSaved: boolean;
  onOpenNotifications?: () => void;
  onOpenMyApplications?: () => void;
  unreadNotificationsCount?: number;
}

export const Header: React.FC<HeaderProps> = ({
  currentLanguage,
  onLanguageChange,
  currentUser,
  onSignOut,
  isBackOfficeOpen,
  onOpenHelp,
  isOnline,
  draftSaved,
  onOpenNotifications,
  onOpenMyApplications,
  unreadNotificationsCount,
}) => {
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isHelpMenuOpen, setIsHelpMenuOpen] = useState(false);

  // Short label shown on the language button.
  const shortLabel = (code: Language) =>
    code === 'he' ? 'עב' : ENABLED_LANGUAGES.find((l) => l.code === code)?.abbr ?? code.toUpperCase();

  // Close the language menu on an outside click or Escape.
  const langMenuRef = useRef<HTMLDivElement>(null);
  const helpMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isHelpMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (helpMenuRef.current && !helpMenuRef.current.contains(e.target as Node)) {
        setIsHelpMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsHelpMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isHelpMenuOpen]);

  useEffect(() => {
    if (!isLangMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target as Node)) setIsLangMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsLangMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isLangMenuOpen]);

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/80 shadow-2xs">
      <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
        {/* Left: Language Selector & Online status */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Language dropdown */}
          <div className="relative" ref={langMenuRef}>
            <button
              id="header-lang-picker-btn"
              type="button"
              onClick={() => setIsLangMenuOpen(!isLangMenuOpen)}
              aria-haspopup="menu"
              aria-expanded={isLangMenuOpen}
              aria-label={t(currentLanguage, 'languageSelector')}
              title={t(currentLanguage, 'languageSelector')}
              className="h-9 px-2.5 text-xs font-bold text-slate-700 hover:text-blue-600 hover:bg-slate-100 rounded-full flex items-center gap-1.5 transition-colors"
            >
              <Globe className="w-4 h-4 text-slate-600" />
              <span>{shortLabel(currentLanguage)}</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isLangMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {isLangMenuOpen && (
              <div
                role="menu"
                aria-label={t(currentLanguage, 'chooseLanguageTitle')}
                className="absolute start-0 mt-2 w-52 bg-white rounded-2xl shadow-xl border border-slate-200 py-2 z-50 animate-in fade-in zoom-in-95"
              >
                <div className="px-3.5 py-1 text-[11px] font-bold text-slate-400 border-b border-slate-100">
                  {t(currentLanguage, 'chooseLanguageTitle')}
                </div>
                {ENABLED_LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    id={`header-lang-option-${lang.code}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={currentLanguage === lang.code}
                    lang={lang.code}
                    onClick={() => {
                      if (lang.code !== currentLanguage) onLanguageChange(lang.code);
                      setIsLangMenuOpen(false);
                    }}
                    className={`w-full px-3.5 py-2.5 text-start text-xs flex items-center justify-between hover:bg-slate-50 transition-colors ${
                      currentLanguage === lang.code ? 'bg-blue-50/70 font-bold text-blue-900' : 'text-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-base">{lang.flag}</span>
                      <div className="flex flex-col text-start">
                        <span className="font-semibold">{lang.nativeName}</span>
                        <span className="text-[10px] text-slate-400">{lang.name}</span>
                      </div>
                    </div>
                    {currentLanguage === lang.code && <Check className="w-4 h-4 text-blue-600" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            id="header-help-btn"
            onClick={onOpenHelp}
            aria-label={t(currentLanguage, 'helpAndFaq')}
            className="w-9 h-9 flex items-center justify-center rounded-full text-slate-500 hover:text-blue-600 hover:bg-slate-100 transition-colors"
            title={t(currentLanguage, 'helpAndFaq')}
          >
            <HelpCircle className="w-5 h-5" />
          </button>

          {!isOnline ? (
            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
              <WifiOff className="w-3 h-3" />
              {t(currentLanguage, 'offline')}
            </span>
          ) : draftSaved ? (
            <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-emerald-600 font-medium animate-fade-in">
              <Check className="w-3 h-3" />
              {t(currentLanguage, 'saved')}
            </span>
          ) : null}
        </div>

        {/* Center: Brand Logo with FinBest-style connected node mark */}
        <div
          className="flex items-center gap-2 sm:gap-2.5 cursor-pointer select-none"
          onClick={() =>
            !isBackOfficeOpen && window.scrollTo({ top: 0, behavior: 'smooth' })
          }
        >
          <div className="w-8 h-8 rounded-xl bg-slate-900 flex items-center justify-center shadow-xs border border-slate-800">
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="18" cy="5" r="2.5" fill="#38bdf8" stroke="#38bdf8" />
              <circle cx="6" cy="12" r="2.5" fill="#0284c7" stroke="#0284c7" />
              <circle cx="18" cy="19" r="2.5" fill="#ff6b35" stroke="#ff6b35" />
              <line x1="8.5" y1="13.2" x2="15.5" y2="17.8" stroke="#0284c7" />
              <line x1="15.5" y1="6.2" x2="8.5" y2="10.8" stroke="#0284c7" />
            </svg>
          </div>
          {/* Wordmark is hidden on very narrow phones so the header fits; the icon stays. */}
          <div className="hidden min-[400px]:flex flex-col items-start">
            <span className="text-lg sm:text-xl font-extrabold tracking-tight text-slate-900 leading-none">
              {/* i18n-ignore-next-line: brand name */}
              Quick<span className="text-blue-600">Loan</span>
            </span>
          </div>
        </div>

        {/* Right: Back Office Toggle & User Account Profile & Help */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Top-Right Help Icon (?) with Contact Support Dropdown */}
          <div className="relative" ref={helpMenuRef}>
            <button
              id="header-help-btn"
              type="button"
              onClick={() => setIsHelpMenuOpen(!isHelpMenuOpen)}
              className="p-1.5 rounded-full text-slate-600 hover:text-blue-600 hover:bg-slate-100 transition-colors flex items-center justify-center"
              title={t(currentLanguage, 'helpAndFaq')}
              aria-label={t(currentLanguage, 'helpAndFaq')}
            >
              <HelpCircle className="w-5 h-5 text-slate-600 hover:text-blue-600" />
            </button>

            {isHelpMenuOpen && (
              <div className="absolute end-0 mt-2 w-56 bg-white rounded-2xl shadow-xl border border-slate-200 py-1.5 z-50 animate-in fade-in zoom-in-95">
                <button
                  type="button"
                  id="contact-support-dropdown-btn"
                  onClick={() => {
                    setIsHelpMenuOpen(false);
                    Linking.openURL(`tel:${SUPPORT_CONFIG.phoneNumber}`);
                  }}
                  className="w-full px-4 py-2.5 text-start hover:bg-blue-50/60 flex items-center gap-3 group transition-colors"
                >
                  <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                    <Phone className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-slate-900 group-hover:text-blue-600">
                      {/* i18n-ignore */} Contact Support
                    </div>
                    <div className="text-xs text-slate-500 font-mono" dir="ltr">
                      {SUPPORT_CONFIG.displayPhone || SUPPORT_CONFIG.phoneNumber}
                    </div>
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* Notification Bell (if user is authenticated) */}
          {currentUser && onOpenNotifications && (
            <NotificationBell
              userId={currentUser.id}
              onClick={onOpenNotifications}
              externalUnreadCount={unreadNotificationsCount}
              language={currentLanguage}
            />
          )}

          {/* User Profile / Account Menu */}
          <div className="relative">
            <button
              id="header-user-menu-btn"
              onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
              className="p-1.5 rounded-full text-slate-600 hover:text-blue-600 hover:bg-slate-100 transition-colors flex items-center"
              title={t(currentLanguage, 'userAccount')}
              aria-label={t(currentLanguage, 'userAccount')}
            >
              {currentUser ? (
                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-800 border border-blue-200 flex items-center justify-center text-xs font-bold uppercase">
                  {currentUser.fullName
                    ? currentUser.fullName.charAt(0)
                    : currentUser.phoneNumber.slice(-2)}
                </div>
              ) : (
                <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center">
                  <UserIcon className="w-5 h-5 text-slate-500" />
                </div>
              )}
            </button>

            {isUserMenuOpen && (
              <div className="absolute end-0 mt-2 w-64 bg-white rounded-2xl shadow-xl border border-slate-200 py-2 z-50 animate-in fade-in zoom-in-95">
                {currentUser ? (
                  <>
                    <div className="px-4 py-2 border-b border-slate-100">
                      <div className="font-bold text-sm text-slate-900">
                        {currentUser.fullName || t(currentLanguage, 'registeredBorrower')}
                      </div>
                      <div className="text-xs text-slate-500 font-mono">
                        <bdi dir="ltr">{currentUser.phoneNumber}</bdi>
                      </div>
                      {currentUser.email && (
                        <div className="text-xs text-slate-400 truncate">
                          <bdi dir="ltr">{currentUser.email}</bdi>
                        </div>
                      )}
                    </div>

                    <div className="py-1">
                      <button
                        type="button"
                        id="header-my-apps-btn"
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          onOpenMyApplications?.();
                        }}
                        className="w-full px-4 py-2 text-start text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                      >
                        <FileText className="w-4 h-4 text-blue-600" />
                        <span>{t(currentLanguage, 'myLoanApplications')}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          onOpenNotifications?.();
                        }}
                        className="w-full px-4 py-2 text-start text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                      >
                        <Bell className="w-4 h-4 text-blue-600" />
                        <span>{t(currentLanguage, 'notifications')}</span>
                      </button>

                      <button
                        type="button"
                        id="user-signout-btn"
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          onSignOut();
                        }}
                        className="w-full px-4 py-2 text-start text-xs font-medium text-red-600 hover:bg-red-50 flex items-center gap-2 border-t border-slate-100"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>{t(currentLanguage, 'signOut')}</span>
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="px-4 py-3 space-y-2 text-center">
                    <p className="text-xs text-slate-500">{t(currentLanguage, 'notSignedIn')}</p>
                    <button
                      type="button"
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      className="w-full py-2 px-3 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700"
                    >
                      {t(currentLanguage, 'signInOrRegister')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
