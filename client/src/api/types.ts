// NON_COMPLIANT: the totals tie out but a penalty was still computed on a late
// payment — any computed penalty means the contract is not compliant.
export type ExposureStatus = 'MISSING_DATA' | 'COMPLIANT' | 'UNDER_REMITTED' | 'NON_COMPLIANT';

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
  ctsFetchedFromSharePoint: string[];
  errors: string[];
  skippedBusy?: boolean;
}

export interface SyncStatus {
  dataDir: string;
  last: SyncSummary | null;
  // The automatic daily "Update from SharePoint".
  schedule?: {
    enabled: boolean;
    hour: number;
    nextRunAt: string | null;
    running: boolean;
    lastRun: { trigger: 'scheduled' | 'manual'; startedAt: string; finishedAt: string; ok: boolean; error: string | null } | null;
  };
}

// What uploading a contract list retrieved, for just those contracts.
export interface UploadIntakeSummary {
  ledgersLoaded: string[];
  ledgersNotFound: string[];
  ledgersFromReviewed?: string[];
  ledgersNotReviewed?: string[];
  ledgersNotLatest?: LedgerNotLatestInfo[];
  ledgersNotFoundAdvice?: { contractNumber: string; advice: string }[];
  oclp: { refreshedFromSharePoint: boolean; matchedRows: number | null };
  ctsFetched: string[];
  ctsOnFile: string[];
  ctsDataFilled: CtsDataFill[];
  ctsDataComplete: string[];
  errors: string[];
}

export interface CtsDataFill {
  contractNumber: string;
  fields: string[];
  batchName: string;
}

export interface EtbLine {
  paymentDate: string | null;
  principal: number | null;
  totalCollection: number | null;
  applicableDeadline: string | null;
  shouldBeCwtDue: number | null;
  cwtFileTaxDue: number | null;
  difference: number | null;
  totalDue: number | null;
  beforeEtbStart: boolean;
  coveredByBulkRemittance: boolean;
  paidInAdvance: boolean;
}

export interface AnalysisState {
  state: 'DONE' | 'PROVISIONAL' | 'PENDING';
  missing: string[];
  ledgerReviewed: boolean;
}

export interface EtbContractResult {
  contractNumber: string;
  // The ETB start date this contract was computed with (its own, else the run's default).
  startDate: string | null;
  analysis: AnalysisState;
  buyerName: string | null;
  tower: string | null;
  unit: string | null;
  storedClassification: string | null;
  taxTagging: string | null;
  ctsNotaryDate: string | null;
  netTCP: number | null;
  cwtTaxBase: number | null;
  taxBaseSource: string | null;
  cwtTaxDue: number | null;
  actualRemitted: number;
  variance: number | null;
  status: ExposureStatus;
  totalPenalties: number | null;
  primaryDeadline: string | null;
  deadlineNote: string;
  deadlineCount: number;
  paymentCount: number;
  paymentsBeforeStart: number;
  lines: EtbLine[];
}

// One saved ETB calculation (a row on the ETB Dashboard).
export interface EtbRunSummary {
  id: number;
  title: string;
  customTitle: string | null;
  filename: string;
  startDate: string | null;
  contractCount: number;
  // How many contracts have their own start date in the uploaded list.
  perContractStarts: number;
  createdAt: string;
}

export interface EtbRunDetail {
  run: EtbRunSummary;
  startDate: string | null;
  // Contracts in the run that have since been deleted from the portal.
  missing: string[];
  results: EtbContractResult[];
}

export interface EtbComputeResponse {
  runId?: number;
  runTitle?: string;
  startDate: string | null;
  perContractStarts?: number;
  totalFound: number;
  created: number;
  retrievedFor: number;
  ctsFilled: number;
  errors: string[];
  results: EtbContractResult[];
}

export interface CtsDataResult {
  filled: CtsDataFill[];
  notFound: string[];
  errors: string[];
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
  ledgers: {
    filesChecked: number;
    filesDownloaded: string[];
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
  batchTitle: string | null;
  batchDate: string | null;
  // Payment rows whose clearing document is outside the "14" series — non-zero
  // means the ledger on file is not LedgerFit's latest corrected ledger.
  nonCurrentClearingDocs?: number;
  // Is the analysis done (everything needed is on file), so the payment ledger
  // can be downloaded? PROVISIONAL = ready but the ledger isn't Tax-accepted yet.
  analysis?: { state: 'DONE' | 'PROVISIONAL' | 'PENDING'; missing: string[]; ledgerReviewed: boolean };
}

export interface LedgerSeriesCheck {
  isLatest: boolean;
  nonCurrentCount: number;
  sample: string[];
  advice: string | null;
  ledgerfitSessionId: string | null;
}

export interface LedgerNotLatestInfo {
  contractNumber: string;
  fileName: string;
  nonCurrentDocs: number;
  sample: string[];
  ledgerfitSessionId: string | null;
  ledgerfitStatus: string | null;
  advice: string;
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
  // After an AR Sale bulk CWT remittance — no CWT due or penalty of its own.
  coveredByBulkRemittance?: boolean;
  // CWT remitted by this row's deadline already covered everything due through it.
  paidInAdvance?: boolean;
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
  ledgerSeries?: LedgerSeriesCheck;
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

// ONETT Summary (see server/src/routes/onett.ts).
export interface OnettSummaryRow {
  docket: string;
  buyer: string;
  location: string;
  class: string;
  areaRc: number | null;
  areaPs: number | null;
  zvPerSqmRc: number | null;
  zvPerSqmPs: number | null;
  zonalValue: number;
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

export interface OnettAccountView {
  docket: string;
  batch?: string | null;
  sheetPage?: number;
  sheetDate?: string;
  buyers: string[];
  tins?: string[];
  sheetNote?: string | null;
  cts?: string | null;
  terms?: string | null;
  schedulePages?: number[];
  irisPages?: number[];
  irisFinding?: string | null;
  handwritten?: string[];
  rows: OnettSummaryRow[];
  reviewFlags: string[];
}

export interface OnettStats {
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

export interface OnettSummaryInfo {
  id: number;
  title: string;
  customTitle: string | null;
  files: { name: string; pages: number; startPage: number }[];
  pageCount: number;
  status: 'PROCESSING' | 'AWAITING_EXTRACTION' | 'READY' | 'FAILED';
  statusNote: string | null;
  createdAt: string;
  updatedAt: string;
  stats: OnettStats;
}

export interface OnettDetail {
  summary: OnettSummaryInfo;
  accounts: OnettAccountView[];
}
