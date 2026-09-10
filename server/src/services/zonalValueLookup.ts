import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { findRdoForTower } from '../lib/rdoLocations';
import { classifyTowerNature, expectedUnitClassification, TowerNature } from '../lib/towerNature';

// Looks up the zonal value in effect as of a contract's CTS notary date from
// the tax team's own consolidated Zonal Value reference workbook (a single
// "ZV RATE" sheet, one row per Tower per effectivity window, with RC/CC/PS
// rates already broken out) — see ZONAL_VALUES_DIR. This replaced an earlier
// version that parsed raw per-RDO BIR schedule exports (a NOTICE sheet plus
// one detail sheet per Department Order); the tax team now maintains a
// single pre-digested rate sheet instead, so that machinery is gone.
//
// Rows are grouped by Tower and sorted newest-first by Effective From; the
// newest row per tower is treated as open-ended ("current") regardless of
// its literal Effective To value, since that cell just reflects the sheet's
// last export date rather than a real expiry — mirroring how the old BIR
// schedules marked their current revision "Present". Older rows use their
// exact [From, To] window as given.

const DEFAULT_DIR = 'C:/Users/villegaskmp/Desktop/CWT ledger_reference';
const ZONAL_DIR = process.env.ZONAL_VALUES_DIR ?? DEFAULT_DIR;
const SHEET_NAME = 'ZV RATE';

export interface DoRevision {
  doNo: string;
  revision: string;
  from: string | null; // ISO date
  to: string | null; // ISO date, null = current/open-ended
  sheet: string;
}

export interface ZonalCandidate {
  barangay: string;
  name: string;
  vicinity: string;
  classification: string;
  value: number;
  // True when this row's classification is the one that actually applies to
  // this tower: RC/CC (whichever matches the tower's residential/commercial
  // nature) for a unit or storage room, or PS for parking — regardless of
  // nature, since parking is always PS. See towerNature.ts.
  recommended: boolean;
}

export interface ZonalLookupResult {
  rdo: string | null;
  file: string | null;
  notaryDate: string | null;
  applicableDo: DoRevision | null;
  namedMatches: ZonalCandidate[];
  message: string;
  towerNature: TowerNature;
  expectedUnitClassification: 'RC' | 'CC';
}

function findZonalFile(): string | null {
  let files: string[];
  try {
    files = fs.readdirSync(ZONAL_DIR);
  } catch {
    return null;
  }
  const hit = files.find((f) => /zonal[\s_-]*value/i.test(f) && /\.(xls|xlsx)$/i.test(f) && !f.startsWith('~$'));
  return hit ? path.join(ZONAL_DIR, hit) : null;
}

function sheetRows(ws: XLSX.WorkSheet): string[][] {
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) as string[][];
}

// Parse "4/19/24", "12/28/18" -> ISO date (M/D/YY, per the sheet's format).
function parseSlashDate(raw: string): string | null {
  const s = String(raw).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += year >= 50 ? 1900 : 2000;
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function parseValue(raw: string): number | null {
  const s = String(raw).replace(/[,\s]/g, '');
  if (!s || !/\d/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

interface RateRow {
  tower: string;
  location: string;
  rdo: string;
  tagging: string;
  from: string | null;
  to: string | null; // null once resolved to "current" for the newest row per tower
  rc: number | null;
  cc: number | null;
  ps: number | null;
}

// Column positions are detected from the header row rather than hardcoded,
// so the lookup keeps working if the tax team reorders columns when they
// regenerate this sheet.
function parseRateSheet(wb: XLSX.WorkBook): RateRow[] {
  const ws = wb.Sheets[SHEET_NAME] ?? wb.Sheets[wb.SheetNames[0]];
  const rows = sheetRows(ws);
  const headerIdx = rows.findIndex((r) => r.some((c) => /^tower$/i.test(String(c).trim())));
  if (headerIdx < 0) return [];
  const header = rows[headerIdx].map((c) => String(c).trim().toLowerCase());
  const col = (pattern: RegExp) => header.findIndex((h) => pattern.test(h));
  const towerCol = col(/^tower$/);
  const locationCol = col(/location/);
  const rdoCol = col(/^rdo$/);
  const taggingCol = col(/tagging/);
  const fromCol = col(/effective\s*from/);
  const toCol = col(/effective\s*to/);
  const rcCol = col(/\brc\b/);
  const ccCol = col(/\bcc\b/);
  const psCol = col(/\bps\b/);

  const out: RateRow[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const tower = String(r[towerCol] ?? '').trim();
    if (!tower) continue;
    out.push({
      tower,
      location: String(r[locationCol] ?? '').trim(),
      rdo: String(r[rdoCol] ?? '').trim(),
      tagging: String(r[taggingCol] ?? '').trim(),
      from: parseSlashDate(String(r[fromCol] ?? '')),
      to: parseSlashDate(String(r[toCol] ?? '')),
      rc: parseValue(String(r[rcCol] ?? '')),
      cc: parseValue(String(r[ccCol] ?? '')),
      ps: parseValue(String(r[psCol] ?? '')),
    });
  }

  const newestFromByTower = new Map<string, string>();
  for (const row of out) {
    if (!row.from) continue;
    const cur = newestFromByTower.get(row.tower);
    if (!cur || row.from > cur) newestFromByTower.set(row.tower, row.from);
  }
  for (const row of out) {
    if (row.from && row.from === newestFromByTower.get(row.tower)) row.to = null;
  }
  return out;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\b(the|tower|condo|condominium|residences?|at)\b/g, '').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

function matches(rowName: string, term: string): boolean {
  const a = normalize(rowName);
  const b = normalize(term);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

let cache: Map<string, RateRow[]> = new Map();
function loadRows(file: string): RateRow[] {
  const key = file + ':' + fs.statSync(file).mtimeMs;
  const hit = cache.get(key);
  if (hit) return hit;
  const wb = XLSX.readFile(file, { cellDates: false });
  const rows = parseRateSheet(wb);
  cache = new Map([[key, rows]]);
  return rows;
}

export function lookupZonalValue(params: {
  tower: string | null;
  rdo?: string | null;
  notaryDate: string | Date | null;
  searchTerm?: string | null;
}): ZonalLookupResult {
  const rdo = params.rdo ?? findRdoForTower(params.tower);
  const notaryISO = params.notaryDate ? new Date(params.notaryDate).toISOString().slice(0, 10) : null;
  const towerNature = classifyTowerNature(params.tower);
  const expectedClass = expectedUnitClassification(towerNature);
  const result: ZonalLookupResult = {
    rdo,
    file: null,
    notaryDate: notaryISO,
    applicableDo: null,
    namedMatches: [],
    message: '',
    towerNature,
    expectedUnitClassification: expectedClass,
  };

  const file = findZonalFile();
  if (!file) return { ...result, message: 'No zonal value reference file found.' };
  result.file = path.basename(file);
  if (!notaryISO) return { ...result, message: 'No CTS notary date set — cannot pick the applicable rate window.' };

  const term = (params.searchTerm ?? params.tower ?? '').trim();
  const rows = loadRows(file);
  const nameMatched = term ? rows.filter((r) => matches(r.tower, term)) : [];
  const applicable = nameMatched.filter((r) => r.from !== null && notaryISO >= r.from && (r.to === null || notaryISO <= r.to));

  if (nameMatched.length === 0) {
    return { ...result, message: `"${term}" is not listed in the zonal value reference. Pick the applicable comparable manually.` };
  }
  if (applicable.length === 0) {
    return { ...result, message: `No rate window in the zonal value reference covers ${notaryISO} for "${term}".` };
  }

  const first = applicable[0];
  result.applicableDo = { doNo: first.tower, revision: first.tagging, from: first.from, to: first.to, sheet: SHEET_NAME };

  const candidates: ZonalCandidate[] = [];
  for (const row of applicable) {
    const entries: Array<['RC' | 'CC' | 'PS', number | null]> = [
      ['RC', row.rc],
      ['CC', row.cc],
      ['PS', row.ps],
    ];
    for (const [classification, value] of entries) {
      if (value === null) continue;
      candidates.push({
        barangay: row.location,
        name: row.tower,
        vicinity: row.location,
        classification,
        value,
        recommended: classification === expectedClass || classification === 'PS',
      });
    }
  }
  result.namedMatches = candidates;
  const recommendedCount = candidates.filter((c) => c.recommended).length;
  result.message = candidates.length
    ? `Found ${candidates.length} rate(s) for "${term}" effective ${first.from ?? '?'} → ${first.to ?? 'present'}` +
      (recommendedCount > 0
        ? ` — ${recommendedCount} recommended for this ${towerNature.toLowerCase()} tower (${expectedClass}/PS).`
        : '.')
    : `"${term}" matched a rate window but no RC/CC/PS values were populated.`;
  return result;
}
