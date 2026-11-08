import React, { useState, useEffect, useRef } from 'react';
import {
  Camera,
  Upload,
  CheckCircle2,
  AlertCircle,
  FileText,
  Trash2,
  Eye,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  RotateCcw,
} from 'lucide-react';
import { Language, UploadedFile, DocumentTypeCode, GuarantorItem, LoanApplication } from '@quickloan/ui-core/types';
import { DOCUMENT_TYPE_CONFIG } from '@quickloan/ui-core/config/appConfig';
import { t } from '@quickloan/ui-core/i18n/translations';
import { localizeError } from '@quickloan/ui-core/i18n/apiErrors';
import { formatDate } from '@quickloan/ui-core/i18n/format';
import { apiService } from '../services/api';
import { calculateIndicativeEligibility } from '@quickloan/ui-core/services/eligibilityScoring';
import { EligibilityScoreBar } from '@quickloan/ui-core/components/EligibilityScoreBar';

interface Step8DocumentUploadProps {
  language: Language;
  applicationId: string;
  initialDocuments?: UploadedFile[];
  initialBankAccountConfirmed?: boolean;
  hasGuarantor?: boolean;
  guarantors?: GuarantorItem[];
  fullApplication?: Partial<LoanApplication>;
  onSaveAndNext: (docs: UploadedFile[], bankAccountConfirmed: boolean) => void;
  onBack: () => void;
}

export const Step8DocumentUpload: React.FC<Step8DocumentUploadProps> = ({
  language,
  applicationId,
  initialDocuments = [],
  initialBankAccountConfirmed = false,
  hasGuarantor = false,
  guarantors = [],
  fullApplication,
  onSaveAndNext,
  onBack,
}) => {
  const [documents, setDocuments] = useState<UploadedFile[]>(initialDocuments);
  const [bankAccountConfirmed, setBankAccountConfirmed] = useState<boolean>(initialBankAccountConfirmed);

  // Synchronize documents if initialDocuments updates from profile
  useEffect(() => {
    if (initialDocuments && initialDocuments.length > 0) {
      setDocuments(initialDocuments);
    }
  }, [initialDocuments]);

  useEffect(() => {
    if (typeof initialBankAccountConfirmed === 'boolean') {
      setBankAccountConfirmed(initialBankAccountConfirmed);
    }
  }, [initialBankAccountConfirmed]);

  const [activeDocType, setActiveDocType] = useState<DocumentTypeCode>('PASSPORT');
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [ocrPromptDoc, setOcrPromptDoc] = useState<UploadedFile | null>(null);
  const [qualityWarningDoc, setQualityWarningDoc] = useState<UploadedFile | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  // Mandatory documents for borrower. Guarantor IDs are uploaded directly in Step 7 to prevent duplicate requests.
  const mandatoryTypes: DocumentTypeCode[] = [
    'PASSPORT',
    'PAY_SLIP',
    'BANK_ACCOUNT_DOCUMENT',
  ];

  const optionalTypes: DocumentTypeCode[] = [
    'WORKERS_CARD',
  ];

  const getDocsByType = (type: DocumentTypeCode) =>
    documents.filter((d) => d.documentTypeCode === type);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, source: 'camera' | 'file') => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploadError(null);
    const file = files[0];

    // Client-side file size validation (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setUploadError(t(language, 'err.fileTooLarge'));
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      return;
    }

    // Client-side file type validation (PDF, JPG, PNG, WebP)
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf', 'image/webp'];
    const isAllowedExt = file.name.match(/\.(pdf|jpe?g|png|webp)$/i);
    if (!allowedMimeTypes.includes(file.type.toLowerCase()) && !isAllowedExt) {
      setUploadError(t(language, 'err.invalidFileType'));
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      return;
    }

    setIsProcessing(true);
    const docConfig = DOCUMENT_TYPE_CONFIG.find((c) => c.code === activeDocType);

    // 1. Upload to backend /api/upload endpoint (with server-side magic byte inspection)
    let fileUrl: string | undefined = undefined;
    try {
      const uploadRes = await apiService.uploadFile(file);
      if (uploadRes && uploadRes.url) {
        fileUrl = uploadRes.url;
      }
    } catch (uploadErr: any) {
      console.warn('Real file upload failed, falling back to local storage:', uploadErr);
      const errMsg = uploadErr?.response?.data?.error || uploadErr?.message || '';
      if (errMsg.includes('disguised') || errMsg.includes('magic bytes') || errMsg.includes('Invalid file type') || errMsg.includes('size limit')) {
        setUploadError(localizeError(errMsg, language, 'err.fileRejected'));
        setIsProcessing(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
        if (cameraInputRef.current) cameraInputRef.current.value = '';
        return;
      }
    }

    // 2. Read as data URL for instant image preview or offline fallback
    let dataUrl: string | undefined = undefined;
    if (file.type.startsWith('image/')) {
      dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string) || '');
        reader.onerror = () => resolve('');
        reader.readAsDataURL(file);
      });
    }

    // Simulate OCR and quality check
    const isCard = activeDocType === 'CREDIT_CARD';
    const isPassport = activeDocType === 'PASSPORT';
    const isVisa = activeDocType === 'WORK_VISA';

    const simulatedQuality: 'passed' | 'warning' =
      Math.random() < 0.1 ? 'warning' : 'passed'; // 10% chance to test blur warning

    // Simulated OCR extraction
    let ocrData: Record<string, any> | undefined = undefined;
    if (isPassport) {
      ocrData = {
        passportNumber: 'P' + Math.floor(1000000 + Math.random() * 9000000),
        fullName: 'EXTRACTED PASSPORT HOLDER',
        nationality: 'THAILAND',
        confidence: 0.96,
      };
    } else if (isVisa) {
      ocrData = {
        visaCategory: 'B-1 Work',
        visaExpiryDate: '2027-08-31',
        confidence: 0.94,
      };
    } else if (isCard) {
      ocrData = {
        maskedPan: '•••• •••• •••• 4591',
        cardholder: 'CARD HOLDER',
      };
    }

    const newDoc: UploadedFile = {
      id: `doc_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      applicationId,
      documentTypeCode: activeDocType,
      originalFilename: file.name,
      mimeType: file.type || 'image/jpeg',
      fileSizeBytes: file.size || 340000,
      storageKey: `s3://quickloan-docs/${applicationId}/${file.name}`,
      fileUrl,
      dataUrl,
      uploadSource: source,
      qualityStatus: simulatedQuality,
      qualityIssues:
        simulatedQuality === 'warning'
          ? ['Slight blur detected on edges. Please ensure all 4 corners and text are sharp.']
          : undefined,
      ocrStatus: ocrData ? 'completed' : 'not_requested',
      ocrExtractedData: ocrData,
      userConfirmed: !ocrData,
      uploadedAt: new Date().toISOString(),
    };

    // If document type only allows single file, replace previous doc of this type
    setDocuments((prev) => {
      if (!docConfig?.allowsMultiple) {
        return [...prev.filter((d) => d.documentTypeCode !== activeDocType), newDoc];
      }
      return [...prev, newDoc];
    });
    setIsProcessing(false);

    if (simulatedQuality === 'warning') {
      setQualityWarningDoc(newDoc);
    } else if (ocrData) {
      setOcrPromptDoc(newDoc);
    }

    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  const handleDeleteDocument = (docId: string) => {
    setDocuments((prev) => prev.filter((d) => d.id !== docId));
  };

  const handleConfirmOcr = (docId: string) => {
    setDocuments((prev) =>
      prev.map((d) => (d.id === docId ? { ...d, userConfirmed: true } : d))
    );
    setOcrPromptDoc(null);
  };

  const hasMandatoryMissing = mandatoryTypes.some(
    (type) => getDocsByType(type).length === 0
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!bankAccountConfirmed) return;
    onSaveAndNext(documents, bankAccountConfirmed);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col flex-1 max-w-md mx-auto w-full py-2 animate-in fade-in duration-300">
      {/* Hidden file and camera inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => handleFileUpload(e, 'file')}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFileUpload(e, 'camera')}
      />

      {/* Header */}
      <div className="space-y-1 mb-4">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          {t(language, 'documentUploadTitle')}
        </h1>
        <p className="text-sm text-slate-500 leading-relaxed">
          {t(language, 'documentUploadSubtitle')}
        </p>
      </div>

      {/* Live Estimated Loan Eligibility Score Bar */}
      <div className="mb-4">
        <EligibilityScoreBar
          scoreData={calculateIndicativeEligibility({
            ...fullApplication,
            documents,
            guarantors,
          })}
          language={language}
          showBreakdownToggle={true}
        />
      </div>

      {/* On-File Documents Recognized Banner */}
      {documents.some((d) => d.isReused) && (
        <div className="mb-4 p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200/90 flex items-start gap-3 text-xs animate-in fade-in">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="font-bold text-emerald-950">{t(language, 'wizard.docsOnFile')}</h4>
            <p className="text-emerald-800 mt-0.5 leading-relaxed">
              {t(language, 'wizard.docsOnFileHint')}
            </p>
          </div>
          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full shrink-0">
            {t(language, 'onFile')}
          </span>
        </div>
      )}

      {/* Guarantor Documents Status from Step 7 */}
      {guarantors.length > 0 && (
        <div className="mb-4 p-3 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-semibold text-slate-800">
              {guarantors.length > 1 ? t(language, 'wizard.guarantorDocsUploadedMany', { n: guarantors.length }) : t(language, 'wizard.guarantorDocsUploadedOne')}
            </span>
          </div>
          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
            {t(language, 'verified')}
          </span>
        </div>
      )}

      {/* Upload Error Banner */}
      {uploadError && (
        <div className="p-3.5 mb-4 rounded-2xl bg-red-50 border border-red-200 animate-in fade-in flex items-start gap-2.5">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="text-xs font-bold text-red-900">{t(language, 'wizard.uploadIssue')}</h4>
            <p className="text-xs text-red-700 mt-0.5">{uploadError}</p>
          </div>
          <button
            type="button"
            onClick={() => setUploadError(null)}
            className="text-red-400 hover:text-red-700 text-xs font-bold p-0.5"
          >
            ✕
          </button>
        </div>
      )}

      {/* OCR Confirmation Dialog Modal */}
      {ocrPromptDoc && ocrPromptDoc.ocrExtractedData && (
        <div className="p-4 mb-4 rounded-2xl bg-blue-50 border-2 border-blue-200 animate-in fade-in space-y-3">
          <div className="flex items-center gap-2 text-blue-900 font-bold text-sm">
            <Sparkles className="w-4 h-4 text-blue-600" />
            <span>{t(language, 'ocrExtractionTitle')}</span>
          </div>
          <p className="text-xs text-blue-800 leading-relaxed">
            {t(language, 'ocrExtractionDesc')}
          </p>

          <div className="p-3 bg-white rounded-xl border border-blue-100 space-y-1 font-mono text-xs text-slate-800">
            {ocrPromptDoc.ocrExtractedData.passportNumber && (
              <div>
                <span className="text-slate-400 font-sans text-[11px] block">{t(language, 'wizard.ocrPassportNumber')}</span>
                <span className="font-bold text-sm text-blue-900"><bdi dir="ltr">{ocrPromptDoc.ocrExtractedData.passportNumber}</bdi></span>
              </div>
            )}
            {ocrPromptDoc.ocrExtractedData.visaExpiryDate && (
              <div>
                <span className="text-slate-400 font-sans text-[11px] block">{t(language, 'wizard.ocrVisaExpiry')}</span>
                <span className="font-bold text-sm text-blue-900">{formatDate(ocrPromptDoc.ocrExtractedData.visaExpiryDate, language)}</span>
              </div>
            )}
            {ocrPromptDoc.ocrExtractedData.maskedPan && (
              <div>
                <span className="text-slate-400 font-sans text-[11px] block">{t(language, 'wizard.ocrCardNumber')}</span>
                <span className="font-bold text-sm text-blue-900">{ocrPromptDoc.ocrExtractedData.maskedPan}</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => handleConfirmOcr(ocrPromptDoc.id)}
              className="px-4 py-2 rounded-xl bg-blue-900 text-white font-bold text-xs hover:bg-blue-800 transition-colors shadow-xs"
            >
              {t(language, 'confirmOcrData')}
            </button>
          </div>
        </div>
      )}

      {/* Quality Check Warning Banner */}
      {qualityWarningDoc && (
        <div className="p-4 mb-4 rounded-2xl bg-amber-50 border border-amber-300 animate-in fade-in space-y-2">
          <div className="flex items-center gap-2 text-amber-950 font-bold text-xs">
            <AlertCircle className="w-4 h-4 text-amber-600" />
            <span>{t(language, 'imageBlurWarning')}</span>
          </div>
          <p className="text-xs text-amber-800">
            {t(language, 'wizard.blurDetected')}
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                handleDeleteDocument(qualityWarningDoc.id);
                setQualityWarningDoc(null);
                cameraInputRef.current?.click();
              }}
              className="px-3 py-1.5 rounded-lg bg-amber-200 text-amber-900 font-bold text-xs flex items-center gap-1"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {t(language, 'retakePhoto')}
            </button>
            <button
              type="button"
              onClick={() => setQualityWarningDoc(null)}
              className="px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-slate-700 font-medium text-xs"
            >
              {t(language, 'wizard.keepAnyway')}
            </button>
          </div>
        </div>
      )}

      {/* Document Category Tabs / Checklist */}
      <div className="space-y-3 mb-6">
        <div className="text-xs font-bold text-slate-700 flex items-center justify-between">
          <span>{t(language, 'wizard.requiredDocs', { n: mandatoryTypes.length })}</span>
          <span className="text-[11px] text-slate-400 font-normal">{t(language, 'wizard.fileTypesHintParen')}</span>
        </div>

        {mandatoryTypes.map((typeCode) => {
          const config = DOCUMENT_TYPE_CONFIG.find((c) => c.code === typeCode);
          const uploadedList = getDocsByType(typeCode);
          const isSelected = activeDocType === typeCode;
          const hasUploaded = uploadedList.length > 0;

          return (
            <div
              key={typeCode}
              className={`p-3.5 rounded-2xl border transition-all ${
                isSelected
                  ? 'border-blue-900 bg-white ring-2 ring-blue-900/10 shadow-xs'
                  : 'border-slate-200 bg-white'
              }`}
            >
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setActiveDocType(typeCode)}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold ${
                      hasUploaded
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {hasUploaded ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <FileText className="w-5 h-5" />}
                  </div>
                  <div>
                    <div className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                      <span>{t(language, config?.titleKey || '')}</span>
                      <span className="text-red-500 text-xs">*</span>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {t(language, config?.descKey || '')}
                    </div>
                  </div>
                </div>

                <div className="text-xs font-bold font-mono text-slate-600">
                  {uploadedList.length > 0 ? (
                    <span className={`px-2 py-0.5 rounded-md font-semibold text-xs ${
                      uploadedList.some((d) => d.isReused)
                        ? 'text-emerald-800 bg-emerald-100 border border-emerald-200'
                        : 'text-emerald-700 bg-emerald-50'
                    }`}>
                      {uploadedList.some((d) => d.isReused)
                        ? t(language, 'wizard.onFileCheck')
                        : uploadedList.length > 1
                          ? t(language, 'wizard.fileCountMany', { n: uploadedList.length })
                          : t(language, 'wizard.fileCountOne')}
                    </span>
                  ) : (
                    <span className="text-slate-400 font-sans text-[11px]">{t(language, 'missing')}</span>
                  )}
                </div>
              </div>

              {/* Uploaded File Previews */}
              {uploadedList.length > 0 && (
                <div className="mt-3 space-y-2 border-t border-slate-100 pt-2.5">
                  {uploadedList.map((doc) => (
                    <div
                      key={doc.id}
                      className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 flex flex-col gap-1.5 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 truncate max-w-[220px]">
                          {(doc.fileUrl || doc.dataUrl) && (
                            <img
                              src={apiService.resolveFileUrl(doc.fileUrl) || doc.dataUrl}
                              alt=""
                              className="w-7 h-7 rounded-md object-cover border border-slate-200 shrink-0"
                            />
                          )}
                          <span className="text-slate-400 font-mono text-[10px]">
                            [{doc.uploadSource === 'camera' ? 'Camera' : 'File'}]
                          </span>
                          <span className="font-medium text-slate-800 truncate">
                            {doc.originalFilename}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            ({Math.round(doc.fileSizeBytes / 1024)} KB)
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setActiveDocType(doc.documentTypeCode);
                              fileInputRef.current?.click();
                            }}
                            className="text-[11px] font-bold text-blue-900 hover:text-blue-700 underline"
                          >
                            {t(language, 'replaceDocument')}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteDocument(doc.id)}
                            className="text-red-500 hover:text-red-700 p-1"
                            title={t(language, 'wizard.deleteFile')}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {doc.isReused && (
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[10px] font-semibold">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <span>{t(language, 'reusedDocumentBadge')}</span>
                          <span className="text-emerald-600 font-normal">({t(language, 'reusedDocumentNotice')})</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Active Upload Actions */}
              {isSelected && (
                <div className="mt-3 pt-3 border-t border-slate-100 flex gap-2">
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    disabled={isProcessing}
                    className="flex-1 py-2.5 px-3 rounded-xl bg-blue-900 hover:bg-blue-800 text-white font-bold text-xs flex items-center justify-center gap-2 transition-colors shadow-2xs"
                  >
                    <Camera className="w-4 h-4" />
                    <span>{t(language, 'takePhoto')}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isProcessing}
                    className="flex-1 py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs flex items-center justify-center gap-2 transition-colors"
                  >
                    <Upload className="w-4 h-4" />
                    <span>{t(language, 'uploadFile')}</span>
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* Optional Documents Section */}
        <div className="pt-2 text-xs font-bold text-slate-700 ">
          {t(language, 'wizard.optionalDocs')}
        </div>

        {optionalTypes.map((typeCode) => {
          const config = DOCUMENT_TYPE_CONFIG.find((c) => c.code === typeCode);
          const uploadedList = getDocsByType(typeCode);
          const isSelected = activeDocType === typeCode;
          const isCreditCard = typeCode === 'CREDIT_CARD';

          return (
            <div
              key={typeCode}
              className={`p-3.5 rounded-2xl border transition-all ${
                isSelected
                  ? 'border-blue-900 bg-white ring-2 ring-blue-900/10 shadow-xs'
                  : 'border-slate-200 bg-white'
              }`}
            >
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setActiveDocType(typeCode)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-slate-900">
                      {t(language, config?.titleKey || '')}{' '}
                      <span className="text-[10px] font-normal text-slate-400">{t(language, 'wizard.optionalParen')}</span>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {t(language, config?.descKey || '')}
                    </div>
                  </div>
                </div>
                <div className="text-xs font-semibold text-slate-500">
                  {uploadedList.length > 0 ? t(language, 'wizard.uploadedCount', { n: uploadedList.length }) : t(language, 'optional')}
                </div>
              </div>

              {isCreditCard && isSelected && (
                <div className="mt-2.5 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900 flex items-start gap-2">
                  <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <span>{t(language, 'creditCardSafetyNotice')}</span>
                </div>
              )}

              {/* Uploaded Files for Optional items */}
              {uploadedList.length > 0 && (
                <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-2.5">
                  {uploadedList.map((doc) => (
                    <div
                      key={doc.id}
                      className="p-2 rounded-xl bg-slate-50 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2 truncate max-w-[240px]">
                        <span className="font-medium text-slate-800 truncate">
                          {doc.originalFilename}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteDocument(doc.id)}
                        className="text-red-500 hover:text-red-700 p-1"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {isSelected && (
                <div className="mt-3 pt-3 border-t border-slate-100 flex gap-2">
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    disabled={isProcessing}
                    className="flex-1 py-2 px-3 rounded-xl bg-blue-900 hover:bg-blue-800 text-white font-bold text-xs flex items-center justify-center gap-2"
                  >
                    <Camera className="w-4 h-4" />
                    <span>{t(language, 'takePhoto')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isProcessing}
                    className="flex-1 py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs flex items-center justify-center gap-2"
                  >
                    <Upload className="w-4 h-4" />
                    <span>{t(language, 'uploadFile')}</span>
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bank Account Management Confirmation */}
      <div className="mb-6 p-4 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-3">
        <label className="flex items-start gap-3 cursor-pointer group">
          <div className="relative flex items-center justify-center mt-0.5">
            <input
              type="checkbox"
              required
              checked={bankAccountConfirmed}
              onChange={(e) => setBankAccountConfirmed(e.target.checked)}
              className="w-5 h-5 appearance-none border-2 border-slate-300 rounded-md checked:bg-blue-600 checked:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20 transition-all peer"
            />
            <CheckCircle2 className="w-3.5 h-3.5 text-white absolute opacity-0 peer-checked:opacity-100 pointer-events-none transition-opacity" strokeWidth={3} />
          </div>
          <span className="text-sm font-medium text-slate-700 group-hover:text-slate-900 transition-colors">
            {t(language, 'wizard.bankConfirmTitle')} <span className="text-red-500">*</span>
          </span>
        </label>
        <p className="text-[11px] text-slate-500 ms-8">
          {t(language, 'wizard.bankConfirmText')}
        </p>
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
          id="step8-continue-btn"
          disabled={hasMandatoryMissing || !bankAccountConfirmed}
          className="w-2/3 py-3.5 px-6 rounded-xl bg-blue-900 hover:bg-blue-800 text-white font-semibold text-base shadow-sm hover:shadow transition-all flex items-center justify-center gap-2 group disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span>{t(language, 'continue')}</span>
          <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1 rtl:rotate-180" />
        </button>
      </div>
    </form>
  );
};
