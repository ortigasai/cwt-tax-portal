import multer from 'multer';
import os from 'os';

// Small spreadsheets (contract lists, per-contract Customer Ledger exports,
// RPT_ALL TOWERS.xlsx) are parsed straight from memory.
export const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// The OCLP 1606 Summary workbook can be tens of MB with 70k+ rows; it's
// parsed with a streaming reader that needs a file path on disk.
export const uploadDisk = multer({
  storage: multer.diskStorage({ destination: os.tmpdir() }),
  limits: { fileSize: 200 * 1024 * 1024 },
});

// CTS PDFs are kept as a reference attachment only (no parsing — see
// birZonalValues.ts-style comment in customerLedgerParser for why: these
// are scanned images with no extractable text).
export const uploadPdfMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, file.mimetype === 'application/pdf');
  },
});
