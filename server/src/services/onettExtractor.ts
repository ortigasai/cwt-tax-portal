
// Reads scanned ONETT packet pages with a vision model and assembles one
// OnettAccount per computation sheet. Two ways to reach a model, no setup in
// the code itself:
//   - "api": ANTHROPIC_API_KEY is set (Messages API).
//   - "cli": the Claude Code executable on this machine, signed in with
//     `claude auth login` — uses the signed-in Claude account, no key needed.
// With neither, uploads wait as AWAITING_EXTRACTION for a manual import.

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import type { OnettAccount, OnettLine } from './onettSummary';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

// Claude Code: CLAUDE_CLI_PATH, else %USERPROFILE%\claude-cli\claude.exe, else
// the newest copy under the desktop app's folder.
export function findClaudeCli(): string | null {
  const explicit = process.env.CLAUDE_CLI_PATH?.trim();
  if (explicit) return fs.existsSync(explicit) ? explicit : null;
  // A plain copy kept in the user's profile (the desktop app's own folder is
  // not always visible to other programs).
  const home = process.env.USERPROFILE ?? process.env.HOME;
  if (home) {
    const copy = path.join(home, 'claude-cli', process.platform === 'win32' ? 'claude.exe' : 'claude');
    if (fs.existsSync(copy)) return copy;
  }
  const appData = process.env.APPDATA;
  if (appData) {
    const root = path.join(appData, 'Claude', 'claude-code');
    try {
      const versions = fs
        .readdirSync(root)
        .filter((v) => /^\d+(\.\d+)*$/.test(v))
        .sort((x, y) => x.localeCompare(y, undefined, { numeric: true }))
        .reverse();
      for (const v of versions) {
        for (const hash of fs.readdirSync(path.join(root, v))) {
          const exe = path.join(root, v, hash, process.platform === 'win32' ? 'claude.exe' : 'claude');
          if (fs.existsSync(exe)) return exe;
        }
      }
    } catch {
      /* no desktop-app install */
    }
  }
  return null;
}

export type VisionMode = 'api' | 'cli' | null;

export function visionMode(): VisionMode {
  if (process.env.ANTHROPIC_API_KEY?.trim()) return 'api';
  if (findClaudeCli()) return 'cli';
  return null;
}

let loginCache: { at: number; ok: boolean } | null = null;

// Is the local Claude Code signed in? (cached briefly — `auth status` spawns a process)
export async function cliSignedIn(force = false): Promise<boolean> {
  if (!force && loginCache && Date.now() - loginCache.at < 30_000) return loginCache.ok;
  const exe = findClaudeCli();
  if (!exe) return false;
  const ok = await new Promise<boolean>((resolve) => {
    execFile(exe, ['auth', 'status'], { timeout: 20_000, windowsHide: true }, (err, stdout) => {
      if (err && !stdout) return resolve(false);
      try {
        resolve(Boolean((JSON.parse(stdout) as { loggedIn?: boolean }).loggedIn));
      } catch {
        resolve(false);
      }
    });
  });
  loginCache = { at: Date.now(), ok };
  return ok;
}

// Can pages be read automatically right now?
export async function autoReadingReady(): Promise<{ mode: VisionMode; ready: boolean; note: string }> {
  const mode = visionMode();
  if (mode === 'api') return { mode, ready: true, note: 'Pages are read automatically after upload (API key).' };
  if (mode === 'cli') {
    if (await cliSignedIn()) {
      return { mode, ready: true, note: 'Pages are read automatically after upload (signed-in Claude on this PC).' };
    }
    return {
      mode,
      ready: false,
      note: 'Claude is installed on this PC but not signed in for the portal. Run "claude auth login" once to enable automatic reading.',
    };
  }
  return { mode, ready: false, note: 'No reader is available on this server; uploads wait for a manual import.' };
}

// Kept for callers that only need "is there a reader at all".
export function visionConfigured(): boolean {
  return visionMode() !== null;
}

const PROMPT = `You are reading one scanned page from a BIR "ONETT" audit packet for a real-estate sale. Handwriting may appear on any page - read it too.
Classify the page and return ONLY one JSON object (no prose, no markdown fence).

pageType is one of:
- "computation_sheet": the "ONETT COMPUTATION SHEET - EXPANDED WITHHOLDING TAX (EWT) and DOCUMENTARY STAMP TAX (DST)" form (Annex B-4).
- "schedule": a spreadsheet-style listing of installment payments with DATE OF PAYMENT, DUE DATE, REMITTANCE DATE, NUMBER OF DAYS DELAY, PRINCIPAL, EWT DUE, SURCHARGE, INTEREST, COMPROMISE.
- "iris": a BIR IRIS "View Taxpayer" screenshot (may be rotated).
- "other": anything else (1606 remittance listing, cover page, blank).

Every page type: "docket" = the docket label for the packet. On a computation sheet it is the printed "P <no>" next to "BATCH <letter>" at the top right, formatted as P + batch letter + number (e.g. "P33", "PB16", "PC8"; batch letter only when printed); on other pages it is the handwritten label (e.g. "PC36") if one is written, else null.

computation_sheet adds:
{"sheetDate": string|null, "sellerName": string, "buyers": [{"name": string, "tin": string|null, "address": string|null}] (skip empty/"0" buyers),
 "dateOfTransaction": string|null, "dueDateCgt": string|null, "dueDateDst": string|null,
 "lines": [{"octTct": string|null, "td": string|null, "location": string, "class": "RC"|"PS"|string, "area": number, "zvPerSqm": number, "zv": number, "fmv": number}] (one per property row with area > 0; the location text can continue on following rows),
 "sellingPrice": number, "totalZv": number, "totalFmv": number, "totalArea": number, "taxBase": number,
 "cgt": {"rate": number (0.05 for 5%), "perAudit": number, "taxPaid": number, "taxPaidDate": string|null, "stillDue": number, "surcharge": number, "interest": number, "compromise": number, "total": number},
 "dst": {"base": number, "perAudit": number, "paid": number, "paidDate": string|null, "stillDue": number, "surcharge": number, "interest": number, "compromise": number},
 "typedNote": string|null (e.g. "ENGAGED IN BUSINESS" / "NOT ENGAGED IN BUSINESS DO 49-12" printed beside the CGT amount),
 "cts": string|null (date next to "CTS"), "paymentTerms": string|null,
 "handwrittenNotes": [string] (every handwritten mark on the sheet, e.g. "W/ IRIS", "NO IRIS")}
Dates as printed. Numbers without commas; "-" or blank = 0.

schedule adds: {"remittanceDate": string|null, "totals": {"principal": number, "ewtDue": number, "surcharge": number, "interest": number, "compromise": number}} - the totals are the bottom row.

iris adds: {"taxpayerName": string|null, "tin": string|null, "tinStatus": string|null, "taxpayerType": string|null, "taxpayerGroup": string|null, "rdo": string|null,
 "businesses": [{"name": string, "registrationDate": string|null, "line": string|null, "status": string|null}]}

If a value is unreadable use null (never guess).`;

export interface PageReading {
  page: number;
  pageType: 'computation_sheet' | 'schedule' | 'iris' | 'other';
  docket: string | null;
  // Remaining keys depend on pageType (see PROMPT).
  [k: string]: unknown;
}

function stripJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON in model reply');
  return JSON.parse(text.slice(start, end + 1));
}

async function readPageApi(jpeg: Buffer, page: number, signal?: AbortSignal): Promise<PageReading> {
  const key = process.env.ANTHROPIC_API_KEY!.trim();
  const model = process.env.ONETT_VISION_MODEL?.trim() || 'claude-sonnet-5-5';
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        signal,
        headers: { 'x-api-key': key, 'anthropic-version': API_VERSION, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } },
                { type: 'text', text: PROMPT },
              ],
            },
          ],
        }),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`Model API ${res.status}`);
      if (!res.ok) throw Object.assign(new Error(`Model API ${res.status}: ${(await res.text()).slice(0, 300)}`), { fatal: true });
      const body = (await res.json()) as { content?: { type: string; text?: string }[] };
      const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
      return toReading(stripJson(text) as Record<string, unknown>, page);
    } catch (err) {
      lastError = err as Error;
      if ((err as { fatal?: boolean }).fatal) break;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastError ?? new Error('Model call failed');
}

function toReading(parsed: Record<string, unknown>, page: number): PageReading {
  const pageType = ['computation_sheet', 'schedule', 'iris'].includes(String(parsed.pageType))
    ? (parsed.pageType as PageReading['pageType'])
    : 'other';
  return { ...parsed, page, pageType, docket: typeof parsed.docket === 'string' ? parsed.docket : null };
}

// One page through the local Claude Code (headless, Read tool only).
async function readPageCli(file: string, page: number): Promise<PageReading> {
  const exe = findClaudeCli();
  if (!exe) throw new Error('Claude Code was not found on this machine');
  const prompt = `${PROMPT}\n\nThe page image to read is the file: ${file}\nUse the Read tool to view it, then reply with only the JSON object.`;
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const stdout = await new Promise<string>((resolve, reject) => {
        execFile(
          exe,
          ['-p', prompt, '--allowedTools', 'Read', '--add-dir', path.dirname(file), '--output-format', 'json', '--max-turns', '5'],
          { cwd: path.dirname(file), timeout: 5 * 60_000, maxBuffer: 20 * 1024 * 1024, windowsHide: true },
          (err, out) => (err && !out ? reject(err) : resolve(out)),
        );
      });
      const envelope = JSON.parse(stdout) as { is_error?: boolean; result?: string };
      if (envelope.is_error || typeof envelope.result !== 'string') {
        const msg = envelope.result ?? 'Claude returned an error';
        throw Object.assign(new Error(msg), { fatal: /not logged in|login/i.test(msg) });
      }
      return toReading(stripJson(envelope.result) as Record<string, unknown>, page);
    } catch (err) {
      lastError = err as Error;
      if ((err as { fatal?: boolean }).fatal) break;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw lastError ?? new Error('Claude Code could not read the page');
}

// Reads every page (a few at a time) and reports progress.
export async function readPages(
  pages: { page: number; jpeg: Buffer; file: string }[],
  onProgress: (done: number, total: number) => void,
  concurrency = Number(process.env.ONETT_READ_CONCURRENCY) || 3,
): Promise<{ readings: PageReading[]; failedPages: number[] }> {
  const mode = visionMode();
  if (!mode) throw new Error('No automatic reader is available');
  const readings: PageReading[] = [];
  const failedPages: number[] = [];
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < pages.length) {
      const p = pages[next++];
      try {
        readings.push(mode === 'api' ? await readPageApi(p.jpeg, p.page) : await readPageCli(p.file, p.page));
      } catch {
        failedPages.push(p.page);
      }
      onProgress(++done, pages.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, pages.length) }, worker));
  readings.sort((a, b) => a.page - b.page);
  return { readings, failedPages: failedPages.sort((a, b) => a - b) };
}

const n = (v: unknown): number => {
  const x = typeof v === 'number' ? v : Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(x) ? x : 0;
};
const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function normalizeDocket(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /^\s*P\s*[- ]?\s*([A-Z]?)\s*[- ]?\s*(\d+)\s*$/i.exec(raw.replace(/\bbatch\b/i, '').trim());
  if (!m) return raw.trim().toUpperCase().replace(/\s+/g, '');
  return `P${m[1].toUpperCase()}${Number(m[2])}`;
}

function irisSummary(readings: PageReading[]): string | null {
  const parts: string[] = [];
  for (const r of readings) {
    if (r.pageType !== 'iris') continue;
    const name = s(r.taxpayerName);
    const businesses = Array.isArray(r.businesses) ? (r.businesses as Record<string, unknown>[]) : [];
    const biz = businesses.length
      ? businesses
          .map((b) => `${s(b.name) ?? 'business'}${s(b.registrationDate) ? ` (reg. ${s(b.registrationDate)})` : ''}${s(b.status) ? ` ${s(b.status)}` : ''}`)
          .join('; ')
      : s(r.taxpayerType) ?? 'no business registration shown';
    const tin = s(r.tinStatus) && !/active/i.test(s(r.tinStatus)!) ? ` [TIN ${s(r.tinStatus)}]` : '';
    parts.push(`${name ?? 'taxpayer'}: ${biz}${tin}`);
  }
  return parts.length ? parts.join(' | ') : null;
}

// Turns the per-page readings into accounts: each computation sheet opens a
// packet; schedule / IRIS / other pages that follow belong to it (a handwritten
// docket label that names an earlier packet re-attaches the page there).
export function assembleAccounts(readings: PageReading[]): OnettAccount[] {
  interface Packet {
    sheet: PageReading;
    docket: string;
    pages: PageReading[];
  }
  const packets: Packet[] = [];
  const byDocket = new Map<string, Packet>();
  let current: Packet | null = null;
  for (const r of readings) {
    if (r.pageType === 'computation_sheet') {
      const docket = normalizeDocket(r.docket) ?? `PAGE${r.page}`;
      current = { sheet: r, docket, pages: [] };
      packets.push(current);
      byDocket.set(docket, current);
      continue;
    }
    const label = normalizeDocket(r.docket);
    const target = (label && byDocket.get(label)) || current;
    if (target) target.pages.push(r);
  }

  return packets.map(({ sheet, docket, pages }) => {
    const lines: OnettLine[] = (Array.isArray(sheet.lines) ? (sheet.lines as Record<string, unknown>[]) : []).map((l) => ({
      location: s(l.location) ?? '',
      class: s(l.class) ?? '',
      area: n(l.area),
      zvPerSqm: n(l.zvPerSqm),
      zv: n(l.zv),
      fmv: n(l.fmv),
    }));
    const buyersRaw = Array.isArray(sheet.buyers) ? (sheet.buyers as Record<string, unknown>[]) : [];
    const buyers = buyersRaw.map((b) => s(b.name)).filter((x): x is string => !!x);
    const tins = buyersRaw.map((b) => s(b.tin)).filter((x): x is string => !!x);
    const cgt = (sheet.cgt ?? {}) as Record<string, unknown>;
    const dst = (sheet.dst ?? {}) as Record<string, unknown>;
    const handwritten = (Array.isArray(sheet.handwrittenNotes) ? sheet.handwrittenNotes : []).filter(
      (x): x is string => typeof x === 'string',
    );
    const remarks = handwritten.find((h) => /iris/i.test(h)) ?? null;
    const ewtDue = n(cgt.perAudit);
    const ewtPaid = n(cgt.taxPaid);
    const flags: string[] = [];
    const dueDst = s(sheet.dueDateDst);
    const paidDst = s(dst.paidDate);
    if (dueDst && paidDst && Date.parse(paidDst) > Date.parse(dueDst) && n(dst.surcharge) + n(dst.interest) + n(dst.compromise) === 0) {
      flags.push(`DST paid ${paidDst} after DST due date ${dueDst} but no DST penalty computed on the sheet`);
    }
    const typed = s(sheet.typedNote);
    const rate = n(cgt.rate) || 0.05;
    if (typed && /not\s+engaged/i.test(typed) && rate < 0.06) {
      flags.push(`Sheet note says "${typed}" but the ${(rate * 100).toFixed(0)}% rate was applied`);
    }
    if (!typed) flags.push('No engaged / not-engaged note on the sheet');
    const scheduleTotals = pages.find((p) => p.pageType === 'schedule')?.totals as Record<string, unknown> | undefined;
    if (scheduleTotals && Math.abs(n(scheduleTotals.ewtDue) - ewtDue) > 0.011) {
      flags.push(`Schedule EWT total ${n(scheduleTotals.ewtDue).toFixed(2)} differs from the sheet (${ewtDue.toFixed(2)})`);
    }
    return {
      docket,
      batch: /^P([A-Z])\d/.exec(docket)?.[1] ?? null,
      sheetPage: sheet.page,
      sheetDate: s(sheet.sheetDate) ?? undefined,
      buyers,
      tins,
      lines,
      zvTotal: n(sheet.totalZv),
      fmvTotal: n(sheet.totalFmv),
      sp: n(sheet.sellingPrice),
      areaTotal: n(sheet.totalArea),
      rate,
      taxBase: n(sheet.taxBase),
      ewtDue,
      ewtPaid,
      ewtPaidDate: s(cgt.taxPaidDate),
      ewtShort: n(cgt.stillDue),
      surcharge: n(cgt.surcharge),
      interest: n(cgt.interest),
      compromise: n(cgt.compromise),
      totalCgt: n(cgt.total),
      dstBase: n(dst.base),
      dstDue: n(dst.perAudit),
      dstPaid: n(dst.paid),
      dstPaidDate: paidDst,
      dstShort: n(dst.stillDue),
      dstPenalties: n(dst.surcharge) + n(dst.interest) + n(dst.compromise),
      sheetNote: typed,
      cts: s(sheet.cts),
      terms: s(sheet.paymentTerms),
      schedulePages: pages.filter((p) => p.pageType === 'schedule').map((p) => p.page),
      irisPages: pages.filter((p) => p.pageType === 'iris').map((p) => p.page),
      irisFinding: irisSummary(pages),
      remarksHandwritten: remarks,
      handwritten,
      flags,
    } satisfies OnettAccount;
  });
}
