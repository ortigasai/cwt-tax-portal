import { generateEtbStatusExcel } from '../generators/etbStatusExcel';
import crypto from 'crypto';
import { Router } from 'express';
import JSZip from 'jszip';
import { prisma } from '../lib/prisma';
import { uploadMemory } from '../lib/upload';
import { parseIsoDate } from '../lib/isoDate';
import ExcelJS from 'exceljs';
import { parseEtbList } from '../parsers/contractListParser';
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
    // The ETB start date this contract was computed with (its own, else the run's default).
    startDate: isoDay(startDate),
    // Is the analysis done, so the payment ledger can be downloaded?
    analysis: deriveAnalysis(contract),
    buyerName: contract.buyerName,
    tower: contract.tower,
    unit: contract.unit,
    storedClassification: stored.buyerClassification,
    // As recorded on the 1606 — the calculator itself always computes ETB + Installment.
    taxTagging: stored.storedTaxTagging,
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

// { contractNumber: "YYYY-MM-DD" } as stored on a run.
function startsOf(raw: unknown): Record<string, string> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, string>) : {};
}

// The ETB start date for one contract of a run: its own, else the run's default.
function startFor(contractNumber: string, starts: Record<string, string>, fallback: Date | null): Date | null {
  return parseIsoDate(starts[contractNumber]) ?? fallback;
}

function runSummary(run: {
  id: number;
  title: string | null;
  filename: string;
  startDate: Date | null;
  contractNumbers: string[];
  contractStarts?: unknown;
  createdAt: Date;
}) {
  return {
    id: run.id,
    title: runDisplayTitle(run),
    customTitle: run.title,
    filename: run.filename,
    startDate: isoDay(run.startDate),
    contractCount: run.contractNumbers.length,
    perContractStarts: Object.keys(startsOf(run.contractStarts)).length,
    createdAt: run.createdAt.toISOString(),
  };
}

interface EtbJobState {
  id: string;
  status: 'running' | 'done' | 'error';
  // What is being worked on, and how many of how many contracts are through it.
  stage: string;
  done: number;
  total: number;
  startedAt: number;
  result?: unknown;
  error?: string;
}

const jobs = new Map<string, EtbJobState>();

function pruneJobs() {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, j] of jobs) if (j.startedAt < cutoff) jobs.delete(id);
}

async function runEtbJob(
  job: EtbJobState,
  input: {
    filename: string;
    contractNumbers: string[];
    contractStarts: Record<string, string>;
    startDate: Date | null;
    dateWarnings: string[];
  },
): Promise<void> {
  const { contractNumbers, contractStarts, startDate } = input;
  const setStage = (stage: string, done: number, total: number) => {
    job.stage = stage;
    job.done = done;
    job.total = total;
  };
  try {
    // Make sure every contract exists (stubs carry no batch, so they don't
    // show up as an upload batch on the Dashboard).
    let created = 0;
    setStage('Preparing contracts', 0, contractNumbers.length);
    for (const contractNumber of contractNumbers) {
      const existing = await prisma.contract.findUnique({ where: { contractNumber }, select: { id: true } });
      if (!existing) {
        const stub = await prisma.contract.create({ data: { contractNumber } });
        await applyManualOverrideIfAny(stub.id, contractNumber);
        created++;
      }
      job.done++;
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
    if (needData.length > 0) {
      intake = await retrieveDataForContracts(needData, (p) => setStage(p.stage, p.done, p.total));
    }

    // Notary date / SQM / zonal value — empty fields only, so cheap to re-run.
    setStage('Reading CTS notary date and SQM from DOAS', 0, 1);
    const ctsFill = await fillCtsDataForContracts(contractNumbers);

    const loaded = await prisma.contract.findMany({
      where: { contractNumber: { in: contractNumbers } },
      include: contractInclude,
      orderBy: { contractNumber: 'asc' },
    });

    // The analysis of each contract, one by one.
    setStage('Analysing contracts', 0, loaded.length);
    const results = [];
    for (const c of loaded) {
      results.push(summarizeEtb(c, startFor(c.contractNumber, contractStarts, startDate)));
      job.done++;
      // Let progress requests through between contracts.
      await new Promise((r) => setImmediate(r));
    }

    // Remember this run so it shows up on the ETB Dashboard. Only the inputs
    // are stored; results are recomputed from current data when it is opened.
    const run = await prisma.etbRun.create({
      data: { filename: input.filename, startDate, contractNumbers, contractStarts },
    });

    job.result = {
      runId: run.id,
      runTitle: runDisplayTitle(run),
      startDate: isoDay(startDate),
      totalFound: contractNumbers.length,
      created,
      retrievedFor: needData.length,
      intake,
      ctsFilled: ctsFill.filled.length,
      perContractStarts: Object.keys(contractStarts).length,
      errors: [...input.dateWarnings, ...(intake?.errors ?? []), ...ctsFill.errors],
      results,
    };
    job.status = 'done';
  } catch (e) {
    job.error = (e as Error).message;
    job.status = 'error';
  }
}

// POST /api/etb/compute — multipart: file (Excel with a "Contract Number" column
// and, optionally, a "Start Date of ETB" column per contract), startDate
// (optional, YYYY-MM-DD: the default start for rows that have no date).
etbRouter.post('/compute', uploadMemory.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const rawStart = (req.body as { startDate?: unknown }).startDate;
  const hasStart = typeof rawStart === 'string' && rawStart.trim() !== '';
  const startDate = hasStart ? parseIsoDate(rawStart) : null;
  if (hasStart && !startDate) {
    return res.status(400).json({ error: 'ETB start date must be a valid date (YYYY-MM-DD)' });
  }

  const list = await parseEtbList(req.file.buffer);
  const contractNumbers = list.rows.map((r) => r.contractNumber);
  if (contractNumbers.length === 0) {
    return res.status(400).json({ error: 'No contract numbers found in the uploaded file' });
  }
  const contractStarts: Record<string, string> = {};
  const dateWarnings: string[] = [];
  for (const row of list.rows) {
    if (row.startDate) contractStarts[row.contractNumber] = isoDay(row.startDate)!;
    else if (row.badDate !== null) {
      dateWarnings.push(
        `Start date "${row.badDate}" for ${row.contractNumber} is not a valid date — ${startDate ? 'the default start date was used' : 'every payment was treated as ETB'}.`,
      );
    }
  }

  // The work (retrieving data, computing) runs in the background so the page can
  // follow its progress — and survive being navigated away from — via GET /jobs/:id.
  pruneJobs();
  const job: EtbJobState = {
    id: crypto.randomBytes(8).toString('hex'),
    status: 'running',
    stage: 'Preparing contracts',
    done: 0,
    total: contractNumbers.length,
    startedAt: Date.now(),
  };
  jobs.set(job.id, job);
  void runEtbJob(job, {
    filename: req.file.originalname,
    contractNumbers,
    contractStarts,
    startDate,
    dateWarnings,
  });
  res.status(202).json({ jobId: job.id, total: job.total });
});

// GET /api/etb/jobs/:id — progress of a running calculation, and its result once done.
etbRouter.get('/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Calculation not found (the server may have restarted)' });
  res.json({
    status: job.status,
    stage: job.stage,
    done: job.done,
    total: job.total,
    elapsedSeconds: Math.round((Date.now() - job.startedAt) / 1000),
    ...(job.status === 'done' ? { result: job.result } : {}),
    ...(job.status === 'error' ? { error: job.error } : {}),
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
  // With a runId each contract uses the start date saved on that run.
  const runId = Number(req.query.runId);
  const run = Number.isInteger(runId) ? await prisma.etbRun.findUnique({ where: { id: runId } }) : null;
  const starts = run ? startsOf(run.contractStarts) : {};
  const defaultStart = run ? run.startDate : startDate;

  const contracts = await prisma.contract.findMany({
    where: { contractNumber: { in: listed } },
    include: contractInclude,
    orderBy: { contractNumber: 'asc' },
  });
  if (contracts.length === 0) return res.status(404).json({ error: 'No contracts found to export' });

  const zip = new JSZip();
  for (const contract of contracts) {
    try {
      const buffer = await buildLedgerBuffer(contract, etbOverride(startFor(contract.contractNumber, starts, defaultStart)));
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

// GET /api/etb/template.xlsx — the upload template: one row per contract with
// its own ETB start date.
etbRouter.get('/template.xlsx', async (_req, res) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('ETB list');
  ws.addRow(['Contract Number', 'Start Date of ETB']).font = { bold: true };
  ws.getColumn(1).width = 22;
  ws.getColumn(2).width = 22;
  ws.getColumn(2).numFmt = 'mm/dd/yyyy';
  ws.addRow(['2000000000000', new Date(Date.UTC(2026, 0, 1))]);
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="ETB list template.xlsx"');
  res.send(buffer);
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
  const starts = startsOf(run.contractStarts);
  const present = new Set(loaded.map((c) => c.contractNumber));
  res.json({
    run: runSummary(run),
    startDate: isoDay(startDate),
    // Contracts in the run that have since been deleted from the portal.
    missing: run.contractNumbers.filter((n) => !present.has(n)),
    results: loaded.map((c) => summarizeEtb(c, startFor(c.contractNumber, starts, startDate))),
  });
});

// POST /api/etb/runs/:id/status.xlsx — the calculation's status as an Excel file:
// one row per contract (ETB start date, status, analysis, every missing item)
// plus a Summary sheet. Body: { contractNumbers?: string[] } — the rows shown on
// screen (default: the whole run). Recomputed from the contracts' current data.
etbRouter.post('/runs/:id/status.xlsx', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid run id' });
  const run = await prisma.etbRun.findUnique({ where: { id } });
  if (!run) return res.status(404).json({ error: 'Run not found' });

  const raw = (req.body as { contractNumbers?: unknown }).contractNumbers;
  const only = Array.isArray(raw) ? new Set(raw.map((n) => String(n))) : null;
  const wanted = only ? run.contractNumbers.filter((n) => only.has(n)) : run.contractNumbers;

  const loaded = await prisma.contract.findMany({
    where: { contractNumber: { in: wanted } },
    include: contractInclude,
    orderBy: { contractNumber: 'asc' },
  });
  const starts = startsOf(run.contractStarts);
  const present = new Set(loaded.map((c) => c.contractNumber));
  const rows = loaded.map((c) => {
    const r = summarizeEtb(c, startFor(c.contractNumber, starts, run.startDate));
    return {
      contractNumber: r.contractNumber,
      buyerName: r.buyerName,
      tower: r.tower,
      unit: r.unit,
      startDate: r.startDate,
      storedClassification: r.storedClassification,
      storedTagging: r.taxTagging,
      analysisState: r.analysis.state,
      missing: r.analysis.missing,
      status: r.status,
      ctsNotaryDate: r.ctsNotaryDate,
      netTCP: r.netTCP,
      cwtTaxBase: r.cwtTaxBase,
      taxBaseSource: r.taxBaseSource,
      cwtTaxDue: r.cwtTaxDue,
      actualRemitted: r.actualRemitted,
      variance: r.variance,
      totalPenalties: r.totalPenalties,
      primaryDeadline: r.primaryDeadline,
      paymentCount: r.paymentCount,
      paymentsBeforeStart: r.paymentsBeforeStart,
    };
  });
  const buffer = await generateEtbStatusExcel(rows, {
    title: runDisplayTitle(run),
    defaultStart: isoDay(run.startDate),
    ownStarts: wanted.filter((n) => starts[n]).length,
    missingFromPortal: wanted.filter((n) => !present.has(n)),
  });
  const safe = runDisplayTitle(run).replace(/[^\w.\- ]+/g, '_').slice(0, 60);
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="ETB Status - ${safe} - ${stamp}.xlsx"`);
  res.send(buffer);
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
