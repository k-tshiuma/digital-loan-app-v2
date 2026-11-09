import { useEffect, useState } from 'react';
import { Language, UserRole } from '@quickloan/ui-core/types';
import { useI18n } from '@quickloan/ui-core/i18n/LanguageContext';
import { BackOffice } from './components/BackOffice';
import { StaffLoginGate } from './components/StaffLoginGate';
import { SESSION_EXPIRED_EVENT, staffSession, StaffSessionData } from './services/api';
import { BORROWER_APP_URL } from './config';

/**
 * The admin dashboard: staff sign in, then the Back Office. This is the former `/backoffice` branch of the
 * single app's App.tsx; the borrower app now only redirects old /backoffice and /admin links here.
 */
export default function App() {
  const { language: currentLanguage, setLanguage } = useI18n();
  const [session, setSession] = useState<StaffSessionData | null>(() => staffSession.getSession());
  const [currentRole, setCurrentRole] = useState<UserRole>(() => staffSession.getSession()?.role || 'credit_reviewer');

  // Staff have no saved language preference on the backend; the choice is kept in this browser only.
  const handleLanguageSelect = (lang: Language) => setLanguage(lang);

  const handleStaffSignOut = () => {
    staffSession.clear();
    setSession(null);
  };

  // The admin API rejected the saved staff token (expired, or signed with an old secret): back to sign-in.
  useEffect(() => {
    const onExpired = (e: Event) => {
      if ((e as CustomEvent<{ scope?: string }>).detail?.scope === 'staff') setSession(null);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  const handleReturnToPublicSite = () => {
    window.location.assign(BORROWER_APP_URL);
  };

  if (!session) {
    return (
      <StaffLoginGate
        language={currentLanguage}
        onLanguageChange={handleLanguageSelect}
        // The borrower app runs on another origin, so a borrower session can't be seen from here.
        isClientBlocked={false}
        onAuthenticated={(staff, token) => {
          setSession({ role: staff.role, token, staff });
          setCurrentRole(staff.role);
        }}
        onReturnToPublic={handleReturnToPublicSite}
      />
    );
  }

  return (
    <BackOffice
      language={currentLanguage}
      currentRole={currentRole === 'borrower' ? session.role : currentRole}
      onRoleChange={(nextRole) => {
        if (nextRole === 'borrower') return;
        setCurrentRole(nextRole);
      }}
      staffName={session.staff?.fullName}
      onCloseBackOffice={handleStaffSignOut}
      onLanguageChange={handleLanguageSelect}
    />
  );
}
