import { Router } from 'express';
import JSZip from 'jszip';
import { prisma } from '../lib/prisma';
import { uploadMemory } from '../lib/upload';
import { parseIsoDate } from '../lib/isoDate';
import { parseContractList } from '../parsers/contractListParser';
import { retrieveDataForContracts, type IntakeSummary } from '../services/contractIntake';
import { fillCtsDataForContracts } from '../services/ctsDataSync';
import { applyManualOverrideIfAny } from '../services/manualOverrides';
import {
  computeContractExposure,
  ContractWithRelations,
  deriveAnalysis,
  deriveDisplayFields,
  etbOverride,
} from '../services/contractExposureService';
import { buildLedgerBuffer } from './contracts';

// ETB Calculator: take a list of contract numbers and compute each contract's
// CWT exposure as if the buyer were ETB (optionally from a start date) —
// everything else (ledger, CTS notary date/SQM, zonal value, 1606
// remittances) is the data the rest of the portal already retrieves. The
// contract's own stored buyer classification is never changed.

export const etbRouter = Router();

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

function isoDay(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function summarizeEtb(contract: ContractWithRelations, startDate: Date | null) {
  const exposure = computeContractExposure(contract, new Date(), etbOverride(startDate));
  const stored = deriveDisplayFields(contract);
  const startMs = startDate ? startDate.getTime() : null;

  const datedPayments = contract.paymentRecords.filter((p) => !p.isSubtotal && p.paymentDate && toNum(p.totalCollection));
  const beforeStart =
    startMs === null ? 0 : datedPayments.filter((p) => p.paymentDate!.getTime() < startMs).length;

  return {
    contractNumber: contract.contractNumber,
    // Is the analysis done, so the payment ledger can be downloaded?
    analysis: deriveAnalysis(contract),
    buyerName: contract.buyerName,
    tower: contract.tower,
    unit: contract.unit,
    storedClassification: stored.buyerClassification,
    taxTagging: stored.taxTagging,
    ctsNotaryDate: isoDay(contract.ctsNotaryDate),
    netTCP: toNum(contract.netTCP),
    cwtTaxBase: exposure.cwtTaxBase,
    taxBaseSource: exposure.taxBaseSource,
    cwtTaxDue: exposure.cwtTaxDue,
    actualRemitted: exposure.actualRemitted,
    variance: exposure.variance,
    status: exposure.status,
    totalPenalties: exposure.penalties?.totalPenalties ?? (exposure.rowPenaltiesTotal > 0 ? exposure.rowPenaltiesTotal : null),
    primaryDeadline: isoDay(exposure.deadline.primaryDeadline),
    deadlineNote: exposure.deadline.note,
    deadlineCount: exposure.deadline.entries.length,
    paymentCount: datedPayments.length,
    paymentsBeforeStart: beforeStart,
    lines: exposure.perPaymentLines
      .filter((l) => l.paymentDate !== null)
      .map((l) => ({
        paymentDate: isoDay(l.paymentDate),
        principal: l.paymentPrincipal,
        totalCollection: l.totalCollection,
        applicableDeadline: isoDay(l.applicableDeadline),
        shouldBeCwtDue: l.shouldBeCwtDue,
        cwtFileTaxDue: l.cwtFileTaxDue,
        difference: l.difference,
        totalDue: l.totalDue,
        beforeEtbStart: startMs !== null && l.paymentDate !== null && l.paymentDate.getTime() < startMs,
        coveredByBulkRemittance: l.coveredByBulkRemittance,
        paidInAdvance: l.paidInAdvance,
      })),
  };
}

const MAX_TITLE_LENGTH = 120;

// A run's display title: what the user renamed it to, otherwise the uploaded
// file's name without its spreadsheet extension.
function runDisplayTitle(run: { title: string | null; filename: string }): string {
  const custom = run.title?.trim();
  if (custom) return custom;
  return run.filename.replace(/\.(xlsx|xlsm|xls)$/i, '') || run.filename;
}

function runSummary(run: {
  id: number;
  title: string | null;
  filename: string;
  startDate: Date | null;
  contractNumbers: string[];
  createdAt: Date;
}) {
  return {
    id: run.id,
    title: runDisplayTitle(run),
    customTitle: run.title,
    filename: run.filename,
    startDate: isoDay(run.startDate),
    contractCount: run.contractNumbers.length,
    createdAt: run.createdAt.toISOString(),
  };
}

// POST /api/etb/compute — multipart: file (Excel list of contract numbers),
// startDate (optional, YYYY-MM-DD: the date the buyer's ETB status begins).
etbRouter.post('/compute', uploadMemory.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const rawStart = (req.body as { startDate?: unknown }).startDate;
  const hasStart = typeof rawStart === 'string' && rawStart.trim() !== '';
  const startDate = hasStart ? parseIsoDate(rawStart) : null;
  if (hasStart && !startDate) {
    return res.status(400).json({ error: 'ETB start date must be a valid date (YYYY-MM-DD)' });
  }

  const contractNumbers = await parseContractList(req.file.buffer);
  if (contractNumbers.length === 0) {
    return res.status(400).json({ error: 'No contract numbers found in the uploaded file' });
  }

  // Make sure every contract exists (stubs carry no batch, so they don't
  // show up as an upload batch on the Dashboard).
  let created = 0;
  for (const contractNumber of contractNumbers) {
    const existing = await prisma.contract.findUnique({ where: { contractNumber }, select: { id: true } });
    if (existing) continue;
    const stub = await prisma.contract.create({ data: { contractNumber } });
    await applyManualOverrideIfAny(stub.id, contractNumber);
    created++;
  }

  // Retrieve data only for contracts that don't have it yet (no ledger or no
  // 1606 remittances on file) — contracts already loaded are used as-is.
  const known = await prisma.contract.findMany({
    where: { contractNumber: { in: contractNumbers } },
    select: { contractNumber: true, _count: { select: { paymentRecords: true, collectionEvents: true } } },
  });
  const needData = known
    .filter((c) => c._count.paymentRecords === 0 || c._count.collectionEvents === 0)
    .map((c) => c.contractNumber);
  let intake: IntakeSummary | null = null;
  if (needData.length > 0) intake = await retrieveDataForContracts(needData);

  // Notary date / SQM / zonal value — empty fields only, so cheap to re-run.
  const ctsFill = await fillCtsDataForContracts(contractNumbers);

  const loaded = await prisma.contract.findMany({
    where: { contractNumber: { in: contractNumbers } },
    include: contractInclude,
    orderBy: { contractNumber: 'asc' },
  });

  // Remember this run so it shows up on the ETB Dashboard. Only the inputs
  // are stored; results are recomputed from current data when it is opened.
  const run = await prisma.etbRun.create({
    data: { filename: req.file.originalname, startDate, contractNumbers },
  });

  res.json({
    runId: run.id,
    runTitle: runDisplayTitle(run),
    startDate: isoDay(startDate),
    totalFound: contractNumbers.length,
    created,
    retrievedFor: needData.length,
    intake,
    ctsFilled: ctsFill.filled.length,
    errors: [...(intake?.errors ?? []), ...ctsFill.errors],
    results: loaded.map((c) => summarizeEtb(c, startDate)),
  });
});

// GET /api/etb/ledgers.zip?contractNumbers=a,b,c[&startDate=YYYY-MM-DD] — the
// ETB variant of every listed contract's Tax Payment Ledger, bundled into one
// ZIP (the same files as each contract's "Download ETB ledger" button).
etbRouter.get('/ledgers.zip', async (req, res) => {
  const listed =
    typeof req.query.contractNumbers === 'string'
      ? [...new Set(req.query.contractNumbers.split(',').map((n) => n.trim()).filter(Boolean))]
      : [];
  if (listed.length === 0) return res.status(400).json({ error: 'contractNumbers is required' });
  const startDate = parseIsoDate(req.query.startDate);

  const contracts = await prisma.contract.findMany({
    where: { contractNumber: { in: listed } },
    include: contractInclude,
    orderBy: { contractNumber: 'asc' },
  });
  if (contracts.length === 0) return res.status(404).json({ error: 'No contracts found to export' });

  const zip = new JSZip();
  for (const contract of contracts) {
    try {
      const buffer = await buildLedgerBuffer(contract, etbOverride(startDate));
      zip.file(`ETB_TaxPaymentLedger_${contract.contractNumber}.xlsx`, buffer);
    } catch (err) {
      zip.file(`ERROR_${contract.contractNumber}.txt`, `Could not generate ledger: ${(err as Error).message}`);
    }
  }
  const content = await zip.generateAsync({ type: 'nodebuffer' });
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="ETB_TaxPaymentLedgers_${contracts.length}_${stamp}.zip"`);
  res.send(content);
});

// GET /api/etb/runs — every ETB calculation, newest first (the ETB Dashboard).
etbRouter.get('/runs', async (_req, res) => {
  const runs = await prisma.etbRun.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(runs.map(runSummary));
});

// GET /api/etb/runs/:id — one run with its results recomputed from the
// contracts' current data (same shape as the compute response's results).
etbRouter.get('/runs/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid run id' });
  const run = await prisma.etbRun.findUnique({ where: { id } });
  if (!run) return res.status(404).json({ error: 'Run not found' });

  const loaded = await prisma.contract.findMany({
    where: { contractNumber: { in: run.contractNumbers } },
    include: contractInclude,
    orderBy: { contractNumber: 'asc' },
  });
  const startDate = run.startDate;
  const present = new Set(loaded.map((c) => c.contractNumber));
  res.json({
    run: runSummary(run),
    startDate: isoDay(startDate),
    // Contracts in the run that have since been deleted from the portal.
    missing: run.contractNumbers.filter((n) => !present.has(n)),
    results: loaded.map((c) => summarizeEtb(c, startDate)),
  });
});

// PATCH /api/etb/runs/:id — rename. Body: { title }. Blank resets to the file name.
etbRouter.patch('/runs/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid run id' });
  const raw = (req.body as { title?: unknown }).title;
  if (typeof raw !== 'string') return res.status(400).json({ error: 'title must be a string' });
  const title = raw.trim().replace(/\s+/g, ' ');
  if (title.length > MAX_TITLE_LENGTH) {
    return res.status(400).json({ error: `Title must be ${MAX_TITLE_LENGTH} characters or fewer` });
  }
  try {
    const run = await prisma.etbRun.update({ where: { id }, data: { title: title || null } });
    res.json(runSummary(run));
  } catch {
    res.status(404).json({ error: 'Run not found' });
  }
});

// DELETE /api/etb/runs/:id — forget a run (the contracts themselves are untouched).
etbRouter.delete('/runs/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid run id' });
  const result = await prisma.etbRun.deleteMany({ where: { id } });
  if (result.count === 0) return res.status(404).json({ error: 'Run not found' });
  res.json({ deleted: result.count });
});
