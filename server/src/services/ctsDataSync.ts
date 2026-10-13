import { prisma } from '../lib/prisma';
import { lookupZonalValue } from './zonalValueLookup';

// Fills each contract's CTS-derived fields — CTS notary date and the unit /
// parking SQM — from the DOAS Notary Endorsement System's batches
// (<DOAS_API_URL>/api/batches). The CTS PDFs themselves are scanned images,
// so the portal can't read these values off the file; the DOAS team has
// already captured them per contract in their endorsement batches (keyed by
// the contract number, there called old_contract_no).
//
// Strictly read-only against DOAS (GETs only), and strictly additive here:
// only fields that are still empty on the contract are filled, so anything
// typed in by hand (or saved as a manual override) always wins.

const DOAS_API_URL = (process.env.DOAS_API_URL ?? 'http://192.168.16.239:4100').replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = 60_000;
const INDEX_TTL_MS = 5 * 60_000;

// DOAS stores 1900-01-01 where the date isn't known yet.
const DATE_PLACEHOLDER = '1900-01-01';
const PROVENANCE_MARKER = 'auto-retrieved from DOAS batch';

export interface DoasCtsRecord {
  contractNumber: string;
  notaryDate: string | null; // YYYY-MM-DD
  sqmUnit: number | null;
  sqmParking: number | null;
  tower: string | null;
  unit: string | null;
  batchName: string;
}

export interface CtsDataFill {
  contractNumber: string;
  fields: string[];
  batchName: string;
}

export interface CtsDataResult {
  filled: CtsDataFill[];
  // Contracts that had something missing and DOAS had nothing usable for.
  notFound: string[];
  errors: string[];
}

interface DoasBatchSummary {
  id: string;
  name: string;
  created_at: string;
}

interface DoasBatchRow {
  old_contract_no: string | null;
  subproject: string | null;
  unit_no: string | null;
  saleable_area: number | string | null;
  cts_notary_date: string | null;
  extract?: {
    parking_area?: number | string | null;
  } | null;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${DOAS_API_URL}${path}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

function positiveNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function realDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const iso = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && iso !== DATE_PLACEHOLDER ? iso : null;
}

let indexCache: { at: number; byContract: Map<string, DoasCtsRecord> } | null = null;

// One record per contract, merged across batches: newest batch first, each
// field taken from the first batch that has a usable value for it (a later
// batch may have the notary date an earlier one still lacks).
async function loadIndex(force = false): Promise<Map<string, DoasCtsRecord>> {
  if (!force && indexCache && Date.now() - indexCache.at < INDEX_TTL_MS) return indexCache.byContract;

  const batches = await getJson<DoasBatchSummary[]>('/api/batches');
  batches.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  const byContract = new Map<string, DoasCtsRecord>();
  for (const batch of batches) {
    const detail = await getJson<{ rows: DoasBatchRow[] }>(`/api/batches/${encodeURIComponent(batch.id)}`);
    for (const row of detail.rows ?? []) {
      const contractNumber = String(row.old_contract_no ?? '').trim();
      if (!contractNumber) continue;
      const existing = byContract.get(contractNumber) ?? {
        contractNumber,
        notaryDate: null,
        sqmUnit: null,
        sqmParking: null,
        tower: null,
        unit: null,
        batchName: batch.name,
      };
      // saleable_area is the dependable unit SQM; the PDF extract's own
      // "unit_area" sometimes picks up the parking figure instead.
      existing.notaryDate ??= realDate(row.cts_notary_date);
      existing.sqmUnit ??= positiveNumber(row.saleable_area);
      existing.sqmParking ??= positiveNumber(row.extract?.parking_area);
      existing.tower ??= row.subproject?.trim() || null;
      existing.unit ??= row.unit_no?.trim() || null;
      byContract.set(contractNumber, existing);
    }
  }

  indexCache = { at: Date.now(), byContract };
  return byContract;
}

export async function fetchDoasCtsRecord(contractNumber: string): Promise<DoasCtsRecord | null> {
  return (await loadIndex()).get(contractNumber) ?? null;
}

// Zonal value per sqm is only filled when the reference file gives an
// unambiguous answer: exactly one recommended rate for the unit's class
// (RC/CC for the tower's nature) and exactly one PS rate for parking.
function pickZonalValues(tower: string | null, notaryDate: Date | null): { unit: number | null; parking: number | null } {
  if (!tower || !notaryDate) return { unit: null, parking: null };
  const lookup = lookupZonalValue({ tower, notaryDate });
  const unit = lookup.namedMatches.filter((c) => c.classification === lookup.expectedUnitClassification);
  const parking = lookup.namedMatches.filter((c) => c.classification === 'PS');
  return {
    unit: unit.length === 1 ? unit[0].value : null,
    parking: parking.length === 1 ? parking[0].value : null,
  };
}

// contractNumbers omitted → every contract that is still missing its notary
// date, a SQM figure or a zonal value.
export async function fillCtsDataForContracts(contractNumbers?: string[]): Promise<CtsDataResult> {
  const result: CtsDataResult = { filled: [], notFound: [], errors: [] };

  const contracts = await prisma.contract.findMany({
    where: contractNumbers ? { contractNumber: { in: contractNumbers } } : undefined,
  });
  const candidates = contracts.filter(
    (c) => c.ctsNotaryDate === null || c.sqmUnit === null || c.zonalValuePerSqmUnit === null,
  );
  if (candidates.length === 0) return result;

  let index: Map<string, DoasCtsRecord>;
  try {
    index = await loadIndex();
  } catch (e) {
    result.errors.push(`CTS data (DOAS batches at ${DOAS_API_URL}): ${(e as Error).message}`);
    return result;
  }

  for (const c of candidates) {
    const rec = index.get(c.contractNumber);
    const data: Record<string, unknown> = {};
    const fields: string[] = [];

    if (rec) {
      if (c.ctsNotaryDate === null && rec.notaryDate) {
        data.ctsNotaryDate = new Date(rec.notaryDate);
        fields.push('CTS notary date');
      }
      if (c.sqmUnit === null && rec.sqmUnit !== null) {
        data.sqmUnit = rec.sqmUnit;
        fields.push('unit SQM');
      }
      if (c.sqmParking === null && rec.sqmParking !== null) {
        data.sqmParking = rec.sqmParking;
        fields.push('parking SQM');
      }
      if (c.tower === null && rec.tower) data.tower = rec.tower;
      if (c.unit === null && rec.unit) data.unit = rec.unit;
    }

    // Zonal value follows from the (possibly just filled) notary date.
    const notaryDate = (data.ctsNotaryDate as Date | undefined) ?? c.ctsNotaryDate;
    const tower = (data.tower as string | undefined) ?? c.tower ?? rec?.tower ?? null;
    const zv = pickZonalValues(tower, notaryDate);
    if (c.zonalValuePerSqmUnit === null && zv.unit !== null) {
      data.zonalValuePerSqmUnit = zv.unit;
      fields.push('zonal value/sqm (unit)');
    }
    const parkingSqm = (data.sqmParking as number | undefined) ?? (c.sqmParking === null ? null : Number(c.sqmParking));
    if (c.zonalValuePerSqmParking === null && zv.parking !== null && parkingSqm) {
      data.zonalValuePerSqmParking = zv.parking;
      fields.push('zonal value/sqm (parking)');
    }

    if (fields.length === 0) {
      if (!rec || (!rec.notaryDate && rec.sqmUnit === null)) result.notFound.push(c.contractNumber);
      continue;
    }

    const batchName = rec?.batchName ?? 'zonal value reference';
    const note = `${fields.join(', ')} ${PROVENANCE_MARKER} "${batchName}" on ${new Date().toISOString().slice(0, 10)} — please verify.`;
    const notes = c.notes?.trim() ? `${c.notes.trim()}\n${note}` : note;

    await prisma.contract.update({ where: { id: c.id }, data: { ...data, notes } });
    result.filled.push({ contractNumber: c.contractNumber, fields, batchName });
  }

  return result;
}
