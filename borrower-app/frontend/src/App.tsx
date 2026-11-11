import React, { useState, useEffect } from 'react';
import {
  Language,
  LoanApplication,
  User,
  BorrowerDetails,
  ResidencyDetails,
  EmploymentDetails,
  LoanRequest,
  GuarantorDetails,
  GuarantorItem,
  UploadedFile,
  ConsentRecord,
  DigitalSignature,
  BankAccountDetails,
} from '@quickloan/ui-core/types';
import { Header } from './components/Header';
import { WizardProgress } from './components/WizardProgress';
import { HelpModal } from './components/HelpModal';
import { ReturningUserConfirmModal } from './components/ReturningUserConfirmModal';
import { Step1Language } from './components/Step1Language';
import { Step2Auth } from './components/Step2Auth';
import { Step3BorrowerDetails } from './components/Step3BorrowerDetails';
import { Step4ResidencyDetails } from './components/Step4ResidencyDetails';
import { Step5EmploymentDetails } from './components/Step5EmploymentDetails';
import { Step6LoanDetails } from './components/Step6LoanDetails';
import { Step7Guarantor } from './components/Step7Guarantor';
import { Step8DocumentUpload } from './components/Step8DocumentUpload';
import { Step9ReviewConfirm } from './components/Step9ReviewConfirm';
import { Step10SubmissionSuccess } from './components/Step10SubmissionSuccess';
import { Step11StatusTimeline } from './components/Step11StatusTimeline';
import { Step1LeadGeneration } from './components/Step1LeadGeneration';
import { FlowEntry, FlowEntryMode } from './components/FlowEntry';
import { Step2ApplicationCompletion } from './components/Step2ApplicationCompletion';
import { Step3FinalSubmission } from './components/Step3FinalSubmission';
import { FlowStatusHub } from './components/FlowStatusHub';
import { NotificationDrawer } from './components/NotificationDrawer';
import { MyApplications } from './components/MyApplications';
import { ErrorBoundary } from '@quickloan/ui-core/components/ErrorBoundary';
import { storageService } from './services/storage';
import { apiService, authTokens, SESSION_EXPIRED_EVENT } from './services/api';
import { useFlowLiveUpdates } from './utils/useFlowLiveUpdates';
import { goToAdminPortal } from './utils/portalRedirect';
import { isClassicFlowEnabled } from './utils/featureFlags';
import { useI18n } from '@quickloan/ui-core/i18n/LanguageContext';
import { ENABLED_LANGUAGES, isEnabledLanguage, t } from '@quickloan/ui-core/i18n/translations';
import { LeadData, LeadStatus, FlowApplicationView, Step1FormData, Step2FormData, Step3FormData, TermsVersionRecord } from '@quickloan/ui-core/types';

function detectBackOfficeUrl(): boolean {
  if (typeof window === 'undefined') return false;
  const path = (window.location.pathname || '').toLowerCase();
  const hash = (window.location.hash || '').toLowerCase();
  const params = new URLSearchParams(window.location.search || '');
  return (
    path === '/backoffice' ||
    path.startsWith('/backoffice/') ||
    path === '/admin' ||
    path.startsWith('/admin/') ||
    hash === '#backoffice' ||
    hash.startsWith('#/backoffice') ||
    hash === '#admin' ||
    hash.startsWith('#/admin') ||
    params.has('backoffice') ||
    params.get('portal')?.toLowerCase() === 'backoffice'
  );
}

export default function App() {
  const { language: currentLanguage, setLanguage, hasSavedChoice } = useI18n();
  // The session user carries the backend's id (the one in the saved token), so API calls for it are allowed.
  const [currentUser, setCurrentUser] = useState<User | null>(() => storageService.restoreSession(authTokens.subject()));
  const [application, setApplication] = useState<LoanApplication | null>(null);
  const [currentStep, setCurrentStep] = useState<number>(() => (storageService.getCurrentUser() ? 3 : 2));
  const [isBackOfficeRoute, setIsBackOfficeRoute] = useState<boolean>(() => detectBackOfficeUrl());
  const [isHelpOpen, setIsHelpOpen] = useState<boolean>(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState<boolean>(false);
  const [isMyAppsOpen, setIsMyAppsOpen] = useState<boolean>(false);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState<number>(0);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [draftSaved, setDraftSaved] = useState<boolean>(false);

  // Intermediary Flow State (Step 1 & Step 2)
  const [flowMode, setFlowMode] = useState<'intermediary' | 'classic'>(() => {
    if (typeof process !== 'undefined' && (process.env.NODE_ENV === 'test' || process.env.VITEST)) {
      return 'classic';
    }
    return 'intermediary';
  });
  const [leadData, setLeadData] = useState<LeadData | null>(null);
  const [currentFlowStep, setCurrentFlowStep] = useState<1 | 2 | 3 | 'hub'>(1);
  const [flowApplication, setFlowApplication] = useState<FlowApplicationView | null>(null);
  const [flowTerms, setFlowTerms] = useState<Record<string, TermsVersionRecord> | null>(null);
  const [flowLoadFailed, setFlowLoadFailed] = useState(false);
  const [flowReloadKey, setFlowReloadKey] = useState(0);

  // Shows the flow application and opens the step the applicant should be on.
  const applyFlowApplication = (app: FlowApplicationView) => {
    setFlowApplication(app);
    setFlowLoadFailed(false);
    if (app.flowStatus === 'LEAD_REGISTERED') {
      setCurrentFlowStep(1);
    } else if (app.unlockedStep === 2 && app.stepStates[2] === 'available') {
      setCurrentFlowStep(2);
    } else if (app.unlockedStep === 3 && app.stepStates[3] === 'available') {
      setCurrentFlowStep(3);
    } else {
      setCurrentFlowStep('hub');
    }
  };

  // Live updates for the 3-step flow: a staff decision moves the applicant on (or to the hub); other
  // changes (a staff message) refresh the data without leaving the screen they are on.
  const reloadFlowApplication = (moveToCurrentStep: boolean) => {
    apiService
      .getFlowApplication()
      .then((app) => {
        if (!app) return;
        if (moveToCurrentStep) applyFlowApplication(app);
        else setFlowApplication(app);
      })
      .catch(() => {});
  };
  useFlowLiveUpdates(!isBackOfficeRoute && flowMode === 'intermediary' ? flowApplication?.id : null, {
    onStatus: () => reloadFlowApplication(true),
    onUpdated: () => reloadFlowApplication(false),
  });

  // Keep Back Office route detection synchronized with URL navigation
  useEffect(() => {
    const syncRoute = () => setIsBackOfficeRoute(detectBackOfficeUrl());
    window.addEventListener('popstate', syncRoute);
    window.addEventListener('hashchange', syncRoute);
    return () => {
      window.removeEventListener('popstate', syncRoute);
      window.removeEventListener('hashchange', syncRoute);
    };
  }, []);

  // Load flow application & terms for authenticated borrower users (never on Back Office route)
  useEffect(() => {
    if (!isBackOfficeRoute && apiService.isAuthenticated()) {
      setFlowLoadFailed(false);
      apiService
        .getFlowApplication()
        .then((app) => {
          if (app) applyFlowApplication(app);
        })
        .catch(() => setFlowLoadFailed(true));

      apiService
        .getCurrentTerms()
        .then((res) => {
          if (res?.terms) {
            setFlowTerms(res.terms);
          }
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, isBackOfficeRoute, flowReloadKey]);

  // The 3-step flow starts with sign-in. Registration (location + conditions + account) and, for accounts that
  // signed in elsewhere, the consent and missing contact details all come before Step 1.
  const flowGate: FlowEntryMode | 'loading' | null = !apiService.isAuthenticated()
    ? 'auth'
    : !flowApplication
    ? 'loading'
    : flowApplication.needsRegistrationConsent
    ? 'consent'
    : !flowApplication.account?.phoneNumber || !flowApplication.account?.email
    ? 'contact'
    : null;

  const handleFlowAuthenticated = (authUser: User, app?: FlowApplicationView | null) => {
    // Same session rule as handleAuthenticated: keep the backend id.
    setCurrentUser(storageService.adoptUser(authUser));
    if (app) applyFlowApplication(app);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleFlowEntryUpdated = (app: FlowApplicationView, authUser?: User) => {
    if (authUser) setCurrentUser(storageService.adoptUser(authUser));
    applyFlowApplication(app);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Network online/offline listener
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Save a language choice to the user's account (local copy + backend).
  const syncUserLanguage = (user: User, lang: Language) => {
    storageService.updateUserLanguage(user.id, lang);
    if (apiService.isAuthenticated()) {
      apiService.updatePreferredLanguage(lang).catch((err) => {
        console.log('[API] Could not save language preference:', err.message);
      });
    }
  };

  // Signed in on the backend but no local copy of the user (e.g. after a password reset): fetch it.
  useEffect(() => {
    if (currentUser || !authTokens.subject()) return;
    apiService
      .getMe()
      .then((user) => {
        setCurrentUser(storageService.adoptUser(user));
        setCurrentStep(3);
      })
      .catch(() => {});
    // Only on start-up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load or initialize active classic application when user is logged in (classic mode only)
  useEffect(() => {
    if (currentUser && !isBackOfficeRoute) {
      // Language: a choice made on this device wins and is saved to the account.
      // Otherwise use the account's saved language (e.g. when signing in on a new device).
      let lang = currentLanguage;
      if (hasSavedChoice) {
        if (currentUser.preferredLanguage !== currentLanguage) syncUserLanguage(currentUser, currentLanguage);
      } else if (isEnabledLanguage(currentUser.preferredLanguage)) {
        lang = currentUser.preferredLanguage;
        if (lang !== currentLanguage) setLanguage(lang);
      }

      if (flowMode !== 'classic') {
        return;
      }

      const localApp = storageService.getOrCreateActiveApplication(currentUser, lang);
      if (!localApp.isSubmitted && localApp.language !== lang) {
        localApp.language = lang;
        storageService.saveApplication(localApp);
      }
      setApplication(localApp);

      if (localApp.isSubmitted) {
        setCurrentStep(11); // Show status dashboard directly if already submitted
      } else if (localApp.currentStep && localApp.currentStep > 1) {
        setCurrentStep(localApp.currentStep);
      } else {
        setCurrentStep(3); // Logged in -> advance to Borrower Details
      }

      // 2. Fetch authoritative active application from backend API to ensure server-persisted
      // personal details and documents are seamlessly synchronized and prefilled immediately
      apiService
        .getActiveApplication(currentUser.id)
        .then((res) => {
          if (res && res.application) {
            const synced = storageService.saveApplication(res.application);
            setApplication({ ...synced });
            if (synced.isSubmitted) {
              setCurrentStep(11);
            } else if (synced.currentStep && synced.currentStep > 1) {
              setCurrentStep(synced.currentStep);
            }
          }
        })
        .catch((err) => {
          console.log('[API] Using local active application draft:', err.message);
        });
    }
  }, [currentUser, flowMode, isBackOfficeRoute]);

  // Draft auto-save helper
  const autoSaveDraft = (updatedApp: LoanApplication, nextStep?: number) => {
    if (nextStep) {
      updatedApp.currentStep = nextStep;
    }
    const saved = storageService.saveApplication(updatedApp);
    setApplication({ ...saved });
    setDraftSaved(true);
    setTimeout(() => setDraftSaved(false), 2000);
    apiService.saveApplication(saved).catch(() => {});
  };

  // --- Step Navigation Handlers ---

  // Step 1: Language selection
  const handleLanguageSelect = (lang: Language) => {
    setLanguage(lang);
    if (application && !application.isSubmitted) {
      application.language = lang;
      autoSaveDraft(application);
    }
    if (currentUser) syncUserLanguage(currentUser, lang);
  };

  const handleStep1Next = () => {
    if (currentUser && application) {
      setCurrentStep(3);
    } else {
      setCurrentStep(2);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Step 2: Authentication
  const handleAuthenticated = (authUser: User) => {
    // Keep the backend's user id for the session and merge the local copy the login helpers made.
    const user = storageService.adoptUser(authUser);
    setCurrentUser(user);
    const app = storageService.getOrCreateActiveApplication(user, currentLanguage);
    setApplication(app);
    if (app.isSubmitted) {
      setCurrentStep(11);
    } else {
      setCurrentStep(3);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });

    apiService
      .getActiveApplication(user.id)
      .then((res) => {
        if (res && res.application) {
          const synced = storageService.saveApplication(res.application);
          setApplication({ ...synced });
          if (synced.isSubmitted) {
            setCurrentStep(11);
          }
        }
      })
      .catch(() => {});
  };

  // Step 3: Borrower details
  const handleSaveBorrowerDetails = (borrowerData: BorrowerDetails) => {
    if (!application) return;
    const updated = {
      ...application,
      borrowerDetails: borrowerData,
    };
    autoSaveDraft(updated, 4);
    setCurrentStep(4);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Step 4: Residency details
  const handleSaveResidencyDetails = (residencyData: ResidencyDetails) => {
    if (!application) return;
    const updated = {
      ...application,
      residencyDetails: residencyData,
    };
    autoSaveDraft(updated, 5);
    setCurrentStep(5);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Step 5: Employment details
  const handleSaveEmploymentDetails = (employmentData: EmploymentDetails) => {
    if (!application) return;
    const updated = {
      ...application,
      employmentDetails: employmentData,
    };
    autoSaveDraft(updated, 6);
    setCurrentStep(6);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Step 6: Loan details
  const handleSaveLoanDetails = (loanData: LoanRequest, bankAccount?: BankAccountDetails) => {
    if (!application) return;
    const updated = {
      ...application,
      loanRequest: loanData,
      bankAccount: bankAccount || application.bankAccount,
    };
    autoSaveDraft(updated, 7);
    setCurrentStep(7);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Step 7: Guarantor details
  const handleSaveGuarantorDetails = (
    guarantorsList: GuarantorItem[],
    legacyGuarantor: GuarantorDetails,
    guarantorDocs: UploadedFile[]
  ) => {
    if (!application) return;
    const existingOtherDocs = (application.documents || []).filter(
      (d) => d.documentTypeCode !== 'GUARANTOR_ID'
    );
    const updated = {
      ...application,
      guarantor: legacyGuarantor,
      guarantors: guarantorsList,
      documents: [...existingOtherDocs, ...guarantorDocs],
    };
    autoSaveDraft(updated, 8);
    setCurrentStep(8);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Step 8: Document uploads
  const handleSaveDocuments = (documentsList: UploadedFile[], bankAccountConfirmed: boolean) => {
    if (!application) return;
    const updated = {
      ...application,
      documents: documentsList,
      bankAccountConfirmed: bankAccountConfirmed,
    };
    autoSaveDraft(updated, 9);
    setCurrentStep(9);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Step 9: Final Review & Submission
  const handleSubmitApplication = (consents: ConsentRecord[], signature: DigitalSignature) => {
    if (!application) return;
    application.consents = consents;
    application.digitalSignature = signature;
    storageService.saveApplication(application);

    // Call submitApplication to create immutable status and request number
    const submitted = storageService.submitApplication(application.id);
    setApplication({ ...submitted });
    setCurrentStep(10);
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Sync submitted application to backend API
    apiService.saveApplication(submitted).catch((err) => {
      console.warn('Background sync of submitted application to API failed:', err);
    });
  };

  // Step 10 -> Step 11: Advance to status dashboard
  const handleTrackStatus = () => {
    setCurrentStep(11);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Reset & start new loan application
  const handleStartNewApplication = () => {
    if (!currentUser) return;
    localStorage.removeItem('quickloan_active_app_id');
    const newApp = storageService.getOrCreateActiveApplication(currentUser, currentLanguage);
    setApplication(newApp);
    setCurrentStep(3);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSignOut = () => {
    storageService.logout();
    apiService.logout(); // forget the session and delete its cookie, or a reload would sign the user back in
    setCurrentUser(null);
    setApplication(null);
    setFlowApplication(null);
    setCurrentFlowStep(1);
    setCurrentStep(2);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // The backend rejected the saved token (expired, or signed with an old secret): back to sign-in.
  // handleSignOut only uses state setters and services, so the first render's copy stays correct.
  useEffect(() => {
    const onExpired = (e: Event) => {
      if ((e as CustomEvent<{ scope?: string }>).detail?.scope !== 'borrower') return;
      setFlowLoadFailed(false);
      handleSignOut();
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The Back Office is a separate app (admin-app/frontend); old /backoffice and /admin links go there.
  useEffect(() => {
    if (isBackOfficeRoute) goToAdminPortal();
  }, [isBackOfficeRoute]);

  if (isBackOfficeRoute) return null;

  return (
    <div className="min-h-screen bg-[#f4f7fb] relative overflow-x-hidden flex flex-col font-sans text-slate-900 antialiased selection:bg-blue-600 selection:text-white">
      {/* FinBest ambient background accents */}
      <div className="fixed top-0 end-0 w-[500px] h-[500px] bg-gradient-to-bl from-orange-400/12 via-orange-300/5 to-transparent rounded-full blur-3xl pointer-events-none -me-32 -mt-32 z-0" />
      <div className="fixed bottom-0 start-0 w-[500px] h-[500px] bg-gradient-to-tr from-sky-400/12 via-indigo-400/5 to-transparent rounded-full blur-3xl pointer-events-none -ms-32 -mb-32 z-0" />

      {/* Top Application Header */}
      <Header
        currentLanguage={currentLanguage}
        onLanguageChange={handleLanguageSelect}
        currentUser={currentUser}
        onSignOut={handleSignOut}
        onOpenHelp={() => setIsHelpOpen(true)}
        isOnline={isOnline}
        draftSaved={draftSaved}
        onOpenNotifications={() => setIsNotificationsOpen(true)}
        onOpenMyApplications={() => setIsMyAppsOpen(true)}
        unreadNotificationsCount={unreadNotificationsCount}
      />

      {/* Main View Area */}
      {flowMode === 'intermediary' ? (
        /* 3-Step Loan Flow Container */
        <main className="flex-1 flex flex-col items-center justify-start p-3 sm:p-5 w-full relative z-10">
          <div className="w-full max-w-xl mx-auto mb-3 flex items-center justify-between px-1">
            {flowGate ? <span /> : (
            <div className="flex items-center gap-1.5 bg-white/90 backdrop-blur-xs p-1 rounded-2xl border border-slate-200/80 shadow-2xs">
              <button
                type="button"
                id="flow-step-1-tab"
                onClick={() => setCurrentFlowStep(1)}
                className={`py-1.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center gap-1 ${
                  currentFlowStep === 1
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span>{t(currentLanguage, 'flow.step1Tab')}</span>
                {flowApplication?.stepStates[1] === 'approved' ? '✓' : ''}
              </button>

              <button
                type="button"
                id="flow-step-2-tab"
                onClick={() => {
                  if ((flowApplication?.unlockedStep ?? 1) >= 2 || leadData?.status === 'approved') {
                    setCurrentFlowStep(2);
                  } else {
                    alert(t(currentLanguage, 'flow.step2LockedAlert'));
                  }
                }}
                className={`py-1.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center gap-1 ${
                  currentFlowStep === 2
                    ? 'bg-purple-600 text-white shadow-xs'
                    : (flowApplication?.unlockedStep ?? 1) >= 2 || leadData?.status === 'approved'
                    ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                    : 'text-slate-400 opacity-60'
                }`}
              >
                <span>{t(currentLanguage, 'flow.step2Tab')}</span>
                {(flowApplication?.unlockedStep ?? 1) >= 2 || leadData?.status === 'approved' ? (
                  flowApplication?.stepStates[2] === 'approved' ? '✓' : ''
                ) : (
                  '🔒'
                )}
              </button>

              <button
                type="button"
                id="flow-step-3-tab"
                onClick={() => {
                  if ((flowApplication?.unlockedStep ?? 1) >= 3) {
                    setCurrentFlowStep(3);
                  } else {
                    alert(t(currentLanguage, 'flow.step3LockedAlert'));
                  }
                }}
                className={`py-1.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center gap-1 ${
                  currentFlowStep === 3
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : (flowApplication?.unlockedStep ?? 1) >= 3
                    ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                    : 'text-slate-400 opacity-60'
                }`}
              >
                <span>{t(currentLanguage, 'flow.step3Tab')}</span>
                {(flowApplication?.unlockedStep ?? 1) >= 3 ? (
                  flowApplication?.isCompleted ? '✓' : ''
                ) : (
                  '🔒'
                )}
              </button>

              {flowApplication && (
                <button
                  type="button"
                  id="flow-status-tab"
                  onClick={() => setCurrentFlowStep('hub')}
                  className={`py-1.5 px-3 rounded-xl text-xs font-bold transition-all ${
                    currentFlowStep === 'hub'
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {t(currentLanguage, 'flow.statusTab')}
                </button>
              )}
            </div>
            )}

            {isClassicFlowEnabled() && (
              <button
                type="button"
                id="classic-wizard-link"
                onClick={() => setFlowMode('classic')}
                className="text-[11px] font-semibold text-slate-500 hover:text-blue-600 underline"
              >
                {t(currentLanguage, 'flow.classicWizard')}
              </button>
            )}
          </div>

          <div className="w-full max-w-xl">
            <ErrorBoundary language={currentLanguage} fallbackTitle={t(currentLanguage, 'errorBoundary.loanAppTitle')}>
              {flowGate === 'loading' ? (
                <div className="bg-white rounded-3xl shadow-sm border border-slate-200/80 p-8 max-w-xl mx-auto text-center space-y-4">
                  <p className="text-sm text-slate-600">
                    {flowLoadFailed ? t(currentLanguage, 'entry.loadFailed') : t(currentLanguage, 'entry.loadingAccount')}
                  </p>
                  {flowLoadFailed && (
                    <div className="flex justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => setFlowReloadKey((k) => k + 1)}
                        className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold"
                      >
                        {t(currentLanguage, 'entry.tryAgain')}
                      </button>
                      <button
                        type="button"
                        onClick={handleSignOut}
                        className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 text-xs font-bold"
                      >
                        {t(currentLanguage, 'entry.signOut')}
                      </button>
                    </div>
                  )}
                </div>
              ) : flowGate ? (
                <FlowEntry
                  key={flowGate}
                  language={currentLanguage}
                  mode={flowGate}
                  account={flowApplication?.account}
                  onAuthenticated={handleFlowAuthenticated}
                  onApplicationUpdated={handleFlowEntryUpdated}
                />
              ) : currentFlowStep === 'hub' && flowApplication ? (
                <FlowStatusHub
                  application={flowApplication}
                  language={currentLanguage}
                  onNavigateToStep={(step) => {
                    setCurrentFlowStep(step as 1 | 2 | 3);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                />
              ) : currentFlowStep === 2 ? (
                <Step2ApplicationCompletion
                  language={currentLanguage}
                  initialData={flowApplication?.steps[2]?.data}
                  defaultAmount={
                    flowApplication?.loanBreakdown?.requestedAmountNis ||
                    flowApplication?.steps[1]?.data?.loan?.requestedAmountNis ||
                    5000
                  }
                  isReadOnly={
                    flowApplication?.stepStates[2] === 'pending' ||
                    flowApplication?.stepStates[2] === 'approved'
                  }
                  onSubmit={async (step2Data) => {
                    const updated = await apiService.submitFlowStep(2, step2Data);
                    if (updated) {
                      setFlowApplication(updated);
                      setCurrentFlowStep('hub');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                  }}
                  lead={leadData}
                  onCompleted={(completedData) => {
                    console.log('Application completion submitted:', completedData);
                  }}
                  onBackToLead={() => {
                    setCurrentFlowStep(1);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                />
              ) : currentFlowStep === 3 ? (
                <Step3FinalSubmission
                  language={currentLanguage}
                  breakdown={flowApplication?.loanBreakdown || null}
                  initialData={flowApplication?.steps[3]?.data}
                  termsVersions={flowTerms || {}}
                  isReadOnly={
                    flowApplication?.stepStates[3] === 'submitted' ||
                    flowApplication?.isCompleted
                  }
                  onSubmit={async (step3Data) => {
                    const updated = await apiService.submitFlowStep(3, step3Data);
                    if (updated) {
                      setFlowApplication(updated);
                      setCurrentFlowStep('hub');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                  }}
                  onBack={() => {
                    setCurrentFlowStep(2);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                />
              ) : (
                <Step1LeadGeneration
                  language={currentLanguage}
                  initialData={flowApplication?.steps[1]?.data}
                  account={flowApplication?.account}
                  isReadOnly={
                    flowApplication?.stepStates[1] === 'pending' ||
                    flowApplication?.stepStates[1] === 'approved'
                  }
                  onSubmit={async (step1Data) => {
                    const updated = await apiService.submitFlowStep(1, step1Data);
                    if (updated) {
                      setFlowApplication(updated);
                      setCurrentFlowStep('hub');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                  }}
                  existingLead={leadData}
                  onLeadCreated={(newLead) => {
                    setLeadData(newLead);
                  }}
                  onLeadStatusChange={(newStatus) => {
                    if (leadData) setLeadData({ ...leadData, status: newStatus });
                  }}
                  onProceedToStep2={() => {
                    setCurrentFlowStep(2);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                />
              )}
            </ErrorBoundary>
          </div>

          {/* Secure Trust Footer Note */}
          <div className="mt-4 text-center text-xs text-slate-600 flex items-center justify-center gap-1.5">
            <span className="font-semibold">QuickLoan</span>
            <span>•</span>
            <span>{t(currentLanguage, 'footer.encrypted')}</span>
            <span>•</span>
            <span className="text-blue-900 font-bold">{t(currentLanguage, 'footer.languages', { n: ENABLED_LANGUAGES.length })}</span>
          </div>
        </main>
      ) : (
        /* Borrower Mobile-First Flow Container */
        <main className="flex-1 flex flex-col items-center justify-start p-3 sm:p-5 w-full relative z-10">
          <div className="w-full max-w-md mb-2 flex justify-end">
            <button
              type="button"
              onClick={() => setFlowMode('intermediary')}
              className="text-[11px] font-bold text-blue-600 hover:underline"
            >
              {t(currentLanguage, 'flow.backToFlow')}
            </button>
          </div>
          <div className="w-full max-w-md bg-white rounded-3xl shadow-[0_8px_30px_rgb(11,26,45,0.06)] border border-slate-200/80 p-5 sm:p-6 flex flex-col min-h-[580px] transition-all">
            <ErrorBoundary language={currentLanguage} fallbackTitle={t(currentLanguage, 'errorBoundary.loanAppTitle')}>
              {/* Step Progress indicator (shown for Loan Wizard Steps 3 through 9) */}
            {currentStep >= 3 && currentStep <= 9 && (
              <WizardProgress
                currentStep={currentStep}
                totalSteps={11}
                language={currentLanguage}
              />
            )}

            {/* STEP 1: Language Selection */}
            {currentStep === 1 && (
              <Step1Language
                selectedLanguage={currentLanguage}
                onSelectLanguage={handleLanguageSelect}
                onNext={handleStep1Next}
              />
            )}

            {/* STEP 2: Phone Authentication & OTP */}
            {currentStep === 2 && (
              <Step2Auth
                language={currentLanguage}
                onAuthenticated={handleAuthenticated}
                onBack={() => setCurrentStep(1)}
              />
            )}

            {/* STEP 3: Borrower Details */}
            {currentStep === 3 && (
              <Step3BorrowerDetails
                language={currentLanguage}
                initialData={application?.borrowerDetails}
                userPhoneNumber={currentUser?.phoneNumber}
                applicationId={application?.id}
                onSaveAndNext={handleSaveBorrowerDetails}
                onBack={() => setCurrentStep(currentUser ? 1 : 2)}
              />
            )}

            {/* STEP 4: Residency & Visa Details */}
            {currentStep === 4 && (
              <Step4ResidencyDetails
                language={currentLanguage}
                initialData={application?.residencyDetails}
                onSaveAndNext={handleSaveResidencyDetails}
                onBack={() => setCurrentStep(3)}
              />
            )}

            {/* STEP 5: Employment Details */}
            {currentStep === 5 && (
              <Step5EmploymentDetails
                language={currentLanguage}
                initialData={application?.employmentDetails}
                onSaveAndNext={handleSaveEmploymentDetails}
                onBack={() => setCurrentStep(4)}
              />
            )}

            {/* STEP 6: Loan Request & Live Estimate */}
            {currentStep === 6 && (
              <Step6LoanDetails
                language={currentLanguage}
                initialData={application?.loanRequest}
                initialBankAccount={application?.bankAccount}
                borrowerName={application?.borrowerDetails?.fullName}
                onSaveAndNext={handleSaveLoanDetails}
                onBack={() => setCurrentStep(application?.isReturningUser ? 3 : 5)}
              />
            )}

            {/* STEP 7: Required & Optional Guarantors */}
            {currentStep === 7 && (
              <Step7Guarantor
                language={currentLanguage}
                applicationId={application?.id || 'temp'}
                initialGuarantors={application?.guarantors}
                initialLegacyGuarantor={application?.guarantor}
                fullApplication={application || undefined}
                onSaveAndNext={handleSaveGuarantorDetails}
                onBack={() => setCurrentStep(6)}
              />
            )}

            {/* STEP 8: Document Upload & Quality Check */}
            {currentStep === 8 && (
              <Step8DocumentUpload
                language={currentLanguage}
                applicationId={application?.id || 'temp'}
                initialDocuments={application?.documents}
                initialBankAccountConfirmed={application?.bankAccountConfirmed}
                hasGuarantor={(application?.guarantors?.length || 0) > 0 || !!application?.guarantor?.hasGuarantor}
                guarantors={application?.guarantors}
                fullApplication={application || undefined}
                onSaveAndNext={handleSaveDocuments}
                onBack={() => setCurrentStep(7)}
              />
            )}

            {/* STEP 9: Review & Digital Signature */}
            {currentStep === 9 && application && (
              <Step9ReviewConfirm
                language={currentLanguage}
                application={application}
                onEditStep={(step) => setCurrentStep(step)}
                onSubmit={handleSubmitApplication}
                onBack={() => setCurrentStep(8)}
              />
            )}

            {/* STEP 10: Submission Success & Request Number */}
            {currentStep === 10 && application && (
              <Step10SubmissionSuccess
                language={currentLanguage}
                application={application}
                onTrackStatus={handleTrackStatus}
              />
            )}

            {/* STEP 11: Real-time Status Tracking & Timeline */}
            {currentStep === 11 && application && (
              <Step11StatusTimeline
                language={currentLanguage}
                application={application}
                onApplicationUpdated={(app) => setApplication({ ...app })}
                onStartNewApplication={handleStartNewApplication}
              />
            )}
            </ErrorBoundary>
          </div>

          {/* Secure Trust Footer Note */}
          <div className="mt-4 text-center text-xs text-slate-600 flex items-center justify-center gap-1.5">
            <span className="font-semibold">QuickLoan</span>
            <span>•</span>
            <span>{t(currentLanguage, 'footer.encrypted')}</span>
            <span>•</span>
            <span className="text-blue-900 font-bold">{t(currentLanguage, 'footer.languages', { n: ENABLED_LANGUAGES.length })}</span>
          </div>
        </main>
      )}

      {/* Multi-language Help & FAQ Modal */}
      <HelpModal
        isOpen={isHelpOpen}
        onClose={() => setIsHelpOpen(false)}
        language={currentLanguage}
      />

      {/* Real-time Notification Drawer */}
      <NotificationDrawer
        isOpen={isNotificationsOpen}
        onClose={() => setIsNotificationsOpen(false)}
        userId={currentUser?.id}
        language={currentLanguage}
        onUnreadCountChange={setUnreadNotificationsCount}
      />

      {/* Borrower Application History Modal */}
      {currentUser && (
        <MyApplications
          isOpen={isMyAppsOpen}
          onClose={() => setIsMyAppsOpen(false)}
          currentUser={currentUser}
          language={currentLanguage}
          onSelectApplication={(selected) => {
            storageService.saveApplication(selected);
            localStorage.setItem('quickloan_active_app_id', selected.id);
            setApplication(selected);
            if (selected.isSubmitted) {
              setCurrentStep(11);
            } else if (selected.currentStep) {
              setCurrentStep(selected.currentStep);
            } else {
              setCurrentStep(3);
            }
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          onStartNewApplication={handleStartNewApplication}
        />
      )}

      {/* Returning User Confirmation Modal (Step 4 of Prompt) */}
      {flowMode === 'classic' && application?.isReturningUser && !application?.detailsConfirmedAt && !application?.isSubmitted && (
        <ReturningUserConfirmModal
          language={currentLanguage}
          application={application}
          onConfirmEverything={() => {
            const updated = {
              ...application,
              detailsConfirmedAt: new Date().toISOString(),
              currentStep: 6,
            };
            autoSaveDraft(updated, 6);
            setCurrentStep(6);
          }}
          onUpdateDetails={(updatedDetails) => {
            const updated: LoanApplication = {
              ...application,
              borrowerDetails: {
                ...application.borrowerDetails!,
                passportNumber: updatedDetails.passportNumber || application.borrowerDetails?.passportNumber || '',
              },
              employmentDetails: {
                ...application.employmentDetails!,
                employerName: updatedDetails.employerName || application.employmentDetails?.employerName || '',
                monthlySalaryNis: updatedDetails.monthlySalaryNis ?? application.employmentDetails?.monthlySalaryNis ?? 0,
              },
              bankAccount: updatedDetails.bankAccount || application.bankAccount,
              detailsConfirmedAt: new Date().toISOString(),
              currentStep: 6,
            };
            autoSaveDraft(updated, 6);
            setCurrentStep(6);
          }}
          onClose={() => {
            setCurrentStep(3);
          }}
        />
      )}
    </div>
  );
}
