import ExcelJS from 'exceljs';

// ONETT Summary: one record per ONETT computation sheet (an "account"), turned
// into the rows of "ONETT Summary template.xlsx" — one row per account per tax
// type (EWT always, DST only when the sheet shows a DST shortfall/penalty).

export interface OnettLine {
  location: string;
  class: string;
  area: number;
  zvPerSqm: number;
  zv: number;
  fmv: number;
}

export interface OnettAccount {
  docket: string;
  batch?: string | null;
  sheetPage?: number;
  sheetDate?: string;
  buyers: string[];
  tins?: string[];
  lines: OnettLine[];
  zvTotal: number;
  fmvTotal: number;
  sp: number;
  areaTotal?: number;
  rate: number;
  taxBase: number;
  ewtDue: number;
  ewtPaid: number;
  ewtPaidDate?: string | null;
  ewtShort?: number;
  surcharge: number;
  interest: number;
  compromise: number;
  totalCgt?: number;
  dstBase?: number;
  dstDue?: number;
  dstPaid?: number;
  dstPaidDate?: string | null;
  dstShort?: number;
  dstPenalties?: number;
  sheetNote?: string | null;
  cts?: string | null;
  terms?: string | null;
  schedulePages?: number[];
  irisPages?: number[];
  irisFinding?: string | null;
  remarksHandwritten?: string | null;
  handwritten?: string[];
  flags?: string[];
}

export interface SummaryRow {
  docket: string;
  buyer: string;
  location: string;
  class: string;
  /** RC / CC / storage lines (one group) and PS (parking) lines (the other). */
  areaRc: number | null;
  areaPs: number | null;
  /** The rate when every line in the group has the same ZV/sqm, else null. */
  zvPerSqmRc: number | null;
  zvPerSqmPs: number | null;
  zonalValue: number;
  /** True when zonal value = areaRc × zvPerSqmRc + areaPs × zvPerSqmPs exactly. */
  zonalIsFormula: boolean;
  fmv: number;
  sellingPrice: number;
  issue: string;
  taxType: 'EWT' | 'DST';
  taxBase: number;
  taxDue: number;
  taxPaid: number;
  surcharge: number;
  interest: number;
  compromise: number;
  remarks: string;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

// "MAVEN AT CAPITOL COMMONS, ORANBO, PASIG" -> "MAVEN AT CAPITOL COMMONS"
// (the template carries only the property name).
export function propertyName(location: string | undefined | null): string {
  const first = (location ?? '').split(',')[0] ?? '';
  return first.replace(/\s+/g, ' ').trim().toUpperCase();
}

// The classes on the sheet in order, e.g. "RC", "PS" or "RC + PS".
export function classLabel(lines: OnettLine[]): string {
  const order: string[] = [];
  for (const l of lines) {
    const c = (l.class || '').trim().toUpperCase();
    if (c && !order.includes(c)) order.push(c);
  }
  return order.join(' + ');
}

// Parking slots (PS) have their own area / ZV-per-sqm columns; everything else
// on the sheet (RC, CC, storage) shares the other pair.
function isParking(l: OnettLine): boolean {
  return (l.class || '').trim().toUpperCase() === 'PS';
}

function groupFigures(lines: OnettLine[]): { area: number | null; rate: number | null; zv: number } {
  const real = lines.filter((l) => num(l.area) > 0);
  if (real.length === 0) return { area: null, rate: null, zv: 0 };
  const rates = new Set(real.map((l) => num(l.zvPerSqm)));
  return {
    area: round2(real.reduce((sum, l) => sum + num(l.area), 0)),
    rate: rates.size === 1 ? [...rates][0] : null,
    zv: real.reduce((sum, l) => sum + num(l.zv), 0),
  };
}

// ISSUE: the 5% (or lower, bracketed) rate on these sheets is the "engaged in
// business" treatment; the 6% rate is "not habitually engaged".
export function issueLabel(rate: number): string {
  return rate >= 0.06 ? 'NOT ENGAGED IN BUSINESS' : 'ENGAGED IN BUSINESS';
}

// REMARKS: the team's handwritten "W/ IRIS" / "NO IRIS" mark on the sheet wins;
// otherwise it reflects whether IRIS screenshots are attached to the packet.
export function remarksLabel(a: OnettAccount): string {
  const hw = a.remarksHandwritten?.trim();
  if (hw) return hw.toUpperCase().replace(/^W\/\s*/, 'WITH ');
  return (a.irisPages?.length ?? 0) > 0 ? 'WITH IRIS' : 'NO IRIS';
}

export function accountToRows(a: OnettAccount): SummaryRow[] {
  const lines = (a.lines ?? []).filter((l) => num(l.area) > 0 || num(l.zv) > 0 || num(l.fmv) > 0);
  const rc = groupFigures(lines.filter((l) => !isParking(l)));
  const ps = groupFigures(lines.filter(isParking));
  const zonal = a.zvTotal || lines.reduce((s, l) => s + num(l.zv), 0);
  const fmv = a.fmvTotal || lines.reduce((s, l) => s + num(l.fmv), 0);
  const ratesKnown = (rc.area === null || rc.rate !== null) && (ps.area === null || ps.rate !== null);
  const product = round2((rc.area ?? 0) * (rc.rate ?? 0) + (ps.area ?? 0) * (ps.rate ?? 0));
  const base = {
    docket: a.docket,
    buyer: (a.buyers[0] ?? '').toUpperCase(),
    location: propertyName(lines[0]?.location),
    class: classLabel(lines),
    areaRc: rc.area,
    areaPs: ps.area,
    zvPerSqmRc: rc.rate,
    zvPerSqmPs: ps.rate,
    zonalValue: zonal,
    zonalIsFormula: ratesKnown && product === round2(zonal),
    fmv,
    sellingPrice: a.sp,
    issue: issueLabel(a.rate),
    remarks: remarksLabel(a),
  };
  const rows: SummaryRow[] = [
    {
      ...base,
      taxType: 'EWT',
      taxBase: a.taxBase,
      taxDue: a.ewtDue,
      taxPaid: a.ewtPaid,
      surcharge: a.surcharge,
      interest: a.interest,
      compromise: a.compromise,
    },
  ];
  const dstShort = num(a.dstShort);
  const dstPen = num(a.dstPenalties);
  if (dstShort > 0.004 || dstPen > 0.004) {
    rows.push({
      ...base,
      taxType: 'DST',
      taxBase: num(a.dstBase),
      taxDue: num(a.dstDue),
      taxPaid: num(a.dstPaid),
      surcharge: 0,
      interest: 0,
      compromise: 0,
    });
  }
  return rows;
}

// Arithmetic cross-checks on the extracted figures plus whatever the reader
// flagged while extracting (e.g. DST paid after its due date).
export function reviewFlags(a: OnettAccount): string[] {
  const out = [...(a.flags ?? [])];
  const highest = Math.max(num(a.zvTotal), num(a.fmvTotal), num(a.sp));
  if (a.taxBase && Math.abs(a.taxBase - highest) > 0.01) {
    out.push(`Tax base ${a.taxBase.toFixed(2)} is not the highest of ZV/FMV/SP (${highest.toFixed(2)})`);
  }
  if (a.taxBase && a.rate && Math.abs(round2(a.taxBase * a.rate) - a.ewtDue) > 0.011) {
    out.push(`EWT due ${a.ewtDue.toFixed(2)} differs from tax base × rate (${round2(a.taxBase * a.rate).toFixed(2)})`);
  }
  if (a.dstBase && a.dstDue !== undefined) {
    const expected = Math.ceil(a.dstBase / 1000) * 15;
    if (Math.abs(expected - a.dstDue) > 0.011) {
      out.push(`DST due ${a.dstDue.toFixed(2)} differs from P15 per P1,000 of the base (${expected.toFixed(2)})`);
    }
  }
  if (a.totalCgt !== undefined) {
    const parts = round2(num(a.ewtDue) - num(a.ewtPaid) + num(a.surcharge) + num(a.interest) + num(a.compromise));
    if (Math.abs(parts - a.totalCgt) > 0.011) {
      out.push(`Sheet total ${a.totalCgt.toFixed(2)} vs components ${parts.toFixed(2)}`);
    }
  }
  const bigPs = (a.lines ?? []).filter((l) => (l.class || '').trim().toUpperCase() === 'PS' && num(l.area) > 12.5);
  if (bigPs.length > 0) {
    out.push(
      `Classed PS with ${bigPs.map((l) => `${num(l.area)} sqm`).join(', ')} (a parking slot is 12.5 sqm) - kept under the PS columns as printed`,
    );
  }
  if ((a.irisPages?.length ?? 0) === 0 && !a.remarksHandwritten) {
    out.push('No IRIS screenshot found in the packet');
  }
  return out;
}

const NUMFMT = '_-* #,##0.00_-;-* #,##0.00_-;_-* "-"??_-;_-@_-';
const HEADERS = [
  'NAME ON BUYER 1',
  'LOCATION',
  'CLASS',
  'AREA SQM (RC)',
  'AREA SQM (PS)',
  'ZV/SQM (RC)',
  'ZV/SQM (PS)',
  'ZONAL VALUE',
  'FAIRMARKET VALUE',
  'SELLING PRICE',
  'ISSUE',
  'TAX TYPE (EWT/DST)',
  'TAX BASE',
  'TAX DUE',
  'TAX PAID',
  'SHORT CWT/DST',
  'SURCHARGE',
  'INTEREST',
  'COMPROMISE',
  'TOTAL',
  'REMARKS',
];
const WIDTHS = [47.45, 31.54, 14.45, 18.18, 20.18, 19.27, 19.27, 19.27, 19.27, 19.27, 29.54, 19.18, 18.27, 13.18, 13.18, 15.82, 15.54, 15.45, 16.45, 17, 21.54];
// Columns carrying money / numbers (get the accounting number format).
const NUMERIC_COLS = [4, 5, 6, 7, 8, 9, 10, 13, 14, 15, 16, 17, 18, 19, 20];

// A workbook laid out like the reviewed "ONETT Summary template": sheet
// "Template", header row 1 (A–U), RC/CC/storage and PS (parking) split into
// their own AREA SQM and ZV/SQM columns, H = D×F + E×G when the rates are
// uniform, P = N−O and T = SUM(P:S) (so any short CWT/DST is in the TOTAL).
// A second "Review flags" sheet lists what needs a human look.
export async function buildSummaryWorkbook(accounts: OnettAccount[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Template', { views: [{ zoomScale: 80, zoomScaleNormal: 80 }] });
  HEADERS.forEach((h, i) => {
    const c = ws.getCell(1, i + 1);
    c.value = h;
    c.font = { bold: true };
  });
  WIDTHS.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  const ordered = [...accounts].sort((x, y) => docketKey(x.docket) - docketKey(y.docket) || x.docket.localeCompare(y.docket));
  let r = 2;
  for (const account of ordered) {
    for (const row of accountToRows(account)) {
      ws.getCell(r, 1).value = row.buyer;
      ws.getCell(r, 2).value = row.location;
      ws.getCell(r, 3).value = row.class;
      if (row.areaRc !== null) ws.getCell(r, 4).value = row.areaRc;
      if (row.areaPs !== null) ws.getCell(r, 5).value = row.areaPs;
      if (row.zvPerSqmRc !== null) ws.getCell(r, 6).value = row.zvPerSqmRc;
      if (row.zvPerSqmPs !== null) ws.getCell(r, 7).value = row.zvPerSqmPs;
      ws.getCell(r, 8).value = row.zonalIsFormula
        ? { formula: `D${r}*F${r}+E${r}*G${r}`, result: row.zonalValue }
        : row.zonalValue;
      ws.getCell(r, 9).value = row.fmv;
      ws.getCell(r, 10).value = row.sellingPrice;
      ws.getCell(r, 11).value = row.issue;
      ws.getCell(r, 12).value = row.taxType;
      ws.getCell(r, 13).value = row.taxBase;
      ws.getCell(r, 14).value = row.taxDue;
      ws.getCell(r, 15).value = row.taxPaid;
      ws.getCell(r, 16).value = { formula: `N${r}-O${r}`, result: round2(row.taxDue - row.taxPaid) };
      ws.getCell(r, 17).value = row.surcharge;
      ws.getCell(r, 18).value = row.interest;
      ws.getCell(r, 19).value = row.compromise;
      const total = round2(row.taxDue - row.taxPaid + row.surcharge + row.interest + row.compromise);
      ws.getCell(r, 20).value = { formula: `SUM(P${r}:S${r})`, result: total };
      ws.getCell(r, 20).font = { bold: true };
      ws.getCell(r, 21).value = row.remarks;
      for (const col of NUMERIC_COLS) ws.getCell(r, col).numFmt = NUMFMT;
      r++;
    }
  }

  const fs = wb.addWorksheet('Review flags');
  fs.addRow(['DOCKET', 'BUYER 1', 'FLAG']).font = { bold: true };
  fs.getColumn(1).width = 12;
  fs.getColumn(2).width = 45;
  fs.getColumn(3).width = 120;
  for (const account of ordered) {
    for (const flag of reviewFlags(account)) fs.addRow([account.docket, (account.buyers[0] ?? '').toUpperCase(), flag]);
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// Numeric part of a docket ("PC36" -> 36) with the batch letter as a tiebreak
// so P*, PB*, PC* group together in order.
function docketKey(docket: string): number {
  const m = /^P([A-Z]?)\s*-?\s*(\d+)/i.exec(docket.trim());
  if (!m) return Number.MAX_SAFE_INTEGER;
  const batch = m[1] ? m[1].toUpperCase().charCodeAt(0) - 64 : 0;
  return batch * 1000 + Number(m[2]);
}

export interface SummaryStats {
  accounts: number;
  withIris: number;
  noIris: number;
  flagged: number;
  taxBase: number;
  shortDue: number;
  surcharge: number;
  interest: number;
  compromise: number;
  total: number;
}

export function summaryStats(accounts: OnettAccount[]): SummaryStats {
  const s: SummaryStats = {
    accounts: accounts.length,
    withIris: 0,
    noIris: 0,
    flagged: 0,
    taxBase: 0,
    shortDue: 0,
    surcharge: 0,
    interest: 0,
    compromise: 0,
    total: 0,
  };
  for (const a of accounts) {
    if (remarksLabel(a).includes('NO IRIS')) s.noIris++;
    else s.withIris++;
    if (reviewFlags(a).length > 0) s.flagged++;
    for (const row of accountToRows(a)) {
      s.taxBase += row.taxType === 'EWT' ? row.taxBase : 0;
      s.shortDue += row.taxDue - row.taxPaid;
      s.surcharge += row.surcharge;
      s.interest += row.interest;
      s.compromise += row.compromise;
    }
  }
  s.total = s.shortDue + s.surcharge + s.interest + s.compromise;
  for (const k of ['taxBase', 'shortDue', 'surcharge', 'interest', 'compromise', 'total'] as const) s[k] = round2(s[k]);
  return s;
}
