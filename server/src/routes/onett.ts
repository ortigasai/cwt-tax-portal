import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../lib/prisma';
import { UPLOADS_DIR } from '../lib/fileStorage';
import { extractPdfPageImages } from '../lib/pdfPages';
import {
  accountToRows,
  buildSummaryWorkbook,
  reviewFlags,
  summaryStats,
  type OnettAccount,
} from '../services/onettSummary';
import { assembleAccounts, autoReadingReady, readPages } from '../services/onettExtractor';

// ONETT Summary: upload scanned ONETT computation-sheet packets (one PDF with
// many ONETTs, or many PDFs) and get the ONETT Summary workbook. Each upload is
// saved as a summary on the ONETT Dashboard.

export const onettRouter = Router();

const MAX_TITLE_LENGTH = 120;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 150 * 1024 * 1024, files: 200 },
});

interface SourceFile {
  name: string;
  pages: number;
  startPage: number;
}

function summaryDir(id: number): string {
  return path.join(UPLOADS_DIR, 'onett', String(id));
}

function pageFile(id: number, page: number): string {
  return path.join(summaryDir(id), `p${String(page).padStart(3, '0')}.jpg`);
}

type SummaryRecord = {
  id: number;
  title: string | null;
  files: unknown;
  pageCount: number;
  status: string;
  statusNote: string | null;
  accounts: unknown;
  createdAt: Date;
  updatedAt: Date;
};

function filesOf(r: SummaryRecord): SourceFile[] {
  return Array.isArray(r.files) ? (r.files as unknown as SourceFile[]) : [];
}

function accountsOf(r: SummaryRecord): OnettAccount[] {
  return Array.isArray(r.accounts) ? (r.accounts as unknown as OnettAccount[]) : [];
}

function displayTitle(r: SummaryRecord): string {
  const custom = r.title?.trim();
  if (custom) return custom;
  const files = filesOf(r);
  if (files.length === 0) return `ONETT Summary #${r.id}`;
  const first = files[0].name.replace(/\.pdf$/i, '');
  return files.length > 1 ? `${first} +${files.length - 1} more` : first;
}

function summaryOf(r: SummaryRecord) {
  const accounts = accountsOf(r);
  return {
    id: r.id,
    title: displayTitle(r),
    customTitle: r.title,
    files: filesOf(r),
    pageCount: r.pageCount,
    status: r.status,
    statusNote: r.statusNote,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    stats: summaryStats(accounts),
  };
}

function detailOf(r: SummaryRecord) {
  const accounts = accountsOf(r);
  return {
    summary: summaryOf(r),
    accounts: accounts.map((a) => ({ ...a, rows: accountToRows(a), reviewFlags: reviewFlags(a) })),
  };
}

// A job that was PROCESSING when the server last stopped will never finish.
async function failStaleProcessing(): Promise<void> {
  const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000);
  await prisma.onettSummary.updateMany({
    where: { status: 'PROCESSING', updatedAt: { lt: cutoff } },
    data: { status: 'FAILED', statusNote: 'Extraction did not finish (server restarted?). Re-run extraction.' },
  });
}

// Reads every saved page image of a summary with the vision model and stores
// the assembled accounts. Runs in the background after the upload response.
async function runExtraction(id: number, pageCount: number): Promise<void> {
  try {
    const pages: { page: number; jpeg: Buffer; file: string }[] = [];
    for (let p = 1; p <= pageCount; p++) {
      const file = pageFile(id, p);
      pages.push({ page: p, jpeg: fs.readFileSync(file), file });
    }
    const { readings, failedPages } = await readPages(pages, (done, total) => {
      void prisma.onettSummary
        .update({ where: { id }, data: { statusNote: `Reading page ${done} of ${total}…` } })
        .catch(() => undefined);
    });
    const accounts = assembleAccounts(readings);
    const note =
      failedPages.length > 0
        ? `${accounts.length} ONETT sheet(s) read; ${failedPages.length} page(s) could not be read (${failedPages.slice(0, 10).join(', ')}${failedPages.length > 10 ? ', …' : ''}).`
        : `${accounts.length} ONETT sheet(s) read from ${pageCount} page(s).`;
    await prisma.onettSummary.update({
      where: { id },
      data: { accounts: accounts as unknown as object, status: 'READY', statusNote: note },
    });
  } catch (err) {
    await prisma.onettSummary
      .update({ where: { id }, data: { status: 'FAILED', statusNote: `Extraction failed: ${(err as Error).message}` } })
      .catch(() => undefined);
  }
}

// GET /api/onett/status — can pages be read automatically right now (and how)?
onettRouter.get('/status', async (_req, res) => {
  const r = await autoReadingReady();
  res.json({ autoExtraction: r.ready, mode: r.mode, note: r.note });
});

// GET /api/onett/summaries — every ONETT summary, newest first.
onettRouter.get('/summaries', async (_req, res) => {
  await failStaleProcessing();
  const rows = await prisma.onettSummary.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(rows.map(summaryOf));
});

// GET /api/onett/summaries/:id — one summary with its accounts and rows.
onettRouter.get('/summaries/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid summary id' });
  const rec = await prisma.onettSummary.findUnique({ where: { id } });
  if (!rec) return res.status(404).json({ error: 'Summary not found' });
  res.json(detailOf(rec));
});

// POST /api/onett/summaries — multipart: files[] (PDFs), title (optional).
onettRouter.post('/summaries', upload.array('files', 200), async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const pdfs = files.filter((f) => f.mimetype === 'application/pdf' || /\.pdf$/i.test(f.originalname));
  if (pdfs.length === 0) return res.status(400).json({ error: 'Upload at least one PDF file' });

  const rawTitle = (req.body as { title?: unknown }).title;
  const title = typeof rawTitle === 'string' ? rawTitle.trim().replace(/\s+/g, ' ').slice(0, MAX_TITLE_LENGTH) : '';

  // Pull the page images out of every PDF first so unreadable files fail fast.
  const sources: SourceFile[] = [];
  const images: Buffer[] = [];
  const problems: string[] = [];
  for (const f of pdfs) {
    const { pages, unsupportedImages } = extractPdfPageImages(f.buffer);
    if (pages.length === 0) {
      problems.push(`${f.originalname}: no scanned page images found${unsupportedImages ? ' (unsupported image format)' : ''}`);
      continue;
    }
    if (unsupportedImages > 0) problems.push(`${f.originalname}: ${unsupportedImages} image(s) skipped (unsupported format)`);
    sources.push({ name: f.originalname, pages: pages.length, startPage: images.length + 1 });
    for (const p of pages) images.push(p.jpeg);
  }
  if (images.length === 0) return res.status(400).json({ error: problems.join('; ') || 'No pages could be read' });

  const readiness = await autoReadingReady();
  const auto = readiness.ready;
  const rec = await prisma.onettSummary.create({
    data: {
      title: title || null,
      files: sources as unknown as object,
      pageCount: images.length,
      status: auto ? 'PROCESSING' : 'AWAITING_EXTRACTION',
      statusNote: auto ? 'Reading pages…' : `Pages saved — awaiting data. ${readiness.note}`,
    },
  });
  fs.mkdirSync(summaryDir(rec.id), { recursive: true });
  images.forEach((jpeg, i) => fs.writeFileSync(pageFile(rec.id, i + 1), jpeg));

  if (auto) void runExtraction(rec.id, images.length);
  res.status(201).json({ ...summaryOf(rec), problems });
});

// POST /api/onett/summaries/import — JSON { title?, accounts: OnettAccount[] }:
// a summary built from already-extracted records (also used to complete an
// upload that is awaiting extraction when `summaryId` is given).
onettRouter.post('/summaries/import', async (req, res) => {
  const body = req.body as { title?: unknown; accounts?: unknown; summaryId?: unknown };
  const accounts = validAccounts(body.accounts);
  if (!accounts) return res.status(400).json({ error: 'accounts must be a non-empty array of ONETT records (docket, buyers, lines, …)' });

  if (body.summaryId !== undefined && body.summaryId !== null) {
    const id = Number(body.summaryId);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid summaryId' });
    try {
      const rec = await prisma.onettSummary.update({
        where: { id },
        data: {
          accounts: accounts as unknown as object,
          status: 'READY',
          statusNote: `${accounts.length} ONETT sheet(s) imported.`,
        },
      });
      return res.json(detailOf(rec));
    } catch {
      return res.status(404).json({ error: 'Summary not found' });
    }
  }

  const title = typeof body.title === 'string' ? body.title.trim().replace(/\s+/g, ' ').slice(0, MAX_TITLE_LENGTH) : '';
  const rec = await prisma.onettSummary.create({
    data: {
      title: title || null,
      accounts: accounts as unknown as object,
      status: 'READY',
      statusNote: `${accounts.length} ONETT sheet(s) imported.`,
    },
  });
  res.status(201).json(detailOf(rec));
});

function validAccounts(raw: unknown): OnettAccount[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  for (const a of raw) {
    if (!a || typeof a !== 'object') return null;
    const r = a as Record<string, unknown>;
    if (typeof r.docket !== 'string' || !r.docket.trim()) return null;
    if (!Array.isArray(r.buyers) || !Array.isArray(r.lines)) return null;
  }
  return raw as OnettAccount[];
}

// PATCH /api/onett/summaries/:id — rename ({ title }) and/or replace the
// accounts after corrections ({ accounts }).
onettRouter.patch('/summaries/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid summary id' });
  const body = req.body as { title?: unknown; accounts?: unknown };
  const data: { title?: string | null; accounts?: object } = {};
  if (body.title !== undefined) {
    if (typeof body.title !== 'string') return res.status(400).json({ error: 'title must be a string' });
    const title = body.title.trim().replace(/\s+/g, ' ');
    if (title.length > MAX_TITLE_LENGTH) {
      return res.status(400).json({ error: `Title must be ${MAX_TITLE_LENGTH} characters or fewer` });
    }
    data.title = title || null;
  }
  if (body.accounts !== undefined) {
    const accounts = validAccounts(body.accounts);
    if (!accounts) return res.status(400).json({ error: 'accounts must be a non-empty array of ONETT records' });
    data.accounts = accounts as unknown as object;
  }
  if (Object.keys(data).length === 0) return res.status(400).json({ error: 'Nothing to update' });
  try {
    const rec = await prisma.onettSummary.update({ where: { id }, data });
    res.json(detailOf(rec));
  } catch {
    res.status(404).json({ error: 'Summary not found' });
  }
});

// POST /api/onett/summaries/:id/extract — (re)run automatic reading on the
// saved page images.
onettRouter.post('/summaries/:id/extract', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid summary id' });
  const readiness = await autoReadingReady();
  if (!readiness.ready) return res.status(409).json({ error: readiness.note });
  const rec = await prisma.onettSummary.findUnique({ where: { id } });
  if (!rec) return res.status(404).json({ error: 'Summary not found' });
  if (rec.pageCount === 0) return res.status(409).json({ error: 'This summary has no saved pages to read' });
  const updated = await prisma.onettSummary.update({
    where: { id },
    data: { status: 'PROCESSING', statusNote: 'Reading pages…' },
  });
  void runExtraction(id, rec.pageCount);
  res.json(summaryOf(updated));
});

// POST /api/onett/summaries/delete — bulk delete. Body: { ids: number[] }.
onettRouter.post('/summaries/delete', async (req, res) => {
  const raw = (req.body as { ids?: unknown }).ids;
  const ids = Array.isArray(raw) ? raw.map(Number).filter((n) => Number.isInteger(n)) : [];
  if (ids.length === 0) return res.status(400).json({ error: 'ids must be a non-empty array of summary ids' });
  const result = await prisma.onettSummary.deleteMany({ where: { id: { in: ids } } });
  for (const id of ids) fs.rmSync(summaryDir(id), { recursive: true, force: true });
  res.json({ deleted: result.count });
});

// POST /api/onett/summaries/:id/remove-accounts — drop ONETT records from a
// summary. Body: { dockets: string[] }.
onettRouter.post('/summaries/:id/remove-accounts', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid summary id' });
  const raw = (req.body as { dockets?: unknown }).dockets;
  const dockets = Array.isArray(raw) ? raw.filter((d): d is string => typeof d === 'string') : [];
  if (dockets.length === 0) return res.status(400).json({ error: 'dockets must be a non-empty array' });
  const rec = await prisma.onettSummary.findUnique({ where: { id } });
  if (!rec) return res.status(404).json({ error: 'Summary not found' });
  const drop = new Set(dockets);
  const before = accountsOf(rec);
  const kept = before.filter((a) => !drop.has(a.docket));
  const updated = await prisma.onettSummary.update({
    where: { id },
    data: { accounts: kept as unknown as object, statusNote: `${before.length - kept.length} ONETT record(s) removed.` },
  });
  res.json(detailOf(updated));
});

// DELETE /api/onett/summaries/:id
onettRouter.delete('/summaries/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid summary id' });
  const result = await prisma.onettSummary.deleteMany({ where: { id } });
  if (result.count === 0) return res.status(404).json({ error: 'Summary not found' });
  fs.rmSync(summaryDir(id), { recursive: true, force: true });
  res.json({ deleted: result.count });
});

// GET /api/onett/summaries/:id/export.xlsx — the ONETT Summary workbook.
onettRouter.get('/summaries/:id/export.xlsx', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid summary id' });
  const rec = await prisma.onettSummary.findUnique({ where: { id } });
  if (!rec) return res.status(404).json({ error: 'Summary not found' });
  const accounts = accountsOf(rec);
  if (accounts.length === 0) return res.status(409).json({ error: 'This summary has no ONETT records yet' });
  const buffer = await buildSummaryWorkbook(accounts);
  const safe = displayTitle(rec).replace(/[^\w.\- ]+/g, '_').slice(0, 80);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  res.setHeader('Content-Disposition', `attachment; filename="ONETT Summary - ${safe} - ${stamp}.xlsx"`);
  res.send(buffer);
});

// GET /api/onett/summaries/:id/pages/:page — the scanned page image.
onettRouter.get('/summaries/:id/pages/:page', (req, res) => {
  const id = Number(req.params.id);
  const page = Number(req.params.page);
  if (!Number.isInteger(id) || !Number.isInteger(page) || page < 1) {
    return res.status(400).json({ error: 'Invalid page' });
  }
  const file = pageFile(id, page);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Page not found' });
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  fs.createReadStream(file).pipe(res);
});
