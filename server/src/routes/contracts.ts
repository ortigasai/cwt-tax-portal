import { Router } from 'express';
import JSZip from 'jszip';
import { prisma } from '../lib/prisma';
import { uploadMemory, uploadPdfMemory } from '../lib/upload';
import { parseContractList } from '../parsers/contractListParser';
import { importCustomerLedgerBuffer } from '../services/dataImport';
import { retrieveDataForContracts } from '../services/contractIntake';
import { fillCtsDataForContracts } from '../services/ctsDataSync';
import {
  ComputationOverride,
  computeContractExposure,
  ContractWithRelations,
  deriveAnalysis,
  deriveDisplayFields,
  etbOverride,
} from '../services/contractExposureService';
import { parseIsoDate } from '../lib/isoDate';
import { nonCurrentClearingDocs } from '../lib/clearingSeries';
import { describeLedgerfitSession, lookupLedgerfitSession } from '../services/ledgerfitStatus';
import { saveManualOverride, applyManualOverrideIfAny } from '../services/manualOverrides';
import { generateLedgerExcel } from '../generators/ledgerExcelGenerator';
import { contractFilePath, UPLOADS_DIR } from '../lib/fileStorage';
import fs from 'fs';
import path from 'path';

export const contractsRouter = Router();

export const contractInclude = {
  paymentRecords: { orderBy: { paymentDate: 'asc' as const } },
  collectionEvents: { orderBy: { datePaid: 'asc' as const } },
  matchedRptRecord: true,
  matchedParkingRptRecord: true,
  matchedStorageRptRecord: true,
};

function toNum(v: { toNumber(): number } | null | undefined): number | null {
  return v ? v.toNumber() : null;
}

// A batch's display title: whatever the user renamed it to, otherwise the
// uploaded Excel file's name (minus its spreadsheet extension). Folder-sync
// batches have no file, so their stored "Folder sync <date>" label is used.
function batchDisplayTitle(b: { title: string | null; filename: string }): string {
  const custom = b.title?.trim();
  return custom ? custom : b.filename.replace(/\.(xlsx|xlsm|xls|csv)$/i, '');
}

const MAX_BATCH_TITLE_LENGTH = 120;

function summarize(contract: ContractWithRelations, batchTitles?: Map<number, string>) {
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
    totalPenalties: exposure.penalties?.totalPenalties ?? exposure.rowPenaltiesTotal,
    status: exposure.status,
    batchNumber: contract.batchNumber,
    batchTitle: contract.batchNumber != null ? (batchTitles?.get(contract.batchNumber) ?? null) : null,
    batchDate: contract.batchDate,
    // How many payment rows still carry a clearing document outside the 14
    // series — non-zero means the ledger on file is not the latest one.
    nonCurrentClearingDocs: ledgerSeriesOf(contract).length,
    // Is the analysis done, so the payment ledger can be downloaded?
    analysis: deriveAnalysis(contract),
  };
}

function ledgerSeriesOf(contract: ContractWithRelations): string[] {
  return nonCurrentClearingDocs(
    contract.paymentRecords.filter((p) => !p.isSubtotal).map((p) => p.clearingDocument),
  );
}

function ledgerFileName(contractNumber: string): string {
  return `TaxPaymentLedger_${contractNumber}.xlsx`;
}

// Build the 2-sheet Tax Payment Ledger workbook buffer for one contract.
// Shared by the single-contract download and the bulk ZIP download.
export async function buildLedgerBuffer(
  contract: ContractWithRelations,
  override?: ComputationOverride,
): Promise<Buffer> {
  const exposure = computeContractExposure(contract, new Date(), override);
  const display = deriveDisplayFields(contract, override);

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

// POST /api/contracts/retrieve-cts-data — fill CTS notary date / SQM / zonal
// value from the DOAS batches for contracts that are still missing them.
// Body: { contractNumbers?: string[] } (default: every contract missing data).
// Empty fields only; manually entered values are never overwritten.
contractsRouter.post('/retrieve-cts-data', async (req, res) => {
  const body = (req.body ?? {}) as { contractNumbers?: unknown };
  const contractNumbers = Array.isArray(body.contractNumbers)
    ? body.contractNumbers.map((n) => String(n)).filter(Boolean)
    : undefined;
  res.json(await fillCtsDataForContracts(contractNumbers));
});

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

  // Retrieve the data for exactly the uploaded contracts (ledger, 1606,
  // CTS) in this same request — no folder-wide sync — then read them back
  // with their computed exposure so the result comes back in one go.
  const intake = await retrieveDataForContracts(contractNumbers);
  const loaded = await prisma.contract.findMany({
    where: { contractNumber: { in: contractNumbers } },
    include: contractInclude,
    orderBy: { contractNumber: 'asc' },
  });
  const batchTitles = await loadBatchTitles();

  res.json({
    totalFound: contractNumbers.length,
    created,
    alreadyExisted: existing,
    batchNumber,
    batchTitle: batchDisplayTitle({ title: null, filename: req.file.originalname }),
    intake,
    results: loaded.map((c) => summarize(c, batchTitles)),
  });
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
  const batchTitles = await loadBatchTitles();
  res.json(contracts.map((c) => summarize(c, batchTitles)));
});

async function loadBatchTitles(): Promise<Map<number, string>> {
  const batches = await prisma.importBatch.findMany({
    where: { type: 'CONTRACT_LIST', batchNumber: { not: null } },
    orderBy: { importedAt: 'asc' },
  });
  const map = new Map<number, string>();
  for (const b of batches) {
    if (b.batchNumber != null && !map.has(b.batchNumber)) map.set(b.batchNumber, batchDisplayTitle(b));
  }
  return map;
}

// GET /api/contracts/batches — every contract-list upload (and folder-sync
// run) as a numbered batch, with its display title. Registered before
// /:contractNumber so "batches" isn't matched as a contract number.
contractsRouter.get('/batches', async (_req, res) => {
  const batches = await prisma.importBatch.findMany({
    where: { type: 'CONTRACT_LIST', batchNumber: { not: null } },
    orderBy: [{ batchNumber: 'asc' }, { importedAt: 'asc' }],
  });
  res.json(
    batches.map((b) => ({
      batchNumber: b.batchNumber,
      title: batchDisplayTitle(b),
      customTitle: b.title,
      filename: b.filename,
      rowCount: b.rowCount,
      importedAt: b.importedAt,
    })),
  );
});

// PATCH /api/contracts/batches/:batchNumber — rename a batch.
// Body: { title: string }. An empty/blank title resets it to the default
// (the uploaded file's name).
contractsRouter.patch('/batches/:batchNumber', async (req, res) => {
  const batchNumber = Number(req.params.batchNumber);
  if (!Number.isInteger(batchNumber)) return res.status(400).json({ error: 'Invalid batch number' });

  const raw = (req.body as { title?: unknown }).title;
  if (typeof raw !== 'string') return res.status(400).json({ error: 'title must be a string' });
  const title = raw.trim().replace(/\s+/g, ' ');
  if (title.length > MAX_BATCH_TITLE_LENGTH) {
    return res.status(400).json({ error: `Title is too long (max ${MAX_BATCH_TITLE_LENGTH} characters)` });
  }

  const result = await prisma.importBatch.updateMany({
    where: { type: 'CONTRACT_LIST', batchNumber },
    data: { title: title || null },
  });
  if (result.count === 0) return res.status(404).json({ error: `Batch ${batchNumber} not found` });

  const updated = await prisma.importBatch.findFirst({ where: { type: 'CONTRACT_LIST', batchNumber } });
  res.json({
    batchNumber,
    title: updated ? batchDisplayTitle(updated) : title,
    customTitle: updated?.title ?? null,
  });
});

// GET /api/contracts/ledgers.zip[?batchNumber=N | ?contractNumbers=a,b,c] —
// bundle every contract's Tax Payment Ledger into a single ZIP, optionally
// filtered to one upload batch or to an explicit list of contracts.
// Registered before /:contractNumber so "ledgers.zip" isn't matched as a
// contract number.
contractsRouter.get('/ledgers.zip', async (req, res) => {
  const raw = req.query.batchNumber;
  const batchNumber = raw !== undefined ? Number(raw) : undefined;
  const filterByBatch = batchNumber !== undefined && !Number.isNaN(batchNumber);
  const listed =
    typeof req.query.contractNumbers === 'string'
      ? [...new Set(req.query.contractNumbers.split(',').map((n) => n.trim()).filter(Boolean))]
      : null;

  const contracts = await prisma.contract.findMany({
    where: listed ? { contractNumber: { in: listed } } : filterByBatch ? { batchNumber } : {},
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
  let titlePart = '';
  if (filterByBatch) {
    const batch = await prisma.importBatch.findFirst({ where: { type: 'CONTRACT_LIST', batchNumber } });
    // Header-safe: letters, digits, dot, underscore, hyphen only.
    const safe = batch
      ? batchDisplayTitle(batch)
          .replace(/[^A-Za-z0-9._-]+/g, '_')
          .replace(/^_+|_+$/g, '')
          .slice(0, 50)
      : '';
    if (safe) titlePart = `_${safe}`;
  }
  const name = listed
    ? `TaxPaymentLedgers_Selected${listed.length}_${stamp}.zip`
    : filterByBatch
      ? `TaxPaymentLedgers_Batch${batchNumber}${titlePart}_${stamp}.zip`
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

  // Is the ledger on file LedgerFit's latest one? Any clearing document
  // outside the 14 series says it isn't; then look up the LedgerFit session
  // so the page can say what to do (best effort).
  const staleDocs = ledgerSeriesOf(contract);
  const ledgerSeries = {
    isLatest: staleDocs.length === 0,
    nonCurrentCount: staleDocs.length,
    sample: staleDocs.slice(0, 5),
    advice: null as string | null,
    ledgerfitSessionId: null as string | null,
  };
  if (staleDocs.length > 0) {
    const session = await lookupLedgerfitSession(contract.contractNumber);
    ledgerSeries.advice = describeLedgerfitSession(session);
    ledgerSeries.ledgerfitSessionId = session?.sessionId ?? null;
  }

  res.json({
    ledgerSeries,
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

  // ?etb=1[&etbStart=YYYY-MM-DD] — the ETB Calculator's variant: same export,
  // with the buyer treated as ETB from the given start date.
  const asEtb = req.query.etb === '1';
  const etbStart = parseIsoDate(req.query.etbStart);
  const override: ComputationOverride | undefined = asEtb ? etbOverride(etbStart) : undefined;
  const buffer = await buildLedgerBuffer(contract, override);
  const fileName = asEtb ? `ETB_${ledgerFileName(contract.contractNumber)}` : ledgerFileName(contract.contractNumber);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(buffer);
});
