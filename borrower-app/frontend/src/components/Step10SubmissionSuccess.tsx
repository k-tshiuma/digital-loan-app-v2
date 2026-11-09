import React, { useEffect, useState } from 'react';
import { CheckCircle2, Copy, ArrowRight, ShieldCheck, Clock, MessageSquare, Check, Download, Loader2 } from 'lucide-react';
import confetti from 'canvas-confetti';
import { Language, LoanApplication } from '@quickloan/ui-core/types';
import { t } from '@quickloan/ui-core/i18n/translations';
import { localizeError } from '@quickloan/ui-core/i18n/apiErrors';
import { apiService } from '../services/api';
import { calculateIndicativeEligibility } from '@quickloan/ui-core/services/eligibilityScoring';
import { EligibilityScoreBar } from '@quickloan/ui-core/components/EligibilityScoreBar';

interface Step10SubmissionSuccessProps {
  language: Language;
  application: LoanApplication;
  onTrackStatus: () => void;
}

export const Step10SubmissionSuccess: React.FC<Step10SubmissionSuccessProps> = ({
  language,
  application,
  onTrackStatus,
}) => {
  const [copied, setCopied] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  useEffect(() => {
    // Fire confetti cannon
    try {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
      });
    } catch {}
  }, []);

  const handleCopyRequestNumber = () => {
    if (application.requestNumber) {
      navigator.clipboard.writeText(application.requestNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadPdf = async () => {
    setIsDownloadingPdf(true);
    try {
      await apiService.downloadApplicationPdf(application, language);
    } catch (err: any) {
      console.error('Failed to download PDF:', err);
      alert(localizeError(err, language, 'pdf.downloadFailed'));
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 max-w-md mx-auto w-full py-4 text-center animate-in fade-in zoom-in-95 duration-400">
      {/* Big Success Icon */}
      <div className="flex justify-center mb-4">
        <div className="w-20 h-20 rounded-full bg-emerald-50 border-4 border-emerald-100 flex items-center justify-center text-emerald-600 shadow-sm">
          <CheckCircle2 className="w-10 h-10 stroke-[2.5]" />
        </div>
      </div>

      <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
        {t(language, 'applicationSubmittedTitle')}
      </h1>
      <p className="text-sm text-slate-500 mt-1 max-w-xs mx-auto">
        {t(language, 'applicationSubmittedSubtitle')}
      </p>

      {/* Prominent Request Number Badge */}
      <div className="my-6 p-4 rounded-2xl bg-blue-50/90 border border-blue-200/80 shadow-xs">
        <span className="text-xs font-bold text-blue-900 block mb-1">
          {t(language, 'yourRequestNumber')}
        </span>
        <div className="flex items-center justify-center gap-2">
          <span className="text-2xl font-black font-mono text-blue-950 tracking-wider">
            <bdi dir="ltr">{application.requestNumber}</bdi>
          </span>
          <button
            type="button"
            onClick={handleCopyRequestNumber}
            className="p-1.5 rounded-lg bg-white hover:bg-blue-100 border border-blue-200 text-blue-700 transition-colors"
            title={t(language, 'copyRequestNumber')}
          >
            {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
        <p className="text-[11px] text-slate-500 mt-1">
          {t(language, 'keepRequestNumberNotice')}
        </p>
      </div>

      {/* Indicative Loan Eligibility Result */}
      <div className="mb-6 text-start">
        <EligibilityScoreBar
          scoreData={
            application.eligibilityBreakdown ||
            calculateIndicativeEligibility(application)
          }
          language={language}
          showBreakdownToggle={true}
        />
      </div>

      {/* Next Steps List */}
      <div className="text-start space-y-3 mb-8">
        <div className="text-xs font-bold text-slate-700 ">
          {t(language, 'nextStepsTitle')}
        </div>

        <div className="p-3 rounded-xl bg-white border border-slate-200 flex items-start gap-3 shadow-2xs">
          <Clock className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
          <div className="text-xs text-slate-700">
            <span className="font-semibold text-slate-900 block">{t(language, 'next.underwritingTitle')}</span>
            {t(language, 'next.underwritingText')}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-white border border-slate-200 flex items-start gap-3 shadow-2xs">
          <MessageSquare className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
          <div className="text-xs text-slate-700">
            <span className="font-semibold text-slate-900 block">{t(language, 'next.smsTitle')}</span>
            {t(language, 'next.smsText')}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-white border border-slate-200 flex items-start gap-3 shadow-2xs">
          <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
          <div className="text-xs text-slate-700">
            <span className="font-semibold text-slate-900 block">{t(language, 'next.fundingTitle')}</span>
            {t(language, 'next.fundingText')}
          </div>
        </div>
      </div>

      {/* Primary & Secondary Actions */}
      <div className="mt-auto pt-2 space-y-2">
        <button
          type="button"
          id="track-status-primary-btn"
          onClick={onTrackStatus}
          className="w-full py-3.5 px-6 rounded-xl bg-blue-900 hover:bg-blue-800 text-white font-semibold text-base shadow-sm hover:shadow transition-all flex items-center justify-center gap-2 group"
        >
          <span>{t(language, 'trackApplicationStatus')}</span>
        </button>

        <button
          type="button"
          onClick={handleDownloadPdf}
          disabled={isDownloadingPdf}
          className="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors flex items-center justify-center gap-2 border border-slate-200"
        >
          {isDownloadingPdf ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
              <span>{t(language, 'pdf.generating')}</span>
            </>
          ) : (
            <>
              <Download className="w-3.5 h-3.5 text-blue-600" />
              <span>{t(language, 'pdf.download')}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
