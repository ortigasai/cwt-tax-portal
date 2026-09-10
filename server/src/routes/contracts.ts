import { Router } from 'express';
import JSZip from 'jszip';
import { prisma } from '../lib/prisma';
import { uploadMemory, uploadPdfMemory } from '../lib/upload';
import { parseContractList } from '../parsers/contractListParser';
import { importCustomerLedgerBuffer } from '../services/dataImport';
import { syncFromFolder } from '../services/folderSync';
import { computeContractExposure, ContractWithRelations, deriveDisplayFields } from '../services/contractExposureService';
import { saveManualOverride, applyManualOverrideIfAny } from '../services/manualOverrides';
import { generateLedgerExcel } from '../generators/ledgerExcelGenerator';
import { contractFilePath, UPLOADS_DIR } from '../lib/fileStorage';
import fs from 'fs';
import path from 'path';

export const contractsRouter = Router();

const contractInclude = {
  paymentRecords: { orderBy: { paymentDate: 'asc' as const } },
  collectionEvents: { orderBy: { datePaid: 'asc' as const } },
  matchedRptRecord: true,
  matchedParkingRptRecord: true,
  matchedStorageRptRecord: true,
};

function toNum(v: { toNumber(): number } | null | undefined): number | null {
  return v ? v.toNumber() : null;
}

function summarize(contract: ContractWithRelations) {
  const exposure = computeContractExposure(contract);
  const display = deriveDisplayFields(contract);
  return {
    contractNumber: contract.contractNumber,
    buyerName: contract.buyerName,
    tower: contract.tower,
    unit: contract.unit,
    taxTagging: display.taxTagging,
    buyerClassification: display.buyerClassification,
    cwtTaxBase: exposure.cwtTaxBase,
    cwtTaxDue: exposure.cwtTaxDue,
    actualRemitted: exposure.actualRemitted,
    variance: exposure.variance,
    totalPenalties: exposure.penalties?.totalPenalties ?? 0,
    status: exposure.status,
    batchNumber: contract.batchNumber,
    batchDate: contract.batchDate,
  };
}

function ledgerFileName(contractNumber: string): string {
  return `TaxPaymentLedger_${contractNumber}.xlsx`;
}

// Build the 2-sheet Tax Payment Ledger workbook buffer for one contract.
// Shared by the single-contract download and the bulk ZIP download.
async function buildLedgerBuffer(contract: ContractWithRelations): Promise<Buffer> {
  const exposure = computeContractExposure(contract);
  const display = deriveDisplayFields(contract);

  return generateLedgerExcel({
    contractNumber: contract.contractNumber,
    buyerName: contract.buyerName,
    estate: contract.estate,
    tower: contract.tower,
    unit: contract.unit,
    totalTCP: toNum(contract.totalTCP),
    netTCP: toNum(contract.netTCP),
    buyerClassification: display.buyerClassification,
    taxTagging: display.taxTagging,
    fmvPerTaxDeclarationUnit: display.fmvPerTaxDeclarationUnit,
    fmvPerTaxDeclarationParking: display.fmvPerTaxDeclarationParking,
    fmvPerTaxDeclarationStorage: display.fmvPerTaxDeclarationStorage,
    zonalValuePerSqmUnit: toNum(contract.zonalValuePerSqmUnit),
    zonalValuePerSqmParking: toNum(contract.zonalValuePerSqmParking),
    sqmUnit: toNum(contract.sqmUnit),
    sqmParking: toNum(contract.sqmParking),
    sqmStorage: toNum(contract.sqmStorage),
    ctsNotaryDate: contract.ctsNotaryDate,
    rdo: display.rdo,
    paymentRecords: contract.paymentRecords.map((p) => ({
      paymentDate: p.paymentDate,
      totalCollection: toNum(p.totalCollection),
      clearingDocument: p.clearingDocument,
      orNumber: p.orNumber,
      paymentPrincipal: toNum(p.paymentPrincipal),
      paymentVat: toNum(p.paymentVat),
      isSubtotal: p.isSubtotal,
    })),
    exposure,
  });
}

// POST /api/contracts/upload-list — bulk-create contract stubs from an
// uploaded Excel file of contract numbers.
contractsRouter.post('/upload-list', uploadMemory.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const contractNumbers = await parseContractList(req.file.buffer);
  if (contractNumbers.length === 0) {
    return res.status(400).json({ error: 'No contract numbers found in the uploaded file' });
  }

  // Assign this upload the next sequential batch number. New contracts are
  // tagged with it (via the create branch); existing ones keep their batch.
  const batchNumber = (await prisma.importBatch.count({ where: { type: 'CONTRACT_LIST' } })) + 1;
  const batchDate = new Date();

  let created = 0;
  let existing = 0;
  for (const contractNumber of contractNumbers) {
    const result = await prisma.contract.upsert({
      where: { contractNumber },
      update: {},
      create: { contractNumber, batchNumber, batchDate },
    });
    if (result.createdAt.getTime() === result.updatedAt.getTime()) {
      created++;
      // Re-hydrate any CTS/zonal research done before this contract was
      // previously deleted, so re-adding it via a fresh upload doesn't lose it.
      await applyManualOverrideIfAny(result.id, contractNumber);
    } else {
      existing++;
    }
  }

  await prisma.importBatch.create({
    data: { type: 'CONTRACT_LIST', filename: req.file.originalname, rowCount: contractNumbers.length, batchNumber },
  });

  // No background sync loop runs anymore (see folderSync.ts) — pull each
  // newly-listed contract's ledger/CTS/1606 data from DATA_SYNC_DIR right
  // now, in the same request, rather than requiring a separate manual
  // "Sync from folder now" click afterward.
  const syncSummary = await syncFromFolder({ force: false });

  res.json({ totalFound: contractNumbers.length, created, alreadyExisted: existing, batchNumber, syncSummary });
});

// POST /api/contracts/delete — delete the given contracts from the system.
// The folder remains the source of truth: if a deleted contract's source file
// is still in the watched folder, the next sync (manual, or the next
// contract-list upload) will re-add it. To keep a contract out for good,
// remove its file from the folder.
// Body: { contractNumbers: string[] }.
contractsRouter.post('/delete', async (req, res) => {
  const raw = (req.body as { contractNumbers?: unknown }).contractNumbers;
  if (!Array.isArray(raw) || raw.length === 0) {
    return res.status(400).json({ error: 'contractNumbers must be a non-empty array' });
  }
  const numbers = [...new Set(raw.map((n) => String(n)))];

  const deleted = await prisma.contract.deleteMany({ where: { contractNumber: { in: numbers } } });

  // Remove any copies the app stored in its own uploads folder (e.g. CTS PDFs).
  // This never touches the user's source folder.
  for (const contractNumber of numbers) {
    fs.rmSync(path.join(UPLOADS_DIR, contractNumber), { recursive: true, force: true });
  }

  res.json({ deleted: deleted.count });
});

// GET /api/contracts — summary dashboard rows.
contractsRouter.get('/', async (_req, res) => {
  const contracts = await prisma.contract.findMany({ include: contractInclude, orderBy: { createdAt: 'asc' } });
  res.json(contracts.map((c) => summarize(c)));
});

// GET /api/contracts/ledgers.zip[?batchNumber=N] — bundle every contract's
// Tax Payment Ledger into a single ZIP, optionally filtered to one upload
// batch. Registered before /:contractNumber so "ledgers.zip" isn't matched
// as a contract number.
contractsRouter.get('/ledgers.zip', async (req, res) => {
  const raw = req.query.batchNumber;
  const batchNumber = raw !== undefined ? Number(raw) : undefined;
  const filterByBatch = batchNumber !== undefined && !Number.isNaN(batchNumber);

  const contracts = await prisma.contract.findMany({
    where: filterByBatch ? { batchNumber } : {},
    include: contractInclude,
    orderBy: { contractNumber: 'asc' },
  });
  if (contracts.length === 0) {
    return res.status(404).json({ error: 'No contracts found to export' });
  }

  const zip = new JSZip();
  for (const contract of contracts) {
    try {
      const buffer = await buildLedgerBuffer(contract);
      zip.file(ledgerFileName(contract.contractNumber), buffer);
    } catch (err) {
      zip.file(`ERROR_${contract.contractNumber}.txt`, `Could not generate ledger: ${(err as Error).message}`);
    }
  }
  const content = await zip.generateAsync({ type: 'nodebuffer' });

  const stamp = new Date().toISOString().slice(0, 10);
  const name = filterByBatch
    ? `TaxPaymentLedgers_Batch${batchNumber}_${stamp}.zip`
    : `TaxPaymentLedgers_All_${stamp}.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(content);
});

// GET /api/contracts/:contractNumber — full detail + computed breakdown.
contractsRouter.get('/:contractNumber', async (req, res) => {
  const contract = await prisma.contract.findUnique({
    where: { contractNumber: req.params.contractNumber },
    include: contractInclude,
  });
  if (!contract) return res.status(404).json({ error: 'Contract not found' });

  const exposure = computeContractExposure(contract);
  const display = deriveDisplayFields(contract);

  res.json({
    contractNumber: contract.contractNumber,
    buyerName: contract.buyerName,
    estate: contract.estate,
    tower: contract.tower,
    unit: contract.unit,
    totalTCP: toNum(contract.totalTCP),
    netTCP: toNum(contract.netTCP),
    ctsNotaryDate: contract.ctsNotaryDate,
    sqmUnit: toNum(contract.sqmUnit),
    sqmParking: toNum(contract.sqmParking),
    sqmStorage: toNum(contract.sqmStorage),
    ctsFileName: contract.ctsFileName,
    customerLedgerFileName: contract.customerLedgerFileName,
    zonalValuePerSqmUnit: toNum(contract.zonalValuePerSqmUnit),
    zonalValuePerSqmParking: toNum(contract.zonalValuePerSqmParking),
    matchedRptRecord: contract.matchedRptRecord,
    matchedParkingRptRecord: contract.matchedParkingRptRecord,
    matchedStorageRptRecord: contract.matchedStorageRptRecord,
    notes: contract.notes,
    buyerClassification: display.buyerClassification,
    taxTagging: display.taxTagging,
    fmvPerTaxDeclarationUnit: display.fmvPerTaxDeclarationUnit,
    fmvPerTaxDeclarationParking: display.fmvPerTaxDeclarationParking,
    fmvPerTaxDeclarationStorage: display.fmvPerTaxDeclarationStorage,
    rdo: display.rdo,
    paymentRecords: contract.paymentRecords.map((p) => ({
      id: p.id,
      baselineDate: p.baselineDate,
      paymentDate: p.paymentDate,
      totalCollection: toNum(p.totalCollection),
      clearingDocument: p.clearingDocument,
      orNumber: p.orNumber,
      paymentPrincipal: toNum(p.paymentPrincipal),
      paymentVat: toNum(p.paymentVat),
      isSubtotal: p.isSubtotal,
    })),
    collectionEvents: contract.collectionEvents.map((e) => ({
      id: e.id,
      buyerClassification: e.buyerClassification,
      taxTagging: e.taxTagging,
      sourceTaxBase: toNum(e.sourceTaxBase),
      actualTaxDue: toNum(e.actualTaxDue),
      transactionDate: e.transactionDate,
      datePaid: e.datePaid,
      remarks: e.remarks,
    })),
    exposure,
  });
});

// PATCH /api/contracts/:contractNumber — manual field entry (CTS notary
// date/SQM, zonal value, FMV match, notes). This is the fallback path for
// data that has no reliable automated source (see README). Every successful
// update is also mirrored into ContractManualOverride so it survives a
// delete + folder-resync cycle (see manualOverrides.ts).
contractsRouter.patch('/:contractNumber', async (req, res) => {
  const {
    ctsNotaryDate,
    sqmUnit,
    sqmParking,
    sqmStorage,
    zonalValuePerSqmUnit,
    zonalValuePerSqmParking,
    matchedRptRecordId,
    matchedParkingRptRecordId,
    matchedStorageRptRecordId,
    notes,
  } = req.body as Record<string, unknown>;

  try {
    const contract = await prisma.contract.update({
      where: { contractNumber: req.params.contractNumber },
      data: {
        ...(ctsNotaryDate !== undefined && { ctsNotaryDate: ctsNotaryDate ? new Date(String(ctsNotaryDate)) : null }),
        ...(sqmUnit !== undefined && { sqmUnit: sqmUnit === null ? null : Number(sqmUnit) }),
        ...(sqmParking !== undefined && { sqmParking: sqmParking === null ? null : Number(sqmParking) }),
        ...(sqmStorage !== undefined && { sqmStorage: sqmStorage === null ? null : Number(sqmStorage) }),
        ...(zonalValuePerSqmUnit !== undefined && {
          zonalValuePerSqmUnit: zonalValuePerSqmUnit === null ? null : Number(zonalValuePerSqmUnit),
        }),
        ...(zonalValuePerSqmParking !== undefined && {
          zonalValuePerSqmParking: zonalValuePerSqmParking === null ? null : Number(zonalValuePerSqmParking),
        }),
        ...(matchedRptRecordId !== undefined && { matchedRptRecordId: matchedRptRecordId as string | null }),
        ...(matchedParkingRptRecordId !== undefined && {
          matchedParkingRptRecordId: matchedParkingRptRecordId as string | null,
        }),
        ...(matchedStorageRptRecordId !== undefined && {
          matchedStorageRptRecordId: matchedStorageRptRecordId as string | null,
        }),
        ...(notes !== undefined && { notes: notes as string | null }),
      },
    });

    await saveManualOverride(contract.contractNumber, {
      ctsNotaryDate: contract.ctsNotaryDate,
      sqmUnit: toNum(contract.sqmUnit),
      sqmParking: toNum(contract.sqmParking),
      sqmStorage: toNum(contract.sqmStorage),
      zonalValuePerSqmUnit: toNum(contract.zonalValuePerSqmUnit),
      zonalValuePerSqmParking: toNum(contract.zonalValuePerSqmParking),
      matchedRptRecordId: contract.matchedRptRecordId,
      matchedParkingRptRecordId: contract.matchedParkingRptRecordId,
      matchedStorageRptRecordId: contract.matchedStorageRptRecordId,
      notes: contract.notes,
    });

    res.json(contract);
  } catch {
    res.status(404).json({ error: 'Contract not found' });
  }
});

// POST /api/contracts/:contractNumber/customer-ledger — upload the
// per-contract Customer Ledger Excel export; replaces payment records.
contractsRouter.post('/:contractNumber/customer-ledger', uploadMemory.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const result = await importCustomerLedgerBuffer(req.params.contractNumber, req.file.buffer, req.file.originalname);
  if (!result.ok) return res.status(404).json({ error: 'Contract not found' });

  res.json({ ok: true, paymentRecordsImported: result.paymentRecordsImported });
});

// POST /api/contracts/:contractNumber/cts — store the CTS PDF for reference.
// Not parsed (scanned images, no extractable text) — enter notary date/SQM
// via PATCH after reading the document.
contractsRouter.post('/:contractNumber/cts', uploadPdfMemory.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No PDF uploaded' });
  const contractNumber = req.params.contractNumber;

  const contract = await prisma.contract.findUnique({ where: { contractNumber } });
  if (!contract) return res.status(404).json({ error: 'Contract not found' });

  const destPath = contractFilePath(contractNumber, req.file.originalname);
  fs.writeFileSync(destPath, req.file.buffer);

  await prisma.contract.update({ where: { id: contract.id }, data: { ctsFileName: req.file.originalname } });
  res.json({ ok: true, ctsFileName: req.file.originalname });
});

// GET /api/contracts/:contractNumber/cts — download the stored CTS PDF.
contractsRouter.get('/:contractNumber/cts', async (req, res) => {
  const contract = await prisma.contract.findUnique({ where: { contractNumber: req.params.contractNumber } });
  if (!contract?.ctsFileName) return res.status(404).json({ error: 'No CTS file on record' });
  const filePath = contractFilePath(req.params.contractNumber, contract.ctsFileName);
  res.download(filePath, contract.ctsFileName);
});

// POST /api/contracts/:contractNumber/collection-events — manually record a
// CWT remittance event when no OCLP 1606 import row matches this contract.
contractsRouter.post('/:contractNumber/collection-events', async (req, res) => {
  const contract = await prisma.contract.findUnique({ where: { contractNumber: req.params.contractNumber } });
  if (!contract) return res.status(404).json({ error: 'Contract not found' });

  const { buyerClassification, taxTagging, actualTaxDue, transactionDate, datePaid, remarks } = req.body as Record<
    string,
    unknown
  >;

  const event = await prisma.cwtCollectionEvent.create({
    data: {
      contractId: contract.id,
      contractNumberRaw: contract.contractNumber,
      buyerClassification: (buyerClassification as string) ?? null,
      taxTagging: (taxTagging as string) ?? null,
      actualTaxDue: actualTaxDue !== undefined ? Number(actualTaxDue) : null,
      transactionDate: transactionDate ? new Date(String(transactionDate)) : null,
      datePaid: datePaid ? new Date(String(datePaid)) : null,
      remarks: (remarks as string) ?? 'Manually entered',
    },
  });
  res.json(event);
});

// GET /api/contracts/:contractNumber/ledger.xlsx — generate and download the
// 2-sheet Tax Payment Ledger export (FS Section 7.2).
contractsRouter.get('/:contractNumber/ledger.xlsx', async (req, res) => {
  const contract = await prisma.contract.findUnique({
    where: { contractNumber: req.params.contractNumber },
    include: contractInclude,
  });
  if (!contract) return res.status(404).json({ error: 'Contract not found' });

  const buffer = await buildLedgerBuffer(contract);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${ledgerFileName(contract.contractNumber)}"`);
  res.send(buffer);
});
