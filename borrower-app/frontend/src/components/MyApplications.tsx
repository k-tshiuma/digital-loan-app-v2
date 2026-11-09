import React, { useEffect, useState } from 'react';
import {
  FileText,
  Clock,
  PlusCircle,
  ChevronRight,
  Download,
  AlertCircle,
  CheckCircle2,
  Calendar,
  X,
  Loader2,
} from 'lucide-react';
import { Language, LoanApplication, User } from '@quickloan/ui-core/types';
import { STATUS_BADGE_CONFIG } from '@quickloan/ui-core/config/appConfig';
import { t } from '@quickloan/ui-core/i18n/translations';
import { statusLabel } from '@quickloan/ui-core/i18n/options';
import { localizeError } from '@quickloan/ui-core/i18n/apiErrors';
import { formatCurrency, formatDate } from '@quickloan/ui-core/i18n/format';
import { apiService } from '../services/api';
import { storageService } from '@quickloan/ui-core/services/storage';

interface MyApplicationsProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  language: Language;
  onSelectApplication: (app: LoanApplication) => void;
  onStartNewApplication: () => void;
}

export const MyApplications: React.FC<MyApplicationsProps> = ({
  isOpen,
  onClose,
  currentUser,
  language,
  onSelectApplication,
  onStartNewApplication,
}) => {
  const [applications, setApplications] = useState<LoanApplication[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const history = await apiService.getApplicationHistory(currentUser.id);
      if (Array.isArray(history) && history.length > 0) {
        setApplications(history);
        setLoading(false);
        return;
      }
    } catch {
      // offline fallback
    }

    const localApps = storageService.getUserApplications(currentUser.id);
    setApplications(localApps);
    setLoading(false);
  };

  useEffect(() => {
    if (isOpen && currentUser) {
      fetchHistory();
    }
  }, [isOpen, currentUser]);

  const handleDownloadPdf = async (e: React.MouseEvent, app: LoanApplication) => {
    e.stopPropagation();
    setDownloadingId(app.id);
    try {
      await apiService.downloadApplicationPdf(app, language);
    } catch (err) {
      console.error('Download failed:', err);
      alert(localizeError(err, language, 'pdf.downloadFailed'));
    } finally {
      setDownloadingId(null);
    }
  };

  if (!isOpen) return null;

  const hasActiveUnderReview = applications.some(
    (a) => a.status === 'Received' || a.status === 'Under Review' || a.status === 'Additional Document Required'
  );

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div
        className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-100 text-blue-900 flex items-center justify-center font-bold">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900">{t(language, 'myLoanApplications')}</h2>
              <p className="text-xs text-slate-500">
                {t(language, 'myApps.subtitle')}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="flex items-center justify-between pb-1">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              {t(language, 'myApps.submittedCount', { n: applications.length })}
            </span>

            <button
              type="button"
              id="new-loan-app-btn"
              onClick={() => {
                if (hasActiveUnderReview) {
                  const proceed = window.confirm(
                    t(language, 'myApps.confirmNew')
                  );
                  if (!proceed) return;
                }
                onClose();
                onStartNewApplication();
              }}
              className="py-1.5 px-3 rounded-xl bg-blue-900 hover:bg-blue-800 text-white font-bold text-xs flex items-center gap-1.5 shadow-2xs transition-colors"
            >
              <PlusCircle className="w-4 h-4" />
              <span>{t(language, 'myApps.applyAnother')}</span>
            </button>
          </div>

          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              <span className="text-xs">{t(language, 'myApps.loading')}</span>
            </div>
          ) : applications.length === 0 ? (
            <div className="py-12 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 p-6">
              <Clock className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <div className="text-sm font-bold text-slate-700">{t(language, 'myApps.emptyTitle')}</div>
              <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
                {t(language, 'myApps.emptyText')}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {applications.map((app) => {
                const statusBadge =
                  STATUS_BADGE_CONFIG[app.status] || STATUS_BADGE_CONFIG['Received'];

                return (
                  <div
                    key={app.id}
                    onClick={() => {
                      onSelectApplication(app);
                      onClose();
                    }}
                    className="p-4 rounded-2xl border border-slate-200 bg-white hover:border-blue-400 hover:shadow-xs transition-all cursor-pointer group"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-2.5 mb-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-sm text-slate-900 group-hover:text-blue-900 transition-colors">
                          <bdi dir="ltr">{app.requestNumber}</bdi>
                        </span>
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border shadow-2xs ${statusBadge.badgeColor}`}
                        >
                          {statusLabel(language, app.status)}
                        </span>
                      </div>

                      <div className="text-[11px] text-slate-400 flex items-center gap-1 font-mono">
                        <Calendar className="w-3.5 h-3.5" />
                        <span>{formatDate(app.createdAt, language)}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-slate-600">
                      <div>
                        <span className="text-slate-400 text-[10px] block">{t(language, 'myApps.amountRequested')}</span>
                        <span className="font-bold text-slate-900 font-mono">
                          {formatCurrency(app.loanRequest?.requestedAmountNis, language)}
                        </span>
                      </div>

                      <div>
                        <span className="text-slate-400 text-[10px] block">{t(language, 'status.term')}</span>
                        <span className="font-medium text-slate-800">
                          {t(language, 'status.monthsN', { n: app.loanRequest?.repaymentPeriodMonths ?? 0 })}
                        </span>
                      </div>

                      <div>
                        <span className="text-slate-400 text-[10px] block">{t(language, 'myApps.estMonthly')}</span>
                        <span className="font-medium text-slate-800">
                          {formatCurrency(app.loanRequest?.estimatedMonthlyPaymentNis, language)}
                        </span>
                      </div>

                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={(e) => handleDownloadPdf(e, app)}
                          disabled={downloadingId === app.id}
                          className="p-2 rounded-xl bg-slate-50 hover:bg-blue-50 text-slate-600 hover:text-blue-900 border border-slate-200 transition-colors"
                          title={t(language, 'pdf.downloadShort')}
                        >
                          {downloadingId === app.id ? (
                            <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                          ) : (
                            <Download className="w-4 h-4" />
                          )}
                        </button>

                        <span className="inline-flex items-center gap-1 text-xs font-bold text-blue-900 group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 transition-transform">
                          <span>{t(language, 'myApps.view')}</span>
                          <ChevronRight className="w-4 h-4 rtl:rotate-180" />
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <span>{t(language, 'myApps.footer')}</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 font-bold text-slate-800 transition-colors"
          >
            {t(language, 'close')}
          </button>
        </div>
      </div>
    </div>
  );
};
