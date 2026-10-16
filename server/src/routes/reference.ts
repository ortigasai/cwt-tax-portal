import { Router } from 'express';
import fs from 'fs';
import { prisma } from '../lib/prisma';
import { uploadDisk, uploadMemory } from '../lib/upload';
import { importOclp1606File } from '../services/dataImport';
import { parseRptTowers } from '../parsers/rptTowersParser';
import { REFERENCE_LOCKED_MESSAGE, referenceDataLocked } from '../lib/referenceLock';
import path from 'path';

export const referenceRouter = Router();

// GET /api/reference/config — whether reference data can be changed from the
// web app, and which source folders it is read from (folder names only).
referenceRouter.get('/config', (_req, res) => {
  const folderName = (p: string | undefined) => (p ? path.basename(p.replace(/[\/]+$/, '')) : null);
  res.json({
    locked: referenceDataLocked(),
    message: REFERENCE_LOCKED_MESSAGE,
    dataSyncFolder: folderName(process.env.DATA_SYNC_DIR),
    zonalValuesFolder: folderName(process.env.ZONAL_VALUES_DIR ?? process.env.DATA_SYNC_DIR),
  });
});

// POST /api/reference/oclp-1606/upload — bulk-import the OCLP 1606 Summary
// FINAL tab. Only rows whose contract number matches an existing Contract
// are linked (others are recorded with contractId=null for traceability).
referenceRouter.post('/oclp-1606/upload', uploadDisk.single('file'), async (req, res) => {
  if (referenceDataLocked()) {
    if (req.file) fs.unlink(req.file.path, () => undefined);
    return res.status(403).json({ error: REFERENCE_LOCKED_MESSAGE });
  }
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const result = await importOclp1606File(req.file.path, req.file.originalname);
    res.json(result);
  } finally {
    fs.unlink(req.file.path, () => undefined);
  }
});

// POST /api/reference/rpt-towers/upload — replace the FMV reference table
// wholesale from RPT_ALL TOWERS.xlsx ("ALL" sheet).
referenceRouter.post('/rpt-towers/upload', uploadMemory.single('file'), async (req, res) => {
  if (referenceDataLocked()) return res.status(403).json({ error: REFERENCE_LOCKED_MESSAGE });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const rows = await parseRptTowers(req.file.buffer);
  if (rows.length === 0) {
    return res.status(400).json({ error: 'No rows found in the ALL sheet' });
  }

  await prisma.$transaction([
    // Unmatch any contracts pointing at records we're about to delete.
    prisma.contract.updateMany({ data: { matchedRptRecordId: null } }),
    prisma.rptTowerRecord.deleteMany({}),
    prisma.rptTowerRecord.createMany({ data: rows }),
  ]);

  await prisma.importBatch.create({
    data: { type: 'RPT_ALL_TOWERS', filename: req.file.originalname, rowCount: rows.length },
  });

  res.json({ rowsImported: rows.length });
});

// GET /api/reference/rpt-towers/search?q=... — used by the contract detail
// page to manually match a contract's Tower/Unit to its FMV record.
referenceRouter.get('/rpt-towers/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 1) return res.json([]);

  const records = await prisma.rptTowerRecord.findMany({
    where: {
      OR: [{ tower: { contains: q, mode: 'insensitive' } }, { unit: { contains: q, mode: 'insensitive' } }],
    },
    take: 25,
  });
  res.json(records);
});
