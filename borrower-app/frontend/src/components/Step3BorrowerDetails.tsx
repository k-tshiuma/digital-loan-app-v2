import React, { useState, useEffect } from 'react';
import { User, Calendar, MapPin, Flag, AlertTriangle, ArrowRight, ArrowLeft, ShieldCheck } from 'lucide-react';
import { Language, BorrowerDetails } from '@quickloan/ui-core/types';
import { ORIGIN_COUNTRIES, STEP1_ORIGIN_COUNTRIES, MARITAL_STATUSES, calculateAge } from '@quickloan/ui-core/config/appConfig';
import { t } from '@quickloan/ui-core/i18n/translations';
import { optionLabel } from '@quickloan/ui-core/i18n/options';
import { storageService } from '../services/storage';
import { DateInput } from '@quickloan/ui-core/components/DateInput';

const ALL_ORIGIN_COUNTRIES = Array.from(new Set<string>([...STEP1_ORIGIN_COUNTRIES, ...ORIGIN_COUNTRIES]));

interface Step3BorrowerDetailsProps {
  language: Language;
  initialData?: Partial<BorrowerDetails>;
  userPhoneNumber?: string;
  applicationId?: string;
  onSaveAndNext: (data: BorrowerDetails) => void;
  onBack: () => void;
}

export const Step3BorrowerDetails: React.FC<Step3BorrowerDetailsProps> = ({
  language,
  initialData,
  userPhoneNumber,
  applicationId,
  onSaveAndNext,
  onBack,
}) => {
  const [formData, setFormData] = useState<BorrowerDetails>({
    fullName: initialData?.fullName || '',
    passportNumber: initialData?.passportNumber || '',
    countryOfOrigin: initialData?.countryOfOrigin || '',
    dateOfBirth: initialData?.dateOfBirth || '1995-06-15',
    mobilePhoneNumber: initialData?.mobilePhoneNumber || userPhoneNumber || '+972',
    addressCity: initialData?.addressCity || '',
    addressStreet: initialData?.addressStreet || '',
    addressFull: initialData?.addressFull || '',
    maritalStatus: initialData?.maritalStatus || 'Single',
    otherMaritalStatusDetails: initialData?.otherMaritalStatusDetails || '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [calculatedAge, setCalculatedAge] = useState<number | null>(null);

  // Synchronize formData whenever initialData or authenticated phone updates
  useEffect(() => {
    if (initialData) {
      setFormData((prev) => ({
        ...prev,
        fullName: initialData.fullName ?? prev.fullName,
        passportNumber: initialData.passportNumber ?? prev.passportNumber,
        countryOfOrigin: initialData.countryOfOrigin ?? prev.countryOfOrigin,
        dateOfBirth: initialData.dateOfBirth ?? prev.dateOfBirth,
        mobilePhoneNumber: initialData.mobilePhoneNumber ?? userPhoneNumber ?? prev.mobilePhoneNumber,
        addressCity: initialData.addressCity ?? prev.addressCity,
        addressStreet: initialData.addressStreet ?? prev.addressStreet,
        addressFull: initialData.addressFull ?? prev.addressFull,
        maritalStatus: initialData.maritalStatus ?? prev.maritalStatus,
        otherMaritalStatusDetails: initialData.otherMaritalStatusDetails ?? prev.otherMaritalStatusDetails,
      }));
    } else if (userPhoneNumber) {
      setFormData((prev) => ({
        ...prev,
        mobilePhoneNumber: prev.mobilePhoneNumber || userPhoneNumber,
      }));
    }
  }, [initialData, userPhoneNumber]);

  // Compute live age
  useEffect(() => {
    if (formData.dateOfBirth) {
      const age = calculateAge(formData.dateOfBirth);
      setCalculatedAge(age);
    }
  }, [formData.dateOfBirth]);

  const isPreFilled = Boolean(initialData?.passportNumber || (initialData?.fullName && initialData.fullName.trim().length > 0));

  const validate = (): boolean => {
    const errs: Record<string, string> = {};

    if (!formData.fullName.trim()) {
      errs.fullName = t(language, 'requiredField');
    }

    if (!formData.passportNumber.trim()) {
      errs.passportNumber = t(language, 'requiredField');
    } else {
      // Check duplicate open application by passport
      const dupCheck = storageService.checkDuplicateOpenApplication(
        undefined,
        formData.passportNumber,
        applicationId
      );
      if (dupCheck.isDuplicate) {
        errs.passportNumber = `${t(language, 'alreadyRegisteredError')} (${dupCheck.existingRequestNumber})`;
      }
    }

    if (!formData.dateOfBirth) {
      errs.dateOfBirth = t(language, 'requiredField');
    } else {
      const age = calculateAge(formData.dateOfBirth);
      if (age < 21) {
        errs.dateOfBirth = t(language, 'minAgeError', { age: 21 });
      }
    }

    if (!formData.mobilePhoneNumber.trim()) {
      errs.mobilePhoneNumber = t(language, 'requiredField');
    }

    if (!formData.addressCity.trim() && !formData.addressFull.trim()) {
      errs.addressCity = t(language, 'requiredField');
    }

    if (formData.maritalStatus === 'Other' && (!formData.otherMaritalStatusDetails || !formData.otherMaritalStatusDetails.trim())) {
      errs.otherMaritalStatusDetails = t(language, 'wizard.err.maritalDetails');
    }

    if (!formData.countryOfOrigin) {
      errs.countryOfOrigin = t(language, 'requiredField');
    } else if (formData.countryOfOrigin === 'Other' && (!(formData as any).otherCountryOfOriginDetails || !(formData as any).otherCountryOfOriginDetails.trim())) {
      errs.otherCountryOfOriginDetails = t(language, 'wizard.err.countryDetails');
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) {
      const fullAddr =
        formData.addressFull ||
        `${formData.addressStreet ? formData.addressStreet + ', ' : ''}${formData.addressCity}, Israel`;

      onSaveAndNext({
        ...formData,
        addressFull: fullAddr,
      });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col flex-1 max-w-md mx-auto w-full py-2 animate-in fade-in duration-300">
      {/* Header */}
      <div className="space-y-1 mb-4">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          {t(language, 'borrowerDetailsTitle')}
        </h1>
        <p className="text-sm text-slate-500 leading-relaxed">
          {t(language, 'borrowerDetailsSubtitle')}
        </p>
      </div>

      {/* On-File Profile Banner */}
      {isPreFilled && (
        <div className="p-3 mb-4 rounded-2xl bg-blue-50 border border-blue-200/90 flex items-center justify-between text-xs animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-4 h-4 text-blue-700 shrink-0" />
            <div>
              <span className="font-bold text-blue-950 block">{t(language, 'wizard.personalOnFile')}</span>
              <span className="text-[11px] text-blue-800">{t(language, 'wizard.personalOnFileHint')}</span>
            </div>
          </div>
          <span className="text-[10px] font-bold text-blue-800 bg-blue-100 px-2 py-0.5 rounded-full shrink-0">
            {t(language, 'wizard.onFile')}
          </span>
        </div>
      )}

      <div className="space-y-4 mb-8">
        {/* Full Name */}
        <div className="space-y-1.5">
          <label htmlFor="full-name-input" className="block text-xs font-bold text-slate-700 ">
            {t(language, 'fullNamePassportLabel')} <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <input
              id="full-name-input"
              type="text"
              required
              placeholder={t(language, 'wizard.fullNamePlaceholder')}
              value={formData.fullName}
              onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
              className={`w-full px-4 py-3 rounded-xl border bg-white text-slate-900 text-sm font-medium focus:outline-none focus:ring-2 transition-all ${
                errors.fullName
                  ? 'border-red-400 focus:ring-red-200'
                  : 'border-slate-300 focus:border-blue-900 focus:ring-blue-900/20'
              }`}
            />
          </div>
          {errors.fullName && <p className="text-xs text-red-600">{errors.fullName}</p>}
        </div>

        {/* Passport Number */}
        <div className="space-y-1.5">
          <label htmlFor="passport-number-input" className="block text-xs font-bold text-slate-700 ">
            {t(language, 'passportNumberLabel')} <span className="text-red-500">*</span>
          </label>
          <input
            id="passport-number-input"
            dir="ltr"
            type="text"
            required
            placeholder={t(language, 'wizard.passportPlaceholder')}
            value={formData.passportNumber}
            onChange={(e) => setFormData({ ...formData, passportNumber: e.target.value.toUpperCase() })}
            className={`w-full px-4 py-3 rounded-xl border bg-white font-mono uppercase text-slate-900 text-sm font-bold tracking-wider focus:outline-none focus:ring-2 transition-all ${
              errors.passportNumber
                ? 'border-red-400 focus:ring-red-200'
                : 'border-slate-300 focus:border-blue-900 focus:ring-blue-900/20'
            }`}
          />
          {errors.passportNumber && <p className="text-xs text-red-600">{errors.passportNumber}</p>}
        </div>

        {/* Country of Origin */}
        <div className="space-y-1.5">
          <label htmlFor="country-origin-select" className="block text-xs font-bold text-slate-700 ">
            {t(language, 'countryOfOriginLabel')} <span className="text-red-500">*</span>
          </label>
          <select
            id="country-origin-select"
            value={formData.countryOfOrigin}
            onChange={(e) => setFormData({ ...formData, countryOfOrigin: e.target.value })}
            className={`w-full px-4 py-3 rounded-xl border bg-white text-slate-900 text-sm font-medium focus:outline-none focus:ring-2 transition-all cursor-pointer ${
              errors.countryOfOrigin
                ? 'border-red-400 focus:ring-red-200'
                : 'border-slate-300 focus:border-blue-900 focus:ring-blue-900/20'
            }`}
          >
            <option value="">{t(language, 'lead.countryOfOriginPlaceholder')}</option>
            {ALL_ORIGIN_COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {optionLabel(language, 'country', c)}
              </option>
            ))}
          </select>
          {errors.countryOfOrigin && <p className="text-xs text-red-600">{errors.countryOfOrigin}</p>}
        </div>

        {/* Other Country of Origin Details */}
        {formData.countryOfOrigin === 'Other' && (
          <div className="space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-300">
            <label htmlFor="other-country-input" className="block text-xs font-bold text-slate-700 ">
              {t(language, 'pleaseSpecify')} <span className="text-red-500">*</span>
            </label>
            <input
              id="other-country-input"
              type="text"
              required
              placeholder={t(language, 'provideDetails')}
              value={(formData as any).otherCountryOfOriginDetails || ''}
              onChange={(e) => setFormData({ ...formData, otherCountryOfOriginDetails: e.target.value } as any)}
              className={`w-full px-4 py-3 rounded-xl border bg-white text-slate-900 text-sm font-medium focus:outline-none focus:ring-2 transition-all ${
                errors.otherCountryOfOriginDetails
                  ? 'border-red-400 focus:ring-red-200'
                  : 'border-slate-300 focus:border-blue-900 focus:ring-blue-900/20'
              }`}
            />
            {errors.otherCountryOfOriginDetails && <p className="text-xs text-red-600">{errors.otherCountryOfOriginDetails}</p>}
          </div>
        )}

        {/* Date of Birth & Live Age */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="dob-input" className="block text-xs font-bold text-slate-700 ">
              {t(language, 'dateOfBirthLabel')} <span className="text-red-500">*</span>
            </label>
            {calculatedAge !== null && (
              <span
                className={`text-xs font-bold px-2 py-0.5 rounded-md ${
                  calculatedAge >= 21
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-red-100 text-red-800'
                }`}
              >
                {t(language, 'ageYears', { age: calculatedAge })}
              </span>
            )}
          </div>
          <DateInput
            id="dob-input"
            language={language}
            required
            max={new Date().toISOString().split('T')[0]}
            value={formData.dateOfBirth}
            onChange={(iso) => setFormData({ ...formData, dateOfBirth: iso })}
            className={
              errors.dateOfBirth
                ? 'border-red-400 focus:ring-red-200'
                : 'border-slate-300 focus:border-blue-900 focus:ring-blue-900/20'
            }
          />
          {errors.dateOfBirth && <p className="text-xs text-red-600">{errors.dateOfBirth}</p>}
        </div>

        {/* Marital Status */}
        <div className="space-y-1.5">
          <label htmlFor="marital-status-select" className="block text-xs font-bold text-slate-700 ">
            {t(language, 'maritalStatusLabel')}
          </label>
          <select
            id="marital-status-select"
            value={formData.maritalStatus}
            onChange={(e) => setFormData({ ...formData, maritalStatus: e.target.value as any })}
            className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm font-medium focus:border-blue-900 focus:ring-2 focus:ring-blue-900/20 focus:outline-none transition-all cursor-pointer"
          >
            {MARITAL_STATUSES.map((m) => (
              <option key={m} value={m}>
                {optionLabel(language, 'marital', m)}
              </option>
            ))}
          </select>
        </div>

        {/* Other Marital Status Details */}
        {formData.maritalStatus === 'Other' && (
          <div className="space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-300">
            <label htmlFor="other-marital-status-input" className="block text-xs font-bold text-slate-700 ">
              {t(language, 'pleaseSpecify')} <span className="text-red-500">*</span>
            </label>
            <input
              id="other-marital-status-input"
              type="text"
              required
              placeholder={t(language, 'provideDetails')}
              value={formData.otherMaritalStatusDetails || ''}
              onChange={(e) => setFormData({ ...formData, otherMaritalStatusDetails: e.target.value })}
              className={`w-full px-4 py-3 rounded-xl border bg-white text-slate-900 text-sm font-medium focus:outline-none focus:ring-2 transition-all ${
                errors.otherMaritalStatusDetails
                  ? 'border-red-400 focus:ring-red-200'
                  : 'border-slate-300 focus:border-blue-900 focus:ring-blue-900/20'
              }`}
            />
            {errors.otherMaritalStatusDetails && <p className="text-xs text-red-600">{errors.otherMaritalStatusDetails}</p>}
          </div>
        )}

        {/* Residential Address in Israel */}
        <div className="space-y-2 pt-1">
          <label className="block text-xs font-bold text-slate-700 ">
            {t(language, 'addressInIsraelLabel')} <span className="text-red-500">*</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <input
              id="address-city-input"
              type="text"
              required
              placeholder={t(language, 'city')}
              value={formData.addressCity}
              onChange={(e) => setFormData({ ...formData, addressCity: e.target.value })}
              className="px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm font-medium focus:border-blue-900 focus:ring-2 focus:ring-blue-900/20 focus:outline-none"
            />
            <input
              id="address-street-input"
              type="text"
              placeholder={t(language, 'streetBuilding')}
              value={formData.addressStreet}
              onChange={(e) => setFormData({ ...formData, addressStreet: e.target.value })}
              className="px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm font-medium focus:border-blue-900 focus:ring-2 focus:ring-blue-900/20 focus:outline-none"
            />
          </div>
          {errors.addressCity && <p className="text-xs text-red-600">{errors.addressCity}</p>}
        </div>
      </div>

      {/* Footer Navigation */}
      <div className="mt-auto pt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="w-1/3 py-3.5 px-4 rounded-xl border border-slate-300 text-slate-700 font-semibold text-sm hover:bg-slate-50 transition-colors flex items-center justify-center gap-1.5"
        >
          <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
          <span>{t(language, 'back')}</span>
        </button>

        <button
          type="submit"
          id="step3-continue-btn"
          className="w-2/3 py-3.5 px-6 rounded-xl bg-blue-900 hover:bg-blue-800 text-white font-semibold text-base shadow-sm hover:shadow transition-all flex items-center justify-center gap-2 group"
        >
          <span>{t(language, 'continue')}</span>
          <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1 rtl:rotate-180" />
        </button>
      </div>
    </form>
  );
};
