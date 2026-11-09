const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType, ShadingType } = require('docx');

// --- Document Content Definitions ---
const docData = {
  title: 'QuickLoan: Digital Micro-Loan Platform',
  subtitle: 'Application Summary & Step-by-Step User Journey Guide',
  generatedDate: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
  version: 'v1.0 (Production Architecture)',
  overview: [
    {
      heading: 'Executive Summary',
      text: 'QuickLoan is a specialized digital micro-lending web application engineered specifically for foreign guest workers residing and employed in Israel (such as workers in agriculture, construction, and caregiving). The platform bridges the gap between institutional credit providers and foreign workers who frequently face language barriers, lack established Israeli credit history, and encounter complex bureaucratic hurdles.'
    },
    {
      heading: 'Core Mission & Key Capabilities',
      points: [
        'Multilingual Inclusivity: Native support for English, Hebrew (with right-to-left UI alignment), Thai, and Chinese, addressing the predominant demographics of Israeli foreign labor.',
        'Accessible Self-Service Wizard: Mobile-optimized, 10-step wizard featuring seamless auto-saving drafts and offline-tolerant state management.',
        'Real-Time Indicative Eligibility Scoring: Dynamic, transparent scoring bar providing instant feedback on approval odds as applicants provide work details and upload verification documents.',
        'End-to-End Digital Security: SMS One-Time Password (OTP) verification, encrypted credential storage (bcrypt + JWT), biometric/photo KYC verification, and canvas-based digital signature capture.',
        'Live Status Tracking (SSE): Server-Sent Events push instant status updates directly to applicants without requiring manual page refreshes.',
        'Enterprise Back-Office & Risk Engine: Dedicated administrative portal equipped with rule-based credit risk assessment, multi-factor scoring overrides, and real-time KPI analytics.'
      ]
    }
  ],
  steps: [
    {
      step: 'Step 1',
      title: 'Language Selection',
      purpose: 'Establish linguistic comfort and cultural accessibility.',
      description: 'The applicant selects their native language from English, Hebrew, Thai, or Chinese. The entire interface, form labels, legal disclaimers, and validation notices instantly adapt. Selecting Hebrew automatically toggles the user interface into Right-to-Left (RTL) mode.'
    },
    {
      step: 'Step 2',
      title: 'Authentication & Registration',
      purpose: 'Identity verification, regulatory compliance, and account creation.',
      description: 'Before registration, geolocation checks verify the borrower is physically in Israel, and mandatory legal disclaimers regarding Israeli credit regulations are acknowledged. Users register using their Israeli phone number, email, and passport number. A 6-digit SMS OTP verifies device ownership before creating a password. Returning borrowers can log in via password, SMS OTP, or Google SSO.'
    },
    {
      step: 'Step 3',
      title: 'Borrower Details',
      purpose: 'Capture primary personal identification and local contact details.',
      description: 'The borrower enters their legal full name (matching their passport), passport number, country of origin, date of birth (validating the minimum age requirement of 18+), marital status, Israeli mobile phone number, WhatsApp contact, and residential address in Israel.'
    },
    {
      step: 'Step 4',
      title: 'Residency & Visa Details',
      purpose: 'Confirm legal immigration status and foreign worker visa validity.',
      description: 'The borrower inputs their Israeli visa category (e.g., B-1 Agricultural, Caregiving, or Construction), initial date of entry into Israel, and visa expiration date. The system automatically computes total years of residency and validates that the visa remains valid for the duration of the requested loan.'
    },
    {
      step: 'Step 5',
      title: 'Employment & Financial Information',
      purpose: 'Assess employment stability and monthly debt-service capacity.',
      description: 'Collects employment credentials, including employer or staffing contractor name, job tenure (in months), monthly net salary in ILS (Israeli Shekels), and salary payment method (e.g., direct Israeli bank deposit or cash card).'
    },
    {
      step: 'Step 6',
      title: 'Loan Request & Repayment Calculator',
      purpose: 'Customize loan parameters, calculate transparent terms, and set disbursement account.',
      description: 'Borrowers configure their loan request using an interactive calculator to choose loan amount (typically up to 20,000 ILS), repayment period (3 to 24 months), loan purpose, and optional grace period. The system immediately calculates monthly payments, interest rates, and APR. The user also enters their Israeli bank account details (bank name, branch number, account number) for direct fund disbursement.'
    },
    {
      step: 'Step 7',
      title: 'Guarantor Details (Optional / Recommended)',
      purpose: 'Enhance creditworthiness and provide secondary repayment assurance.',
      description: 'Borrowers can add co-signers or community guarantors to strengthen their loan application. The step records the guarantor\'s full name, Israeli mobile number, relationship to the borrower, passport/ID, and allows optional guarantor ID document uploads.'
    },
    {
      step: 'Step 8',
      title: 'Document Uploads & KYC Verification',
      purpose: 'Verify borrower identity, employment, and banking credentials.',
      description: 'Borrowers take photos or upload clear copies of mandatory verification records: Passport photo page, valid Israeli Visa sticker/card, recent pay stubs / salary slips, and a bank statement or account ownership confirmation. An Indicative Eligibility Score bar updates in real time to show how document completion improves approval probabilities.'
    },
    {
      step: 'Step 9',
      title: 'Review, Legal Consents & Digital Signature',
      purpose: 'Audit application data and execute binding legal consents.',
      description: 'Displays a comprehensive summary of all submitted details with one-click "Edit" links for each section. The applicant reviews and accepts statutory consents (Credit Bureau inquiry, privacy agreement, terms of service) and provides an enforceable digital signature using an interactive drawing pad or typed signature.'
    },
    {
      step: 'Step 10',
      title: 'Submission Success',
      purpose: 'Confirm application receipt and provide immediate proof of submission.',
      description: 'Confirms application submission with celebration graphics and issues a unique Application Reference Number (e.g., LN-2026-XXXX). The borrower can instantly download an official PDF copy of their completed application and proceed to the status dashboard.'
    },
    {
      step: 'Step 11 (Post-Submission)',
      title: 'Real-Time Status Timeline',
      purpose: 'Provide live, transparent tracking through underwriting and disbursement.',
      description: 'A visual timeline tracking milestones: Submitted -> Initial Screening -> Document Review -> Credit Assessment -> Approved -> Disbursed. Powered by Server-Sent Events (SSE), status changes initiated by loan officers in the back-office reflect in real time on the borrower\'s screen alongside SMS notification alerts.'
    }
  ]
};

// ==========================================
// 1. GENERATE PDF DOCUMENT (using PDFKit)
// ==========================================
function generatePdf(outputPath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 45,
      info: {
        Title: 'QuickLoan Application Summary & Guide',
        Author: 'LendGlobal / QuickLoan Team',
        Subject: 'Digital Loan App Documentation',
      }
    });

    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    const PRIMARY = '#1e3a8a';   // Deep Blue
    const SECONDARY = '#2563eb'; // Royal Blue
    const DARK = '#0f172a';      // Slate 900
    const MUTED = '#475569';     // Slate 600
    const BG_LIGHT = '#f8fafc';  // Slate 50
    const BORDER = '#e2e8f0';    // Slate 200

    // Header Banner
    doc.rect(0, 0, doc.page.width, 95).fill(PRIMARY);
    doc.fillColor('#ffffff').fontSize(22).font('Helvetica-Bold').text('QuickLoan Israel', 45, 25);
    doc.fontSize(11).font('Helvetica').text('Digital Micro-Lending Platform for Foreign Workers', 45, 52);
    doc.fontSize(9).text(`Generated: ${docData.generatedDate}  |  ${docData.version}`, 45, 70);

    doc.moveDown(4.5);

    // Section 1: Executive Summary
    doc.fillColor(SECONDARY).fontSize(14).font('Helvetica-Bold').text('1. APPLICATION OVERVIEW');
    doc.moveTo(45, doc.y + 2).lineTo(doc.page.width - 45, doc.y + 2).strokeColor(BORDER).lineWidth(1).stroke();
    doc.moveDown(0.6);

    doc.fillColor(DARK).fontSize(10).font('Helvetica').lineGap(3).text(docData.overview[0].text);
    doc.moveDown(0.8);

    doc.fillColor(DARK).fontSize(11).font('Helvetica-Bold').text('Key Platform Capabilities:');
    doc.moveDown(0.3);

    docData.overview[1].points.forEach((point) => {
      const parts = point.split(': ');
      doc.fillColor(SECONDARY).font('Helvetica-Bold').fontSize(9.5).text('•  ' + parts[0] + ': ', { continued: true });
      doc.fillColor(MUTED).font('Helvetica').text(parts[1]);
      doc.moveDown(0.2);
    });

    doc.moveDown(1.2);

    // Section 2: Step-by-Step Flow
    doc.fillColor(SECONDARY).fontSize(14).font('Helvetica-Bold').text('2. STEP-BY-STEP USER JOURNEY & APPLICATION FLOW');
    doc.moveTo(45, doc.y + 2).lineTo(doc.page.width - 45, doc.y + 2).strokeColor(BORDER).lineWidth(1).stroke();
    doc.moveDown(0.8);

    docData.steps.forEach((s) => {
      // Check if near bottom of page
      if (doc.y > doc.page.height - 110) {
        doc.addPage();
        // Top mini-header on subsequent pages
        doc.rect(0, 0, doc.page.width, 25).fill(PRIMARY);
        doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold').text('QuickLoan Platform Guide — Step-by-Step Application Flow', 45, 8);
        doc.moveDown(2);
      }

      // Step Box Container
      const startY = doc.y;
      
      // Step Badge & Title
      doc.fillColor(PRIMARY).fontSize(11).font('Helvetica-Bold').text(`${s.step}: ${s.title}`);
      doc.moveDown(0.15);
      
      // Purpose
      doc.fillColor(SECONDARY).fontSize(9).font('Helvetica-Bold').text('Purpose: ', { continued: true });
      doc.fillColor(DARK).font('Helvetica-Oblique').text(s.purpose);
      doc.moveDown(0.25);

      // Description
      doc.fillColor(MUTED).fontSize(9.5).font('Helvetica').lineGap(2).text(s.description);
      doc.moveDown(0.7);

      // Light divider between steps
      doc.moveTo(45, doc.y).lineTo(doc.page.width - 45, doc.y).strokeColor(BORDER).lineWidth(0.5).stroke();
      doc.moveDown(0.6);
    });

    // Footer on all pages
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fillColor(MUTED).fontSize(8).font('Helvetica').text(
        `QuickLoan Digital Micro-Lending • Page ${i + 1} of ${range.count}`,
        45,
        doc.page.height - 30,
        { align: 'center', width: doc.page.width - 90 }
      );
    }

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

// ==========================================
// 2. GENERATE DOCX DOCUMENT (using docx)
// ==========================================
async function generateDocx(outputPath) {
  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 1000, bottom: 1000, left: 1200, right: 1200 }
        }
      },
      children: [
        // Title Block
        new Paragraph({
          text: docData.title,
          heading: HeadingLevel.TITLE,
          spacing: { after: 120 },
        }),
        new Paragraph({
          children: [
            new TextRun({ text: docData.subtitle, italics: true, size: 24, color: '2563EB' }),
          ],
          spacing: { after: 80 }
        }),
        new Paragraph({
          children: [
            new TextRun({ text: `Date: ${docData.generatedDate}  |  Version: ${docData.version}`, size: 18, color: '64748B' }),
          ],
          spacing: { after: 300 }
        }),

        // Heading: Executive Summary
        new Paragraph({
          text: '1. Executive Summary',
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 200, after: 140 }
        }),
        new Paragraph({
          text: docData.overview[0].text,
          spacing: { after: 180 }
        }),

        // Heading: Key Capabilities
        new Paragraph({
          text: 'Key Platform Capabilities',
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 140, after: 100 }
        }),
        ...docData.overview[1].points.map(pt => {
          const parts = pt.split(': ');
          return new Paragraph({
            bullet: { level: 0 },
            children: [
              new TextRun({ text: parts[0] + ': ', bold: true, color: '1E3A8A' }),
              new TextRun({ text: parts[1] })
            ],
            spacing: { after: 80 }
          });
        }),

        // Heading: Step-by-Step Flow
        new Paragraph({
          text: '2. Step-by-Step User Journey & Application Flow',
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 300, after: 180 }
        }),

        // Steps mapping
        ...docData.steps.flatMap(s => [
          new Paragraph({
            text: `${s.step} — ${s.title}`,
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 180, after: 60 }
          }),
          new Paragraph({
            children: [
              new TextRun({ text: 'Purpose: ', bold: true, color: '2563EB' }),
              new TextRun({ text: s.purpose, italics: true })
            ],
            spacing: { after: 60 }
          }),
          new Paragraph({
            text: s.description,
            spacing: { after: 160 }
          })
        ])
      ]
    }]
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);
}

// ==========================================
// RUN SCRIPT & COPY TO ACCESSIBLE LOCATIONS
// ==========================================
async function main() {
  const rootDir = path.resolve(__dirname, '..');
  const uploadsDir = path.resolve(rootDir, 'data', 'uploads');
  const frontendPublicDir = path.resolve(rootDir, 'borrower-app', 'frontend', 'public');

  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  if (!fs.existsSync(frontendPublicDir)) fs.mkdirSync(frontendPublicDir, { recursive: true });

  const pdfFileName = 'QuickLoan_App_Overview_and_Application_Guide.pdf';
  const docxFileName = 'QuickLoan_App_Overview_and_Application_Guide.docx';

  const rootPdf = path.join(rootDir, pdfFileName);
  const rootDocx = path.join(rootDir, docxFileName);

  console.log('Generating PDF...');
  await generatePdf(rootPdf);
  console.log('PDF generated at:', rootPdf);

  console.log('Generating DOCX...');
  await generateDocx(rootDocx);
  console.log('DOCX generated at:', rootDocx);

  // Copy to backend/uploads and frontend/public
  fs.copyFileSync(rootPdf, path.join(uploadsDir, pdfFileName));
  fs.copyFileSync(rootDocx, path.join(uploadsDir, docxFileName));
  fs.copyFileSync(rootPdf, path.join(frontendPublicDir, pdfFileName));
  fs.copyFileSync(rootDocx, path.join(frontendPublicDir, docxFileName));

  console.log('Successfully copied documents to:');
  console.log(' - Project root');
  console.log(' - backend/uploads/');
  console.log(' - frontend/public/');
}

main().catch(err => {
  console.error('Error generating documents:', err);
  process.exit(1);
});
