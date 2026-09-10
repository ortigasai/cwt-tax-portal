// CWT exposure computation engine — implements FS Sections 6.1-6.4.
//
// Interpretation notes (flagged in README, confirm with tax/legal team):
// 1. AR Sale has no deadline rule in Section 6.1 (only a computation rule in
//    6.2). We cannot compute a deadline for AR Sale contracts automatically;
//    the caller must supply `manualDeadlineOverride`.
// 2. Sections 6.3 and 6.4 give conflicting penalty bases ("CWT Tax Due" vs
//    "the exposure amount"). We apply penalties to the exposure (variance)
//    amount, per the more specific 6.4 rule — this avoids penalizing the
//    portion of tax that was already remitted on time.
// 3. For ETB/Corporation + Installment, CWT is due per collection: each
//    row's should-be due is strictly that row's own principal x 5% (per the
//    tax team) — there is no reconciliation shortfall applied anywhere,
//    even if per-row amounts don't sum exactly to the contract's overall
//    CWT due (which is computed independently from Net TCP/FMV/Zonal, not
//    from summing collections). FIFO aging (first unmet deadline) anchors
//    the "days late" interest calculation.
// 4. Per-collection CWT (ETB/Corporation + Installment) is computed on the
//    VAT-exclusive principal — trusting the ledger's own recorded Payment
//    Principal (real data shows some rows don't follow a clean 12% VAT
//    split), falling back to Total Collection / 1.12 only when no principal
//    was recorded. This also applies to the reservation fee once it's
//    folded into the 1st downpayment.

export type BuyerClassification = 'INDIVIDUAL' | 'ETB' | 'CORPORATION' | 'UNKNOWN';
export type TaxTagging = 'INSTALLMENT' | 'CASH_DEFERRED' | 'AR_SALE' | 'UNKNOWN';

export interface PaymentRecordInput {
  paymentDate: Date | null;
  totalCollection: number | null;
  isSubtotal: boolean;
  orNumber?: string | null;
  clearingDocument?: string | null;
  paymentPrincipal?: number | null;
  paymentVat?: number | null;
}

export interface CollectionEventInput {
  actualTaxDue: number | null;
  datePaid: Date | null;
  transactionDate: Date | null;
  sourceTaxBase: number | null;
  // The 1606 file's stable anchor contract number for this remittance's
  // lineage — see dataImport.ts. Optional so existing fixtures/callers that
  // predate this field don't need updating.
  baseContract?: string | null;
  // The literal Contract Number this remittance was actually filed under in
  // the 1606 file — can differ from the contract's own number when this is
  // a previous buyer's remittance pulled in via baseContract matching.
  contractNumberRaw?: string | null;
}

export interface ContractComputationInput {
  netTCP: number | null;
  fmvPerTaxDeclarationUnit: number | null;
  fmvPerTaxDeclarationParking: number | null;
  fmvPerTaxDeclarationStorage: number | null;
  // Parking has its own rate; storage has none — it always shares the
  // unit's rate (see computeCwtTaxBase).
  zonalValuePerSqmUnit: number | null;
  zonalValuePerSqmParking: number | null;
  sqmUnit: number | null;
  sqmParking: number | null;
  sqmStorage: number | null;
  buyerClassification: BuyerClassification;
  taxTagging: TaxTagging;
  manualDeadlineOverride: Date | null;
  paymentRecords: PaymentRecordInput[];
  collectionEvents: CollectionEventInput[];
}

export interface DeadlineEntry {
  date: Date;
  basisAmount: number;
  description: string;
}

export interface DeadlineResult {
  entries: DeadlineEntry[];
  primaryDeadline: Date | null;
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
  paymentDate: Date | null;
  orNumber: string | null;
  totalCollection: number | null;
  clearingDocument: string | null;
  paymentPrincipal: number | null;
  paymentVat: number | null;
  applicableDeadline: Date | null;
  shouldBeCwtDue: number | null;
  // Matched from the OCLP 1606 Summary ("CWT file") by month/year of this
  // row's payment date vs. the CWT file entry's transaction date — see
  // matchCwtFileByMonth. Multiple CWT file entries can land on one ledger
  // row (e.g. two partial remittances in the same month); dates are listed
  // in full per FS Section 8's "reflect all dates" requirement, while the
  // base/due amounts are summed.
  cwtFileTransactionDates: Date[];
  cwtFileDatesPaid: Date[];
  cwtFileTaxBase: number | null;
  cwtFileTaxDue: number | null;
  // Base contract(s) of the matched CWT file entries — see CwtFileMatch.
  // baseContracts. Empty when there's no match.
  cwtFileBaseContracts: string[];
  // Literal Contract Number(s) the matched CWT file entries were filed
  // under — see CwtFileMatch.contractNumbers.
  cwtFileContractNumbers: string[];
  // Whether the applicable CWT deadline and (any of) the CWT file's actual
  // date(s) paid fall in the same calendar month — a per-row on-time
  // remittance check. Null when there's no deadline or no matched date
  // paid to compare.
  remittedInDeadlineMonth: boolean | null;
  // Should-Be CWT Due minus CWT File Tax Due — a simple per-row variance,
  // not a cumulative/reconciled figure. Null for the reservation fee row
  // (it never carries its own should-be due) and whenever either side is
  // missing.
  difference: number | null;
  // Per-row penalties (Section 6.3), computed only when `difference` shows
  // a shortfall (Should-Be CWT Due > CWT File Tax Due) exceeding the
  // rounding tolerance. Reuses the same surcharge/compromise/interest rules
  // as the contract-level penalty calculation, anchored on this row's own
  // applicable deadline and variance.
  penalties: PenaltyBreakdown | null;
  // The full amount owed for this row: Difference + Total Penalties. Null
  // whenever there are no penalties (no exposure on this row, or nothing to
  // compare), matching the same gating as `penalties`.
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
  status: 'MISSING_DATA' | 'COMPLIANT' | 'UNDER_REMITTED';
  deadline: DeadlineResult;
  penalties: PenaltyBreakdown | null;
  perPaymentLines: PerPaymentLine[];
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// mm/dd/yyyy, zero-padded, UTC-based (these are pure calendar dates stored
// at midnight UTC) — used anywhere a date is embedded into a free-text
// description or export cell rather than rendered as a real Excel date.
export function formatMDY(d: Date): string {
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

export function normalizeBuyerClassification(raw: string | null | undefined): BuyerClassification {
  const v = (raw ?? '').trim().toUpperCase();
  if (v === 'INDIVIDUAL') return 'INDIVIDUAL';
  if (v === 'ETB') return 'ETB';
  if (v === 'CORPORATION' || v === 'CORPORATE') return 'CORPORATION';
  return 'UNKNOWN';
}

export function normalizeTaxTagging(raw: string | null | undefined): TaxTagging {
  const v = (raw ?? '').trim().toUpperCase();
  if (v === 'INSTALLMENT') return 'INSTALLMENT';
  if (v === 'CASH DEFERRED' || v === 'CASH_DEFERRED') return 'CASH_DEFERRED';
  if (v === 'AR SALE' || v === 'AR_SALE') return 'AR_SALE';
  return 'UNKNOWN';
}

function addMonthsTenth(date: Date): Date {
  // 10th day of the month following `date`.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 10));
  return d;
}

// The set of payment records that can trigger a CWT obligation (dated,
// non-subtotal, non-zero collection), in chronological order. Multiple rows
// can share the same date (verified in real data), so callers must match
// entries back to rows by array position/reference — never by date value.
function triggerablePayments(records: PaymentRecordInput[]): PaymentRecordInput[] {
  return records
    .filter((r) => !r.isSubtotal && r.paymentDate && r.totalCollection)
    .sort((a, b) => a.paymentDate!.getTime() - b.paymentDate!.getTime());
}

// A round-thousands amount (25,000.00, 100,000.00, 250,000.00, ...) as the
// very first collection is almost always a reservation fee, not an
// amortization payment.
function looksLikeReservationFee(amount: number): boolean {
  return amount > 0 && Math.round(amount) % 1000 === 0;
}

const CWT_RATE = 0.05;
const EXPOSURE_ROUNDING_TOLERANCE = 1.0;

// Total Collection is VAT-inclusive (Principal x 1.12, since VAT = Principal
// x 12%); CWT is computed on the VAT-exclusive principal.
function netOfVat(grossAmount: number): number {
  return grossAmount / 1.12;
}

// CWT is computed on the VAT-exclusive principal. We trust the ledger's own
// recorded Payment Principal when available — real data shows some rows
// don't follow a clean 12% VAT split, so re-deriving via Total Collection /
// 1.12 can disagree with what the ledger actually booked. Only fall back to
// the derived value when no principal was recorded at all.
function principalBasis(row: PaymentRecordInput): number {
  return row.paymentPrincipal ?? netOfVat(row.totalCollection!);
}

// The ordered list of rows that will each generate their own deadline entry
// for ETB/Corporation + Installment, after folding a reservation fee (if
// any) into the 1st downpayment. Shared by computeDeadline and
// computePerPaymentLines — both call this and get the identical array (same
// object references, same order), so entries stay correctly matched to
// their originating row via array position even when multiple rows share
// the same payment date. See the module-level note (4) for why the
// reservation fee's own principal isn't trusted while the 1st downpayment's
// is: source ledgers book the full reservation fee as principal with zero
// VAT, but individual installment rows can (and do) have irregular splits
// that must be taken as booked.
function etbInstallmentObligationRows(paymentRecords: PaymentRecordInput[]): {
  rows: PaymentRecordInput[];
  basisOverrides: Map<PaymentRecordInput, number>;
  mergeNote: string | null;
  reservationFeeRow: PaymentRecordInput | null;
} {
  const triggerable = triggerablePayments(paymentRecords);
  if (triggerable.length < 2 || !looksLikeReservationFee(triggerable[0].totalCollection ?? 0)) {
    return { rows: triggerable, basisOverrides: new Map(), mergeNote: null, reservationFeeRow: null };
  }
  const [reservationFee, firstDownpayment, ...rest] = triggerable;
  const reservationFeeNet = round2(netOfVat(reservationFee.totalCollection!));
  const combinedBasis = round2(reservationFeeNet + principalBasis(firstDownpayment));
  const basisOverrides = new Map([[firstDownpayment, combinedBasis]]);
  const mergeNote = `includes reservation fee of ${reservationFee.totalCollection} (net of VAT: ${reservationFeeNet}) collected on ${formatMDY(reservationFee.paymentDate!)}`;
  return { rows: [firstDownpayment, ...rest], basisOverrides, mergeNote, reservationFeeRow: reservationFee };
}

// The single row whose payment date anchors the deadline for Individual +
// Installment (the LAST amortization payment). Shared with
// computePerPaymentLines so the trigger row is identified identically
// (matched by reference) regardless of duplicate payment dates.
function individualInstallmentTriggerRow(paymentRecords: PaymentRecordInput[]): PaymentRecordInput | null {
  const triggerable = triggerablePayments(paymentRecords);
  return triggerable[triggerable.length - 1] ?? null;
}

// The single row whose payment date anchors the deadline for Cash Deferred
// (first payment where cumulative collections exceed 25% of Net TCP). When
// multiple payments share that triggering payment's calendar month, the
// deadline and Should-Be CWT Due are attached to the LAST such row, not the
// exact row that crossed the threshold — the same "last row in the month"
// convention already used for CWT file matching (see matchCwtFileByMonth),
// per tax team direction.
function cashDeferredTriggerRow(paymentRecords: PaymentRecordInput[], netTCP: number): PaymentRecordInput | null {
  const triggerable = triggerablePayments(paymentRecords);
  const threshold = 0.25 * netTCP;
  let cumulative = 0;
  let triggerRow: PaymentRecordInput | null = null;
  for (const r of triggerable) {
    cumulative += r.totalCollection!;
    if (cumulative > threshold) {
      triggerRow = r;
      break;
    }
  }
  if (!triggerRow) return null;
  const sameMonth = triggerable.filter((r) => monthKey(r.paymentDate!) === monthKey(triggerRow!.paymentDate!));
  return sameMonth[sameMonth.length - 1];
}

// Consolidates a per-row (basisAmount, date) map so that when multiple rows
// share the same calendar month (by Payment Date), only the LAST row in that
// month displays the SUMMED Should-Be CWT Due and its own Applicable CWT
// deadline — every earlier row in that month is dropped from the result
// (computePerPaymentLines then shows null for it). This is the same
// "last row in the month" convention used everywhere else a month can span
// multiple ledger rows (CWT file matching, the Cash Deferred trigger row),
// applied universally per tax team direction so the payment-ledger table
// never shows a Should-Be CWT Due/Applicable CWT split across two rows of
// the same month.
function consolidateByMonth(
  rows: PaymentRecordInput[],
  perRow: Map<PaymentRecordInput, { basisAmount: number; date: Date }>,
): Map<PaymentRecordInput, { basisAmount: number; date: Date }> {
  const rowsByMonth = new Map<string, PaymentRecordInput[]>();
  for (const row of rows) {
    if (!perRow.has(row)) continue;
    const key = monthKey(row.paymentDate!);
    const list = rowsByMonth.get(key) ?? [];
    list.push(row);
    rowsByMonth.set(key, list);
  }
  const result = new Map<PaymentRecordInput, { basisAmount: number; date: Date }>();
  for (const group of rowsByMonth.values()) {
    const lastRow = group[group.length - 1];
    const total = round2(group.reduce((sum, r) => sum + perRow.get(r)!.basisAmount, 0));
    result.set(lastRow, { basisAmount: total, date: perRow.get(lastRow)!.date });
  }
  return result;
}

export interface CwtFileMatch {
  transactionDates: Date[];
  datesPaid: Date[];
  taxBase: number;
  taxDue: number;
  // Distinct base contracts among the matched events — normally just this
  // contract's own number, but can include a previous buyer's contract
  // number when a remittance was filed before a unit's buyer changed.
  baseContracts: string[];
  // Distinct literal Contract Numbers the matched events were filed under —
  // lets a reviewer see the actual (possibly superseded) contract number
  // behind each base-contract-matched remittance.
  contractNumbers: string[];
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
}

// Matches CWT file (OCLP 1606 Summary) collection events to ledger rows by
// month/year: a row's Payment Date and an event's Transaction Date (falling
// back to Date Paid if no transaction date was recorded) are considered a
// match when they fall in the same calendar month. When multiple ledger
// rows share a month, the LAST one (chronologically) claims that month's
// events — e.g. contract 2000000002661's reservation fee (05/10) and two
// payments dated 05/21 are all May 2018, so the CWT file data lands on the
// third row. Every event is counted exactly once, which is what makes the
// table's total tie out to the CWT file's total. Any events whose month
// doesn't match any ledger row are returned separately so they can still be
// surfaced (and included in the tie-out) rather than silently dropped.
function matchCwtFileByMonth(
  rows: PaymentRecordInput[],
  events: CollectionEventInput[],
): { matchByRow: Map<PaymentRecordInput, CwtFileMatch>; unmatchedEvents: CollectionEventInput[] } {
  const eventsByMonth = new Map<string, CollectionEventInput[]>();
  for (const e of events) {
    const anchor = e.transactionDate ?? e.datePaid;
    if (!anchor) continue;
    const key = monthKey(anchor);
    const list = eventsByMonth.get(key) ?? [];
    list.push(e);
    eventsByMonth.set(key, list);
  }

  const lastRowByMonth = new Map<string, PaymentRecordInput>();
  for (const row of rows) {
    if (!row.paymentDate) continue;
    lastRowByMonth.set(monthKey(row.paymentDate), row); // rows are chronological, so this ends up being the last one per month
  }

  const matchByRow = new Map<PaymentRecordInput, CwtFileMatch>();
  const unmatchedEvents: CollectionEventInput[] = [];
  for (const [key, matches] of eventsByMonth) {
    const row = lastRowByMonth.get(key);
    const match: CwtFileMatch = {
      transactionDates: matches.map((m) => m.transactionDate).filter((d): d is Date => d !== null),
      datesPaid: matches.map((m) => m.datePaid).filter((d): d is Date => d !== null),
      taxBase: round2(matches.reduce((s, m) => s + (m.sourceTaxBase ?? 0), 0)),
      taxDue: round2(matches.reduce((s, m) => s + (m.actualTaxDue ?? 0), 0)),
      baseContracts: [...new Set(matches.map((m) => m.baseContract).filter((b): b is string => !!b))],
      contractNumbers: [...new Set(matches.map((m) => m.contractNumberRaw).filter((c): c is string => !!c))],
    };
    if (row) matchByRow.set(row, match);
    else unmatchedEvents.push(...matches);
  }

  return { matchByRow, unmatchedEvents };
}

function zvPart(rate: number | null, sqm: number | null): number {
  return rate !== null && sqm !== null && sqm > 0 ? rate * sqm : 0;
}

export function computeCwtTaxBase(input: {
  netTCP: number | null;
  fmvPerTaxDeclarationUnit: number | null;
  fmvPerTaxDeclarationParking: number | null;
  fmvPerTaxDeclarationStorage: number | null;
  zonalValuePerSqmUnit: number | null;
  zonalValuePerSqmParking: number | null;
  sqmUnit: number | null;
  sqmParking: number | null;
  sqmStorage: number | null;
}): {
  taxBase: number | null;
  zonalValueBasis: number | null;
  fmvPerTaxDeclarationTotal: number | null;
  taxBaseSource: TaxBaseSource | null;
} {
  // Parking has its own BIR zonal rate (typically ~70% of the unit's rate).
  // Storage has no separate rate at all — per the tax team, a storage room
  // always carries the SAME rate as its unit (BIR classifies both under the
  // same RC/CC schedule row), so it reuses zonalValuePerSqmUnit here.
  const unitZv = zvPart(input.zonalValuePerSqmUnit, input.sqmUnit);
  const parkingZv = zvPart(input.zonalValuePerSqmParking, input.sqmParking);
  const storageZv = zvPart(input.zonalValuePerSqmUnit, input.sqmStorage);
  const zonalValueBasis = unitZv > 0 || parkingZv > 0 || storageZv > 0 ? round2(unitZv + parkingZv + storageZv) : null;

  const hasFmv =
    input.fmvPerTaxDeclarationUnit !== null ||
    input.fmvPerTaxDeclarationParking !== null ||
    input.fmvPerTaxDeclarationStorage !== null;
  const fmvPerTaxDeclarationTotal = hasFmv
    ? round2(
        (input.fmvPerTaxDeclarationUnit ?? 0) +
          (input.fmvPerTaxDeclarationParking ?? 0) +
          (input.fmvPerTaxDeclarationStorage ?? 0),
      )
    : null;

  const candidates: { source: TaxBaseSource; value: number | null }[] = [
    { source: 'NET_TCP', value: input.netTCP },
    { source: 'FMV_PER_TAX_DECLARATION', value: fmvPerTaxDeclarationTotal },
    { source: 'ZONAL_VALUE', value: zonalValueBasis },
  ];
  const valid = candidates.filter((c): c is { source: TaxBaseSource; value: number } => c.value !== null && c.value !== undefined);
  if (valid.length === 0) return { taxBase: null, zonalValueBasis, fmvPerTaxDeclarationTotal, taxBaseSource: null };
  const winner = valid.reduce((a, b) => (b.value > a.value ? b : a));
  return { taxBase: winner.value, zonalValueBasis, fmvPerTaxDeclarationTotal, taxBaseSource: winner.source };
}

export function computeDeadline(input: ContractComputationInput): DeadlineResult {
  const { buyerClassification: bc, taxTagging: tag, paymentRecords, netTCP } = input;

  if (tag === 'AR_SALE') {
    if (input.manualDeadlineOverride) {
      return {
        entries: [{ date: input.manualDeadlineOverride, basisAmount: 0, description: 'Manual override (AR Sale)' }],
        primaryDeadline: input.manualDeadlineOverride,
        note: 'AR Sale has no deadline rule in FS Section 6.1 — using manual override.',
      };
    }
    return {
      entries: [],
      primaryDeadline: null,
      note: 'AR Sale has no deadline rule in FS Section 6.1. Enter a manual deadline to compute penalties.',
    };
  }

  if (tag === 'INSTALLMENT' && bc === 'INDIVIDUAL') {
    const last = individualInstallmentTriggerRow(paymentRecords);
    if (!last?.paymentDate) {
      return { entries: [], primaryDeadline: null, note: 'No payment records found to determine the last amortization date.' };
    }
    const date = addMonthsTenth(last.paymentDate);
    return {
      entries: [{ date, basisAmount: 0, description: '10th day of month following last amortization payment' }],
      primaryDeadline: date,
      note: 'Individual + Installment: deadline is 10th day of month following the LAST amortization payment date.',
    };
  }

  if (tag === 'INSTALLMENT' && (bc === 'ETB' || bc === 'CORPORATION')) {
    const { rows, basisOverrides, mergeNote } = etbInstallmentObligationRows(paymentRecords);
    if (rows.length === 0) {
      return { entries: [], primaryDeadline: null, note: 'No payment records found to schedule per-collection deadlines.' };
    }
    const entries: DeadlineEntry[] = rows.map((r, i) => ({
      date: addMonthsTenth(r.paymentDate!),
      basisAmount: round2((basisOverrides.get(r) ?? principalBasis(r)) * CWT_RATE),
      description:
        `10th day of month following collection on ${formatMDY(r.paymentDate!)}` +
        (i === 0 && mergeNote ? ` (${mergeNote})` : ''),
    }));
    return {
      entries,
      primaryDeadline: entries[0].date,
      note: 'ETB/Corporation + Installment: CWT due EACH payment date on the VAT-exclusive principal; primary deadline uses FIFO aging of unmet obligations. A round-thousands first payment is treated as a reservation fee and folded into the 1st downpayment for CWT purposes.',
    };
  }

  if (tag === 'CASH_DEFERRED') {
    if (netTCP === null || netTCP <= 0) {
      return { entries: [], primaryDeadline: null, note: 'Insufficient payment records or Net TCP to evaluate the 25% cumulative-collection threshold.' };
    }
    const trigger = cashDeferredTriggerRow(paymentRecords, netTCP);
    if (!trigger?.paymentDate) {
      return {
        entries: [],
        primaryDeadline: null,
        note: 'Cash Deferred: cumulative collections have not yet exceeded 25% of Net TCP — no deadline triggered.',
      };
    }
    const date = addMonthsTenth(trigger.paymentDate);
    return {
      entries: [{ date, basisAmount: 0, description: 'Cumulative collections exceeded 25% of Net TCP on this payment' }],
      primaryDeadline: date,
      note: 'Cash Deferred: deadline is 10th day of month following the payment when cumulative collections first exceed 25% of Net TCP.',
    };
  }

  return { entries: [], primaryDeadline: null, note: 'Buyer classification/tax tagging not recognized — cannot determine deadline rule.' };
}

export function compromisePenaltyFor(amount: number): number {
  if (amount <= 0) return 0;
  if (amount <= 5000) return 1000;
  if (amount <= 15000) return 3000;
  if (amount <= 20000) return 5000;
  if (amount <= 50000) return 10000;
  if (amount <= 500000) return 15000;
  if (amount <= 1000000) return 20000;
  return 25000;
}

const POST_2018_CUTOFF = new Date(Date.UTC(2018, 0, 1));

export function computePenalties(variance: number, deadline: Date | null, asOfDate: Date): PenaltyBreakdown | null {
  if (variance <= 0 || !deadline) return null;

  const msPerDay = 24 * 60 * 60 * 1000;
  const daysLate = Math.max(0, Math.floor((asOfDate.getTime() - deadline.getTime()) / msPerDay));
  const interestRate = deadline < POST_2018_CUTOFF ? 0.2 : 0.12;

  const surcharge = round2(0.25 * variance);
  const compromisePenalty = compromisePenaltyFor(variance);
  const interest = round2(variance * interestRate * (daysLate / 365));
  const totalPenalties = round2(surcharge + compromisePenalty + interest);

  return { surcharge, compromisePenalty, interest, interestRate, daysLate, totalPenalties };
}

// Builds the line-by-line "should-be" CWT exposure alongside each payment
// record — the basis for the Tax Payment Ledger Duplicate sheet. Re-derives
// the same obligation-row selection computeDeadline used (rather than
// matching by date, which breaks when multiple rows share a date — verified
// in real data) so each entry lines up with the exact row that produced it.
// For ETB/Corporation + Installment, every triggerable payment gets its own
// should-be due, with any shortfall against the true Base x 5% total (FS
// 6.2's "Important" reconciliation note) trued up at the final triggered
// payment. For Individual + Installment and Cash Deferred, only the single
// triggering payment carries the full due; other rows show no obligation of
// their own (still listed for a complete side-by-side view against the
// ledger). This is a per-line snapshot only — it does not track
// running/cumulative totals or attempt a per-line compliance verdict, since
// remittances aren't reliably attributable to one specific collection;
// overall compliance is judged at the contract level (see computeExposure's
// `status`/`variance`).
export function computePerPaymentLines(
  input: ContractComputationInput,
  deadline: DeadlineResult,
  cwtTaxDue: number | null,
  asOfDate: Date,
): PerPaymentLine[] {
  const allRows = input.paymentRecords
    .filter((r) => !r.isSubtotal && r.paymentDate)
    .sort((a, b) => a.paymentDate!.getTime() - b.paymentDate!.getTime());

  // CWT-file matching is independent of the deadline-rule branch below — it
  // applies uniformly regardless of buyer classification/tax tagging.
  const { matchByRow, unmatchedEvents } = matchCwtFileByMonth(allRows, input.collectionEvents);

  // Set below, only for ETB/Corporation + Installment, when the first
  // payment looks like a reservation fee — that row never carries its own
  // should-be due, so Difference (and any penalties derived from it) must
  // stay null for it rather than comparing against a stray CWT file match.
  let reservationFeeRow: PaymentRecordInput | null = null;

  const toLine = (row: PaymentRecordInput, shouldBeCwtDue: number | null, applicableDeadline: Date | null): PerPaymentLine => {
    const match = matchByRow.get(row);
    const datesPaid = match?.datesPaid ?? [];
    const remittedInDeadlineMonth =
      applicableDeadline && datesPaid.length > 0 ? datesPaid.some((d) => monthKey(d) === monthKey(applicableDeadline)) : null;
    const cwtFileTaxDue = match?.taxDue ?? null;
    const isReservationFee = row === reservationFeeRow;
    // No CWT file match at all (as opposed to a match confirming exactly
    // ₱0 remitted) means we found no remittance record for this row's
    // obligation — for a tax exposure tool that must count as full
    // exposure, not be skipped, so it's treated as 0 remitted here. The
    // raw `cwtFileTaxDue` column stays null so the table still shows
    // plainly that no CWT file data was found for the row.
    const difference = !isReservationFee && shouldBeCwtDue !== null ? round2(shouldBeCwtDue - (cwtFileTaxDue ?? 0)) : null;
    // Per-row penalties (FS Section 6.3) — only when this row's own
    // should-be due exceeds what the CWT file shows as actually remitted.
    const penalties =
      difference !== null && difference > EXPOSURE_ROUNDING_TOLERANCE
        ? computePenalties(difference, applicableDeadline, asOfDate)
        : null;
    // Full amount owed for this row: the exposure itself plus every penalty
    // component. Null whenever there's no exposure/penalties to total up.
    const totalDue = difference !== null && penalties !== null ? round2(difference + penalties.totalPenalties) : null;
    return {
      paymentDate: row.paymentDate,
      orNumber: row.orNumber ?? null,
      totalCollection: row.totalCollection,
      clearingDocument: row.clearingDocument ?? null,
      paymentPrincipal: row.paymentPrincipal ?? null,
      paymentVat: row.paymentVat ?? null,
      applicableDeadline,
      shouldBeCwtDue,
      cwtFileTransactionDates: match?.transactionDates ?? [],
      cwtFileDatesPaid: datesPaid,
      cwtFileTaxBase: match?.taxBase ?? null,
      cwtFileTaxDue,
      cwtFileBaseContracts: match?.baseContracts ?? [],
      cwtFileContractNumbers: match?.contractNumbers ?? [],
      remittedInDeadlineMonth,
      difference,
      penalties,
      totalDue,
    };
  };

  // Any CWT file entries whose month didn't match any ledger row still need
  // to be surfaced so the table's total ties out to the CWT file exactly.
  const unmatchedLines: PerPaymentLine[] = unmatchedEvents.map((e) => ({
    paymentDate: null,
    orNumber: null,
    totalCollection: null,
    clearingDocument: null,
    paymentPrincipal: null,
    paymentVat: null,
    applicableDeadline: null,
    shouldBeCwtDue: null,
    cwtFileTransactionDates: e.transactionDate ? [e.transactionDate] : [],
    cwtFileDatesPaid: e.datePaid ? [e.datePaid] : [],
    cwtFileTaxBase: e.sourceTaxBase,
    cwtFileTaxDue: e.actualTaxDue,
    cwtFileBaseContracts: e.baseContract ? [e.baseContract] : [],
    cwtFileContractNumbers: e.contractNumberRaw ? [e.contractNumberRaw] : [],
    remittedInDeadlineMonth: null,
    difference: null,
    penalties: null,
    totalDue: null,
  }));

  if (allRows.length === 0 || cwtTaxDue === null || deadline.entries.length === 0) {
    return [...allRows.map((r) => toLine(r, null, null)), ...unmatchedLines];
  }

  const { buyerClassification: bc, taxTagging: tag, paymentRecords, netTCP } = input;

  if (tag === 'INSTALLMENT' && (bc === 'ETB' || bc === 'CORPORATION')) {
    // `rows` and `deadline.entries` are derived from the identical
    // etbInstallmentObligationRows() call, so they share the same
    // length/order — zip by index against the already-rounded entries
    // rather than re-deriving amounts, so this can never drift from what's
    // shown in the deadline list. Each row's own-principal-x-5% amount is
    // never trued up against the contract's overall CWT due (confirmed with
    // the tax team — no reconciliation shortfall), but when multiple rows
    // land in the same calendar month, their amounts ARE summed onto the
    // LAST row of that month (see consolidateByMonth) — same convention as
    // every other tax-tagging rule below.
    const { rows, reservationFeeRow: feeRow } = etbInstallmentObligationRows(paymentRecords);
    reservationFeeRow = feeRow;
    const perRow = new Map<PaymentRecordInput, { basisAmount: number; date: Date }>();
    rows.forEach((r, i) => {
      const entry = deadline.entries[i];
      perRow.set(r, { basisAmount: entry.basisAmount, date: entry.date });
    });
    const lineDataByRow = consolidateByMonth(rows, perRow);

    return [
      ...allRows.map((row) => {
        const data = lineDataByRow.get(row);
        return toLine(row, data?.basisAmount ?? null, data?.date ?? null);
      }),
      ...unmatchedLines,
    ];
  }

  if (tag === 'INSTALLMENT' && bc === 'INDIVIDUAL') {
    const trigger = individualInstallmentTriggerRow(paymentRecords);
    return [
      ...allRows.map((row) =>
        toLine(row, row === trigger ? cwtTaxDue : null, row === trigger ? addMonthsTenth(row.paymentDate!) : null),
      ),
      ...unmatchedLines,
    ];
  }

  if (tag === 'CASH_DEFERRED' && netTCP !== null && netTCP > 0) {
    const trigger = cashDeferredTriggerRow(paymentRecords, netTCP);
    return [
      ...allRows.map((row) =>
        toLine(row, row === trigger ? cwtTaxDue : null, row === trigger ? addMonthsTenth(row.paymentDate!) : null),
      ),
      ...unmatchedLines,
    ];
  }

  // AR Sale (manual override) or unrecognized combinations: the single
  // deadline entry isn't tied to a specific payment row.
  return [...allRows.map((r) => toLine(r, null, null)), ...unmatchedLines];
}

export function computeExposure(input: ContractComputationInput, asOfDate: Date = new Date()): ExposureResult {
  const { taxBase, zonalValueBasis, fmvPerTaxDeclarationTotal, taxBaseSource } = computeCwtTaxBase(input);
  const deadline = computeDeadline(input);

  const cwtTaxDue = taxBase !== null ? round2(taxBase * CWT_RATE) : null;
  const actualRemitted = round2(
    input.collectionEvents.reduce((sum, e) => sum + (e.actualTaxDue ?? 0), 0),
  );
  const perPaymentLines = computePerPaymentLines(input, deadline, cwtTaxDue, asOfDate);

  if (cwtTaxDue === null) {
    return {
      cwtTaxBase: taxBase,
      zonalValueBasis,
      fmvPerTaxDeclarationTotal,
      taxBaseSource,
      cwtTaxDue,
      actualRemitted,
      variance: null,
      status: 'MISSING_DATA',
      deadline,
      penalties: null,
      perPaymentLines,
    };
  }

  const variance = round2(cwtTaxDue - actualRemitted);
  // Summing dozens of per-collection remittances accumulates centavo-level
  // float rounding noise; a variance this small isn't real exposure and
  // shouldn't trigger the ₱1,000 compromise-penalty minimum.
  const status = variance > EXPOSURE_ROUNDING_TOLERANCE ? 'UNDER_REMITTED' : 'COMPLIANT';
  const penalties = status === 'UNDER_REMITTED' ? computePenalties(variance, deadline.primaryDeadline, asOfDate) : null;

  return {
    cwtTaxBase: taxBase,
    zonalValueBasis,
    fmvPerTaxDeclarationTotal,
    taxBaseSource,
    cwtTaxDue,
    actualRemitted,
    variance,
    status,
    deadline,
    penalties,
    perPaymentLines,
  };
}
