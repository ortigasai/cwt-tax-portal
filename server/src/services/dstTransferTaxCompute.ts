import { DstTransferTaxInputRow } from '../parsers/dstTransferTaxParser';
import { lookupZonalValue } from './zonalValueLookup';

// Traces each uploaded row against the tax team's Zonal Value reference
// (see zonalValueLookup.ts) and resolves the RDO, Tagging, and Unit/Storage
// & Parking ZV/sqm to use — reusing the exact same date-windowed rate
// resolution as the per-contract "BIR Zonal Value Lookup" on the contract
// detail page (including "use the latest rate if the notary date is after
// the latest effective date", since that's how zonalValueLookup already
// treats the newest row per tower as open-ended).
//
// Two full sets are computed per row: one "as of the CTS Notary Date" (the
// rate window that actually applied when the Contract to Sell was
// notarized), and one "as of DOAS" (Deed of Absolute Sale) that always uses
// the current/latest rate — DOAS execution date isn't a column the reviewer
// tracks here, and the current rate is by definition what's in effect now.

interface ZonalRates {
  rdo: string | null;
  tagging: 'Residential' | 'Offices' | null;
  unitZvPerSqm: number | null;
  parkingZvPerSqm: number | null;
  matchNotes: string | null;
}

function resolveZonalRates(tower: string | null, asOfDate: Date | string | null): ZonalRates {
  const lookup = lookupZonalValue({ tower, notaryDate: asOfDate });
  const tagging: 'Residential' | 'Offices' | null = tower ? (lookup.towerNature === 'COMMERCIAL' ? 'Offices' : 'Residential') : null;

  const unitMatch = lookup.namedMatches.find((m) => m.recommended && m.classification === lookup.expectedUnitClassification);
  const parkingMatch = lookup.namedMatches.find((m) => m.recommended && m.classification === 'PS');

  const unitZvPerSqm = unitMatch?.value ?? null;
  const parkingZvPerSqm = parkingMatch?.value ?? null;

  return {
    rdo: lookup.rdo,
    tagging,
    unitZvPerSqm,
    parkingZvPerSqm,
    matchNotes: unitZvPerSqm === null && parkingZvPerSqm === null ? lookup.message : null,
  };
}

function totalZv(
  unitZvPerSqm: number | null,
  parkingZvPerSqm: number | null,
  unitStorageArea: number | null,
  parkingArea: number | null,
): { totalZvUnitStorage: number | null; totalZvParking: number | null; totalZv: number | null } {
  const totalZvUnitStorage = unitZvPerSqm !== null && unitStorageArea !== null ? unitZvPerSqm * unitStorageArea : null;
  const totalZvParking = parkingZvPerSqm !== null && parkingArea !== null ? parkingZvPerSqm * parkingArea : null;
  const total = totalZvUnitStorage === null && totalZvParking === null ? null : (totalZvUnitStorage ?? 0) + (totalZvParking ?? 0);
  return { totalZvUnitStorage, totalZvParking, totalZv: total };
}

export interface DstTransferTaxComputedRow extends DstTransferTaxInputRow {
  rdo: string | null;
  tagging: 'Residential' | 'Offices' | null;
  // As of the CTS Notary Date.
  unitZvPerSqm: number | null;
  parkingZvPerSqm: number | null;
  totalZvUnitStorage: number | null;
  totalZvParking: number | null;
  totalZv: number | null;
  zonalMatchNotes: string | null;
  // As of DOAS — always the current/latest rate (see file-level comment).
  doasUnitZvPerSqm: number | null;
  doasParkingZvPerSqm: number | null;
  doasTotalZvUnitStorage: number | null;
  doasTotalZvParking: number | null;
  doasTotalZv: number | null;
  doasZonalMatchNotes: string | null;
  // DST/Transfer Tax — see dstTaxCompute() below.
  dstTaxBase: number | null;
  dstDue: number | null;
  transferTax: number | null;
}

// The RDO number (e.g. "40") out of a label like "RDO 40 – Quezon City" —
// same convention the reviewer's Transfer Tax rule is keyed on.
function rdoNumber(rdoLabel: string | null): string | null {
  const m = rdoLabel?.match(/RDO\s*0*(\d{1,3})/i);
  return m ? m[1] : null;
}

// DST Tax Base = highest of TCP net of VAT, FMV per Tax Declaration, and
// Total ZV at the time of CTS, rounded UP to the nearest thousand. DST Due
// = DST Tax Base x 1.5%. Transfer Tax's base and rate depend on the tower's
// RDO — rules only defined for RDO 40/42/43 (null, i.e. blank, otherwise;
// per the app's convention elsewhere, never guess a rate for an RDO with no
// defined rule).
function dstTaxCompute(
  tcpNetOfVat: number | null,
  fmvPerTaxDeclaration: number | null,
  totalZvCts: number | null,
  totalZvDoas: number | null,
  rdo: string | null,
): { dstTaxBase: number | null; dstDue: number | null; transferTax: number | null } {
  const maxOf = (...vals: (number | null)[]): number => {
    const present = vals.filter((v): v is number => v !== null);
    return present.length ? Math.max(...present) : 0;
  };

  const dstTaxBase = Math.ceil(maxOf(tcpNetOfVat, fmvPerTaxDeclaration, totalZvCts) / 1000) * 1000;
  const dstDue = dstTaxBase * 0.015;

  const num = rdoNumber(rdo);
  const doasBasis = maxOf(tcpNetOfVat, fmvPerTaxDeclaration, totalZvDoas);
  let transferTax: number | null;
  if (num === '40') transferTax = doasBasis * 0.0075 + 100;
  else if (num === '43') transferTax = doasBasis * 0.0075;
  else if (num === '42') transferTax = (tcpNetOfVat ?? 0) * 0.006;
  else transferTax = null;

  return { dstTaxBase, dstDue, transferTax };
}

export function computeDstTransferTaxRow(input: DstTransferTaxInputRow): DstTransferTaxComputedRow {
  // CTS uses the row's own notary date as-is (including null — the lookup
  // correctly refuses to guess a rate when there's no date to anchor it,
  // same as the per-contract lookup does).
  const cts = resolveZonalRates(input.tower, input.ctsNotaryDate);
  const doas = resolveZonalRates(input.tower, new Date());

  const ctsTotals = totalZv(cts.unitZvPerSqm, cts.parkingZvPerSqm, input.unitStorageArea, input.parkingArea);
  const doasTotals = totalZv(doas.unitZvPerSqm, doas.parkingZvPerSqm, input.unitStorageArea, input.parkingArea);

  const rdo = cts.rdo ?? doas.rdo;
  const { dstTaxBase, dstDue, transferTax } = dstTaxCompute(
    input.tcpNetOfVat,
    input.fmvPerTaxDeclaration,
    ctsTotals.totalZv,
    doasTotals.totalZv,
    rdo,
  );

  return {
    ...input,
    // RDO/Tagging are tower-derived, not date-derived, so both lookups agree
    // on them whenever a match exists — prefer whichever one matched.
    rdo,
    tagging: cts.tagging ?? doas.tagging,
    unitZvPerSqm: cts.unitZvPerSqm,
    parkingZvPerSqm: cts.parkingZvPerSqm,
    ...ctsTotals,
    zonalMatchNotes: cts.matchNotes,
    doasUnitZvPerSqm: doas.unitZvPerSqm,
    doasParkingZvPerSqm: doas.parkingZvPerSqm,
    doasTotalZvUnitStorage: doasTotals.totalZvUnitStorage,
    doasTotalZvParking: doasTotals.totalZvParking,
    doasTotalZv: doasTotals.totalZv,
    doasZonalMatchNotes: doas.matchNotes,
    dstTaxBase,
    dstDue,
    transferTax,
  };
}

export function computeDstTransferTaxRows(inputs: DstTransferTaxInputRow[]): DstTransferTaxComputedRow[] {
  return inputs.map(computeDstTransferTaxRow);
}
