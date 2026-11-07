import React from 'react';
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  Lock,
  ChevronRight,
  AlertCircle,
  FileText,
  Building,
  User,
  Phone,
} from 'lucide-react';
import {
  FlowApplicationView,
  Language,
} from '../types';
import { statusLabel } from '../i18n/options';
import { formatCurrency, formatDate } from '../i18n/format';
import { t } from '../i18n/translations';

interface FlowStatusHubProps {
  application: FlowApplicationView;
  language: Language;
  onNavigateToStep: (step: number) => void;
  onResubmitCorrections?: () => void;
}

export const FlowStatusHub: React.FC<FlowStatusHubProps> = ({
  application,
  language,
  onNavigateToStep,
}) => {
  const isRejected = application.flowStatus === 'LOAN_REJECTED';
  const isApproved = application.flowStatus === 'LOAN_APPROVED';
  const isCompleted = application.isCompleted;

  const getStepIcon = (state: string) => {
    switch (state) {
      case 'approved':
        return <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />;
      case 'pending':
        return <Clock className="w-5 h-5 text-amber-500 animate-pulse shrink-0" />;
      case 'submitted':
        return <CheckCircle2 className="w-5 h-5 text-blue-600 shrink-0" />;
      case 'changes_requested':
        return <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />;
      case 'available':
        return <span className="block w-4 h-4 rounded-full border-2 border-blue-600 bg-white shrink-0" />;
      case 'rejected':
        return <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />;
      default:
        return <Lock className="w-4 h-4 text-slate-400 shrink-0" />;
    }
  };

  /** Text for each step state, so it is not shown by the icon alone. */
  const getStepStateLabel = (state: string) => {
    switch (state) {
      case 'approved':
        return { text: t(language, 'hub.state.approved'), color: 'text-emerald-700' };
      case 'pending':
        return { text: t(language, 'hub.state.pending'), color: 'text-amber-700' };
      case 'submitted':
        return { text: t(language, 'hub.state.submitted'), color: 'text-blue-700' };
      case 'changes_requested':
        return { text: t(language, 'hub.state.changes_requested'), color: 'text-red-600' };
      case 'available':
        return { text: t(language, 'hub.state.available'), color: 'text-blue-700' };
      case 'draft':
        return { text: t(language, 'hub.state.draft'), color: 'text-slate-600' };
      case 'rejected':
        return { text: t(language, 'hub.state.rejected'), color: 'text-red-700' };
      default:
        return { text: t(language, 'hub.state.locked'), color: 'text-slate-500' };
    }
  };

  const stepCards = [
    { step: 1 as const, title: t(language, 'hub.step1Title'), sub: t(language, 'hub.step1Sub') },
    { step: 2 as const, title: t(language, 'hub.step2Title'), sub: t(language, 'hub.step2Sub') },
    { step: 3 as const, title: t(language, 'hub.step3Title'), sub: t(language, 'hub.step3Sub') },
  ];

  const getStatusBadgeColor = (flowStatus: string) => {
    if (flowStatus.includes('APPROVED')) return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    if (flowStatus.includes('REJECTED')) return 'bg-red-100 text-red-800 border-red-200';
    if (flowStatus.includes('PENDING')) return 'bg-amber-100 text-amber-800 border-amber-200';
    if (flowStatus.includes('CHANGES')) return 'bg-rose-100 text-rose-800 border-rose-200';
    return 'bg-blue-100 text-blue-800 border-blue-200';
  };

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-slate-200/80 p-6 sm:p-8 max-w-xl mx-auto space-y-6 animate-in fade-in">
      {/* Top Status Header */}
      <div className="text-center space-y-2">
        <div
          className={`inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border ${getStatusBadgeColor(
            application.flowStatus
          )}`}
        >
          {statusLabel(language, application.flowStatus)}
        </div>

        <h1 className="text-xl sm:text-2xl font-black text-slate-900">
          {isApproved
            ? t(language, 'lead.statusApproved')
            : isRejected
            ? t(language, 'statusRejectedTitle')
            : isCompleted
            ? t(language, 'step3.successTitle')
            : t(language, 'lead.statusPending')}
        </h1>

        <p className="text-xs text-slate-500 font-mono">
          {t(language, 'lead.appRef', { id: application.requestNumber })}
        </p>
      </div>

      {/* Staff message / changes requested alert */}
      {application.staffMessage && (
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 space-y-1">
          <div className="flex items-center gap-1.5 font-bold text-xs">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <span>{t(language, 'hub.staffCommunication')}</span>
          </div>
          <p className="text-xs leading-relaxed ps-5">
            "{application.staffMessage.text}"
          </p>
        </div>
      )}

      {/* Rejection Note */}
      {isRejected && application.rejection && (
        <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-800 space-y-1">
          <span className="font-bold text-xs block">{t(language, 'hub.notApproved')}</span>
          <p className="text-xs leading-relaxed">
            {application.rejection.reason || t(language, 'hub.notApprovedDefault')}
          </p>
        </div>
      )}

      {/* 3-Step Interactive Timeline */}
      <div className="space-y-3 pt-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100 pb-1">
          {t(language, 'hub.journeyTitle')}
        </h2>

        <div className="space-y-2.5">
          {stepCards.map(({ step, title, sub }) => {
            const unlocked = step === 1 || application.unlockedStep >= step;
            const stateLabel = getStepStateLabel(application.stepStates[step]);
            return (
              <button
                key={step}
                type="button"
                disabled={!unlocked}
                onClick={() => onNavigateToStep(step)}
                className={`w-full text-start p-3.5 rounded-2xl border flex items-center justify-between transition-all focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                  unlocked
                    ? 'border-slate-200/90 bg-slate-50/60 hover:bg-slate-50 cursor-pointer'
                    : 'border-slate-100 bg-slate-50/20 opacity-60 cursor-not-allowed'
                }`}
              >
                <span className="flex items-center gap-3">
                  {getStepIcon(application.stepStates[step])}
                  <span className="space-y-0.5">
                    <span className="text-xs font-bold text-slate-800 block">
                      {title}
                    </span>
                    <span className="text-[11px] text-slate-500 block">
                      {sub}
                    </span>
                  </span>
                </span>
                <span className="flex items-center gap-1.5 shrink-0 ms-2">
                  <span className={`text-[11px] font-semibold ${stateLabel.color}`}>{stateLabel.text}</span>
                  <ChevronRight className="w-4 h-4 text-slate-400 rtl:rotate-180" />
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Action Button if Next Action is available */}
      {application.nextAction && !isRejected && (
        <button
          type="button"
          onClick={() => onNavigateToStep(application.nextAction!.step)}
          className="w-full py-4 px-6 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-black text-sm shadow-lg shadow-blue-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
        >
          <span>{t(language, 'hub.continueToStep', { n: application.nextAction.step })}</span>
          <ChevronRight className="w-4 h-4 rtl:rotate-180" />
        </button>
      )}

      {/* Summary overview card */}
      <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 text-xs space-y-2">
        <div className="font-bold text-slate-800 border-b border-slate-200 pb-1.5 flex justify-between items-center">
          <span>{t(language, 'hub.summaryTitle')}</span>
          <span className="font-mono text-slate-500">
            {formatDate(application.createdAt, language)}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-slate-600 pt-1">
          <div>
            <span className="font-semibold text-slate-700">{t(language, 'hub.applicant')}</span>{' '}
            {application.account?.fullName || application.steps[1].data?.personal?.fullName || '-'}
          </div>
          <div>
            <span className="font-semibold text-slate-700">{t(language, 'hub.phone')}</span>{' '}
            <bdi dir="ltr">{application.account?.phoneNumber || application.steps[1].data?.personal?.phoneNumber || '-'}</bdi>
          </div>
          {application.loanBreakdown && (
            <>
              <div>
                <span className="font-semibold text-slate-700">{t(language, 'hub.loan')}</span>{' '}
                {formatCurrency(application.loanBreakdown.requestedAmountNis, language)}
              </div>
              <div>
                <span className="font-semibold text-slate-700">{t(language, 'hub.term')}</span>{' '}
                {t(language, 'hub.months', { n: application.loanBreakdown.repaymentPeriodMonths })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
