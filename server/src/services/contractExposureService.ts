import { Contract, CwtCollectionEvent, PaymentRecord, RptTowerRecord } from '../generated/prisma';
import { findRdoForTower } from '../lib/rdoLocations';
import { nonCurrentClearingDocs } from '../lib/clearingSeries';
import { REVIEWED_LEDGER_PREFIX } from './reviewedLedgers';
import {
  BuyerClassification,
  computeExposure,
  ContractComputationInput,
  ExposureResult,
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

export function buildComputationInput(
  contract: ContractWithRelations,
  override?: ComputationOverride,
): ContractComputationInput {
  const { buyerClassification, taxTagging } = deriveClassificationAndTagging(contract.collectionEvents);

  return {
    etbStartDate: override?.etbStartDate ?? null,
    netTCP: toNumber(contract.netTCP),
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
    taxTagging: override?.taxTagging ?? normalizeTaxTagging(taxTagging),
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
  taxTagging: string | null;
  fmvPerTaxDeclarationUnit: number | null;
  fmvPerTaxDeclarationParking: number | null;
  fmvPerTaxDeclarationStorage: number | null;
  rdo: string | null;
} {
  const { buyerClassification, taxTagging } = deriveClassificationAndTagging(contract.collectionEvents);
  return {
    buyerClassification: override?.buyerClassification ?? buyerClassification,
    taxTagging: override?.taxTagging ?? taxTagging,
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
