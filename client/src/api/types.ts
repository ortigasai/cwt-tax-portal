export type ExposureStatus = 'MISSING_DATA' | 'COMPLIANT' | 'UNDER_REMITTED';

export interface SyncSummary {
  ranAt: string;
  durationMs: number;
  dataDir: string;
  contractsCreated: number;
  ledgersLoaded: string[];
  ledgersSkipped: number;
  oclpLoaded: boolean;
  oclpMatchedRows: number | null;
  ctsAttached: string[];
  errors: string[];
  skippedBusy?: boolean;
}

export interface SyncStatus {
  dataDir: string;
  last: SyncSummary | null;
}

export interface SharePointUpdateSummary {
  ranAt: string;
  oclp: {
    sharepointModifiedAt: string;
    sharepointSizeBytes: number;
    baseContractMatched: number;
    baseContractSelfReferenced: number;
  };
  zonalValue: {
    sharepointModifiedAt: string;
    sharepointSizeBytes: number;
    skipped: boolean;
  };
  folderSync: SyncSummary;
}

export interface DoRevision {
  doNo: string;
  revision: string;
  from: string | null;
  to: string | null;
  sheet: string;
}

export type TowerNature = 'RESIDENTIAL' | 'COMMERCIAL';

export interface ZonalCandidate {
  barangay: string;
  name: string;
  vicinity: string;
  classification: string;
  value: number;
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

export interface ContractSummary {
  contractNumber: string;
  buyerName: string | null;
  tower: string | null;
  unit: string | null;
  taxTagging: string | null;
  buyerClassification: string | null;
  cwtTaxBase: number | null;
  cwtTaxDue: number | null;
  actualRemitted: number;
  variance: number | null;
  totalPenalties: number;
  status: ExposureStatus;
  batchNumber: number | null;
  batchDate: string | null;
}

export interface DeadlineEntry {
  date: string;
  basisAmount: number;
  description: string;
}

export interface DeadlineResult {
  entries: DeadlineEntry[];
  primaryDeadline: string | null;
  note: string;
}

export interface PenaltyBreakdown {
  surcharge: number;
  compromisePenalty: number;
  interest: number;
  interestRate: number;
  daysLate: number;
  totalPenalties: number;
}

export interface PerPaymentLine {
  paymentDate: string | null;
  orNumber: string | null;
  totalCollection: number | null;
  clearingDocument: string | null;
  paymentPrincipal: number | null;
  paymentVat: number | null;
  applicableDeadline: string | null;
  shouldBeCwtDue: number | null;
  cwtFileTransactionDates: string[];
  cwtFileDatesPaid: string[];
  cwtFileTaxBase: number | null;
  cwtFileTaxDue: number | null;
  remittedInDeadlineMonth: boolean | null;
  difference: number | null;
  penalties: PenaltyBreakdown | null;
  totalDue: number | null;
}

export type TaxBaseSource = 'NET_TCP' | 'FMV_PER_TAX_DECLARATION' | 'ZONAL_VALUE';

export interface ExposureResult {
  cwtTaxBase: number | null;
  zonalValueBasis: number | null;
  fmvPerTaxDeclarationTotal: number | null;
  taxBaseSource: TaxBaseSource | null;
  cwtTaxDue: number | null;
  actualRemitted: number;
  variance: number | null;
  status: ExposureStatus;
  deadline: DeadlineResult;
  penalties: PenaltyBreakdown | null;
  perPaymentLines: PerPaymentLine[];
}

export interface PaymentRecord {
  id: string;
  baselineDate: string | null;
  paymentDate: string | null;
  totalCollection: number | null;
  clearingDocument: string | null;
  orNumber: string | null;
  paymentPrincipal: number | null;
  paymentVat: number | null;
  isSubtotal: boolean;
}

export interface CollectionEvent {
  id: string;
  buyerClassification: string | null;
  taxTagging: string | null;
  sourceTaxBase: number | null;
  actualTaxDue: number | null;
  transactionDate: string | null;
  datePaid: string | null;
  remarks: string | null;
}

export interface RptTowerRecord {
  id: string;
  tower: string;
  type: string | null;
  floor: string | null;
  unit: string;
  fairMarketValue: number;
  estate: string | null;
}

export interface ContractDetail {
  contractNumber: string;
  buyerName: string | null;
  estate: string | null;
  tower: string | null;
  unit: string | null;
  totalTCP: number | null;
  netTCP: number | null;
  ctsNotaryDate: string | null;
  sqmUnit: number | null;
  sqmParking: number | null;
  sqmStorage: number | null;
  ctsFileName: string | null;
  customerLedgerFileName: string | null;
  zonalValuePerSqmUnit: number | null;
  zonalValuePerSqmParking: number | null;
  matchedRptRecord: RptTowerRecord | null;
  matchedParkingRptRecord: RptTowerRecord | null;
  matchedStorageRptRecord: RptTowerRecord | null;
  notes: string | null;
  buyerClassification: string | null;
  taxTagging: string | null;
  fmvPerTaxDeclarationUnit: number | null;
  fmvPerTaxDeclarationParking: number | null;
  fmvPerTaxDeclarationStorage: number | null;
  rdo: string | null;
  paymentRecords: PaymentRecord[];
  collectionEvents: CollectionEvent[];
  exposure: ExposureResult;
}
