import React, { useState, useEffect } from 'react';
import {
  Search,
  Filter,
  Download,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Send,
  Shield,
  FileText,
  Clock,
  Settings,
  Users,
  Building2,
  Lock,
  ChevronRight,
  Sparkles,
  RefreshCw,
  ExternalLink,
  Sliders,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react';
import {
  Language,
  LoanApplication,
  CanonicalStatus,
  UserRole,
  ApplicationConfig,
  AuditEvent,
  CreditRules,
} from '@quickloan/ui-core/types';
import { STATUS_BADGE_CONFIG } from '@quickloan/ui-core/config/appConfig';
import { storageService } from '../services/storage';
import { apiService } from '../services/api';
import { AnalyticsDashboard } from './AnalyticsDashboard';
import { t } from '@quickloan/ui-core/i18n/translations';
import {
  docTypeLabel,
  optionLabel,
  qualityLabel,
  riskFlagLabel,
  riskLevelLabel,
  roleLabel,
  statusLabel,
  flowGroupLabel,
  statusReasonLabel,
  DEFAULT_STATUS_REASONS,
} from '@quickloan/ui-core/i18n/options';
import { localizeError } from '@quickloan/ui-core/i18n/apiErrors';
import { formatCurrency, formatDate, formatDateTime } from '@quickloan/ui-core/i18n/format';
import { calculateIndicativeEligibility } from '@quickloan/ui-core/services/eligibilityScoring';
import { EligibilityScoreBar } from '@quickloan/ui-core/components/EligibilityScoreBar';
import { FlowApplicationInspector } from './FlowApplicationInspector';
import { LanguageToggle } from './LanguageToggle';

/** Shows only the last 4 digits of an account number. */
export function maskAccountNumber(value: string | undefined | null): string {
  if (!value) return '—';
  const s = String(value);
  return s.length <= 4 ? '****' : `****${s.slice(-4)}`;
}

/** Flow statuses where a staff decision is due. */
const NEEDS_REVIEW = new Set(['PENDING_STEP1_APPROVAL', 'PENDING_STEP2_APPROVAL', 'PENDING_FINAL_PROCESSING']);

interface BackOfficeProps {
  language: Language;
  currentRole: UserRole;
  onRoleChange: (role: UserRole) => void;
  onCloseBackOffice: () => void;
  staffName?: string;
  /** Switches the dashboard between English and Hebrew. */
  onLanguageChange?: (lang: Language) => void;
}

export const BackOffice: React.FC<BackOfficeProps> = ({
  language,
  currentRole,
  onRoleChange,
  onCloseBackOffice,
  staffName,
  onLanguageChange,
}) => {
  const [applications, setApplications] = useState<LoanApplication[]>(() =>
    storageService.getAllApplications()
  );
  const [selectedApp, setSelectedApp] = useState<LoanApplication | null>(null);
  const [selectedFlowDetail, setSelectedFlowDetail] = useState<any | null>(null);
  const [flowGroupFilter, setFlowGroupFilter] = useState<string>('ALL');

  // Escape closes the application detail window, unless the user is typing in a field (a note or reason
  // they are writing would be lost).
  useEffect(() => {
    if (!selectedApp) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      setSelectedApp(null);
      setSelectedFlowDetail(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedApp]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [activeTab, setActiveTab] = useState<'applications' | 'analytics' | 'audit' | 'config'>('applications');
  const [creditRules, setCreditRules] = useState<Partial<CreditRules>>({
    salaryMultiplier: 6,
    salaryWarnRatio: 1.5,
    visaBufferMonths: 3,
    minTenureMonths: 6,
    hardMinTenureMonths: 3,
    guarantorBonus: 10,
    lowRiskMinScore: 80,
    mediumRiskMinScore: 50,
  });

  // Review modal actions
  const [reviewReason, setReviewReason] = useState('');
  const [missingDocNote, setMissingDocNote] = useState('');
  const [showDocNoteInput, setShowDocNoteInput] = useState(false);
  // Older-flow applications: the account number is in the list data, so hiding it is display-only.
  const [showClassicAccount, setShowClassicAccount] = useState(false);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);

  // Config editor state
  const [config, setConfig] = useState<ApplicationConfig>(() => storageService.getConfig());
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>(() => storageService.getAuditEvents());

  const fetchBackendData = async () => {
    // The list and credit rules are staff-only endpoints. In the borrower view there is no staff
    // token, so asking would only get a 403; show the local data until a staff role is picked.
    if (currentRole === 'borrower') return;
    try {
      await apiService.ensureStaffToken(currentRole);
      const [backendApps, rulesData] = await Promise.all([
        apiService.listAllApplications().catch(() => null),
        apiService.getCreditRules().catch(() => null),
      ]);
      if (backendApps && backendApps.length > 0) {
        setApplications(backendApps);
      }
      if (rulesData && rulesData.rules) {
        setCreditRules(rulesData.rules);
      }
    } catch {
      // offline / local storage fallback
    }
  };

  useEffect(() => {
    fetchBackendData();
  }, [currentRole]);

  const reloadData = () => {
    setApplications(storageService.getAllApplications());
    setAuditEvents(storageService.getAuditEvents());
    if (selectedApp) {
      const fresh = storageService.getApplication(selectedApp.id);
      if (fresh) setSelectedApp(fresh);
      if ((selectedApp as any).flowStatus || (selectedApp as any).flowVersion === 2) {
        apiService
          .getFlowApplicationDetail(selectedApp.id)
          .then(setSelectedFlowDetail)
          .catch(() => {});
      }
    }
    fetchBackendData();
  };

  const handleSelectApp = (app: LoanApplication) => {
    setSelectedApp(app);
    setShowClassicAccount(false);
    if ((app as any).flowStatus || (app as any).flowVersion === 2 || String((app as any).flowVersion) === '2') {
      apiService
        .getFlowApplicationDetail(app.id)
        .then((detail) => {
          setSelectedFlowDetail(detail);
        })
        .catch(() => {
          setSelectedFlowDetail(null);
        });
    } else {
      setSelectedFlowDetail(null);
    }
  };

  // Loads the full bank account number. Only on request: the backend audit-logs every reveal.
  const handleRevealBank = async () => {
    if (!selectedApp) return;
    const revealed = await apiService.getFlowApplicationDetail(selectedApp.id, true);
    setSelectedFlowDetail(revealed);
  };

  const handleApproveStep = async (step: number, note?: string) => {
    if (!selectedApp) return;
    await apiService.submitStepDecision(selectedApp.id, step, 'approve', note);
    setActionSuccessMessage(t(language, 'fi.msg.stepApproved', { step }));
    const fresh = await apiService.getFlowApplicationDetail(selectedApp.id);
    setSelectedFlowDetail(fresh);
    fetchBackendData();
    setTimeout(() => setActionSuccessMessage(null), 3000);
  };

  const handleRequestStepChanges = async (step: number, notes: string, corrections: string) => {
    if (!selectedApp) return;
    const combinedNote = corrections ? `${corrections}${notes ? ` (Notes: ${notes})` : ''}` : notes;
    await apiService.submitStepDecision(selectedApp.id, step, 'request_changes', combinedNote);
    setActionSuccessMessage(t(language, 'fi.msg.changesRequested', { step }));
    const fresh = await apiService.getFlowApplicationDetail(selectedApp.id);
    setSelectedFlowDetail(fresh);
    fetchBackendData();
    setTimeout(() => setActionSuccessMessage(null), 3000);
  };

  const handleRejectStep = async (step: number, reason: string) => {
    if (!selectedApp) return;
    await apiService.submitStepDecision(selectedApp.id, step, 'reject', reason);
    setActionSuccessMessage(t(language, 'fi.msg.stepRejected', { step }));
    const fresh = await apiService.getFlowApplicationDetail(selectedApp.id);
    setSelectedFlowDetail(fresh);
    fetchBackendData();
    setTimeout(() => setActionSuccessMessage(null), 3000);
  };

  const handleFinalDecision = async (decision: 'APPROVE' | 'REJECT' | 'ADDITIONAL_DOCS', notes?: string) => {
    if (!selectedApp) return;
    const status = decision === 'APPROVE' ? 'Approved' : decision === 'REJECT' ? 'Rejected' : 'Additional Document Required';
    await apiService.submitFinalDecision(selectedApp.id, { status, reason: notes });
    setActionSuccessMessage(t(language, 'fi.msg.finalDecision', { status: statusLabel(language, status) }));
    const fresh = await apiService.getFlowApplicationDetail(selectedApp.id);
    setSelectedFlowDetail(fresh);
    fetchBackendData();
    setTimeout(() => setActionSuccessMessage(null), 3000);
  };

  const handleSendApplicantMessage = async (message: string) => {
    if (!selectedApp) return;
    await apiService.sendApplicantStaffMessage(selectedApp.id, message);
    setActionSuccessMessage('Message dispatched to applicant');
    const fresh = await apiService.getFlowApplicationDetail(selectedApp.id);
    setSelectedFlowDetail(fresh);
    setTimeout(() => setActionSuccessMessage(null), 3000);
  };

  // Filtered applications list
  // Whether an application belongs to a filter chip's group. 3-step applications carry their group; classic
  // ones are placed by status (they have no in-progress, stage-approved or completed groups).
  const inFlowGroup = (app: LoanApplication, group: string): boolean => {
    if (group === 'ALL') return true;
    const flowGroup = (app as any).group || (app as any).flowGroup;
    if (flowGroup) return flowGroup === group;
    if (group === 'pending') return ['Received', 'Under Review'].includes(app.status);
    if (group === 'approved_final') return app.status === 'Approved';
    if (group === 'rejected') return app.status === 'Rejected';
    return false;
  };
  // Each chip shows how many rows the table lists when it is selected (before search and status filters).
  const groupCount = (group: string) => applications.filter((app) => inFlowGroup(app, group)).length;

  const filteredApps = applications.filter((app) => {
    const flowStatus = (app as any).flowStatus;

    if (!inFlowGroup(app, flowGroupFilter)) return false;

    const matchesStatus =
      statusFilter === 'ALL' ||
      app.status === statusFilter ||
      flowStatus === statusFilter;

    const q = searchQuery.toLowerCase().trim();
    if (!q) return matchesStatus;

    // Drafts and older records can lack any of these fields, so every one is optional.
    const b = app.borrowerDetails;
    const s1p = (app as any).step1Data?.personal;
    const applicantName = (app as any).applicantName || s1p?.fullName;
    const phone = (app as any).phoneNumber || s1p?.phoneNumber || b?.mobilePhoneNumber;
    const email = (app as any).email;
    const passport = (app as any).passportNumber || s1p?.passportNumber || b?.passportNumber;
    const country = (app as any).countryOfOrigin || s1p?.countryOfOrigin || b?.countryOfOrigin;
    const localizedCountry = country ? optionLabel(language, 'country', country) : '';

    const matchesSearch = [
      app.requestNumber,
      b?.fullName,
      applicantName,
      passport,
      phone,
      email,
      country,
      localizedCountry,
    ].some((field) => typeof field === 'string' && field.toLowerCase().includes(q));

    return matchesStatus && matchesSearch;
  });

  const handleStatusChange = async (newStatus: CanonicalStatus, reason?: string, missingNote?: string) => {
    if (!selectedApp) return;

    const updated = storageService.updateApplicationStatus(
      selectedApp.id,
      newStatus,
      currentRole as any,
      `${currentRole.replace('_', ' ').toUpperCase()}_USER`,
      reason || reviewReason,
      missingNote || missingDocNote
    );

    try {
      await apiService.saveApplication(updated);
    } catch (err) {
      console.warn('Backend sync failed, saved locally:', err);
    }

    setActionSuccessMessage(t(language, 'bo.msg.statusUpdated', { status: statusLabel(language, newStatus) }));
    setReviewReason('');
    setMissingDocNote('');
    setShowDocNoteInput(false);
    reloadData();
    setTimeout(() => setActionSuccessMessage(null), 3000);
  };

  const handleFundingHandoff = async () => {
    if (!selectedApp) return;
    const rec = storageService.simulateFundingHandoff(selectedApp.id, `FundingOfficer (${currentRole})`);
    try {
      const fresh = storageService.getApplication(selectedApp.id);
      if (fresh) await apiService.saveApplication(fresh);
    } catch {}
    setActionSuccessMessage(t(language, 'bo.msg.pushedToFunding'));
    reloadData();
    setTimeout(() => setActionSuccessMessage(null), 4000);
  };

  const handleDownloadSignedJson = () => {
    if (!selectedApp) return;
    const jsonStr = storageService.exportSignedJson(selectedApp.id);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedApp.requestNumber}_signed_bundle.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportCsv = () => {
    const csvStr = storageService.exportApplicationsCsv();
    const blob = new Blob([csvStr], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quickloan_applications_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    storageService.updateConfig(config);

    try {
      if (currentRole === 'system_admin') {
        await apiService.updateCreditRules(creditRules);
      }
    } catch (err) {
      console.warn('Backend credit rules update failed:', err);
    }

    setActionSuccessMessage(t(language, 'bo.msg.configSaved'));
    reloadData();
    setTimeout(() => setActionSuccessMessage(null), 3000);
  };

  // Strict internal-only guard: clients / borrower role can never view the Back Office
  if (currentRole === 'borrower') {
    return (
      <div
        data-testid="backoffice-borrower-denied"
        className="min-h-screen bg-[#0b1a2d] text-white flex items-center justify-center p-4"
      >
        <div className="w-full max-w-md bg-white text-slate-900 rounded-3xl shadow-2xl border border-slate-200 p-6 sm:p-8 space-y-5 text-center">
          <div className="w-12 h-12 rounded-2xl bg-red-100 text-red-700 flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          <div className="space-y-2">
            <h1 className="text-lg font-extrabold text-slate-900">
              {t(language, 'bo.accessDenied.title')}
            </h1>
            <p className="text-xs text-slate-600 leading-relaxed">
              {t(language, 'bo.accessDenied.clientBody')}
            </p>
          </div>
          <button
            type="button"
            onClick={onCloseBackOffice}
            className="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors shadow-xs"
          >
            {t(language, 'bo.accessDenied.returnBtn')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 flex flex-col animate-in fade-in">
      {/* Top Admin Navigation Bar */}
      <div className="bg-[#0b1a2d] text-white border-b border-slate-800 px-4 py-3 sticky top-0 z-30 shadow-md">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-sky-600 flex items-center justify-center font-bold text-white shadow-xs">
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm tracking-tight text-white">QuickLoan</span>
                <span className="text-[10px] bg-sky-500/15 text-sky-300 border border-sky-500/30 px-2 py-0.5 rounded-full font-mono uppercase font-semibold">
                  {t(language, 'bo.portal')}
                </span>
              </div>
              <div className="text-[11px] text-slate-400">
                {t(language, 'bo.workbench')}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {onLanguageChange && <LanguageToggle language={language} onChange={onLanguageChange} />}
            {staffName && (
              <span className="text-xs text-slate-300 font-semibold hidden sm:inline">
                {staffName}
              </span>
            )}
            {/* RBAC Role Selector — strictly authorized internal staff roles only */}
            <div className="flex items-center gap-1.5 bg-slate-800/90 px-3 py-1.5 rounded-xl border border-slate-700">
              <span className="text-xs text-slate-400 font-medium">{t(language, 'bo.role')}</span>
              <select
                data-testid="backoffice-role-select"
                value={currentRole}
                onChange={(e) => onRoleChange(e.target.value as UserRole)}
                className="bg-transparent text-xs font-bold text-sky-300 focus:outline-none cursor-pointer capitalize"
              >
                <option value="customer_service" className="bg-[#0b1a2d] text-white">{roleLabel(language, 'customer_service')}</option>
                <option value="credit_reviewer" className="bg-[#0b1a2d] text-white">{roleLabel(language, 'credit_reviewer')}</option>
                <option value="system_admin" className="bg-[#0b1a2d] text-white">{roleLabel(language, 'system_admin')}</option>
                <option value="funding_entity" className="bg-[#0b1a2d] text-white">{roleLabel(language, 'funding_entity')}</option>
              </select>
            </div>

            <button
              type="button"
              onClick={onCloseBackOffice}
              className="px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition-colors shadow-2xs"
            >
              {t(language, 'bo.staffSignOut')}
            </button>
          </div>
        </div>
      </div>

      {/* Main Container */}
      <div className="max-w-7xl mx-auto w-full px-4 py-6 flex-1 flex flex-col">
        {/* Navigation Tabs */}
        <div className="flex items-center justify-between border-b border-slate-300 pb-3 mb-6">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('applications')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'applications'
                  ? 'bg-[#0b1a2d] text-sky-300 border border-sky-500/40 shadow-xs'
                  : 'bg-white text-slate-700 hover:bg-slate-200 border border-slate-200'
              }`}
            >
              <FileText className="w-3.5 h-3.5 inline me-1.5 text-sky-400" />
              {t(language, 'bo.tab.applications', { n: applications.length })}
            </button>

            {(currentRole === 'credit_reviewer' || currentRole === 'system_admin') && (
              <button
                onClick={() => setActiveTab('analytics')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  activeTab === 'analytics'
                    ? 'bg-[#0b1a2d] text-sky-300 border border-sky-500/40 shadow-xs'
                    : 'bg-white text-slate-700 hover:bg-slate-200 border border-slate-200'
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5 inline me-1.5 text-sky-400" />
                {t(language, 'bo.tab.analytics')}
              </button>
            )}

            <button
              onClick={() => setActiveTab('audit')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'audit'
                  ? 'bg-[#0b1a2d] text-sky-300 border border-sky-500/40 shadow-xs'
                  : 'bg-white text-slate-700 hover:bg-slate-200 border border-slate-200'
              }`}
            >
              <Clock className="w-3.5 h-3.5 inline me-1.5 text-sky-400" />
              {t(language, 'bo.tab.audit', { n: auditEvents.length })}
            </button>

            {(currentRole === 'system_admin' || currentRole === 'credit_reviewer') && (
              <button
                onClick={() => setActiveTab('config')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  activeTab === 'config'
                    ? 'bg-[#0b1a2d] text-sky-300 border border-sky-500/40 shadow-xs'
                    : 'bg-white text-slate-700 hover:bg-slate-200 border border-slate-200'
                }`}
              >
                <Sliders className="w-3.5 h-3.5 inline me-1.5 text-sky-400" />
                {t(language, 'bo.tab.config')}
              </button>
            )}
          </div>

          {/* Export CSV button */}
          <button
            onClick={handleExportCsv}
            className="px-3 py-2 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-semibold flex items-center gap-1.5 shadow-2xs"
          >
            <Download className="w-3.5 h-3.5 text-sky-600" />
            {t(language, 'bo.exportCsv')}
          </button>
        </div>

        {actionSuccessMessage && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-xs text-emerald-900 font-bold flex items-center gap-2 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{actionSuccessMessage}</span>
          </div>
        )}

        {/* TAB 1: Applications Table & Search */}
        {activeTab === 'applications' && (
          <div className="space-y-4">
            {/* Workflow Group Filter Pills */}
            <div className="flex flex-wrap items-center gap-1.5 pb-1">
              {[
                { id: 'ALL', label: t(language, 'bo.allStatuses', { n: applications.length }) },
                ...(['pending', 'in_progress', 'approved_stage', 'completed', 'approved_final', 'rejected'] as const).map((group) => ({
                  id: group,
                  label: `${flowGroupLabel(language, group)} (${groupCount(group)})`,
                })),
              ].map((pill) => (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => setFlowGroupFilter(pill.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    flowGroupFilter === pill.id
                      ? 'bg-[#0b1a2d] text-sky-300 border border-sky-500/40 shadow-xs'
                      : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                  }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>

            {/* Search & Filter Bar */}
            <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="w-4 h-4 text-slate-400 absolute start-3.5 top-3" />
                <input
                  type="text"
                  placeholder={t(language, 'bo.searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full ps-10 pe-4 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs focus:bg-white focus:border-purple-900 focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-500">{t(language, 'bo.status')}</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-800 focus:outline-none cursor-pointer"
                >
                  <option value="ALL">{t(language, 'bo.allStatuses', { n: applications.length })}</option>
                  <optgroup label="3-Step Workflow">
                    <option value="LEAD_REGISTERED">{statusLabel(language, 'LEAD_REGISTERED')}</option>
                    <option value="PENDING_STEP1_APPROVAL">{statusLabel(language, 'PENDING_STEP1_APPROVAL')}</option>
                    <option value="STEP1_APPROVED">{statusLabel(language, 'STEP1_APPROVED')}</option>
                    <option value="STEP1_CHANGES_REQUESTED">{statusLabel(language, 'STEP1_CHANGES_REQUESTED')}</option>
                    <option value="PENDING_STEP2_APPROVAL">{statusLabel(language, 'PENDING_STEP2_APPROVAL')}</option>
                    <option value="STEP2_APPROVED">{statusLabel(language, 'STEP2_APPROVED')}</option>
                    <option value="STEP2_CHANGES_REQUESTED">{statusLabel(language, 'STEP2_CHANGES_REQUESTED')}</option>
                    <option value="PENDING_FINAL_PROCESSING">{statusLabel(language, 'PENDING_FINAL_PROCESSING')}</option>
                    <option value="LOAN_APPROVED">{statusLabel(language, 'LOAN_APPROVED')}</option>
                    <option value="LOAN_REJECTED">{statusLabel(language, 'LOAN_REJECTED')}</option>
                  </optgroup>
                  <optgroup label="Classic Statuses">
                    <option value="Received">{statusLabel(language, 'Received')}</option>
                    <option value="Under Review">{statusLabel(language, 'Under Review')}</option>
                    <option value="Additional Document Required">{statusLabel(language, 'Additional Document Required')}</option>
                    <option value="Approved">{statusLabel(language, 'Approved')}</option>
                    <option value="Rejected">{statusLabel(language, 'Rejected')}</option>
                    <option value="Forwarded to Funding Entity">{statusLabel(language, 'Forwarded to Funding Entity')}</option>
                  </optgroup>
                </select>
              </div>
            </div>

            {/* Applications Table */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-start text-xs text-slate-700">
                  <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase text-slate-500 tracking-wider">
                    <tr>
                      <th className="py-3 px-4">{t(language, 'bo.col.request')}</th>
                      <th className="py-3 px-4">{t(language, 'bo.col.borrower')}</th>
                      <th className="py-3 px-4">{t(language, 'bo.col.passport')}</th>
                      <th className="py-3 px-4">{t(language, 'bo.col.visa')}</th>
                      <th className="py-3 px-4 text-end">{t(language, 'bo.col.loan')}</th>
                      <th className="py-3 px-4 text-center">{t(language, 'bo.col.risk')}</th>
                      <th className="py-3 px-4 text-center">{t(language, 'bo.col.status')}</th>
                      <th className="py-3 px-4 text-end">{t(language, 'bo.col.action')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredApps.length > 0 ? (
                      filteredApps.map((app) => {
                        const sCfg = STATUS_BADGE_CONFIG[app.status] || STATUS_BADGE_CONFIG['Received'];
                        const flowStatus = (app as any).flowStatus;
                        return (
                          <tr
                            key={app.id}
                            className="hover:bg-purple-50/40 transition-colors cursor-pointer"
                            onClick={() => handleSelectApp(app)}
                          >
                            <td className="py-3.5 px-4 font-mono font-bold text-purple-950">
                              <bdi dir="ltr">{app.requestNumber}</bdi>
                            </td>
                            <td className="py-3.5 px-4 font-bold text-slate-900">
                              {(app as any).applicantName || app.borrowerDetails?.fullName || t(language, 'bo.anonymousDraft')}
                              <div className="text-[10px] text-slate-400 font-normal">
                                <bdi dir="ltr">{(app as any).phoneNumber || app.borrowerDetails?.mobilePhoneNumber}</bdi>
                              </div>
                            </td>
                            <td className="py-3.5 px-4">
                              <span className="font-mono"><bdi dir="ltr">{(app as any).passportNumber || (app as any).step1Data?.personal?.passportNumber || app.borrowerDetails?.passportNumber || '—'}</bdi></span>
                              <span className="text-[11px] text-slate-500 block">
                                {(() => {
                                  const c = (app as any).countryOfOrigin || (app as any).step1Data?.personal?.countryOfOrigin || app.borrowerDetails?.countryOfOrigin;
                                  return c ? optionLabel(language, 'country', c) : '—';
                                })()}
                              </span>
                            </td>
                            <td className="py-3.5 px-4">
                              {app.residencyDetails?.visaType ? (
                                <>
                                  <span className="font-semibold text-slate-800">{optionLabel(language, 'visa', app.residencyDetails.visaType)}</span>
                                  <span className="text-[10px] text-slate-500 block">
                                    {t(language, 'bo.yrsInIsrael', { n: app.residencyDetails?.yearsOfResidency || 0 })}
                                  </span>
                                </>
                              ) : (() => {
                                const vStart = (app as any).visaStartDate || (app as any).step1Data?.personal?.visaStartDate || app.residencyDetails?.visaStartDate;
                                const vEnd = (app as any).visaExpiryDate || (app as any).step1Data?.personal?.visaExpiryDate || app.residencyDetails?.visaExpiryDate;
                                const sal = (app as any).monthlySalaryNis || (app as any).step1Data?.personal?.monthlySalaryNis || app.employmentDetails?.monthlySalaryNis;
                                return (
                                  <>
                                    <span className="font-semibold text-slate-800">
                                      {vStart && vEnd ? (
                                        <bdi dir="ltr">{formatDate(vStart, language)} – {formatDate(vEnd, language)}</bdi>
                                      ) : vEnd ? (
                                        <bdi dir="ltr">{formatDate(vEnd, language)}</bdi>
                                      ) : (
                                        '—'
                                      )}
                                    </span>
                                    <span className="text-[10px] text-slate-500 block">
                                      {sal ? formatCurrency(sal, language) : t(language, 'bo.yrsInIsrael', { n: app.residencyDetails?.yearsOfResidency || 0 })}
                                    </span>
                                  </>
                                );
                              })()}
                            </td>
                            <td className="py-3.5 px-4 text-end">
                              <span className="font-mono font-extrabold text-blue-900">
                                {formatCurrency((app as any).requestedAmountNis || app.loanRequest?.requestedAmountNis, language)}
                              </span>
                              <span className="text-[10px] text-slate-400 block">
                                {t(language, 'bo.termAtMonthly', {
                                  months: (app as any).repaymentPeriodMonths || (app.loanRequest?.repaymentPeriodMonths ?? 0),
                                  monthly: formatCurrency(
                                    (app as any).loanBreakdown?.monthlyRepaymentWithInterestNis ||
                                      app.loanRequest?.estimatedMonthlyPaymentNis,
                                    language
                                  ),
                                })}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              {app.riskLevel ? (
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold border inline-flex items-center gap-1 ${
                                    app.riskLevel === 'Low'
                                      ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                      : app.riskLevel === 'Medium'
                                      ? 'bg-amber-50 text-amber-800 border-amber-300'
                                      : 'bg-red-50 text-red-800 border-red-300'
                                  }`}
                                >
                                  <span className="w-1.5 h-1.5 rounded-full bg-current" />
                                  {riskLevelLabel(language, app.riskLevel)} ({app.riskScore ?? '—'})
                                </span>
                              ) : (
                                <span className="text-slate-400 text-[10px]">{t(language, 'bo.unscored')}</span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              <span
                                className={`px-2.5 py-1 rounded-full text-[11px] font-bold border inline-block ${
                                  flowStatus
                                    ? flowStatus.includes('APPROVED')
                                      ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                      : flowStatus.includes('REJECTED')
                                      ? 'bg-red-50 text-red-800 border-red-300'
                                      : flowStatus.includes('PENDING')
                                      ? 'bg-amber-50 text-amber-800 border-amber-300'
                                      : flowStatus.includes('CHANGES')
                                      ? 'bg-rose-50 text-rose-800 border-rose-300'
                                      : 'bg-blue-50 text-blue-800 border-blue-300'
                                    : sCfg.badgeColor
                                }`}
                              >
                                {statusLabel(language, flowStatus || app.status)}
                              </span>
                              {NEEDS_REVIEW.has(flowStatus) && (
                                <span className="mt-1 mx-auto w-fit px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 text-white flex items-center gap-1">
                                  <AlertCircle className="w-3 h-3" />
                                  {t(language, 'fi.needsReview')}
                                </span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 text-end">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSelectApp(app);
                                }}
                                className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-purple-100 text-purple-900 font-bold text-xs inline-flex items-center gap-1"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>{t(language, 'bo.inspect')}</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-slate-400">
                          {t(language, 'bo.noMatches')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: Analytics Dashboard (Phase 3) */}
        {activeTab === 'analytics' && (
          <AnalyticsDashboard applications={applications} language={language} />
        )}

        {/* TAB 2: Immutable Audit Trail */}
        {activeTab === 'audit' && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden p-4 space-y-3">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <Shield className="w-4 h-4 text-purple-700" />
                {t(language, 'bo.auditTitle')}
              </h3>
              <span className="text-xs text-slate-400 font-mono">{t(language, 'bo.totalRecords', { n: auditEvents.length })}</span>
            </div>

            <div className="space-y-2 max-h-[600px] overflow-y-auto pe-1">
              {auditEvents.map((evt) => (
                <div key={evt.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-purple-900 bg-purple-100 px-2 py-0.5 rounded text-[10px]">
                        {evt.action}
                      </span>
                      <span className="font-semibold text-slate-800">
                        {t(language, 'bo.actor', { name: evt.actorName || evt.actorType || '' })}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {t(language, 'bo.entity')} <span className="font-mono">{evt.entityType}/{evt.entityId}</span>
                    </div>
                    {evt.metadata && (
                      <pre className="text-[10px] text-slate-600 bg-white p-2 rounded border border-slate-200 overflow-x-auto max-w-xl">
                        {JSON.stringify(evt.metadata, null, 2)}
                      </pre>
                    )}
                  </div>
                  <div className="text-end text-[10px] text-slate-400 font-mono shrink-0">
                    {formatDateTime(evt.createdAt, language)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 3: Credit Policy Configuration */}
        {activeTab === 'config' && (
          <form onSubmit={handleSaveConfig} className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 max-w-2xl mx-auto space-y-6">
            <div className="border-b pb-3">
              <h3 className="text-base font-bold text-slate-900">{t(language, 'bo.cfg.title')}</h3>
              <p className="text-xs text-slate-500">{t(language, 'bo.cfg.subtitle')}</p>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">{t(language, 'bo.cfg.productConstraints')}</h4>
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">{t(language, 'bo.cfg.minAmount')}</label>
                  <input
                    type="number"
                    value={config.minLoanAmountNis}
                    onChange={(e) => setConfig({ ...config, minLoanAmountNis: Number(e.target.value) })}
                    className="w-full p-2.5 rounded-xl border border-slate-300 font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">{t(language, 'bo.cfg.maxAmount')}</label>
                  <input
                    type="number"
                    value={config.maxLoanAmountNis}
                    onChange={(e) => setConfig({ ...config, maxLoanAmountNis: Number(e.target.value) })}
                    className="w-full p-2.5 rounded-xl border border-slate-300 font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">{t(language, 'bo.cfg.minAge')}</label>
                  <input
                    type="number"
                    value={config.minBorrowerAge}
                    onChange={(e) => setConfig({ ...config, minBorrowerAge: Number(e.target.value) })}
                    className="w-full p-2.5 rounded-xl border border-slate-300 font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">{t(language, 'bo.cfg.visaBuffer')}</label>
                  <input
                    type="number"
                    value={config.minVisaValidityMonths}
                    onChange={(e) => setConfig({ ...config, minVisaValidityMonths: Number(e.target.value) })}
                    className="w-full p-2.5 rounded-xl border border-slate-300 font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">{t(language, 'bo.cfg.apr')}</label>
                  <input
                    type="number"
                    step={0.1}
                    value={config.defaultInterestRatePercent}
                    onChange={(e) => setConfig({ ...config, defaultInterestRatePercent: Number(e.target.value) })}
                    className="w-full p-2.5 rounded-xl border border-slate-300 font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">{t(language, 'bo.cfg.managementFee')}</label>
                  <input
                    type="number"
                    value={config.managementFeeNis}
                    onChange={(e) => setConfig({ ...config, managementFeeNis: Number(e.target.value) })}
                    className="w-full p-2.5 rounded-xl border border-slate-300 font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Credit Engine Rules */}
            <div className="border-t pt-4 space-y-3">
              <div>
                <h4 className="text-xs font-bold text-purple-900 uppercase tracking-wider">{t(language, 'bo.cfg.scoringPolicy')}</h4>
                <p className="text-[11px] text-slate-500">{t(language, 'bo.cfg.scoringHint')}</p>
              </div>

              <div className="grid grid-cols-2 gap-4 text-xs">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">{t(language, 'bo.cfg.salaryMultiplier')}</label>
                  <input
                    type="number"
                    step={0.5}
                    value={creditRules.salaryMultiplier ?? 6}
                    onChange={(e) => setCreditRules({ ...creditRules, salaryMultiplier: Number(e.target.value) })}
                    className="w-full p-2.5 rounded-xl border border-slate-300 font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">{t(language, 'bo.cfg.salaryWarnRatio')}</label>
                  <input
                    type="number"
                    step={0.1}
                    value={creditRules.salaryWarnRatio ?? 1.5}
                    onChange={(e) => setCreditRules({ ...creditRules, salaryWarnRatio: Number(e.target.value) })}
                    className="w-full p-2.5 rounded-xl border border-slate-300 font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">{t(language, 'bo.cfg.visaExpiryBuffer')}</label>
                  <input
                    type="number"
                    value={creditRules.visaBufferMonths ?? 3}
                    onChange={(e) => setCreditRules({ ...creditRules, visaBufferMonths: Number(e.target.value) })}
                    className="w-full p-2.5 rounded-xl border border-slate-300 font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">{t(language, 'bo.cfg.minTenure')}</label>
                  <input
                    type="number"
                    value={creditRules.minTenureMonths ?? 6}
                    onChange={(e) => setCreditRules({ ...creditRules, minTenureMonths: Number(e.target.value) })}
                    className="w-full p-2.5 rounded-xl border border-slate-300 font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">{t(language, 'bo.cfg.lowRiskMin')}</label>
                  <input
                    type="number"
                    value={creditRules.lowRiskMinScore ?? 80}
                    onChange={(e) => setCreditRules({ ...creditRules, lowRiskMinScore: Number(e.target.value) })}
                    className="w-full p-2.5 rounded-xl border border-slate-300 font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">{t(language, 'bo.cfg.mediumRiskMin')}</label>
                  <input
                    type="number"
                    value={creditRules.mediumRiskMinScore ?? 50}
                    onChange={(e) => setCreditRules({ ...creditRules, mediumRiskMinScore: Number(e.target.value) })}
                    className="w-full p-2.5 rounded-xl border border-slate-300 font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">{t(language, 'bo.cfg.guarantorBonus')}</label>
                  <input
                    type="number"
                    value={creditRules.guarantorBonus ?? 10}
                    onChange={(e) => setCreditRules({ ...creditRules, guarantorBonus: Number(e.target.value) })}
                    className="w-full p-2.5 rounded-xl border border-slate-300 font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="pt-4 border-t flex items-center justify-between">
              <span className="text-[11px] text-slate-400">
                {currentRole === 'system_admin'
                  ? t(language, 'bo.cfg.adminSync')
                  : t(language, 'bo.cfg.adminRequired')}
              </span>
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-purple-900 hover:bg-purple-800 text-white font-bold text-xs shadow-xs"
              >
                {t(language, 'bo.cfg.save')}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Application Detail Inspection & Action Modal */}
      {selectedApp && (
        selectedFlowDetail ? (
          <FlowApplicationInspector
            detail={selectedFlowDetail}
            language={language}
            currentRole={currentRole}
            onClose={() => {
              setSelectedApp(null);
              setSelectedFlowDetail(null);
            }}
            onApproveStep={handleApproveStep}
            onRequestStepChanges={handleRequestStepChanges}
            onRejectStep={handleRejectStep}
            onFinalDecision={handleFinalDecision}
            onSendMessage={handleSendApplicantMessage}
            onDownloadPdf={async () => {
              try {
                await apiService.downloadApplicationPdf(selectedApp, language);
              } catch (e: any) {
                setActionSuccessMessage(t(language, 'bo.msg.pdfFailed', { error: localizeError(e, language, 'err.pdfFailed') }));
              }
            }}
            onDownloadJson={handleDownloadSignedJson}
            onRevealBank={handleRevealBank}
          />
        ) : (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white w-full max-w-3xl rounded-3xl shadow-2xl border border-slate-200 max-h-[92vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            {/* Wraps on phones: the actions move under the request number instead of being cut off. */}
            <div className="px-4 sm:px-6 py-4 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-bold text-base text-purple-300 whitespace-nowrap">
                    <bdi dir="ltr">{selectedApp.requestNumber}</bdi>
                  </span>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                      STATUS_BADGE_CONFIG[selectedApp.status]?.badgeColor
                    }`}
                  >
                    {statusLabel(language, selectedApp.status)}
                  </span>
                </div>
                <div className="text-xs text-slate-300 mt-0.5">
                  {t(language, 'bo.submittedLang', {
                    date: formatDate(selectedApp.createdAt, language),
                    lang: selectedApp.language === 'he' ? 'עברית' : selectedApp.language === 'en' ? 'English' : selectedApp.language.toUpperCase(),
                  })}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 ms-auto">
                <button
                  type="button"
                  onClick={async () => {
                    if (!selectedApp) return;
                    try {
                      await apiService.downloadApplicationPdf(selectedApp, language);
                    } catch (e: any) {
                      setActionSuccessMessage(t(language, 'bo.msg.pdfFailed', { error: localizeError(e, language, 'err.pdfFailed') }));
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 text-xs text-white border border-blue-600 flex items-center gap-1 font-semibold transition-colors"
                  title={t(language, 'bo.downloadPdfSummary')}
                >
                  <FileText className="w-3.5 h-3.5" />
                  PDF {/* i18n-ignore */}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadSignedJson}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-purple-200 border border-slate-700 flex items-center gap-1"
                  title={t(language, 'bo.downloadSignedJson')}
                >
                  <Download className="w-3.5 h-3.5" />
                  JSON {/* i18n-ignore */}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedApp(null)}
                  aria-label={t(language, 'bo.closeInspector')}
                  title={t(language, 'bo.closeInspector')}
                  className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5 text-xs text-slate-700">
              {/* Borrower & Residency Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 [&>*]:min-w-0">
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                  <div className="font-bold text-slate-900  text-[11px] border-b pb-1">
                    {t(language, 'bo.borrowerProfile')}
                  </div>
                  <div><span className="text-slate-400">{t(language, 'bo.fullName')}</span> <span className="font-bold text-slate-900">{selectedApp.borrowerDetails?.fullName || (selectedApp as any).step1Data?.personal?.fullName || '—'}</span></div>
                  <div><span className="text-slate-400">{t(language, 'bo.passport')}</span> <span className="font-mono font-bold"><bdi dir="ltr">{(selectedApp as any).step1Data?.personal?.passportNumber || selectedApp.borrowerDetails?.passportNumber || '—'}</bdi></span></div>
                  <div>
                    <span className="text-slate-400">{t(language, 'bo.origin')}</span>{' '}
                    <span className="font-semibold text-slate-900">
                      {((selectedApp as any).step1Data?.personal?.countryOfOrigin || selectedApp.borrowerDetails?.countryOfOrigin)
                        ? optionLabel(language, 'country', (selectedApp as any).step1Data?.personal?.countryOfOrigin || selectedApp.borrowerDetails?.countryOfOrigin)
                        : '—'}
                    </span>
                  </div>
                  <div><span className="text-slate-400">{t(language, 'bo.dob')}</span> {(selectedApp.borrowerDetails?.dateOfBirth || (selectedApp as any).step1Data?.personal?.dateOfBirth) ? formatDate(selectedApp.borrowerDetails?.dateOfBirth || (selectedApp as any).step1Data?.personal?.dateOfBirth, language) : '—'}</div>
                  <div><span className="text-slate-400">{t(language, 'bo.phone')}</span> <bdi dir="ltr">{selectedApp.borrowerDetails?.mobilePhoneNumber || (selectedApp as any).step1Data?.personal?.phoneNumber || '—'}</bdi></div>
                  <div><span className="text-slate-400">{t(language, 'bo.address')}</span> {selectedApp.borrowerDetails?.addressFull || (selectedApp as any).step1Data?.personal?.address || '—'}</div>
                </div>

                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                  <div className="font-bold text-slate-900  text-[11px] border-b pb-1">
                    {t(language, 'bo.residencyEmployment')}
                  </div>
                  <div><span className="text-slate-400">{t(language, 'bo.visaType')}</span> <span className="font-bold">{selectedApp.residencyDetails?.visaType ? optionLabel(language, 'visa', selectedApp.residencyDetails.visaType) : '—'}</span></div>
                  <div>
                    <span className="text-slate-400">{t(language, 'bo.visaValidity')}</span>{' '}
                    {(() => {
                      const vStart = (selectedApp as any).step1Data?.personal?.visaStartDate || selectedApp.residencyDetails?.visaStartDate;
                      const vEnd = (selectedApp as any).step1Data?.personal?.visaExpiryDate || selectedApp.residencyDetails?.visaExpiryDate;
                      if (vStart && vEnd) {
                        return (
                          <bdi dir="ltr" className="font-semibold text-slate-900">
                            {formatDate(vStart, language)} – {formatDate(vEnd, language)}
                          </bdi>
                        );
                      }
                      if (vEnd) {
                        return (
                          <bdi dir="ltr" className="font-semibold text-slate-900">
                            {formatDate(vEnd, language)}
                          </bdi>
                        );
                      }
                      return '—';
                    })()}
                  </div>
                  <div><span className="text-slate-400">{t(language, 'bo.visaExpiry')}</span> {(selectedApp.residencyDetails?.visaExpiryDate || (selectedApp as any).step1Data?.personal?.visaExpiryDate) ? formatDate(selectedApp.residencyDetails?.visaExpiryDate || (selectedApp as any).step1Data?.personal?.visaExpiryDate, language) : '—'}</div>
                  <div><span className="text-slate-400">{t(language, 'bo.yearsInIsrael')}</span> {t(language, 'bo.yrs', { n: selectedApp.residencyDetails?.yearsOfResidency ?? 0 })}</div>
                  <div><span className="text-slate-400">{t(language, 'bo.employer')}</span> {selectedApp.employmentDetails?.employerName || (selectedApp as any).step1Data?.employment?.employerName || '—'}</div>
                  <div>
                    <span className="text-slate-400">{t(language, 'bo.monthlySalary')}</span>{' '}
                    <span className="font-mono font-bold text-emerald-800">
                      {((selectedApp as any).step1Data?.personal?.monthlySalaryNis || selectedApp.employmentDetails?.monthlySalaryNis)
                        ? formatCurrency((selectedApp as any).step1Data?.personal?.monthlySalaryNis || selectedApp.employmentDetails?.monthlySalaryNis, language)
                        : '—'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Disbursement Bank Account & Guarantor Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 [&>*]:min-w-0">
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                  <div className="font-bold text-slate-900 text-[11px] border-b pb-1 flex items-center justify-between">
                    <span>{t(language, 'bo.bankAccount')}</span>
                    <span className="text-[10px] text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full font-semibold">
                      {t(language, 'verified')}
                    </span>
                  </div>
                  <div><span className="text-slate-400">{t(language, 'bo.bank')}</span> <span className="font-bold text-slate-800">{selectedApp.bankAccount?.bankName || '—'}</span></div>
                  <div><span className="text-slate-400">{t(language, 'bo.branch')}</span> <span className="font-mono font-bold">{selectedApp.bankAccount?.branchNumber || '—'}</span></div>
                  <div className="flex flex-wrap items-center gap-x-1.5">
                    <span className="text-slate-400">{t(language, 'bo.account')}</span>
                    <bdi dir="ltr" className="font-mono font-bold">
                      {showClassicAccount ? selectedApp.bankAccount?.accountNumber || '—' : maskAccountNumber(selectedApp.bankAccount?.accountNumber)}
                    </bdi>
                    {selectedApp.bankAccount?.accountNumber && (
                      <button
                        type="button"
                        onClick={() => setShowClassicAccount((v) => !v)}
                        className="text-[10px] font-bold text-purple-800 hover:underline inline-flex items-center gap-0.5"
                      >
                        {showClassicAccount ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                        {t(language, showClassicAccount ? 'fi.bank.hide' : 'fi.bank.show')}
                      </button>
                    )}
                  </div>
                  <div><span className="text-slate-400">{t(language, 'bo.accountHolder')}</span> <span className="text-slate-800">{selectedApp.bankAccount?.accountHolderName || selectedApp.borrowerDetails?.fullName || '—'}</span></div>
                </div>

                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                  <div className="font-bold text-slate-900 text-[11px] border-b pb-1">
                    {t(language, 'status.guarantorInfo', { n: (Array.isArray(selectedApp.guarantors) && selectedApp.guarantors.length > 0) ? selectedApp.guarantors.length : (selectedApp.guarantor?.hasGuarantor ? 1 : 0) })}
                  </div>
                  {(() => {
                    const list = (Array.isArray(selectedApp.guarantors) && selectedApp.guarantors.length > 0)
                      ? selectedApp.guarantors
                      : (selectedApp.guarantor?.hasGuarantor ? [{
                          id: 'g_1',
                          fullName: selectedApp.guarantor.fullName || '',
                          passportOrIdNumber: selectedApp.guarantor.passportOrIdNumber || '',
                          mobilePhoneNumber: selectedApp.guarantor.mobilePhoneNumber || '',
                          relationship: selectedApp.guarantor.relationship || 'Co-worker',
                          idDocument: selectedApp.guarantor.passportPhoto,
                        }] : []);

                    if (list.length === 0) {
                      return (
                        <div className="text-slate-500 py-3 text-xs">
                          {t(language, 'bo.noGuarantor')}
                        </div>
                      );
                    }

                    return (
                      <div className="space-y-2">
                        {list.map((g, idx) => (
                          <div key={g.id || idx} className="p-2 rounded-xl bg-white border border-slate-200 text-xs space-y-1 min-w-0">
                            <div className="flex flex-wrap items-center justify-between gap-x-2 font-bold text-slate-800">
                              <span className="min-w-0 break-words">{t(language, 'bo.guarantorLine', { n: idx + 1, name: g.fullName })}</span>
                              <span className="text-[10px] font-normal text-slate-500">{optionLabel(language, 'relationship', g.relationship)}</span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px] text-slate-600 [&>*]:min-w-0">
                              <div>{t(language, 'bo.id')} <span className="font-mono font-semibold"><bdi dir="ltr">{g.passportOrIdNumber}</bdi></span></div>
                              <div>{t(language, 'bo.tel')} <bdi dir="ltr" className="whitespace-nowrap">{g.mobilePhoneNumber}</bdi></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Loan Details */}
              <div className="p-4 rounded-2xl bg-blue-950 text-white flex items-center justify-between">
                <div>
                  <div className="text-[11px] text-blue-300  font-bold">{t(language, 'bo.requestedAmount')}</div>
                  <div className="text-2xl font-extrabold font-mono text-white">{formatCurrency(selectedApp.loanRequest?.requestedAmountNis, language)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-blue-300  font-bold">{t(language, 'bo.termPlan')}</div>
                  <div className="text-sm font-bold">{t(language, 'bo.monthsAtMonthly', { months: selectedApp.loanRequest?.repaymentPeriodMonths ?? 0, monthly: formatCurrency(selectedApp.loanRequest?.estimatedMonthlyPaymentNis, language) })}</div>
                </div>
                <div>
                  <div className="text-[11px] text-blue-300  font-bold">{t(language, 'bo.totalRepayment')}</div>
                  <div className="text-lg font-bold font-mono text-blue-100">{formatCurrency(selectedApp.loanRequest?.totalRepaymentNis, language)}</div>
                </div>
              </div>

              {/* Automated Credit Risk Assessment (Phase 8) */}
              <div className="p-4 rounded-2xl bg-slate-900 text-white space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-purple-400" />
                    <span className="font-bold text-xs text-purple-200">
                      {t(language, 'bo.riskTitle')}
                    </span>
                  </div>
                  {selectedApp.riskLevel ? (
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                        selectedApp.riskLevel === 'Low'
                          ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                          : selectedApp.riskLevel === 'Medium'
                          ? 'bg-amber-950 text-amber-300 border-amber-700'
                          : 'bg-red-950 text-red-300 border-red-700'
                      }`}
                    >
                      {t(language, 'bo.riskBadge', { level: riskLevelLabel(language, selectedApp.riskLevel), score: selectedApp.riskScore ?? '—' })}
                    </span>
                  ) : (
                    <span className="text-slate-400 text-xs">{t(language, 'bo.riskPending')}</span>
                  )}
                </div>

                {selectedApp.riskFlags && selectedApp.riskFlags.length > 0 ? (
                  <div className="space-y-1">
                    <span className="text-[10px] text-slate-400 font-semibold">{t(language, 'bo.riskFlags')}</span>
                    <div className="space-y-1">
                      {selectedApp.riskFlags.map((flag, idx) => (
                        <div
                          key={idx}
                          className="text-[11px] font-mono text-amber-300 bg-amber-950/60 border border-amber-800/80 px-2.5 py-1 rounded-lg flex items-center gap-1.5"
                        >
                          <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                          <span title={flag}>{riskFlagLabel(language, flag)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-[11px] text-emerald-400 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{t(language, 'bo.noRiskFlags')}</span>
                  </div>
                )}
              </div>

              {/* Indicative Loan Eligibility Score */}
              <div>
                <EligibilityScoreBar
                  scoreData={
                    selectedApp.eligibilityBreakdown ||
                    calculateIndicativeEligibility(selectedApp)
                  }
                  language={language}
                  showBreakdownToggle={true}
                />
              </div>

              {/* Uploaded Documents Gallery & OCR verification */}
              <div className="space-y-2">
                <div className="font-bold text-slate-900  text-[11px]">
                  {t(language, 'bo.uploadedDocs', { n: selectedApp.documents?.length || 0 })}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {selectedApp.documents?.map((doc) => {
                    const resolvedUrl = apiService.resolveFileUrl(doc.fileUrl) || doc.dataUrl;
                    const isImg = doc.mimeType?.startsWith('image/') || resolvedUrl?.startsWith('data:image/');
                    return (
                      <div key={doc.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-800 text-[11px]">{docTypeLabel(language, doc.documentTypeCode)}</span>
                          <span className="text-[10px] text-emerald-700 bg-emerald-100 px-1.5 py-0.2 rounded font-semibold">
                            {qualityLabel(language, doc.qualityStatus)}
                          </span>
                        </div>

                        {/* Thumbnail view */}
                        {resolvedUrl && isImg ? (
                          <a
                            href={resolvedUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block overflow-hidden rounded-lg border border-slate-200 aspect-video bg-slate-100 group relative"
                            title={t(language, 'bo.viewFullSize')}
                          >
                            <img
                              src={resolvedUrl}
                              alt={doc.originalFilename}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                            />
                            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-[10px] font-bold transition-opacity">
                              <ExternalLink className="w-3 h-3" />
                            </div>
                          </a>
                        ) : resolvedUrl ? (
                          <a
                            href={resolvedUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center gap-1.5 text-blue-900 font-semibold text-[11px] hover:bg-blue-100"
                          >
                            <FileText className="w-4 h-4 text-blue-700" />
                            <span>{t(language, 'bo.viewPdf')}</span>
                          </a>
                        ) : null}

                        <div className="text-[10px] text-slate-500 truncate" title={doc.originalFilename}>
                          {doc.originalFilename}
                        </div>
                        {doc.ocrExtractedData && (
                          <div className="text-[10px] text-blue-900 bg-blue-50 p-1.5 rounded border border-blue-100 font-mono">
                            {t(language, 'bo.ocr', { value: doc.ocrExtractedData.passportNumber || doc.ocrExtractedData.visaExpiryDate || t(language, 'bo.ocrExtracted') })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Status History & Audit Notes */}
              <div className="space-y-2 border-t pt-3">
                <div className="font-bold text-slate-900  text-[11px]">
                  {t(language, 'bo.history')}
                </div>
                <div className="space-y-1.5">
                  {selectedApp.statusHistory?.map((h) => (
                    <div key={h.id} className="p-2 rounded-lg bg-slate-100 text-[11px] flex justify-between">
                      <div>
                        <span className="font-bold text-slate-800">{statusLabel(language, h.toStatus)}</span> — {statusReasonLabel(language, h.reason) || t(language, 'bo.statusUpdatedDefault')}
                        <span className="text-slate-400 block text-[10px]">{t(language, 'bo.by', { name: h.changedByName || h.changedByType || '' })}</span>
                      </div>
                      <span className="font-mono text-slate-400 text-[10px]">{formatDate(h.createdAt, language)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Operational Action Controls (Role-Based) */}
              <div className="p-4 rounded-2xl bg-purple-50 border border-purple-200 space-y-3">
                <div className="font-bold text-purple-950 text-xs flex items-center justify-between">
                  <span>{t(language, 'bo.actions', { role: roleLabel(language, currentRole) })}</span>
                </div>

                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder={t(language, 'bo.reasonPlaceholder')}
                    value={reviewReason}
                    onChange={(e) => setReviewReason(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-purple-200 bg-white text-xs text-slate-800"
                  />
                </div>

                {showDocNoteInput && (
                  <div className="space-y-1 animate-in fade-in">
                    <label className="text-[11px] font-bold text-amber-900">{t(language, 'bo.missingDocLabel')}</label>
                    <input
                      type="text"
                      placeholder={t(language, 'bo.missingDocPlaceholder')}
                      value={missingDocNote}
                      onChange={(e) => setMissingDocNote(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-amber-300 bg-white text-xs"
                    />
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {/* Credit Reviewer Actions */}
                  {(currentRole === 'credit_reviewer' || currentRole === 'system_admin') && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleStatusChange('Approved', DEFAULT_STATUS_REASONS.approved)}
                        className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1 shadow-xs"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {t(language, 'bo.approve')}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (!showDocNoteInput) {
                            setShowDocNoteInput(true);
                          } else {
                            handleStatusChange('Additional Document Required', DEFAULT_STATUS_REASONS.docRequested, missingDocNote);
                          }
                        }}
                        className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs flex items-center gap-1 shadow-xs"
                      >
                        <AlertCircle className="w-3.5 h-3.5" />
                        {showDocNoteInput ? t(language, 'bo.sendMissingDoc') : t(language, 'bo.requestDoc')}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleStatusChange('Rejected', reviewReason || DEFAULT_STATUS_REASONS.rejected)}
                        className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs flex items-center gap-1 shadow-xs"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        {t(language, 'bo.reject')}
                      </button>
                    </>
                  )}

                  {/* Funding Entity Partner Action */}
                  {(currentRole === 'funding_entity' || currentRole === 'system_admin' || currentRole === 'credit_reviewer') && (
                    <button
                      type="button"
                      onClick={handleFundingHandoff}
                      className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs flex items-center gap-1 shadow-xs"
                    >
                      <Send className="w-3.5 h-3.5" />
                      {t(language, 'bo.pushToFunding')}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedApp(null)}
                className="px-5 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs"
              >
                {t(language, 'bo.closeInspector')}
              </button>
            </div>
          </div>
        </div>
        )
      )}
    </div>
  );
};
