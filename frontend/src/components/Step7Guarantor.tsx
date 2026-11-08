import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Users,
  UserPlus,
  Trash2,
  Upload,
  Camera,
  CheckCircle2,
  AlertCircle,
  FileText,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  Loader2,
  X,
} from 'lucide-react';
import {
  Language,
  GuarantorDetails,
  GuarantorItem,
  UploadedFile,
  LoanApplication,
} from '@quickloan/ui-core/types';
import { GUARANTOR_RELATIONSHIPS } from '@quickloan/ui-core/config/appConfig';
import { t } from '@quickloan/ui-core/i18n/translations';
import { optionLabel } from '@quickloan/ui-core/i18n/options';
import { localizeError } from '@quickloan/ui-core/i18n/apiErrors';
import { apiService } from '../services/api';
import { calculateIndicativeEligibility } from '@quickloan/ui-core/services/eligibilityScoring';
import { EligibilityScoreBar } from '@quickloan/ui-core/components/EligibilityScoreBar';

interface Step7GuarantorProps {
  language: Language;
  applicationId: string;
  initialGuarantors?: GuarantorItem[];
  initialLegacyGuarantor?: Partial<GuarantorDetails>;
  fullApplication?: Partial<LoanApplication>;
  onSaveAndNext: (
    guarantors: GuarantorItem[],
    legacyGuarantor: GuarantorDetails,
    guarantorDocs: UploadedFile[]
  ) => void;
  onBack: () => void;
}

export const Step7Guarantor: React.FC<Step7GuarantorProps> = ({
  language,
  applicationId,
  initialGuarantors,
  initialLegacyGuarantor,
  fullApplication,
  onSaveAndNext,
  onBack,
}) => {
  // Initialize guarantors (Guarantor 1 is required, up to 3 allowed)
  const [guarantors, setGuarantors] = useState<GuarantorItem[]>(() => {
    if (Array.isArray(initialGuarantors) && initialGuarantors.length > 0) {
      return initialGuarantors;
    }
    if (initialLegacyGuarantor && initialLegacyGuarantor.hasGuarantor) {
      return [
        {
          id: 'g_1',
          fullName: initialLegacyGuarantor.fullName || '',
          passportOrIdNumber: initialLegacyGuarantor.passportOrIdNumber || '',
          mobilePhoneNumber: initialLegacyGuarantor.mobilePhoneNumber || '',
          relationship: initialLegacyGuarantor.relationship || 'Co-worker',
          otherRelationshipDetails: initialLegacyGuarantor.otherRelationshipDetails || '',
          idDocument: initialLegacyGuarantor.passportPhoto,
        },
      ];
    }
    // Default: Guarantor 1 (required)
    return [
      {
        id: 'g_1',
        fullName: '',
        passportOrIdNumber: '',
        mobilePhoneNumber: '',
        relationship: 'Co-worker',
        otherRelationshipDetails: '',
      },
    ];
  });

  // Synchronize guarantors whenever initialGuarantors update from profile
  useEffect(() => {
    if (Array.isArray(initialGuarantors) && initialGuarantors.length > 0) {
      setGuarantors(initialGuarantors);
    }
  }, [initialGuarantors]);

  const hasSavedGuarantors = Boolean(
    initialGuarantors &&
    initialGuarantors.length > 0 &&
    initialGuarantors[0].fullName &&
    initialGuarantors[0].fullName.trim().length > 0
  );

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploadingForId, setUploadingForId] = useState<string | null>(null);
  const [uploadErrorForId, setUploadErrorForId] = useState<{ id: string; error: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const activeUploadTargetId = useRef<string | null>(null);

  // Collect all uploaded guarantor documents
  const guarantorDocuments = useMemo(() => {
    return guarantors
      .map((g) => g.idDocument)
      .filter((doc): doc is UploadedFile => !!doc);
  }, [guarantors]);

  // Live indicative eligibility score reflecting current guarantor data
  const liveEligibilityScore = useMemo(() => {
    const combinedDocs = [
      ...(fullApplication?.documents || []).filter((d) => d.documentTypeCode !== 'GUARANTOR_ID'),
      ...guarantorDocuments,
    ];
    return calculateIndicativeEligibility({
      ...fullApplication,
      guarantors,
      documents: combinedDocs,
    });
  }, [fullApplication, guarantors, guarantorDocuments]);

  // Handle adding an optional guarantor (up to 3 total)
  const handleAddGuarantor = () => {
    if (guarantors.length >= 3) return;
    const newIdx = guarantors.length + 1;
    const newGuarantor: GuarantorItem = {
      id: `g_${Date.now()}_${newIdx}`,
      fullName: '',
      passportOrIdNumber: '',
      mobilePhoneNumber: '',
      relationship: 'Co-worker',
      otherRelationshipDetails: '',
    };
    setGuarantors([...guarantors, newGuarantor]);
  };

  // Handle removing an optional guarantor (Guarantor 1 cannot be removed)
  const handleRemoveGuarantor = (id: string) => {
    if (guarantors.length <= 1) return;
    setGuarantors(guarantors.filter((g) => g.id !== id));
    // Clear any errors associated with this guarantor
    const updatedErrors = { ...errors };
    Object.keys(updatedErrors).forEach((k) => {
      if (k.startsWith(`${id}_`)) {
        delete updatedErrors[k];
      }
    });
    setErrors(updatedErrors);
    if (uploadErrorForId?.id === id) setUploadErrorForId(null);
  };

  // Update fields for a specific guarantor
  const handleUpdateGuarantor = (id: string, updates: Partial<GuarantorItem>) => {
    setGuarantors((prev) =>
      prev.map((g) => (g.id === id ? { ...g, ...updates } : g))
    );
    // Clear field-specific error
    const updatedErrors = { ...errors };
    Object.keys(updates).forEach((field) => {
      delete updatedErrors[`${id}_${field}`];
    });
    setErrors(updatedErrors);
  };

  // Trigger file upload for a specific guarantor
  const triggerUpload = (targetId: string, source: 'file' | 'camera') => {
    activeUploadTargetId.current = targetId;
    setUploadErrorForId(null);
    if (source === 'camera') {
      cameraInputRef.current?.click();
    } else {
      fileInputRef.current?.click();
    }
  };

  // Process file upload
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, source: 'camera' | 'file') => {
    const files = e.target.files;
    const targetId = activeUploadTargetId.current;
    if (!files || files.length === 0 || !targetId) return;

    const file = files[0];
    setUploadErrorForId(null);

    // 1. Client-side size validation (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setUploadErrorForId({
        id: targetId,
        error: t(language, 'err.fileTooLarge'),
      });
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      return;
    }

    // 2. Client-side format validation: PDF, PNG, JPEG/JPG
    const allowedMimes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf', 'image/webp'];
    const hasValidExt = file.name.match(/\.(pdf|jpe?g|png|webp)$/i);
    if (!allowedMimes.includes(file.type.toLowerCase()) && !hasValidExt) {
      setUploadErrorForId({
        id: targetId,
        error: t(language, 'err.invalidFileType'),
      });
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      return;
    }

    setUploadingForId(targetId);

    // 3. Upload to server
    let fileUrl: string | undefined = undefined;
    try {
      const uploadRes = await apiService.uploadFile(file);
      if (uploadRes && uploadRes.url) {
        fileUrl = uploadRes.url;
      }
    } catch (uploadErr: any) {
      console.warn('Real file upload failed, falling back to local dataUrl:', uploadErr);
      const errMsg = uploadErr?.response?.data?.error || uploadErr?.message || '';
      if (
        errMsg.includes('magic bytes') ||
        errMsg.includes('disguised') ||
        errMsg.includes('Invalid file type')
      ) {
        setUploadErrorForId({ id: targetId, error: localizeError(errMsg, language, 'err.fileRejected') });
        setUploadingForId(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        if (cameraInputRef.current) cameraInputRef.current.value = '';
        return;
      }
    }

    // 4. Data URL fallback / preview
    let dataUrl: string | undefined = undefined;
    if (file.type.startsWith('image/')) {
      dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string) || '');
        reader.onerror = () => resolve('');
        reader.readAsDataURL(file);
      });
    }

    const newDoc: UploadedFile = {
      id: `doc_g_${targetId}_${Date.now()}`,
      applicationId: applicationId || 'temp',
      documentTypeCode: 'GUARANTOR_ID',
      originalFilename: file.name,
      mimeType: file.type || 'image/jpeg',
      fileSizeBytes: file.size,
      storageKey: `s3://quickloan-docs/${applicationId}/guarantor_${file.name}`,
      fileUrl,
      dataUrl,
      uploadSource: source,
      qualityStatus: 'passed',
      ocrStatus: 'not_requested',
      userConfirmed: true,
      uploadedAt: new Date().toISOString(),
    };

    // Attach document to this guarantor
    handleUpdateGuarantor(targetId, { idDocument: newDoc });
    setUploadingForId(null);

    // Reset inputs
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  const handleRemoveDocument = (targetId: string) => {
    handleUpdateGuarantor(targetId, { idDocument: undefined });
  };

  // Validation
  const validate = (): boolean => {
    const errs: Record<string, string> = {};

    guarantors.forEach((g, idx) => {
      const gNum = idx + 1;
      const prefix = `${g.id}_`;

      if (!g.fullName?.trim()) {
        errs[`${prefix}fullName`] = t(language, 'wizard.err.guarantorName', { n: gNum });
      }
      if (!g.passportOrIdNumber?.trim()) {
        errs[`${prefix}passportOrIdNumber`] = t(language, 'wizard.err.guarantorId', { n: gNum });
      }
      if (!g.mobilePhoneNumber?.trim()) {
        errs[`${prefix}mobilePhoneNumber`] = t(language, 'wizard.err.guarantorPhone', { n: gNum });
      }
      if (g.relationship === 'Other' && (!g.otherRelationshipDetails || !g.otherRelationshipDetails.trim())) {
        errs[`${prefix}otherRelationshipDetails`] = t(language, 'wizard.err.relationshipDetails');
      }
      if (!g.idDocument) {
        errs[`${prefix}idDocument`] = t(language, 'wizard.err.guarantorDoc', { n: gNum });
      }
    });

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) {
      window.scrollTo({ top: 120, behavior: 'smooth' });
      return;
    }

    const primaryG = guarantors[0];
    const legacyGuarantor: GuarantorDetails = {
      hasGuarantor: true,
      fullName: primaryG.fullName,
      passportOrIdNumber: primaryG.passportOrIdNumber,
      mobilePhoneNumber: primaryG.mobilePhoneNumber,
      relationship: primaryG.relationship,
      otherRelationshipDetails: primaryG.otherRelationshipDetails,
      passportPhoto: primaryG.idDocument,
    };

    onSaveAndNext(guarantors, legacyGuarantor, guarantorDocuments);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col flex-1 max-w-md mx-auto w-full py-2 animate-in fade-in duration-300"
    >
      {/* Hidden file and camera inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/jpg,application/pdf"
        className="hidden"
        onChange={(e) => handleFileChange(e, 'file')}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/jpeg,image/png,image/jpg"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFileChange(e, 'camera')}
      />

      {/* Header */}
      <div className="space-y-1 mb-4">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          {t(language, 'guarantorTitle')}
        </h1>
        <p className="text-sm text-slate-500 leading-relaxed">
          {t(language, 'wizard.guarantorIntro')}
        </p>
      </div>

      {/* On-File Guarantors Banner */}
      {hasSavedGuarantors && (
        <div className="p-3 mb-4 rounded-2xl bg-blue-50 border border-blue-200/90 flex items-center justify-between text-xs animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-4 h-4 text-blue-700 shrink-0" />
            <div>
              <span className="font-bold text-blue-950 block">{t(language, 'wizard.guarantorOnFile')}</span>
              <span className="text-[11px] text-blue-800">{t(language, 'wizard.guarantorOnFileHint')}</span>
            </div>
          </div>
          <span className="text-[10px] font-bold text-blue-800 bg-blue-100 px-2 py-0.5 rounded-full shrink-0">
            {t(language, 'onFile')}
          </span>
        </div>
      )}

      {/* Live Estimated Loan Eligibility Score Bar */}
      <div className="mb-5">
        <EligibilityScoreBar
          scoreData={liveEligibilityScore}
          language={language}
          showBreakdownToggle={true}
        />
      </div>

      {/* Guarantors List */}
      <div className="space-y-5 mb-6">
        {guarantors.map((g, idx) => {
          const isRequired = idx === 0;
          const gNum = idx + 1;
          const isUploading = uploadingForId === g.id;
          const uploadErr = uploadErrorForId?.id === g.id ? uploadErrorForId.error : null;

          return (
            <div
              key={g.id}
              className={`p-4 rounded-2xl border transition-all ${
                isRequired
                  ? 'bg-white border-blue-900/40 ring-1 ring-blue-900/10 shadow-xs'
                  : 'bg-white border-slate-200/90 shadow-2xs'
              }`}
            >
              {/* Card Header */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-3.5">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      isRequired
                        ? 'bg-blue-900 text-white'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {gNum}
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-900">
                      {t(language, 'wizard.guarantorN', { n: gNum })}
                    </span>
                    <span
                      className={`ms-2 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                        isRequired
                          ? 'bg-blue-50 text-blue-900 border border-blue-200'
                          : 'bg-slate-100 text-slate-600 border border-slate-200'
                      }`}
                    >
                      {isRequired ? t(language, 'required') : t(language, 'optional')}
                    </span>
                  </div>
                </div>

                {!isRequired && (
                  <button
                    type="button"
                    onClick={() => handleRemoveGuarantor(g.id)}
                    className="text-xs text-red-600 hover:text-red-700 font-semibold flex items-center gap-1 p-1 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{t(language, 'remove')}</span>
                  </button>
                )}
              </div>

              {/* Form Fields */}
              <div className="space-y-3.5">
                {/* Full Legal Name */}
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-700">
                    {t(language, 'guarantorNameLabel')}{' '}
                    <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={t(language, 'wizard.guarantorNamePlaceholder')}
                    value={g.fullName || ''}
                    onChange={(e) => handleUpdateGuarantor(g.id, { fullName: e.target.value })}
                    className={`w-full px-3.5 py-2.5 rounded-xl border bg-white text-slate-900 text-sm focus:outline-none transition-all ${
                      errors[`${g.id}_fullName`]
                        ? 'border-red-400 focus:ring-2 focus:ring-red-200'
                        : 'border-slate-300 focus:border-blue-900 focus:ring-2 focus:ring-blue-900/10'
                    }`}
                  />
                  {errors[`${g.id}_fullName`] && (
                    <p className="text-[11px] text-red-600 font-medium">{errors[`${g.id}_fullName`]}</p>
                  )}
                </div>

                {/* Passport or Israeli ID Number */}
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-700">
                    {t(language, 'guarantorIdLabel')}{' '}
                    <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    dir="ltr"
                    placeholder={t(language, 'wizard.guarantorIdPlaceholder')}
                    value={g.passportOrIdNumber || ''}
                    onChange={(e) =>
                      handleUpdateGuarantor(g.id, { passportOrIdNumber: e.target.value.toUpperCase() })
                    }
                    className={`w-full px-3.5 py-2.5 rounded-xl border bg-white text-slate-900 text-sm font-mono focus:outline-none transition-all ${
                      errors[`${g.id}_passportOrIdNumber`]
                        ? 'border-red-400 focus:ring-2 focus:ring-red-200'
                        : 'border-slate-300 focus:border-blue-900 focus:ring-2 focus:ring-blue-900/10'
                    }`}
                  />
                  {errors[`${g.id}_passportOrIdNumber`] && (
                    <p className="text-[11px] text-red-600 font-medium">
                      {errors[`${g.id}_passportOrIdNumber`]}
                    </p>
                  )}
                </div>

                {/* Mobile Phone */}
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-700">
                    {t(language, 'guarantorPhoneLabel')}{' '}
                    <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="tel"
                    dir="ltr"
                    required
                    placeholder="+972-5X-XXXXXXX" // i18n-ignore: phone format
                    value={g.mobilePhoneNumber || ''}
                    onChange={(e) =>
                      handleUpdateGuarantor(g.id, { mobilePhoneNumber: e.target.value })
                    }
                    className={`w-full px-3.5 py-2.5 rounded-xl border bg-white text-slate-900 text-sm focus:outline-none transition-all ${
                      errors[`${g.id}_mobilePhoneNumber`]
                        ? 'border-red-400 focus:ring-2 focus:ring-red-200'
                        : 'border-slate-300 focus:border-blue-900 focus:ring-2 focus:ring-blue-900/10'
                    }`}
                  />
                  {errors[`${g.id}_mobilePhoneNumber`] && (
                    <p className="text-[11px] text-red-600 font-medium">
                      {errors[`${g.id}_mobilePhoneNumber`]}
                    </p>
                  )}
                </div>

                {/* Relationship Dropdown */}
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-700">
                    {t(language, 'guarantorRelationshipLabel')}
                  </label>
                  <select
                    value={g.relationship || 'Co-worker'}
                    onChange={(e) =>
                      handleUpdateGuarantor(g.id, { relationship: e.target.value })
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm focus:border-blue-900 focus:outline-none cursor-pointer"
                  >
                    {GUARANTOR_RELATIONSHIPS.map((r) => (
                      <option key={r} value={r}>
                        {optionLabel(language, 'relationship', r)}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Other Relationship Details */}
                {g.relationship === 'Other' && (
                  <div className="space-y-1 animate-in fade-in duration-200">
                    <label className="block text-xs font-bold text-slate-700">
                      {t(language, 'pleaseSpecify')} <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder={t(language, 'wizard.relationshipPlaceholder')}
                      value={g.otherRelationshipDetails || ''}
                      onChange={(e) =>
                        handleUpdateGuarantor(g.id, { otherRelationshipDetails: e.target.value })
                      }
                      className={`w-full px-3.5 py-2 rounded-xl border text-sm ${
                        errors[`${g.id}_otherRelationshipDetails`]
                          ? 'border-red-400'
                          : 'border-slate-300 focus:border-blue-900'
                      }`}
                    />
                    {errors[`${g.id}_otherRelationshipDetails`] && (
                      <p className="text-[11px] text-red-600 font-medium">
                        {errors[`${g.id}_otherRelationshipDetails`]}
                      </p>
                    )}
                  </div>
                )}

                {/* Identity Document Upload Section (Required for this Guarantor) */}
                <div className="pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-bold text-slate-800">
                      {t(language, 'wizard.guarantorIdDoc')} <span className="text-red-500">*</span>
                    </label>
                    <span className="text-[10px] text-slate-400 font-medium">
                      {t(language, 'fileTypesHint')}
                    </span>
                  </div>

                  {/* Upload Error Banner */}
                  {uploadErr && (
                    <div className="p-2.5 mb-2 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                      <div className="flex-1">{uploadErr}</div>
                    </div>
                  )}

                  {/* Uploaded Document Card */}
                  {g.idDocument ? (
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2 animate-in fade-in">
                      <div className="flex items-center gap-2.5 truncate">
                        <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                          <CheckCircle2 className="w-4 h-4" />
                        </div>
                        <div className="truncate">
                          <div className="text-xs font-bold text-slate-800 truncate">
                            {g.idDocument.originalFilename}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {t(language, 'wizard.fileReady', { kb: (g.idDocument.fileSizeBytes / 1024).toFixed(0) })}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleRemoveDocument(g.id)}
                          className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 transition-colors"
                          title={t(language, 'wizard.removeDocument')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Document Upload Dropzone / Action Buttons */
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={isUploading}
                          onClick={() => triggerUpload(g.id, 'camera')}
                          className="flex-1 py-2 px-3 rounded-xl bg-blue-900 hover:bg-blue-800 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                        >
                          {isUploading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Camera className="w-4 h-4" />
                          )}
                          <span>{t(language, 'takePhoto')}</span>
                        </button>

                        <button
                          type="button"
                          disabled={isUploading}
                          onClick={() => triggerUpload(g.id, 'file')}
                          className="flex-1 py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors border border-slate-200 disabled:opacity-50"
                        >
                          <Upload className="w-4 h-4" />
                          <span>{t(language, 'uploadFile')}</span>
                        </button>
                      </div>

                      {errors[`${g.id}_idDocument`] && (
                        <p className="text-[11px] text-red-600 font-medium flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                          {errors[`${g.id}_idDocument`]}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Add Another Guarantor Button (when < 3) */}
        {guarantors.length < 3 && (
          <button
            type="button"
            onClick={handleAddGuarantor}
            className="w-full py-3 px-4 rounded-2xl border-2 border-dashed border-blue-900/30 hover:border-blue-900/60 bg-blue-50/40 hover:bg-blue-50/80 text-blue-900 font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-2xs group"
          >
            <UserPlus className="w-4 h-4 text-blue-900 transition-transform group-hover:scale-110" />
            <span>{t(language, 'wizard.addGuarantorN', { n: guarantors.length + 1 })}</span>
          </button>
        )}

        {/* Encouraging Tip */}
        <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80 text-xs text-slate-600 space-y-1">
          <div className="font-bold text-slate-800 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{t(language, 'wizard.eligibilityTip')}</span>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-500">
            {t(language, 'wizard.eligibilityTipText')}
          </p>
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
          id="step7-continue-btn"
          className="w-2/3 py-3.5 px-6 rounded-xl bg-blue-900 hover:bg-blue-800 text-white font-semibold text-base shadow-sm hover:shadow transition-all flex items-center justify-center gap-2 group"
        >
          <span>{t(language, 'continue')}</span>
          <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1 rtl:rotate-180" />
        </button>
      </div>
    </form>
  );
};
