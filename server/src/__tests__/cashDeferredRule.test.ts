import {
  buildComputationInput,
  cashDeferredByRule,
  computeContractExposure,
  ContractWithRelations,
  deriveDisplayFields,
  etbOverride,
} from '../services/contractExposureService';
import { initialPaymentsExceedThreshold } from '../services/computation';

const dec = (n: number) => ({ toNumber: () => n });
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

function pay(date: string, total: number, principal: number) {
  return { paymentDate: d(date), totalCollection: dec(total), paymentPrincipal: dec(principal), isSubtotal: false };
}

// Modelled on contract 2000000008098: Net TCP 17,072,500 / Total Contract Price 19,120,200, tagged ETB + INSTALLMENT,
// its first-year collections (Sep-Nov 2021) pass 25% of the Total Contract Price on 11/24/2021, and
// the CWT (853,625) was remitted in pieces — the last 43,170 on 02/10/2022.
function contract(overrides: Partial<ContractWithRelations> & { tagging?: string } = {}): ContractWithRelations {
  const { tagging = 'INSTALLMENT', ...rest } = overrides;
  return {
    contractNumber: '2000000008098',
    tower: 'MAVEN TOWER',
    netTCP: dec(17_072_500),
    totalTCP: dec(19_120_200),
    zonalValuePerSqmUnit: null,
    zonalValuePerSqmParking: null,
    sqmUnit: null,
    sqmParking: null,
    sqmStorage: null,
    matchedRptRecord: null,
    matchedParkingRptRecord: null,
    matchedStorageRptRecord: null,
    paymentRecords: [
      pay('2021-09-08', 56_000, 50_000),
      pay('2021-09-08', 3_494_000, 3_119_642.86),
      pay('2021-11-24', 1_450_000, 1_294_642.86),
      pay('2021-12-21', 68_641, 61_286.61),
    ],
    collectionEvents: [
      { buyerClassification: 'ETB', taxTagging: tagging, actualTaxDue: dec(158_482.14), datePaid: d('2021-10-11'), transactionDate: d('2021-09-30'), sourceTaxBase: null, baseContract: null, contractNumberRaw: null, remarks: null },
      { buyerClassification: 'ETB', taxTagging: tagging, actualTaxDue: dec(651_972.86), datePaid: d('2021-12-10'), transactionDate: d('2021-11-30'), sourceTaxBase: null, baseContract: null, contractNumberRaw: null, remarks: null },
      { buyerClassification: 'ETB', taxTagging: tagging, actualTaxDue: dec(43_170), datePaid: d('2022-02-10'), transactionDate: d('2022-01-31'), sourceTaxBase: null, baseContract: null, contractNumberRaw: null, remarks: null },
    ],
    ...rest,
  } as unknown as ContractWithRelations;
}

describe('initialPaymentsExceedThreshold (25% of the Total Contract Price in the year of the first payment)', () => {
  const rows = [
    { paymentDate: d('2021-09-08'), totalCollection: 3_550_000, isSubtotal: false },
    { paymentDate: d('2021-11-24'), totalCollection: 1_450_000, isSubtotal: false },
  ];

  it('is exceeded once the first-year cumulative collections pass 25%', () => {
    const r = initialPaymentsExceedThreshold(rows, 19_120_200);
    expect(r.exceeded).toBe(true);
    expect(r.year).toBe(2021);
    expect(r.triggerDate?.toISOString().slice(0, 10)).toBe('2021-11-24');
  });

  it('is not exceeded when the first year stays at or below 25%', () => {
    expect(initialPaymentsExceedThreshold(rows, 30_000_000).exceeded).toBe(false);
  });

  it('ignores collections that only pass 25% in a later year', () => {
    const later = [
      { paymentDate: d('2021-09-08'), totalCollection: 1_000_000, isSubtotal: false },
      { paymentDate: d('2022-03-10'), totalCollection: 9_000_000, isSubtotal: false },
    ];
    expect(initialPaymentsExceedThreshold(later, 19_120_200).exceeded).toBe(false);
  });

  it('measures against the Total Contract Price, not the Net TCP', () => {
    // 4,450,000 is over 25% of the Net TCP (4,268,125) but under 25% of the Total Contract Price (4,780,050).
    const first = [
      { paymentDate: d('2021-09-08'), totalCollection: 3_550_000, isSubtotal: false },
      { paymentDate: d('2021-10-20'), totalCollection: 900_000, isSubtotal: false },
    ];
    expect(initialPaymentsExceedThreshold(first, 17_072_500).exceeded).toBe(true);
    expect(initialPaymentsExceedThreshold(first, 19_120_200).exceeded).toBe(false);
  });

  it('needs a Total Contract Price and payments', () => {
    expect(initialPaymentsExceedThreshold(rows, null).exceeded).toBe(false);
    expect(initialPaymentsExceedThreshold([], 1_000_000).exceeded).toBe(false);
  });
});

describe('Installment accounts that breach the 25% rule are computed as Cash Deferred', () => {
  it('reclassifies and computes penalties on the late-remitted part', () => {
    const c = contract();
    expect(cashDeferredByRule(c)).not.toBeNull();
    expect(buildComputationInput(c).taxTagging).toBe('CASH_DEFERRED');

    const e = computeContractExposure(c, new Date('2026-10-01'));
    // CWT due = 5% x the CWT base (Net TCP here), due by 12/10/2021 (10th after the 11/24/2021 crossing).
    expect(e.cwtTaxDue).toBeCloseTo(853_625, 2);
    expect(e.deadline.primaryDeadline?.toISOString().slice(0, 10)).toBe('2021-12-10');
    expect(e.deadline.note).toContain('Stored as Installment');
    // 158,482.14 (advance) + 651,972.86 (on time) = 810,455; the last 43,170 came on 02/10/2022.
    expect(e.rowPenaltiesTotal).toBeGreaterThan(0);
    const late = e.perPaymentLines.find((l) => l.penalties);
    expect(late?.penalties?.surcharge).toBeCloseTo(10_792.5, 2); // 25% x 43,170
    expect(late?.penalties?.compromisePenalty).toBe(10_000);
    expect(e.status).toBe('NON_COMPLIANT');
  });

  it('shows CASH DEFERRED with the reason, and keeps the stored tagging', () => {
    const display = deriveDisplayFields(contract());
    expect(display.taxTagging).toBe('CASH DEFERRED');
    expect(display.storedTaxTagging).toBe('INSTALLMENT');
    expect(display.taxTaggingNote).toContain('25%');
  });

  it('applies to Individual buyers too, not only ETB', () => {
    const c = contract();
    c.collectionEvents = c.collectionEvents.map((e) => ({ ...e, buyerClassification: 'INDIVIDUAL' })) as never;
    expect(buildComputationInput(c).taxTagging).toBe('CASH_DEFERRED');
  });

  it('leaves an installment account alone when the 25% is not breached in the first year', () => {
    const c = contract({
      paymentRecords: [pay('2021-09-08', 1_000_000, 892_857.14), pay('2022-05-10', 8_000_000, 7_142_857.14)] as never,
    });
    expect(cashDeferredByRule(c)).toBeNull();
    expect(buildComputationInput(c).taxTagging).toBe('INSTALLMENT');
  });

  it('leaves an untagged account (no 1606 remittances to compute penalties from) alone', () => {
    const c = contract({ collectionEvents: [] as never });
    expect(cashDeferredByRule(c)).toBeNull();
    expect(buildComputationInput(c).taxTagging).toBe('UNKNOWN');
  });

  it('does not touch contracts tagged otherwise', () => {
    const c = contract({ tagging: 'CASH DEFERRED' });
    expect(cashDeferredByRule(c)).toBeNull();
    expect(buildComputationInput(c).taxTagging).toBe('CASH_DEFERRED');
  });

  it('does not apply inside the ETB Calculator, which forces its own treatment', () => {
    const c = contract();
    expect(cashDeferredByRule(c, etbOverride(null))).toBeNull();
    expect(buildComputationInput(c, etbOverride(null)).taxTagging).toBe('INSTALLMENT');
  });
});
