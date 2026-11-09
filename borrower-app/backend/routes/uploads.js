// Document uploads (Phase 2): multer storage, file-type checks, ownership in uploaded_files.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { dbRun } = require('@quickloan/backend-core/services/dbHelpers');
const { UPLOAD_DIR } = require('@quickloan/backend-core/core/config');

// --- File uploads (Phase 2) -------------------------------------------------
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 8);
      cb(null, `${Date.now()}_${crypto.randomBytes(8).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: parseInt(process.env.MAX_UPLOAD_BYTES || String(10 * 1024 * 1024), 10) },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) return cb(null, true);
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Only images (JPEG/PNG/WebP/HEIC) and PDF files are allowed'));
  },
});

function validateFileMagicBytes(filePath) {
  try {
    const buffer = Buffer.alloc(16);
    const fd = fs.openSync(filePath, 'r');
    const bytesRead = fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);
    if (bytesRead < 4) return false;

    // PDF: %PDF (0x25, 0x50, 0x44, 0x46)
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
      return true;
    }
    // JPEG: FF D8 FF
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      return true;
    }
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      return true;
    }
    // WebP: RIFF at 0..3 and WEBP at 8..11
    if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
      return true;
    }
    // HEIC / HEIF: ftyp at offset 4
    if (buffer.toString('ascii', 4, 8) === 'ftyp') {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function register(app) {
  app.post('/api/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file received (expected multipart field "file")' });

    // Magic bytes / header inspection to detect disguised or malicious files
    const isValid = validateFileMagicBytes(req.file.path);
    if (!isValid) {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(400).json({
        success: false,
        error: 'File content does not match genuine PDF or image format. Disguised or corrupted files are rejected for security.',
      });
    }

    // Record ownership in database
    const userId = req.auth ? req.auth.sub : 'anonymous';
    try {
      await dbRun(
        'INSERT OR REPLACE INTO uploaded_files (filename, userId, originalName, mimeType, size, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
        [req.file.filename, userId, req.file.originalname, req.file.mimetype, req.file.size, new Date().toISOString()]
      );
    } catch (e) {
      console.warn('[UPLOAD] Error tracking file owner:', e.message);
    }

    res.json({
      success: true,
      file: {
        filename: req.file.filename,
        url: `/api/uploads/${req.file.filename}`,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
      },
    });
  });
}

module.exports = { register };
