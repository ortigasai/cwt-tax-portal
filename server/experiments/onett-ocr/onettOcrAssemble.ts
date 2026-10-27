import type { OcrPage } from './onettOcr';
import { classify, parseSchedule, parseSheet, type PageKind, type ScheduleReading, type SheetReading } from './onettOcrParse';
import type { OnettAccount, OnettLine } from './onettSummary';

// Assembles ONETT records from OCR output without a vision model. OCR digits on
// these 150-dpi scans are only ~50% exact, so values are *derived* wherever the
// form's own arithmetic allows and the OCR reading is used to choose between
// candidates, never trusted blindly:
//   ZV/sqm   snapped to the rates the project actually uses
//   ZV       = area x ZV/sqm
//   FMV      = 25,000/sqm for units, 16,000/sqm for 12.5 sqm parking slots
//   EWT, DST = rate x base, P15 per P1,000
//   surcharge / interest / compromise = the payment schedule's (clean) totals row
// Everything not confirmed by such a check is listed in the record's flags.

const RATES = [220000, 154000, 150000, 120000, 38000, 24000];
const PARKING_AREA = 12.5;
const FMV_PER_SQM_UNIT = 25000;
const FMV_PER_SQM_PARKING = 16000;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

// Snap an OCR'd ZV/sqm to the nearest rate in use (digit-wise, 1 slip allowed).
function snapRate(v: number | null): number | null {
  if (v === null) return null;
  const s = String(Math.round(v));
  let best: { r: number; d: number } | null = null;
  for (const r of RATES) {
    const d = editDistance(s, String(r));
    if (d <= 1 && (!best || d < best.d)) best = { r, d };
  }
  // A reading such as 12,000.00 / 120000 with a dropped digit still maps.
  return best ? best.r : null;
}

export interface OcrPageInput {
  page: number;
  ocr: OcrPage;
}

export interface OcrAssembleOptions {
  /** Known buyer names (e.g. from the portal's contracts) used to fix OCR typos. */
  knownBuyers?: string[];
}

const KNOWN_PROJECTS = [
  'MAVEN AT CAPITOL COMMONS',
  'THE IMPERIUM AT CAPITOL COMMONS',
  'ORTIGAS EAST RESIDENCES',
  'MAPLE VERDANT TOWER',
  'THE ROYALTON AT CAPITOL COMMONS',
  'THE EMPRESS AT CAPITOL COMMONS',
  'THE ELLIPTICAL',
  'THE GROVE',
];

function tokens(s: string): string[] {
  return s.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length > 1);
}

function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  let hit = 0;
  for (const x of ta) if (tb.some((y) => y === x || (x.length > 3 && y.length > 3 && editDistance(x, y) <= 1))) hit++;
  return hit / Math.max(ta.length, tb.length);
}

function bestMatch(text: string, candidates: string[], min: number): string | null {
  let best: { c: string; s: number } | null = null;
  for (const c of candidates) {
    const s = similarity(text, c);
    if (s >= min && (!best || s > best.s)) best = { c, s };
  }
  return best ? best.c : null;
}

interface Packet {
  sheetPage: number;
  sheet: SheetReading;
  schedulePages: number[];
  schedule: ScheduleReading | null;
  otherPages: number[];
}

export function assemblePackets(pages: OcrPageInput[]): { kind: PageKind; page: number; packet: number }[] {
  // Exposed for callers that want per-page labels (progress / debugging).
  const out: { kind: PageKind; page: number; packet: number }[] = [];
  let packet = -1;
  for (const p of pages) {
    const kind = classify(p.ocr);
    if (kind === 'sheet') packet++;
    out.push({ kind, page: p.page, packet });
  }
  return out;
}

export function assembleFromOcr(pages: OcrPageInput[], options: OcrAssembleOptions = {}): OnettAccount[] {
  const packets: Packet[] = [];
  for (const p of pages) {
    const kind = classify(p.ocr);
    if (kind === 'sheet') {
      packets.push({ sheetPage: p.page, sheet: parseSheet(p.ocr), schedulePages: [], schedule: null, otherPages: [] });
      continue;
    }
    const cur = packets[packets.length - 1];
    if (!cur) continue;
    if (kind === 'schedule') {
      cur.schedulePages.push(p.page);
      // The totals row sits on the packet's last schedule page.
      cur.schedule = parseSchedule(p.ocr);
    } else {
      cur.otherPages.push(p.page);
    }
  }

  return packets.map((pk, index) => buildAccount(pk, index, options));
}

function buildAccount(pk: Packet, index: number, options: OcrAssembleOptions): OnettAccount {
  const s = pk.sheet;
  const flags: string[] = [];

  // ---- property lines ----
  const lines: OnettLine[] = [];
  for (const it of s.items) {
    let area = it.area ?? 0;
    const looksParking = Math.abs(area - PARKING_AREA) < 0.01 || [2.5, 1.25, 125, 12.5, 1.5, 12].includes(area) || it.className === 'PS' && area < 20;
    if (looksParking) area = PARKING_AREA;
    let className = it.className || (area === PARKING_AREA ? 'PS' : 'RC');
    if (area === PARKING_AREA && className !== 'PS') className = 'PS';
    let rate = snapRate(it.zvPerSqm);
    if (rate === null && it.zv && area) rate = snapRate(it.zv / area);
    if (rate === null && it.zvPerSqm) {
      rate = it.zvPerSqm;
      flags.push(`ZV/sqm ${it.zvPerSqm} is not one of the usual rates - verify`);
    }
    if (rate === null) {
      rate = 0;
      flags.push('A ZV/sqm could not be read - verify');
    }
    const zv = round2(area * rate);
    const fmv = round2(area * (area === PARKING_AREA ? FMV_PER_SQM_PARKING : FMV_PER_SQM_UNIT));
    if (it.fmv !== null && Math.abs(it.fmv - fmv) > 0.5) {
      // Read FMV disagrees with the 25,000 / 16,000 per sqm pattern.
      if (it.fmv > fmv * 0.2) flags.push(`FMV read as ${it.fmv.toFixed(2)}, expected ${fmv.toFixed(2)} for ${area} sqm - verify`);
    }
    lines.push({ location: it.location, class: className, area, zvPerSqm: rate, zv, fmv });
  }

  const zvTotal = round2(lines.reduce((x, l) => x + l.zv, 0));
  const fmvTotal = round2(lines.reduce((x, l) => x + l.fmv, 0));
  const areaTotal = round2(lines.reduce((x, l) => x + l.area, 0));
  const rate = s.rate ?? 0.05;
  if (s.rate === null) flags.push('Tax rate not read - assumed 5%');

  // ---- selling price / tax base ----
  const sched = pk.schedule;
  const spTokens = [s.items[0]?.sp, s.totals.sp, s.totals.base].filter((x): x is number => typeof x === 'number' && x > 0);
  const highestZvFmv = Math.max(zvTotal, fmvTotal);
  let sp = 0;
  let taxBase = highestZvFmv;
  const ewtFromSchedule = sched && sched.ewtDue && sched.ewtDue > 0 ? sched.ewtDue : null;
  if (ewtFromSchedule) {
    const baseEst = round2(ewtFromSchedule / rate);
    if (baseEst > highestZvFmv + 1) {
      // The selling price is the tax base. Its exact centavos come from a
      // reading (or the schedule's principal total) that reproduces the EWT.
      const cands = [...spTokens, ...(sched?.principal ? [sched.principal] : [])];
      const exact = cands.find((c) => Math.abs(round2(c * rate) - ewtFromSchedule) < 0.011);
      if (exact !== undefined) {
        sp = exact;
      } else {
        sp = baseEst;
        flags.push(`Selling price derived from the EWT (${baseEst.toFixed(2)}); centavos unverified`);
      }
      taxBase = sp;
    } else {
      taxBase = highestZvFmv;
      // SP is below ZV/FMV: pick the reading that sits closest to the schedule's principal total.
      const below = spTokens.filter((c) => c > 0 && c <= highestZvFmv);
      const target = sched?.principal ?? null;
      if (below.length > 0) {
        sp = target !== null ? below.sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0] : below[0];
        if (!(target !== null && Math.abs(sp - target) < 0.011)) flags.push(`Selling price ${sp.toFixed(2)} read by OCR - verify`);
      } else if (target !== null) {
        sp = target;
        flags.push(`Selling price taken from the schedule principal ${target.toFixed(2)} - verify`);
      } else {
        flags.push('Selling price could not be read - verify');
      }
    }
  } else {
    // No schedule: single payment, rely on the sheet readings.
    const cands = spTokens.filter((c) => c > 0);
    sp = cands.sort((a, b) => b - a)[0] ?? 0;
    taxBase = Math.max(highestZvFmv, sp);
    flags.push('No payment schedule found - selling price and penalties read from the sheet by OCR; verify');
  }

  const ewtDue = round2(taxBase * rate);
  if (ewtFromSchedule && Math.abs(ewtFromSchedule - ewtDue) > 0.02) {
    flags.push(`EWT ${ewtDue.toFixed(2)} (from base) differs from the schedule total ${ewtFromSchedule.toFixed(2)} - verify`);
  }

  // ---- penalties ----
  let surcharge = 0;
  let interest = 0;
  let compromise = 0;
  if (sched && sched.surcharge !== null && sched.interest !== null && sched.compromise !== null) {
    surcharge = sched.surcharge;
    interest = sched.interest;
    compromise = sched.compromise;
  } else {
    surcharge = s.surcharge ?? round2(ewtDue * 0.25);
    interest = s.interest ?? 0;
    compromise = s.compromise ?? 0;
    if (Math.abs(surcharge - round2(ewtDue * 0.25)) > 0.011) {
      surcharge = round2(ewtDue * 0.25);
    }
  }

  const dstBase = Math.ceil(taxBase / 1000) * 1000;
  const dstDue = round2((dstBase / 1000) * 15);

  // ---- people / labels ----
  const buyers: string[] = [];
  const tins: string[] = [];
  for (const b of s.buyers) {
    if (!b.name || b.name.length < 3) continue;
    let name = b.name;
    const known = options.knownBuyers ? bestMatch(name, options.knownBuyers, 0.75) : null;
    if (known) name = known;
    else if (b.confidence < 80) flags.push(`Buyer name "${name}" read with low confidence - verify`);
    buyers.push(name);
    if (b.tin) tins.push(b.tin);
  }
  if (buyers.length === 0) flags.push('Buyer name could not be read - verify');

  const projectText = lines[0]?.location ?? '';
  const project = bestMatch(projectText, KNOWN_PROJECTS, 0.5);
  if (project) {
    for (const l of lines) l.location = project;
  } else if (projectText) {
    flags.push(`Location "${projectText}" not recognised - verify`);
  }

  const typed = s.typedNote ?? '';
  const sheetNote = /NOT\s*EN|NOT\s*ENG/.test(typed) ? 'NOT ENGAGED IN BUSINESS' : /ENG|BUSIN/.test(typed) ? 'ENGAGED IN BUSINESS' : null;

  const docket = `${s.batch && s.batch !== 'A' ? 'P' + s.batch : 'P'}${s.docketNumber ?? `?${index + 1}`}`;
  if (!s.docketNumber) flags.push('Docket number could not be read - verify');

  return {
    docket,
    batch: s.batch,
    sheetPage: pk.sheetPage,
    sheetDate: s.sheetDate ?? undefined,
    buyers,
    tins,
    lines,
    zvTotal,
    fmvTotal,
    sp,
    areaTotal,
    rate,
    taxBase,
    ewtDue,
    ewtPaid: ewtDue,
    ewtShort: 0,
    surcharge,
    interest,
    compromise,
    totalCgt: round2(surcharge + interest + compromise),
    dstBase,
    dstDue,
    dstPaid: dstDue,
    dstShort: 0,
    dstPenalties: 0,
    sheetNote,
    cts: s.cts,
    schedulePages: pk.schedulePages,
    irisPages: pk.otherPages,
    flags,
  };
}
