import { prisma } from '../lib/prisma';
import { lookupZonalValue } from './zonalValueLookup';
import { DOAS_API_URL, doasFetch } from './doasAuth';

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

const REQUEST_TIMEOUT_MS = 60_000;
const INDEX_TTL_MS = 5 * 60_000;

// DOAS stores 1900-01-01 where the date isn't known yet.
const DATE_PLACEHOLDER = '1900-01-01';
const PROVENANCE_MARKER = 'auto-retrieved from DOAS batch';

export interface DoasCtsRecord {
  contractNumber: string;
  // The CTS notary date we use (YYYY-MM-DD): the LATEST "CTS Notarization" date
  // read from the deed (the DOAS "read from deed" column), across every DOAS row
  // of the contract; only when no row has one, the latest DCMG endorsement date.
  notaryDate: string | null;
  notarySource: 'deed' | 'dcmg' | null;
  // What the portal used before the deed-read date became the reference (the
  // DCMG endorsement date from the newest batch that had one) — kept only to
  // recognise values that were auto-filled from it, never ones typed by hand.
  legacyNotaryDate: string | null;
  // Unit / storage and parking area (sqm) as shown in the DOAS "read from deed"
  // column — the value corrected on the DOAS screen when there is one, else what
  // was read off the deed; the DCMG saleable area only when the deed gave none.
  sqmUnit: number | null;
  sqmParking: number | null;
  // What the portal used before the deed column became the reference (DCMG
  // saleable area / the PDF extract's parking area) — only to recognise values
  // that were auto-filled from it, never ones typed by hand.
  legacySqmUnit: number | null;
  legacySqmParking: number | null;
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
  // Values corrected / confirmed on the DOAS screen (the pencil on a field).
  unit_area_sqm?: number | string | null;
  parking_area_sqm?: number | string | null;
  extract?: {
    unit_area?: number | string | null;
    parking_area?: number | string | null;
    // "CTS Notarization" as read from the deed (DOAS column of the DOAS screen).
    cts_date?: string | null;
  } | null;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await doasFetch(path, REQUEST_TIMEOUT_MS);
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

// One record per contract, merged across batches (newest batch first). The
// notary date is the latest deed-read CTS notarization over all of the
// contract's rows — a contract can appear in several batches, and a row can be
// re-read — falling back to the latest DCMG endorsement date when no row has a
// deed-read one. Every other field is taken from the first batch that has a
// usable value for it (a later batch may have what an earlier one still lacks).
export function buildCtsIndex(batches: { name: string; rows: DoasBatchRow[] }[]): Map<string, DoasCtsRecord> {
  const byContract = new Map<string, DoasCtsRecord>();
  const deedDates = new Map<string, string[]>();
  const dcmgDates = new Map<string, string[]>();
  for (const batch of batches) {
    for (const row of batch.rows ?? []) {
      const contractNumber = String(row.old_contract_no ?? '').trim();
      if (!contractNumber) continue;
      const existing = byContract.get(contractNumber) ?? {
        contractNumber,
        notaryDate: null,
        notarySource: null,
        legacyNotaryDate: null,
        sqmUnit: null,
        sqmParking: null,
        legacySqmUnit: null,
        legacySqmParking: null,
        tower: null,
        unit: null,
        batchName: batch.name,
      };
      const deed = realDate(row.extract?.cts_date);
      const dcmg = realDate(row.cts_notary_date);
      if (deed) deedDates.set(contractNumber, [...(deedDates.get(contractNumber) ?? []), deed]);
      if (dcmg) dcmgDates.set(contractNumber, [...(dcmgDates.get(contractNumber) ?? []), dcmg]);
      existing.legacyNotaryDate ??= dcmg;
      // SQM comes from the "read from deed" column: the corrected value when
      // the DOAS screen has one, else the deed read; the DCMG saleable area is
      // only the last resort when the deed gave no unit area.
      existing.sqmUnit ??=
        positiveNumber(row.unit_area_sqm) ?? positiveNumber(row.extract?.unit_area) ?? positiveNumber(row.saleable_area);
      existing.sqmParking ??= positiveNumber(row.parking_area_sqm) ?? positiveNumber(row.extract?.parking_area);
      existing.legacySqmUnit ??= positiveNumber(row.saleable_area);
      existing.legacySqmParking ??= positiveNumber(row.extract?.parking_area);
      existing.tower ??= row.subproject?.trim() || null;
      existing.unit ??= row.unit_no?.trim() || null;
      byContract.set(contractNumber, existing);
    }
  }
  const latest = (dates: string[] | undefined) => (dates && dates.length ? [...dates].sort().at(-1)! : null);
  for (const [contractNumber, rec] of byContract) {
    const deed = latest(deedDates.get(contractNumber));
    const dcmg = latest(dcmgDates.get(contractNumber));
    rec.notaryDate = deed ?? dcmg;
    rec.notarySource = deed ? 'deed' : dcmg ? 'dcmg' : null;
  }
  return byContract;
}

async function loadIndex(force = false): Promise<Map<string, DoasCtsRecord>> {
  if (!force && indexCache && Date.now() - indexCache.at < INDEX_TTL_MS) return indexCache.byContract;

  const batches = await getJson<DoasBatchSummary[]>('/api/batches');
  batches.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  const detailed: { name: string; rows: DoasBatchRow[] }[] = [];
  for (const batch of batches) {
    const detail = await getJson<{ rows: DoasBatchRow[] }>(`/api/batches/${encodeURIComponent(batch.id)}`);
    detailed.push({ name: batch.name, rows: detail.rows ?? [] });
  }
  const byContract = buildCtsIndex(detailed);
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
  // Contracts missing something, plus any that already hold a notary date: one
  // that was auto-filled from the old source may need moving to the deed-read date.
  const candidates = contracts.filter(
    (c) => c.ctsNotaryDate !== null || c.sqmUnit !== null || c.sqmParking !== null || c.zonalValuePerSqmUnit === null,
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

    let previousNotaryDate: Date | null = null;
    if (rec) {
      if (c.ctsNotaryDate === null && rec.notaryDate) {
        data.ctsNotaryDate = new Date(rec.notaryDate);
        fields.push('CTS notary date');
      } else if (
        c.ctsNotaryDate !== null &&
        rec.notarySource === 'deed' &&
        rec.notaryDate &&
        c.ctsNotaryDate.toISOString().slice(0, 10) === rec.legacyNotaryDate &&
        rec.legacyNotaryDate !== rec.notaryDate
      ) {
        // The stored date is exactly what the old source auto-filled (so nobody
        // typed it in): move it to the latest deed-read CTS notarization.
        previousNotaryDate = c.ctsNotaryDate;
        data.ctsNotaryDate = new Date(rec.notaryDate);
        fields.push('CTS notary date (now the latest deed-read date)');
      }
      // Empty → fill. Already holding exactly what the old source auto-filled
      // (so nobody typed it) → move to the deed-column value.
      const movable = (stored: unknown, legacy: number | null, deed: number | null) =>
        stored !== null && legacy !== null && deed !== null && Number(stored) === legacy && legacy !== deed;
      if (rec.sqmUnit !== null && (c.sqmUnit === null || movable(c.sqmUnit, rec.legacySqmUnit, rec.sqmUnit))) {
        data.sqmUnit = rec.sqmUnit;
        fields.push(c.sqmUnit === null ? 'unit SQM' : 'unit SQM (now the deed-column value)');
      }
      if (rec.sqmParking !== null && (c.sqmParking === null || movable(c.sqmParking, rec.legacySqmParking, rec.sqmParking))) {
        data.sqmParking = rec.sqmParking;
        fields.push(c.sqmParking === null ? 'parking SQM' : 'parking SQM (now the deed-column value)');
      }
      if (c.tower === null && rec.tower) data.tower = rec.tower;
      if (c.unit === null && rec.unit) data.unit = rec.unit;
    }

    // Zonal value follows from the (possibly just filled) notary date.
    const notaryDate = (data.ctsNotaryDate as Date | undefined) ?? c.ctsNotaryDate;
    const tower = (data.tower as string | undefined) ?? c.tower ?? rec?.tower ?? null;
    const zv = pickZonalValues(tower, notaryDate);
    // A zonal value that was auto-picked for the previous notary date follows the new date.
    const oldZv = previousNotaryDate ? pickZonalValues(tower, previousNotaryDate) : null;
    const sameRate = (stored: unknown, auto: number | null) => stored !== null && auto !== null && Number(stored) === auto;
    if ((c.zonalValuePerSqmUnit === null || (oldZv && sameRate(c.zonalValuePerSqmUnit, oldZv.unit))) && zv.unit !== null && Number(c.zonalValuePerSqmUnit) !== zv.unit) {
      data.zonalValuePerSqmUnit = zv.unit;
      fields.push('zonal value/sqm (unit)');
    }
    const parkingSqm = (data.sqmParking as number | undefined) ?? (c.sqmParking === null ? null : Number(c.sqmParking));
    if ((c.zonalValuePerSqmParking === null || (oldZv && sameRate(c.zonalValuePerSqmParking, oldZv.parking))) && zv.parking !== null && parkingSqm && Number(c.zonalValuePerSqmParking) !== zv.parking) {
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
