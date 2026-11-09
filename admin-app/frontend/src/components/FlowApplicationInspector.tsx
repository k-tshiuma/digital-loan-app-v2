import React, { useState } from 'react';
import {
  X,
  FileText,
  Download,
  CheckCircle2,
  AlertCircle,
  XCircle,
  AlertTriangle,
  Building2,
  Calendar,
  CreditCard,
  User,
  Phone,
  Mail,
  ExternalLink,
  Shield,
  Clock,
  Send,
  MessageSquare,
  Lock,
  Eye,
} from 'lucide-react';
import { Language, UserRole } from '@quickloan/ui-core/types';
import { statusLabel, flowGroupLabel, optionLabel } from '@quickloan/ui-core/i18n/options';
import { formatCurrency, formatDate, formatDateTime } from '@quickloan/ui-core/i18n/format';
import { t } from '@quickloan/ui-core/i18n/translations';
import { apiService } from '../services/api';
import { localizeError } from '@quickloan/ui-core/i18n/apiErrors';

interface FlowApplicationInspectorProps {
  detail: any;
  language: Language;
  currentRole: UserRole;
  onClose: () => void;
  onApproveStep: (step: number, note?: string) => Promise<void>;
  onRequestStepChanges: (step: number, notes: string, corrections: string) => Promise<void>;
  onRejectStep: (step: number, reason: string) => Promise<void>;
  onFinalDecision: (decision: 'APPROVE' | 'REJECT' | 'ADDITIONAL_DOCS', notes?: string) => Promise<void>;
  onSendMessage: (message: string) => Promise<void>;
  onDownloadPdf?: () => void;
  onDownloadJson?: () => void;
  /** Reloads the detail with the full bank account number (audit-logged by the backend). */
  onRevealBank?: () => Promise<void>;
}

const DECISION_BTN =
  'px-4 py-2 rounded-xl text-white font-bold text-xs flex items-center gap-1 shadow-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none';

type DecisionStage = 1 | 2 | 'final';

/** Statuses where a staff decision is due, and which one. */
const REVIEW_STAGE: Record<string, DecisionStage> = {
  PENDING_STEP1_APPROVAL: 1,
  PENDING_STEP2_APPROVAL: 2,
  PENDING_FINAL_PROCESSING: 'final',
};

/** Statuses where the applicant still has to submit, and which decision comes next. */
const WAITING_STAGE: Record<string, DecisionStage> = {
  LEAD_REGISTERED: 1,
  STEP1_CHANGES_REQUESTED: 1,
  STEP1_APPROVED: 2,
  STEP2_CHANGES_REQUESTED: 2,
  STEP2_APPROVED: 'final',
};

export const FlowApplicationInspector: React.FC<FlowApplicationInspectorProps> = ({
  detail,
  language,
  currentRole,
  onClose,
  onApproveStep,
  onRequestStepChanges,
  onRejectStep,
  onFinalDecision,
  onSendMessage,
  onDownloadPdf,
  onDownloadJson,
  onRevealBank,
}) => {
  const [activeTab, setActiveTab] = useState<'step1' | 'step2' | 'step3' | 'breakdown' | 'audit'>('step1');
  const [decisionNote, setDecisionNote] = useState('');
  const [correctionsText, setCorrectionsText] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [showChangesForm, setShowChangesForm] = useState(false);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [staffMessage, setStaffMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const canApproveOrReject = currentRole === 'credit_reviewer' || currentRole === 'system_admin';

  // Which decision the application is at. reviewStage: waiting for staff. waitingStage: waiting for the applicant.
  // Neither (loan approved or rejected): no decision left to make.
  const reviewStage = REVIEW_STAGE[detail.flowStatus];
  const waitingStage = WAITING_STAGE[detail.flowStatus];
  const stage = reviewStage ?? waitingStage;
  const canDecide = reviewStage !== undefined && canApproveOrReject;
  const decisionNotice =
    stage === undefined
      ? t(language, 'fi.note.closed')
      : reviewStage === undefined
      ? t(language, 'fi.note.waitingStep', { step: stage === 'final' ? 3 : stage })
      : !canApproveOrReject
      ? t(language, 'fi.note.noRole')
      : reviewStage === 'final'
      ? t(language, 'fi.note.reviewFinal')
      : t(language, 'fi.note.reviewStep', { step: reviewStage });

  const step1 = detail.steps?.[1] || {};
  const step2 = detail.steps?.[2] || {};
  const step3 = detail.steps?.[3] || {};
  const breakdown = detail.loanBreakdown;
  const termsAcceptances = detail.termsAcceptances || [];

  const p1 = step1.data?.personal || detail.step1Data?.personal || {};
  const b1 = detail.borrowerDetails || {};
  const r1 = detail.residencyDetails || {};
  const e1 = step1.data?.employment || detail.step1Data?.employment || detail.employmentDetails || {};
  const empInfo = {
    fullName: p1.fullName || b1.fullName || detail.account?.fullName || '',
    phoneNumber: p1.phoneNumber || b1.mobilePhoneNumber || detail.account?.phoneNumber || '',
    dateOfBirth: p1.dateOfBirth || b1.dateOfBirth || '',
    address: p1.address || b1.addressFull || '',
    passportNumber: p1.passportNumber || b1.passportNumber || '',
    countryOfOrigin: p1.countryOfOrigin || b1.countryOfOrigin || '',
    visaStartDate: p1.visaStartDate || r1.visaStartDate || '',
    visaExpiryDate: p1.visaExpiryDate || r1.visaExpiryDate || '',
    monthlySalaryNis:
      Number(p1.monthlySalaryNis) > 0
        ? Number(p1.monthlySalaryNis)
        : Number(e1.monthlySalaryNis) > 0
        ? Number(e1.monthlySalaryNis)
        : Number(detail.employmentDetails?.monthlySalaryNis) > 0
        ? Number(detail.employmentDetails.monthlySalaryNis)
        : null,
  };

  const renderVisaValidity = () => {
    if (empInfo.visaStartDate && empInfo.visaExpiryDate) {
      return (
        <bdi dir="ltr" className="font-semibold text-slate-900">
          {formatDate(empInfo.visaStartDate, language)} – {formatDate(empInfo.visaExpiryDate, language)}
        </bdi>
      );
    }
    if (empInfo.visaExpiryDate) {
      return (
        <bdi dir="ltr" className="font-semibold text-slate-900">
          {formatDate(empInfo.visaExpiryDate, language)}
        </bdi>
      );
    }
    if (empInfo.visaStartDate) {
      return (
        <bdi dir="ltr" className="font-semibold text-slate-900">
          {formatDate(empInfo.visaStartDate, language)}
        </bdi>
      );
    }
    return '—';
  };

  const renderEmployeeSummaryCard = (titleKey: string) => (
    <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
      <h4 className="font-bold text-slate-900 border-b border-slate-200 pb-1">
        {t(language, titleKey)}
      </h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
        <div>
          <span className="text-slate-400">{t(language, 'fi.passportNumber')}</span>{' '}
          <bdi dir="ltr" className="font-mono font-bold text-slate-900">
            {empInfo.passportNumber || '—'}
          </bdi>
        </div>
        <div>
          <span className="text-slate-400">{t(language, 'fi.countryOfOrigin')}</span>{' '}
          <span className="font-semibold text-slate-900">
            {empInfo.countryOfOrigin ? optionLabel(language, 'country', empInfo.countryOfOrigin) : '—'}
          </span>
        </div>
        <div>
          <span className="text-slate-400">{t(language, 'fi.visaValidity')}</span>{' '}
          {renderVisaValidity()}
        </div>
        <div>
          <span className="text-slate-400">{t(language, 'fi.monthlySalary')}</span>{' '}
          <span className="font-mono font-bold text-emerald-800">
            {empInfo.monthlySalaryNis !== null ? formatCurrency(empInfo.monthlySalaryNis, language) : '—'}
          </span>
        </div>
      </div>
    </div>
  );
  const reviews = detail.reviews || [];
  const auditLogs = detail.audit || [];

  const termsTypeLabel = (type: string | undefined) => {
    const key = `fi.terms.${type}`;
    const label = t(language, key);
    return label === key ? type || '—' : label;
  };

  const handleStepApproveClick = async (stepNum: number) => {
    setIsSubmitting(true);
    setActionError(null);
    try {
      await onApproveStep(stepNum, decisionNote || undefined);
      setDecisionNote('');
    } catch (err: any) {
      setActionError(localizeError(err, language));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestChangesClick = async (stepNum: number) => {
    if (!correctionsText.trim()) {
      setActionError(t(language, 'fi.err.changesRequired'));
      return;
    }
    setIsSubmitting(true);
    setActionError(null);
    try {
      await onRequestStepChanges(stepNum, decisionNote, correctionsText.trim());
      setShowChangesForm(false);
      setCorrectionsText('');
      setDecisionNote('');
    } catch (err: any) {
      setActionError(localizeError(err, language));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStepRejectClick = async (stepNum: number) => {
    if (!rejectReason.trim()) {
      setActionError(t(language, 'fi.err.reasonRequired'));
      return;
    }
    setIsSubmitting(true);
    setActionError(null);
    try {
      await onRejectStep(stepNum, rejectReason.trim());
      setShowRejectForm(false);
      setRejectReason('');
    } catch (err: any) {
      setActionError(localizeError(err, language));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFinalApprove = async () => {
    setIsSubmitting(true);
    setActionError(null);
    try {
      await onFinalDecision('APPROVE', decisionNote || undefined);
      setDecisionNote('');
    } catch (err: any) {
      setActionError(localizeError(err, language));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFinalAdditionalDocs = async () => {
    setIsSubmitting(true);
    setActionError(null);
    try {
      await onFinalDecision('ADDITIONAL_DOCS', decisionNote || undefined);
      setDecisionNote('');
    } catch (err: any) {
      setActionError(localizeError(err, language));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFinalReject = async () => {
    if (!rejectReason.trim()) {
      setActionError(t(language, 'fi.err.reasonRequired'));
      return;
    }
    setIsSubmitting(true);
    setActionError(null);
    try {
      await onFinalDecision('REJECT', rejectReason.trim());
      setShowRejectForm(false);
      setRejectReason('');
    } catch (err: any) {
      setActionError(localizeError(err, language));
    } finally {
      setIsSubmitting(false);
    }
  };

  const [isRevealing, setIsRevealing] = useState(false);
  const handleRevealBankClick = async () => {
    if (!onRevealBank) return;
    setIsRevealing(true);
    setActionError(null);
    try {
      await onRevealBank();
    } catch (err: any) {
      setActionError(localizeError(err, language));
    } finally {
      setIsRevealing(false);
    }
  };

  const handleSendMessageSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffMessage.trim()) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      await onSendMessage(staffMessage.trim());
      setStaffMessage('');
    } catch (err: any) {
      setActionError(localizeError(err, language));
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderDocItem = (title: string, docObj: any) => {
    if (!docObj) {
      return (
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-400">
          <span className="font-bold text-slate-600 block">{title}</span>
          <span>{t(language, 'fi.doc.notUploaded')}</span>
        </div>
      );
    }

    const docId = docObj.docId || docObj.id;
    const resolvedUrl = docId
      ? apiService.resolveFileUrl(`/documents/${docId}`)
      : docObj.fileUrl
      ? apiService.resolveFileUrl(docObj.fileUrl)
      : docObj.dataUrl;
    const isImg = docObj.mimeType?.startsWith('image/') || resolvedUrl?.startsWith('data:image/');

    return (
      <div className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-bold text-slate-800 text-xs">{title}</span>
          <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">
            {docObj.mimeType || t(language, 'fi.doc.file')}
          </span>
        </div>

        {resolvedUrl && isImg ? (
          <a
            href={resolvedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block aspect-video rounded-lg overflow-hidden border border-slate-200 bg-slate-100 relative group"
          >
            <img src={resolvedUrl} alt={docObj.filename || title} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-[10px] font-bold transition-opacity gap-1">
              <ExternalLink className="w-3.5 h-3.5" />
              <span>{t(language, 'fi.doc.viewFull')}</span>
            </div>
          </a>
        ) : resolvedUrl ? (
          <a
            href={resolvedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-3 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center gap-2 text-blue-900 font-semibold text-xs hover:bg-blue-100 transition-colors"
          >
            <FileText className="w-4 h-4 text-blue-700" />
            <span>{t(language, 'fi.doc.open')}</span>
          </a>
        ) : (
          <div className="text-xs text-slate-500 font-mono truncate" dir="ltr">{docObj.filename}</div>
        )}

        <div className="text-[10px] text-slate-400 truncate" dir="ltr" title={docObj.filename}>
          {docObj.filename}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl border border-slate-200 max-h-[94vh] flex flex-col overflow-hidden">
        {/* Top Header */}
        <div className="px-5 py-4 bg-[#0b1a2d] text-white flex flex-wrap items-center justify-between gap-3 border-b border-slate-800">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono font-bold text-base text-sky-400">
                <bdi dir="ltr">{detail.requestNumber}</bdi>
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-500/20 text-blue-300 border border-blue-400/30">
                {statusLabel(language, detail.flowStatus)}
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                {flowGroupLabel(language, detail.group)}
              </span>
            </div>

            <div className="text-xs text-slate-300 mt-1 flex flex-wrap items-center gap-3">
              <span>
                <strong>{t(language, 'fi.applicant')}</strong> {detail.account?.fullName || step1.data?.personal?.fullName || '—'}
              </span>
              <span>•</span>
              <span>
                <strong>{t(language, 'fi.phone')}</strong> <bdi dir="ltr">{detail.account?.phoneNumber || step1.data?.personal?.phoneNumber || '—'}</bdi>
              </span>
              <span>•</span>
              <span>
                <strong>{t(language, 'fi.email')}</strong> <bdi dir="ltr">{detail.account?.email || '—'}</bdi>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 ms-auto">
            {onDownloadPdf && (
              <button
                type="button"
                onClick={onDownloadPdf}
                className="px-3 py-1.5 rounded-xl bg-blue-700 hover:bg-blue-600 text-xs text-white border border-blue-600 flex items-center gap-1 font-semibold transition-colors"
                title={t(language, 'fi.downloadPdf')}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>PDF {/* i18n-ignore */}</span>
              </button>
            )}
            {onDownloadJson && (
              <button
                type="button"
                onClick={onDownloadJson}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-sky-300 border border-slate-700 flex items-center gap-1 font-semibold transition-colors"
                title={t(language, 'fi.exportJson')}
              >
                <Download className="w-3.5 h-3.5" />
                <span>JSON {/* i18n-ignore */}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label={t(language, 'fi.close')}
              title={t(language, 'fi.close')}
              className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Sub-Tab Navigation Bar */}
        <div className="bg-slate-100 border-b border-slate-200 px-5 py-2 flex items-center gap-1.5 overflow-x-auto text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('step1')}
            className={`py-1.5 px-3 rounded-xl font-bold transition-all whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'step1'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-white text-slate-700 hover:bg-slate-200 border border-slate-200'
            }`}
          >
            <span>{t(language, 'fi.tab.step1')}</span>
            {step1.status === 'APPROVED' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
            {step1.status === 'SUBMITTED' && <Clock className="w-3.5 h-3.5 text-amber-300" />}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('step2')}
            className={`py-1.5 px-3 rounded-xl font-bold transition-all whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'step2'
                ? 'bg-purple-600 text-white shadow-xs'
                : 'bg-white text-slate-700 hover:bg-slate-200 border border-slate-200'
            }`}
          >
            <span>{t(language, 'fi.tab.step2')}</span>
            {step2.status === 'APPROVED' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
            {step2.status === 'SUBMITTED' && <Clock className="w-3.5 h-3.5 text-amber-300" />}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('step3')}
            className={`py-1.5 px-3 rounded-xl font-bold transition-all whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'step3'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'bg-white text-slate-700 hover:bg-slate-200 border border-slate-200'
            }`}
          >
            <span>{t(language, 'fi.tab.step3')}</span>
            {step3.status === 'SUBMITTED' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('breakdown')}
            className={`py-1.5 px-3 rounded-xl font-bold transition-all whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'breakdown'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'bg-white text-slate-700 hover:bg-slate-200 border border-slate-200'
            }`}
          >
            <span>{t(language, 'fi.tab.breakdown')}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('audit')}
            className={`py-1.5 px-3 rounded-xl font-bold transition-all whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'audit'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-white text-slate-700 hover:bg-slate-200 border border-slate-200'
            }`}
          >
            <span>{t(language, 'fi.tab.audit')}</span>
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5 text-xs text-slate-700 flex-1">
          {actionError && (
            <div className="p-3 bg-red-50 border border-red-300 text-red-800 rounded-xl flex items-center gap-2 font-bold animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{actionError}</span>
            </div>
          )}

          {/* TAB 1: STEP 1 (Personal, Credentials, Docs, Employment, Requested Loan) */}
          {activeTab === 'step1' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Personal Details */}
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                  <h4 className="font-bold text-slate-900 border-b border-slate-200 pb-1 flex items-center justify-between">
                    <span>{t(language, 'fi.s1.personal')}</span>
                    <span className="text-[10px] text-blue-600 bg-blue-50 px-2 py-0.5 rounded font-mono">{t(language, 'fi.stepBadge', { step: 1 })}</span>
                  </h4>
                  <div><span className="text-slate-400">{t(language, 'fi.fullName')}</span> <span className="font-bold text-slate-900">{empInfo.fullName || '—'}</span></div>
                  {step1.data?.personal?.nameCorrection?.previousName && (
                    <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                      {t(language, 'fi.nameCorrected', { name: step1.data.personal.nameCorrection.previousName })}
                    </div>
                  )}
                  <div><span className="text-slate-400">{t(language, 'fi.phone')}</span> <bdi dir="ltr" className="font-bold">{empInfo.phoneNumber || '—'}</bdi></div>
                  {step1.data?.personal?.email && (
                    <div><span className="text-slate-400">{t(language, 'fi.email')}</span> <bdi dir="ltr" className="font-bold">{step1.data.personal.email}</bdi></div>
                  )}
                  <div><span className="text-slate-400">{t(language, 'fi.dob')}</span> {empInfo.dateOfBirth ? formatDate(empInfo.dateOfBirth, language) : '—'}</div>
                  <div><span className="text-slate-400">{t(language, 'fi.address')}</span> {empInfo.address || '—'}</div>
                  <div><span className="text-slate-400">{t(language, 'fi.passportNumber')}</span> <bdi dir="ltr" className="font-mono font-bold text-slate-900">{empInfo.passportNumber || '—'}</bdi></div>
                  <div><span className="text-slate-400">{t(language, 'fi.countryOfOrigin')}</span> <span className="font-semibold text-slate-900">{empInfo.countryOfOrigin ? optionLabel(language, 'country', empInfo.countryOfOrigin) : '—'}</span></div>
                  <div>
                    <span className="text-slate-400">{t(language, 'fi.visaValidity')}</span>{' '}
                    {renderVisaValidity()}
                  </div>
                  <div>
                    <span className="text-slate-400">{t(language, 'fi.monthlySalary')}</span>{' '}
                    <span className="font-mono font-bold text-emerald-800">
                      {empInfo.monthlySalaryNis !== null ? formatCurrency(empInfo.monthlySalaryNis, language) : '—'}
                    </span>
                  </div>
                </div>

                {/* Account & Registration */}
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                  <h4 className="font-bold text-slate-900 border-b border-slate-200 pb-1 flex items-center justify-between">
                    <span>{t(language, 'fi.s1.account')}</span>
                    <span className="text-[10px] text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded font-semibold">{t(language, 'fi.verified')}</span>
                  </h4>
                  <div><span className="text-slate-400">{t(language, 'fi.email')}</span> <bdi dir="ltr" className="font-mono font-bold text-slate-800">{detail.account?.email || '—'}</bdi></div>
                  <div><span className="text-slate-400">{t(language, 'fi.authMethod')}</span> <span className="font-semibold">{t(language, (step1.data?.account?.authMethod || detail.account?.authProvider) === 'google' ? 'fi.auth.google' : 'fi.auth.manual')}</span></div>
                  <div>
                    <span className="text-slate-400">{t(language, 'fi.location')}</span>{' '}
                    {step1.data?.registration?.locationGranted ? (
                      <span className="text-emerald-700 font-bold">{t(language, 'fi.granted')}</span>
                    ) : (
                      <span className="text-amber-700 font-bold">{t(language, 'fi.notGiven')}</span>
                    )}
                  </div>
                  <div>
                    <span className="text-slate-400">{t(language, 'fi.disclaimer')}</span>{' '}
                    {step1.data?.registration?.disclaimerAcceptedAt ? (
                      <span className="text-emerald-700 font-bold">{t(language, 'fi.accepted')}</span>
                    ) : (
                      <span className="text-amber-700 font-bold">{t(language, 'fi.notGiven')}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Employment Details */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                <h4 className="font-bold text-slate-900 border-b border-slate-200 pb-1">
                  {t(language, 'fi.s1.employment')}
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <span className="text-slate-400 block text-[11px]">{t(language, 'fi.employer')}</span>
                    <span className="font-bold text-slate-800">{step1.data?.employment?.employerName || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">{t(language, 'fi.company')}</span>
                    <span className="font-bold text-slate-800">{step1.data?.employment?.companyName || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">{t(language, 'fi.agent')}</span>
                    <span className="font-semibold text-slate-800">{step1.data?.employment?.manpowerAgent || t(language, 'fi.agentNone')}</span>
                  </div>
                </div>
              </div>

              {/* Verification Documents */}
              <div className="space-y-2">
                <h4 className="font-bold text-slate-900">
                  {t(language, 'fi.s1.documents')}
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {renderDocItem(t(language, 'fi.doc.passport'), step1.data?.documents?.passport)}
                  {renderDocItem(t(language, 'fi.doc.visa'), step1.data?.documents?.visa)}
                  {renderDocItem(t(language, 'fi.doc.payslip'), step1.data?.documents?.payslip)}
                </div>
              </div>

              {/* Requested Loan Amount */}
              <div className="p-4 rounded-2xl bg-blue-900 text-white flex items-center justify-between">
                <div>
                  <span className="text-blue-200 text-xs font-semibold block">{t(language, 'fi.s1.loan')}</span>
                  <span className="text-2xl font-black font-mono">
                    {formatCurrency(step1.data?.loan?.requestedAmountNis || detail.requestedAmountNis, language)}
                  </span>
                </div>
                <div className="text-end text-xs text-blue-200">
                  <span>{t(language, 'fi.guarantorNotice')}</span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: STEP 2 (Applicant Employee Info, Sponsors & Loan Duration) */}
          {activeTab === 'step2' && (
            <div className="space-y-4">
              {renderEmployeeSummaryCard('fi.s2.employeeInfo')}

              {/* Sponsors Section */}
              <div className="space-y-2">
                <h4 className="font-bold text-slate-900 flex items-center justify-between border-b pb-1">
                  <span>{t(language, 'fi.s2.sponsors')}</span>
                  <span className="text-[11px] text-slate-500 font-normal">
                    {t(language, 'fi.s2.count', { n: step2.data?.sponsors?.length || 0 })}
                  </span>
                </h4>

                {step2.data?.sponsors && step2.data.sponsors.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {step2.data.sponsors.map((sp: any, idx: number) => (
                      <div key={sp.id || idx} className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                        <div className="font-bold text-slate-900 text-xs flex items-center justify-between">
                          <span>{t(language, 'fi.s2.sponsor', { n: idx + 1 })}</span>
                          <span className="text-purple-700 bg-purple-100 px-2 py-0.5 rounded text-[10px]">{t(language, 'fi.s2.verifiedForm')}</span>
                        </div>
                        <div><span className="text-slate-400">{t(language, 'fi.fullName')}</span> <span className="font-bold text-slate-800">{sp.fullName}</span></div>
                        <div><span className="text-slate-400">{t(language, 'fi.idOrPassport')}</span> <bdi dir="ltr" className="font-mono font-bold text-slate-800">{sp.idOrPassportNumber || sp.passportOrIdNumber || '—'}</bdi></div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                    {t(language, 'fi.s2.none')}
                  </div>
                )}
              </div>

              {/* Loan Term Selection */}
              <div className="p-4 rounded-2xl bg-purple-900 text-white flex items-center justify-between">
                <div>
                  <span className="text-purple-200 text-xs font-semibold block">{t(language, 'fi.s2.duration')}</span>
                  <span className="text-xl font-bold font-mono">
                    {step2.data?.loan?.repaymentPeriodMonths || detail.repaymentPeriodMonths
                      ? t(language, 'fi.months', { n: step2.data?.loan?.repaymentPeriodMonths || detail.repaymentPeriodMonths })
                      : '—'}
                  </span>
                </div>
                <div className="text-end">
                  <span className="text-purple-200 text-xs font-semibold block">{t(language, 'fi.s2.monthly')}</span>
                  <span className="text-lg font-bold font-mono text-purple-100">
                    {step2.data?.loan?.estimatedMonthlyPaymentNis || breakdown?.monthlyPaymentTotalNis
                      ? formatCurrency(step2.data?.loan?.estimatedMonthlyPaymentNis || breakdown.monthlyPaymentTotalNis, language)
                      : '—'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: STEP 3 (Applicant Employee Info, Bank Account Details & Terms) */}
          {activeTab === 'step3' && (
            <div className="space-y-4">
              {renderEmployeeSummaryCard('fi.s3.employeeInfo')}

              {/* Bank Account Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                  <h4 className="font-bold text-slate-900 border-b pb-1">
                    {t(language, 'fi.s3.bank')}
                  </h4>
                  <div><span className="text-slate-400">{t(language, 'fi.bank')}</span> <span className="font-bold text-slate-800">{step3.data?.bank?.bankName || '—'}</span></div>
                  <div><span className="text-slate-400">{t(language, 'fi.bankCode')}</span> <bdi dir="ltr" className="font-mono font-bold">{step3.data?.bank?.bankCode || '—'}</bdi></div>
                  <div><span className="text-slate-400">{t(language, 'fi.branch')}</span> <bdi dir="ltr" className="font-mono font-bold">{step3.data?.bank?.branchNumber || '—'}</bdi></div>
                  <div className="flex flex-wrap items-center gap-x-1.5">
                    <span className="text-slate-400">{t(language, 'fi.accountNumber')}</span>
                    <bdi dir="ltr" className="font-mono font-bold text-blue-900">{step3.data?.bank?.accountNumber || '—'}</bdi>
                    {step3.data?.bank?.accountNumber && !detail.bankRevealed && onRevealBank && (
                      <button
                        type="button"
                        disabled={isRevealing}
                        onClick={handleRevealBankClick}
                        title={t(language, 'fi.bank.showHint')}
                        className="text-[10px] font-bold text-blue-700 hover:underline inline-flex items-center gap-0.5 disabled:opacity-50"
                      >
                        <Eye className="w-3 h-3" />
                        {t(language, 'fi.bank.show')}
                      </button>
                    )}
                  </div>
                  <div><span className="text-slate-400">{t(language, 'fi.accountHolder')}</span> <span className="font-bold text-slate-900">{step3.data?.bank?.accountHolderName || '—'}</span></div>
                </div>

                {/* Bank Account Document */}
                <div className="space-y-2">
                  <h4 className="font-bold text-slate-900">
                    {t(language, 'fi.s3.bankDoc')}
                  </h4>
                  {renderDocItem(t(language, 'fi.doc.bankConfirmation'), step3.data?.bankDocument)}
                </div>
              </div>

              {/* Terms and Conditions Acceptance Audit */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                <h4 className="font-bold text-slate-900 border-b pb-1 flex items-center justify-between">
                  <span>{t(language, 'fi.s3.terms')}</span>
                  <span className="text-[10px] text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded font-semibold">{t(language, 'fi.s3.binding')}</span>
                </h4>

                {termsAcceptances.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {termsAcceptances.map((rec: any, idx: number) => (
                      <div key={idx} className="p-3 rounded-xl bg-white border border-slate-200 text-xs space-y-1">
                        <div className="flex items-center justify-between font-bold text-slate-800">
                          <span>{termsTypeLabel(rec.termsType)}</span>
                          <span className="text-emerald-700 font-bold">{t(language, 'fi.accepted')}</span>
                        </div>
                        <div><span className="text-slate-400">{t(language, 'fi.version')}</span> <bdi dir="ltr" className="font-mono font-semibold">{rec.version}</bdi></div>
                        <div><span className="text-slate-400">{t(language, 'fi.acceptedAt')}</span> <bdi dir="ltr" className="font-mono">{formatDateTime(rec.acceptedAt, language)}</bdi></div>
                        <div><span className="text-slate-400">{t(language, 'fi.ip')}</span> <bdi dir="ltr" className="font-mono">{rec.ipAddress || '—'}</bdi></div>
                        {rec.hash && (
                          <div className="text-[10px] text-slate-400 font-mono truncate" title={rec.hash}>
                            {t(language, 'fi.hash')} <bdi dir="ltr">{rec.hash.slice(0, 24)}…</bdi>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">
                    {t(language, 'fi.s3.noTerms')}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: FINANCIAL BREAKDOWN */}
          {activeTab === 'breakdown' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-900 text-xs space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <Shield className="w-4 h-4 text-indigo-700" />
                  <span>{t(language, 'fi.bd.feeTitle')}</span>
                </div>
                <p>{t(language, 'fi.bd.feeText')}</p>
              </div>

              {breakdown ? (
                <div className="p-5 rounded-2xl bg-slate-900 text-white space-y-4">
                  <h4 className="font-bold text-sm text-sky-400 border-b border-slate-800 pb-2">
                    {t(language, 'fi.bd.title')}
                  </h4>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                    <div>
                      <span className="text-slate-400 block">{t(language, 'fi.bd.amount')}</span>
                      <span className="text-xl font-bold font-mono text-white">
                        {formatCurrency(breakdown.requestedAmountNis, language)}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block">{t(language, 'fi.bd.duration')}</span>
                      <span className="text-xl font-bold font-mono text-white">
                        {t(language, 'fi.months', { n: breakdown.repaymentPeriodMonths })}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block">{t(language, 'fi.bd.interest')}</span>
                      <span className="text-xl font-bold font-mono text-amber-300">
                        {formatCurrency(breakdown.totalInterestNis, language)}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block">{t(language, 'fi.bd.fee')}</span>
                      <span className="text-xl font-bold font-mono text-indigo-300">
                        {formatCurrency(breakdown.totalServiceFeeNis, language)}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block">{t(language, 'fi.bd.total')}</span>
                      <span className="text-xl font-extrabold font-mono text-emerald-400">
                        {formatCurrency(breakdown.totalRepaymentNis, language)}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block">{t(language, 'fi.bd.monthlyLoan')}</span>
                      <span className="text-xl font-extrabold font-mono text-emerald-300">
                        {formatCurrency(breakdown.monthlyRepaymentWithInterestNis, language)}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block">{t(language, 'fi.bd.monthlyFee')}</span>
                      <span className="text-xl font-extrabold font-mono text-indigo-200">
                        {formatCurrency(breakdown.monthlyServiceFeeNis, language)}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200 text-center text-slate-500 text-xs">
                  {t(language, 'fi.bd.none')}
                </div>
              )}
            </div>
          )}

          {/* TAB 5: AUDIT & MESSAGING */}
          {activeTab === 'audit' && (
            <div className="space-y-4">
              {/* Send message to applicant */}
              <form onSubmit={handleSendMessageSubmit} className="p-4 rounded-2xl bg-blue-50 border border-blue-200 space-y-2">
                <div className="font-bold text-blue-950 text-xs flex items-center gap-1.5">
                  <MessageSquare className="w-4 h-4 text-blue-700" />
                  <span>{t(language, 'fi.msg.title')}</span>
                </div>
                <p className="text-[11px] text-blue-700">
                  {t(language, 'fi.msg.hint')}
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={staffMessage}
                    onChange={(e) => setStaffMessage(e.target.value)}
                    placeholder={t(language, 'fi.msg.placeholder')}
                    className="flex-1 px-3 py-2 rounded-xl border border-blue-300 bg-white text-xs text-slate-800"
                  />
                  <button
                    type="submit"
                    disabled={isSubmitting || !staffMessage.trim()}
                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{t(language, 'fi.msg.send')}</span>
                  </button>
                </div>
              </form>

              {/* Staff message currently visible to applicant */}
              {detail.staffMessage && (
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs space-y-1">
                  <div className="font-bold flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                    <span>{t(language, 'fi.msg.active')}</span>
                  </div>
                  <p className="ps-4"><bdi>{detail.staffMessage.text}</bdi></p>
                  <span className="text-[10px] text-amber-700 block ps-4">
                    {t(language, 'fi.msg.sentBy', {
                      role: t(language, `role.${detail.staffMessage.senderRole}`),
                      // LTR isolate (U+2066…U+2069) keeps "date, time" in order inside Hebrew text.
                      date: `⁦${formatDateTime(detail.staffMessage.sentAt, language)}⁩`,
                    })}
                  </span>
                </div>
              )}

              {/* Review History */}
              <div className="space-y-2">
                <h4 className="font-bold text-slate-900">{t(language, 'fi.rev.title')}</h4>
                {reviews.length > 0 ? (
                  <div className="space-y-1.5">
                    {reviews.map((rev: any, idx: number) => (
                      <div key={idx} className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs flex justify-between items-start">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-800">{t(language, 'fi.stepBadge', { step: rev.stepNumber })}</span>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              rev.decision === 'APPROVE'
                                ? 'bg-emerald-100 text-emerald-800'
                                : rev.decision === 'REQUEST_CHANGES'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-red-100 text-red-800'
                            }`}>
                              {t(language, `fi.rev.${rev.decision}`)}
                            </span>
                          </div>
                          {rev.notes && <p className="text-slate-600 mt-1">{t(language, 'fi.rev.notes')} <bdi>{rev.notes}</bdi></p>}
                          {rev.correctionsRequired && (
                            <p className="text-amber-800 mt-0.5 font-semibold">
                              {t(language, 'fi.rev.corrections')} <bdi>{rev.correctionsRequired}</bdi>
                            </p>
                          )}
                          <span className="text-[10px] text-slate-400 block mt-1">
                            {t(language, 'fi.rev.by', { name: rev.reviewedByName || rev.reviewedBy || '—' })}
                          </span>
                        </div>
                        <bdi dir="ltr" className="text-[10px] text-slate-400 font-mono shrink-0">
                          {formatDateTime(rev.createdAt, language)}
                        </bdi>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-slate-400">{t(language, 'fi.rev.none')}</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Bottom decision bar. Always shown so staff can see which decision is next and why it may be locked. */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 space-y-3">
          {showChangesForm && reviewStage !== undefined && reviewStage !== 'final' && (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-xs space-y-2 animate-in fade-in">
              <span className="font-bold text-amber-900 block">{t(language, 'fi.changesLabel')}</span>
              <textarea
                value={correctionsText}
                onChange={(e) => setCorrectionsText(e.target.value)}
                placeholder={t(language, 'fi.changesPlaceholder')}
                rows={2}
                className="w-full p-2.5 rounded-xl border border-amber-300 bg-white text-xs text-slate-800 focus:outline-none"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowChangesForm(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-200 text-slate-700 font-bold"
                >
                  {t(language, 'fi.cancel')}
                </button>
                <button
                  type="button"
                  disabled={isSubmitting || !correctionsText.trim()}
                  onClick={() => handleRequestChangesClick(reviewStage)}
                  className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {t(language, 'fi.submitChanges')}
                </button>
              </div>
            </div>
          )}

          {showRejectForm && reviewStage !== undefined && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-300 text-xs space-y-2 animate-in fade-in">
              <span className="font-bold text-red-900 block">{t(language, 'fi.rejectLabel')}</span>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder={t(language, 'fi.rejectPlaceholder')}
                rows={2}
                className="w-full p-2.5 rounded-xl border border-red-300 bg-white text-xs text-slate-800 focus:outline-none"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowRejectForm(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-200 text-slate-700 font-bold"
                >
                  {t(language, 'fi.cancel')}
                </button>
                <button
                  type="button"
                  disabled={isSubmitting || !rejectReason.trim()}
                  onClick={() => (reviewStage === 'final' ? handleFinalReject() : handleStepRejectClick(reviewStage))}
                  className="px-4 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {t(language, 'fi.confirmReject')}
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              role="status"
              className={`text-xs font-semibold flex items-center gap-1.5 ${
                canDecide ? 'text-emerald-800' : reviewStage !== undefined ? 'text-amber-800' : 'text-slate-500'
              }`}
            >
              {canDecide ? (
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              ) : reviewStage !== undefined ? (
                <Lock className="w-3.5 h-3.5 shrink-0" />
              ) : stage !== undefined ? (
                <Clock className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>{decisionNotice}</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {stage !== undefined && (
                <>
                  <button
                    type="button"
                    disabled={isSubmitting || !canDecide}
                    title={canDecide ? undefined : decisionNotice}
                    onClick={() => (stage === 'final' ? handleFinalApprove() : handleStepApproveClick(stage))}
                    className={`${DECISION_BTN} bg-emerald-600 hover:bg-emerald-700`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{stage === 'final' ? t(language, 'fi.approveLoan') : t(language, 'fi.approveStep', { step: stage })}</span>
                  </button>

                  <button
                    type="button"
                    disabled={isSubmitting || !canDecide}
                    title={canDecide ? undefined : decisionNotice}
                    onClick={() => {
                      if (stage === 'final') {
                        handleFinalAdditionalDocs();
                        return;
                      }
                      setShowChangesForm(true);
                      setShowRejectForm(false);
                    }}
                    className={`${DECISION_BTN} bg-amber-600 hover:bg-amber-700`}
                  >
                    {stage === 'final' ? <AlertCircle className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                    <span>{stage === 'final' ? t(language, 'fi.requestDocs') : t(language, 'fi.requestChanges')}</span>
                  </button>

                  <button
                    type="button"
                    disabled={isSubmitting || !canDecide}
                    title={canDecide ? undefined : decisionNotice}
                    onClick={() => {
                      setShowRejectForm(true);
                      setShowChangesForm(false);
                    }}
                    className={`${DECISION_BTN} bg-red-600 hover:bg-red-700`}
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>{stage === 'final' ? t(language, 'fi.rejectLoan') : t(language, 'fi.rejectStep', { step: stage })}</span>
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs cursor-pointer"
              >
                {t(language, 'fi.close')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
