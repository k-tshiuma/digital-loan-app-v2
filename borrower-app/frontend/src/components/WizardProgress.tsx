import React from 'react';
import { Language } from '@quickloan/ui-core/types';
import { t } from '@quickloan/ui-core/i18n/translations';

interface WizardProgressProps {
  currentStep: number;
  totalSteps?: number;
  stepTitleKey?: string;
  language: Language;
}

export const WizardProgress: React.FC<WizardProgressProps> = ({
  currentStep,
  totalSteps = 11,
  stepTitleKey,
  language,
}) => {
  // If at step 10 or 11 (Submission & Status), progress is 100%
  const progressPercent = Math.min(100, Math.round((currentStep / totalSteps) * 100));

  const stepTitles: Record<number, string> = {
    1: t(language, 'chooseLanguageTitle'),
    2: t(language, 'registerTitle'),
    3: t(language, 'borrowerDetailsTitle'),
    4: t(language, 'residencyDetailsTitle'),
    5: t(language, 'employmentDetailsTitle'),
    6: t(language, 'loanDetailsTitle'),
    7: t(language, 'guarantorTitle'),
    8: t(language, 'documentUploadTitle'),
    9: t(language, 'reviewTitle'),
    10: t(language, 'applicationSubmittedTitle'),
    11: t(language, 'statusTimelineTitle'),
  };

  const title = stepTitleKey ? t(language, stepTitleKey) : stepTitles[currentStep] || '';

  return (
    <div className="w-full pb-4 pt-1">
      <div className="flex items-center justify-between text-xs font-semibold mb-1.5 text-slate-500">
        <span className="text-blue-900 font-bold">
          {t(language, 'stepOf', { current: currentStep, total: totalSteps })}
        </span>
        <span className="text-blue-700 font-medium truncate max-w-[200px]">
          {title}
        </span>
        <span className="text-blue-900 font-bold ms-1">
          {progressPercent}%
        </span>
      </div>

      {/* Progress track */}
      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden p-0.5 border border-slate-200/60">
        <div
          className="h-full bg-gradient-to-r rtl:bg-gradient-to-l from-blue-600 via-sky-500 to-sky-400 rounded-full transition-all duration-300 ease-out shadow-xs"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  );
};
