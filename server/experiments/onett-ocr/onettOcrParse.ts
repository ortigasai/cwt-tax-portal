import type { OcrLine, OcrPage, OcrWord } from './onettOcr';

// Turns OCR words from a scanned ONETT page into structured values. OCR digits
// are never trusted blindly: amounts are normalised to "…cents" form here and
// cross-checked arithmetically in onettOcrAssemble.ts.

export type PageKind = 'sheet' | 'schedule' | 'other';

export interface OcrLineItem {
  className: string;
  area: number | null;
  zvPerSqm: number | null;
  zv: number | null;
  fmv: number | null;
  sp: number | null;
  location: string;
}

export interface SheetReading {
  docketNumber: string | null;
  batch: string | null;
  sheetDate: string | null;
  buyers: { name: string; tin: string | null; confidence: number }[];
  items: OcrLineItem[];
  totals: { area: number | null; zv: number | null; fmv: number | null; sp: number | null; base: number | null };
  rate: number | null;
  ewtDue: number | null;
  taxPaid: number | null;
  surcharge: number | null;
  interest: number | null;
  compromise: number | null;
  totalCgt: number | null;
  dstBase: number | null;
  dstDue: number | null;
  typedNote: string | null;
  cts: string | null;
  warnings: string[];
}

export interface ScheduleReading {
  principal: number | null;
  ewtDue: number | null;
  surcharge: number | null;
  interest: number | null;
  compromise: number | null;
}

const up = (s: string) => s.toUpperCase();

// "13,350,000.00" / "2136785714" / "1.068.392.85" -> 13350000 / 21367857.14 / …
// Every amount on these forms carries exactly two decimals, so the last two
// digits are the cents regardless of which separators the OCR kept.
export function moneyOf(raw: string): number | null {
  let t = raw.replace(/[|\[\]{}()_~'"`:;]/g, '');
  if (!/\d/.test(t)) return null;
  t = t.replace(/[Oo©]/g, '0').replace(/[lI]/g, '1').replace(/[Ss$]/g, '5').replace(/[Bb]/g, '8');
  const digits = t.replace(/[^0-9]/g, '');
  if (digits.length < 3) return null;
  const letters = t.replace(/[0-9.,\-\s]/g, '');
  if (letters.length > 0) return null;
  return Number(digits.slice(0, -2) + '.' + digits.slice(-2));
}

export function isMoneyToken(text: string): boolean {
  const v = moneyOf(text);
  return v !== null && /\d[.,]?\d/.test(text);
}

export function classify(page: OcrPage): PageKind {
  const top = up(
    page.lines
      .filter((l) => l.y < 300)
      .map((l) => l.text)
      .join(' '),
  );
  if (/COMPUTATION|ONETT|WITHHOLDING|DOCUMENTARY/.test(top)) return 'sheet';
  const all = up(page.lines.map((l) => l.text).join(' '));
  const hits = ['PAYMENT', 'DUE DATE', 'REMITT', 'SURCHARGE', 'COMPROMIS', 'INTEREST', 'PRINCIPAL', 'DELAY'].filter((k) =>
    all.includes(k),
  ).length;
  if (hits >= 3) return 'schedule';
  return 'other';
}

function moneyTokens(line: OcrLine): { value: number; word: OcrWord }[] {
  const out: { value: number; word: OcrWord }[] = [];
  for (const w of line.words) {
    if (!/\d/.test(w.text)) continue;
    const v = moneyOf(w.text);
    if (v !== null && w.text.replace(/[^0-9]/g, '').length >= 4) out.push({ value: v, word: w });
  }
  return out;
}

// The totals row of a payment schedule: the lowest line with at least 4 amounts.
// Its last four amounts are EWT due, surcharge, interest and compromise.
export function parseSchedule(page: OcrPage): ScheduleReading {
  const candidates = page.lines
    .map((l) => ({ line: l, tokens: moneyTokens(l) }))
    .filter((c) => c.tokens.length >= 4)
    .sort((a, b) => b.line.y - a.line.y);
  const last = candidates[0];
  if (!last) return { principal: null, ewtDue: null, surcharge: null, interest: null, compromise: null };
  const v = last.tokens.map((t) => t.value);
  const n = v.length;
  return {
    principal: v[0],
    ewtDue: v[n - 4],
    surcharge: v[n - 3],
    interest: v[n - 2],
    compromise: v[n - 1],
  };
}

const CLASS_MAP: [RegExp, string][] = [
  [/^R[CEO]?$/i, 'RC'],
  [/^P[S5]$/i, 'PS'],
  [/^C[CE]$/i, 'CC'],
  [/^S[T7]$/i, 'ST'],
];

function classOf(text: string): string | null {
  const t = text.replace(/[^A-Za-z0-9]/g, '');
  for (const [re, name] of CLASS_MAP) if (re.test(t)) return name;
  return null;
}

function cleanName(words: OcrWord[]): { name: string; confidence: number } {
  const kept = words.filter((w) => /[A-Za-z]/.test(w.text) && !/^[\[\]|{}_~\-.:;,0]+$/.test(w.text));
  const text = kept
    .map((w) => w.text.replace(/[|\[\]{}_~]/g, '').replace(/^[^A-Za-z]+|[^A-Za-z.]+$/g, ''))
    .filter(Boolean)
    .join(' ');
  const conf = kept.length ? kept.reduce((s, w) => s + w.conf, 0) / kept.length : 0;
  return { name: up(text).replace(/\s+/g, ' ').trim(), confidence: conf };
}

const num = (v: number | null) => v;

export function parseSheet(page: OcrPage): SheetReading {
  const warnings: string[] = [];
  const lines = page.lines;
  const findLine = (re: RegExp, from = 0, to = Infinity) => lines.find((l) => l.y >= from && l.y <= to && re.test(up(l.text)));

  // --- docket / batch / date (top right, under the title block) ---
  let docketNumber: string | null = null;
  let batch: string | null = null;
  let sheetDate: string | null = null;
  const headBand = lines.filter((l) => l.y > 170 && l.y < 215);
  for (const l of headBand) {
    const right = l.words.filter((w) => w.x0 > 930);
    const text = right.map((w) => w.text).join(' ');
    const b = /BATCH\s*([A-Z])/i.exec(text.replace(/BATCH(?=[A-Z])/i, 'BATCH '));
    if (b) batch = up(b[1]);
    const d = /(\d{1,2}[\/.]\d{1,2}[\/.]\d{4})/.exec(text.replace(/\s/g, ''));
    if (d) sheetDate = d[1];
    const n = /\b(\d{1,3})\b/.exec(text.replace(/\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}/g, ''));
    if (n && !docketNumber) docketNumber = n[1];
  }

  // --- buyers ---
  const buyers: SheetReading['buyers'] = [];
  const buyerLines = lines.filter((l) => l.y > 250 && l.y < 400 && /^N[A-Z]ME|^NAVE|^NANE/.test(up(l.words[0]?.text ?? '')) && /BU|BL|BV|BW/.test(up(l.text)));
  for (const l of buyerLines) {
    const addr = l.words.find((w) => /^A[DO]{1,2}RE/i.test(w.text));
    const limit = addr ? addr.x0 - 6 : 550;
    const nameWords = l.words.filter((w) => w.x0 >= 262 && w.x1 <= limit + 4);
    const { name, confidence } = cleanName(nameWords);
    const tinWords = l.words.filter((w) => w.x0 >= 990);
    const tinText = tinWords.map((w) => w.text).join('');
    const tm = /(\d{3})\D{0,2}(\d{3})\D{0,2}(\d{3})/.exec(tinText);
    // The TIN sits on a slightly lower line in some scans.
    buyers.push({ name, tin: tm ? `${tm[1]}-${tm[2]}-${tm[3]}` : null, confidence });
  }
  // TINs the buyer lines missed: any line within +-30px of a buyer line.
  const tinLines = lines.filter((l) => l.y > 250 && l.y < 400);
  for (let i = 0; i < buyerLines.length; i++) {
    if (buyers[i].tin) continue;
    const near = tinLines.filter((l) => Math.abs(l.y - buyerLines[i].y) < 30);
    for (const l of near) {
      const t = l.words.filter((w) => w.x0 >= 990).map((w) => w.text).join('');
      const tm = /(\d{3})\D{0,2}(\d{3})\D{0,2}(\d{3})/.exec(t);
      if (tm) {
        buyers[i].tin = `${tm[1]}-${tm[2]}-${tm[3]}`;
        break;
      }
    }
  }

  // --- property table ---
  const totalLine = lines.find((l) => l.y > 520 && l.y < 700 && l.words.some((w) => /^T[O0]TAL$/i.test(w.text) && w.x0 > 400 && w.x0 < 520));
  const headLine = lines.find((l) => l.y > 400 && l.y < 460 && /LOCAT/.test(up(l.text)));
  const totalY = totalLine?.y ?? 610;
  const headY = headLine?.y ?? 435;
  const tokensOf = (l: OcrLine) =>
    l.words
      .filter((w) => /\d/.test(w.text) && w.text.replace(/[^0-9]/g, '').length >= 1)
      .map((w) => ({ w, v: moneyOf(w.text) }))
      .filter((t) => t.v !== null);

  // Column right edges: area, ZV/sqm, ZV, FMV, SP, tax base (mid-scan averages,
  // re-centred on the TOTAL row when it was read cleanly).
  let edges = [586, 684, 790, 900, 1020, 1135];
  if (totalLine) {
    const t = tokensOf(totalLine).filter((x) => x.w.x0 > 520);
    // area (x1 < 640) is the first token; the rest follow the SP/base pattern.
    const areaTok = t.find((x) => x.w.x1 < 640);
    if (areaTok) edges[0] = areaTok.w.x1;
    const shift = edges[0] - 586;
    edges = [edges[0], 684 + shift, 790 + shift, 900 + shift, 1020 + shift, 1135 + shift];
  }
  const colOf = (w: OcrWord): number => {
    let best = -1;
    let bestD = 38;
    edges.forEach((e, i) => {
      const d = Math.abs(w.x1 - e);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  };

  const items: OcrLineItem[] = [];
  const propLines = lines.filter((l) => l.y > headY + 25 && l.y < totalY - 6);
  const continuationText: string[] = [];
  for (const l of propLines) {
    const cls = l.words.map((w) => (w.x0 > 395 && w.x0 < 470 ? classOf(w.text) : null)).find(Boolean) ?? null;
    const cols: (number | null)[] = [null, null, null, null, null, null];
    for (const w of l.words) {
      if (w.x0 < 500) continue;
      const c = colOf(w);
      if (c < 0) continue;
      const v = moneyOf(w.text);
      if (v !== null && /\d/.test(w.text)) cols[c] = v;
    }
    const loc = l.words
      .filter((w) => w.x0 >= 268 && w.x1 <= 420 && /[A-Za-z]/.test(w.text) && classOf(w.text) === null)
      .map((w) => w.text)
      .join(' ');
    const hasArea = cols[0] !== null && cols[0] > 0;
    if (hasArea) {
      items.push({
        className: cls ?? '',
        area: cols[0],
        zvPerSqm: cols[1],
        zv: cols[2],
        fmv: cols[3],
        sp: cols[4],
        location: loc,
      });
    } else if (loc) {
      continuationText.push(loc);
    }
  }
  if (items.length > 0 && continuationText.length > 0) {
    items[0].location = [items[0].location, ...continuationText].join(', ');
  }

  const totals = { area: null as number | null, zv: null as number | null, fmv: null as number | null, sp: null as number | null, base: null as number | null };
  if (totalLine) {
    for (const w of totalLine.words) {
      if (w.x0 < 500) continue;
      const c = colOf(w);
      const v = moneyOf(w.text);
      if (c < 0 || v === null) continue;
      if (c === 0) totals.area = v;
      if (c === 2) totals.zv = v;
      if (c === 3) totals.fmv = v;
      if (c === 4) totals.sp = v;
      if (c === 5) totals.base = v;
    }
  }

  // --- computation block ---
  const compStart = findLine(/COMPUTATION|DETAILS/, totalY, totalY + 60)?.y ?? totalY + 30;
  const rateWord = lines
    .filter((l) => l.y > compStart && l.y < compStart + 140)
    .flatMap((l) => l.words)
    .find((w) => /%/.test(w.text) && /\d/.test(w.text) && w.x0 > 380 && w.x0 < 480);
  let rate: number | null = null;
  if (rateWord) {
    const r = Number(rateWord.text.replace(/[^0-9.]/g, '').replace(/^0+(?=\d)/, ''));
    if ([1.5, 3, 5, 6].includes(r)) rate = r / 100;
    else if (r === 50) rate = 0.05;
    else if (r === 15) rate = 0.015;
    else if (r === 30) rate = 0.03;
    else if (r === 60) rate = 0.06;
  }

  // PER AUDIT amounts live in the column right of x~840.
  const auditAmounts = lines
    .filter((l) => l.y > compStart)
    .map((l) => {
      const toks = l.words.filter((w) => w.x0 >= 835 && w.x0 < 960 && /\d/.test(w.text));
      const v = toks.length ? moneyOf(toks.map((t) => t.text).join('')) : null;
      return v === null ? null : { y: l.y, v };
    })
    .filter((x): x is { y: number; v: number } => x !== null);

  const labelLine = (re: RegExp, from = compStart) => lines.find((l) => l.y > from && re.test(up(l.text)));
  const cgtPaidLine = labelLine(/LESS|PAID/, compStart + 50);
  const dstHead = labelLine(/DOCUM|STAMP/, compStart + 150);
  const amountAt = (y: number, tol = 14) => auditAmounts.find((a) => Math.abs(a.y - y) <= tol)?.v ?? null;

  const ewtDue = auditAmounts.find((a) => a.y > compStart && a.y < compStart + 90)?.v ?? null;
  const taxPaid = cgtPaidLine ? amountAt(cgtPaidLine.y) : null;
  const middleAmount = (re: RegExp, from: number, to: number): number | null => {
    const l = lines.find((x) => x.y > from && x.y < to && re.test(up(x.text)));
    if (!l) return null;
    const toks = l.words.filter((w) => w.x0 >= 600 && w.x0 < 800 && /\d/.test(w.text));
    for (let i = toks.length - 1; i >= 0; i--) {
      const v = moneyOf(toks[i].text);
      if (v !== null) return v;
    }
    return null;
  };
  const cgtEnd = dstHead?.y ?? compStart + 330;
  const surcharge = middleAmount(/SURCH|URCH/, compStart + 100, cgtEnd);
  const interest = middleAmount(/^INTEREST|INTEREST/, compStart + 100, cgtEnd);
  const compromise = middleAmount(/COMPRO|PENAL|PENOL/, compStart + 100, cgtEnd);
  const totalLineCgt = lines.find((l) => l.y > compStart + 150 && l.y < cgtEnd && /TOTAL.*(CGT|CCT|CGV|CET|CG)/.test(up(l.text)));
  const totalCgt = totalLineCgt ? amountAt(totalLineCgt.y, 16) : null;

  // DST: base in the left box, due in the audit column on the same line.
  let dstBase: number | null = null;
  let dstDue: number | null = null;
  const dstBaseLine = lines.find((l) => l.y > cgtEnd && l.y < cgtEnd + 90 && /15|P15|FOR EVERY|EVERY/.test(up(l.text)));
  if (dstBaseLine) {
    const toks = dstBaseLine.words.filter((w) => w.x0 > 100 && w.x0 < 330 && /\d/.test(w.text));
    for (const t of toks) {
      const v = moneyOf(t.text);
      if (v !== null && v >= 1000) dstBase = v;
    }
    dstDue = amountAt(dstBaseLine.y, 16);
  }

  // Typed note beside the CGT amount ("ENGAGED IN BUSINESS" …) and CTS date.
  const noteLine = lines.find((l) => l.y > compStart && l.y < compStart + 120 && /BUSIN|ENGAGED|ENGOGED/.test(up(l.text)) && !/HABITUAL|HOBIT/.test(up(l.text)));
  const typedNote = noteLine
    ? up(noteLine.words.filter((w) => w.x0 > 540 && w.x0 < 820).map((w) => w.text).join(' ')).replace(/\s+/g, ' ').trim() || null
    : null;
  const ctsLine = lines.find((l) => l.y > compStart && l.y < compStart + 200 && /CTS|CT5|CIS/.test(up(l.text)));
  let cts: string | null = null;
  if (ctsLine) {
    const m = /(\d{1,2})[-\s]?([A-Za-z]{3})[-\s]?(\d{2})/.exec(ctsLine.words.map((w) => w.text).join(' '));
    if (m) cts = `${m[1].padStart(2, '0')}-${m[2][0].toUpperCase()}${m[2].slice(1).toLowerCase()}-${m[3]}`;
  }

  if (items.length === 0) warnings.push('No property rows could be read');
  return {
    docketNumber,
    batch,
    sheetDate,
    buyers,
    items,
    totals,
    rate,
    ewtDue: num(ewtDue),
    taxPaid: num(taxPaid),
    surcharge,
    interest,
    compromise,
    totalCgt,
    dstBase,
    dstDue,
    typedNote,
    cts,
    warnings,
  };
}
