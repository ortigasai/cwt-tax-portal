import { Contract, CwtCollectionEvent, PaymentRecord, RptTowerRecord } from '../generated/prisma';
import { findRdoForTower } from '../lib/rdoLocations';
import { nonCurrentClearingDocs } from '../lib/clearingSeries';
import { REVIEWED_LEDGER_PREFIX } from './reviewedLedgers';
import {
  BuyerClassification,
  computeExposure,
  ContractComputationInput,
  ExposureResult,
  initialPaymentsExceedThreshold,
  normalizeBuyerClassification,
  normalizeTaxTagging,
  TaxTagging,
} from './computation';

export type ContractWithRelations = Contract & {
  paymentRecords: PaymentRecord[];
  collectionEvents: CwtCollectionEvent[];
  matchedRptRecord: RptTowerRecord | null;
  matchedParkingRptRecord: RptTowerRecord | null;
  matchedStorageRptRecord: RptTowerRecord | null;
};

function toNumber(value: { toNumber(): number } | null | undefined): number | null {
  return value ? value.toNumber() : null;
}

// The FS lists buyer classification and tax tagging as coming from the OCLP
// 1606 Summary import. If multiple collection events disagree (shouldn't
// normally happen — they're contract-level attributes), we take the most
// recent import's value.
function deriveClassificationAndTagging(events: CwtCollectionEvent[]): {
  buyerClassification: string | null;
  taxTagging: string | null;
} {
  const withValues = events.filter((e) => e.buyerClassification || e.taxTagging);
  const latest = withValues[withValues.length - 1];
  return {
    buyerClassification: latest?.buyerClassification ?? null,
    taxTagging: latest?.taxTagging ?? null,
  };
}

// What-if overrides on top of a contract's stored data — used by the ETB
// Calculator, which treats every uploaded buyer as ETB (from an optional start
// date) without touching the contract's own stored classification.
export interface ComputationOverride {
  buyerClassification?: BuyerClassification;
  taxTagging?: TaxTagging;
  etbStartDate?: Date | null;
}

// The ETB Calculator's override: whatever the contract is stored as (Individual
// / Corporation, Installment / Cash Deferred / AR Sale / untagged), compute it
// as an ETB buyer on installment terms.
export function etbOverride(etbStartDate: Date | null): ComputationOverride {
  return { buyerClassification: 'ETB', taxTagging: 'INSTALLMENT', etbStartDate };
}

// Is this contract, although tagged Installment, really a Cash Deferred sale
// because the 25% rule was breached in the year of the first payment? Skipped
// when a tagging override is in force (the ETB Calculator's what-if).
export function cashDeferredByRule(
  contract: ContractWithRelations,
  override?: ComputationOverride,
): { storedTagging: TaxTagging; year: number; triggerDate: Date } | null {
  if (override?.taxTagging) return null;
  const { taxTagging } = deriveClassificationAndTagging(contract.collectionEvents);
  const stored = normalizeTaxTagging(taxTagging);
  // Only accounts the 1606 tags as Installment. An untagged account has no 1606
  // remittances to compute penalties from, so it is left as it was.
  if (stored !== 'INSTALLMENT') return null;
  const check = initialPaymentsExceedThreshold(
    contract.paymentRecords.map((p) => ({
      paymentDate: p.paymentDate,
      totalCollection: toNumber(p.totalCollection),
      isSubtotal: p.isSubtotal,
    })),
    toNumber(contract.totalTCP),
  );
  return check.exceeded && check.year !== null && check.triggerDate
    ? { storedTagging: stored, year: check.year, triggerDate: check.triggerDate }
    : null;
}

// What the tax tagging SHOULD be, from our own reading of the payment ledger
// (whatever the 1606 tags it as): Cash Deferred when the collections in the year
// of the first payment exceed 25% of the Total Contract Price, otherwise
// Installment. `triggerDate` is the payment on which the 25% was passed.
export interface TaggingAnalysis {
  shouldBe: 'CASH DEFERRED' | 'INSTALLMENT' | null; // null: cannot be told (no payments / no Total Contract Price)
  firstYear: number | null;
  triggerDate: Date | null;
  threshold: number | null; // 25% of the Total Contract Price
}

export function analyzeTagging(contract: ContractWithRelations): TaggingAnalysis {
  const totalTCP = toNumber(contract.totalTCP);
  const check = initialPaymentsExceedThreshold(
    contract.paymentRecords.map((p) => ({
      paymentDate: p.paymentDate,
      totalCollection: toNumber(p.totalCollection),
      isSubtotal: p.isSubtotal,
    })),
    totalTCP,
  );
  if (totalTCP === null || totalTCP <= 0 || check.year === null) {
    return { shouldBe: null, firstYear: null, triggerDate: null, threshold: null };
  }
  return {
    shouldBe: check.exceeded ? 'CASH DEFERRED' : 'INSTALLMENT',
    firstYear: check.year,
    triggerDate: check.triggerDate,
    threshold: Math.round(totalTCP * 25) / 100,
  };
}

export function buildComputationInput(
  contract: ContractWithRelations,
  override?: ComputationOverride,
): ContractComputationInput {
  const { buyerClassification, taxTagging } = deriveClassificationAndTagging(contract.collectionEvents);
  const byRule = cashDeferredByRule(contract, override);

  return {
    etbStartDate: override?.etbStartDate ?? null,
    netTCP: toNumber(contract.netTCP),
    totalTCP: toNumber(contract.totalTCP),
    fmvPerTaxDeclarationUnit: contract.matchedRptRecord ? toNumber(contract.matchedRptRecord.fairMarketValue) : null,
    fmvPerTaxDeclarationParking: contract.matchedParkingRptRecord
      ? toNumber(contract.matchedParkingRptRecord.fairMarketValue)
      : null,
    fmvPerTaxDeclarationStorage: contract.matchedStorageRptRecord
      ? toNumber(contract.matchedStorageRptRecord.fairMarketValue)
      : null,
    zonalValuePerSqmUnit: toNumber(contract.zonalValuePerSqmUnit),
    zonalValuePerSqmParking: toNumber(contract.zonalValuePerSqmParking),
    sqmUnit: toNumber(contract.sqmUnit),
    sqmParking: toNumber(contract.sqmParking),
    sqmStorage: toNumber(contract.sqmStorage),
    buyerClassification: override?.buyerClassification ?? normalizeBuyerClassification(buyerClassification),
    taxTagging: byRule ? 'CASH_DEFERRED' : override?.taxTagging ?? normalizeTaxTagging(taxTagging),
    cashDeferredByRule: byRule,
    manualDeadlineOverride: null,
    paymentRecords: contract.paymentRecords.map((p) => ({
      paymentDate: p.paymentDate,
      totalCollection: toNumber(p.totalCollection),
      isSubtotal: p.isSubtotal,
      orNumber: p.orNumber,
      clearingDocument: p.clearingDocument,
      paymentPrincipal: toNumber(p.paymentPrincipal),
      paymentVat: toNumber(p.paymentVat),
    })),
    collectionEvents: contract.collectionEvents.map((e) => ({
      actualTaxDue: toNumber(e.actualTaxDue),
      datePaid: e.datePaid,
      transactionDate: e.transactionDate,
      sourceTaxBase: toNumber(e.sourceTaxBase),
      baseContract: e.baseContract,
      contractNumberRaw: e.contractNumberRaw,
      remarks: e.remarks,
    })),
  };
}

export function computeContractExposure(
  contract: ContractWithRelations,
  asOfDate: Date = new Date(),
  override?: ComputationOverride,
): ExposureResult {
  return computeExposure(buildComputationInput(contract, override), asOfDate);
}

// Is the analysis of this contract finished, i.e. is everything the CWT
// computation needs on file so its payment ledger can be downloaded?
//   DONE         — ledger (latest 14-series, from Reviewed & Accepted), 1606
//                  remittances, CTS notary date and unit SQM are all in.
//   PROVISIONAL  — all of that is in, but the ledger did not come from
//                  Reviewed & Accepted (a SharePoint/local file), so Tax has
//                  not accepted it yet.
//   PENDING      — something is still missing (listed in `missing`).
export interface AnalysisState {
  state: 'DONE' | 'PROVISIONAL' | 'PENDING';
  missing: string[];
  ledgerReviewed: boolean;
}

export function deriveAnalysis(contract: ContractWithRelations): AnalysisState {
  const missing: string[] = [];
  const rows = contract.paymentRecords.filter((p) => !p.isSubtotal);
  const ledgerReviewed = (contract.customerLedgerFileName ?? '').startsWith(REVIEWED_LEDGER_PREFIX);

  if (rows.length === 0) missing.push('Payment ledger');
  else if (nonCurrentClearingDocs(rows.map((p) => p.clearingDocument)).length > 0) {
    missing.push('Latest ledger (clearing documents not in the 14 series)');
  }
  if (contract.collectionEvents.length === 0) missing.push('1606 remittances');
  if (!contract.ctsNotaryDate) missing.push('CTS notary date');
  if (!contract.sqmUnit) missing.push('Unit SQM');

  return {
    state: missing.length > 0 ? 'PENDING' : ledgerReviewed ? 'DONE' : 'PROVISIONAL',
    missing,
    ledgerReviewed,
  };
}

export function deriveDisplayFields(
  contract: ContractWithRelations,
  override?: ComputationOverride,
): {
  buyerClassification: string | null;
  // The tagging the contract is computed under (CASH DEFERRED when the 25% rule applies).
  taxTagging: string | null;
  // The tagging as recorded on the 1606 (before the 25% rule).
  storedTaxTagging: string | null;
  // Set when taxTagging differs from the stored one because of the 25% rule.
  taxTaggingNote: string | null;
  fmvPerTaxDeclarationUnit: number | null;
  fmvPerTaxDeclarationParking: number | null;
  fmvPerTaxDeclarationStorage: number | null;
  rdo: string | null;
} {
  const { buyerClassification, taxTagging } = deriveClassificationAndTagging(contract.collectionEvents);
  const byRule = cashDeferredByRule(contract, override);
  return {
    buyerClassification: override?.buyerClassification ?? buyerClassification,
    taxTagging: byRule ? 'CASH DEFERRED' : override?.taxTagging ?? taxTagging,
    storedTaxTagging: override?.taxTagging ?? taxTagging,
    taxTaggingNote: byRule
      ? `Stored as ${taxTagging ?? 'INSTALLMENT'}; collections in ${byRule.year} exceeded 25% of the Total Contract Price`
      : null,
    fmvPerTaxDeclarationUnit: contract.matchedRptRecord ? toNumber(contract.matchedRptRecord.fairMarketValue) : null,
    fmvPerTaxDeclarationParking: contract.matchedParkingRptRecord
      ? toNumber(contract.matchedParkingRptRecord.fairMarketValue)
      : null,
    fmvPerTaxDeclarationStorage: contract.matchedStorageRptRecord
      ? toNumber(contract.matchedStorageRptRecord.fairMarketValue)
      : null,
    rdo: findRdoForTower(contract.tower),
  };
}
