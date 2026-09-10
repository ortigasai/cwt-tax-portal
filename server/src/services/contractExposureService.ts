import { Contract, CwtCollectionEvent, PaymentRecord, RptTowerRecord } from '../generated/prisma';
import { findRdoForTower } from '../lib/rdoLocations';
import {
  computeExposure,
  ContractComputationInput,
  ExposureResult,
  normalizeBuyerClassification,
  normalizeTaxTagging,
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

export function buildComputationInput(contract: ContractWithRelations): ContractComputationInput {
  const { buyerClassification, taxTagging } = deriveClassificationAndTagging(contract.collectionEvents);

  return {
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
    buyerClassification: normalizeBuyerClassification(buyerClassification),
    taxTagging: normalizeTaxTagging(taxTagging),
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
    })),
  };
}

export function computeContractExposure(contract: ContractWithRelations, asOfDate: Date = new Date()): ExposureResult {
  return computeExposure(buildComputationInput(contract), asOfDate);
}

export function deriveDisplayFields(contract: ContractWithRelations): {
  buyerClassification: string | null;
  taxTagging: string | null;
  fmvPerTaxDeclarationUnit: number | null;
  fmvPerTaxDeclarationParking: number | null;
  fmvPerTaxDeclarationStorage: number | null;
  rdo: string | null;
} {
  const { buyerClassification, taxTagging } = deriveClassificationAndTagging(contract.collectionEvents);
  return {
    buyerClassification,
    taxTagging,
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
