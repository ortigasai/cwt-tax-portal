import {
  computeCwtTaxBase,
  computeDeadline,
  computeExposure,
  computePerPaymentLines,
  compromisePenaltyFor,
  computePenalties,
  ContractComputationInput,
  round2,
} from '../services/computation';

const baseInput = (overrides: Partial<ContractComputationInput> = {}): ContractComputationInput => ({
  netTCP: 1_000_000,
  fmvPerTaxDeclarationUnit: 900_000,
  fmvPerTaxDeclarationParking: null,
  fmvPerTaxDeclarationStorage: null,
  zonalValuePerSqmUnit: 20_000,
  zonalValuePerSqmParking: 20_000,
  sqmUnit: 40,
  sqmParking: 10,
  sqmStorage: null,
  buyerClassification: 'INDIVIDUAL',
  taxTagging: 'INSTALLMENT',
  manualDeadlineOverride: null,
  paymentRecords: [],
  collectionEvents: [],
  ...overrides,
});

describe('computeCwtTaxBase', () => {
  it('takes the highest of netTCP, FMV, and zonal value basis', () => {
    const { taxBase, zonalValueBasis } = computeCwtTaxBase({
      netTCP: 1_000_000,
      fmvPerTaxDeclarationUnit: 900_000,
      fmvPerTaxDeclarationParking: null,
      fmvPerTaxDeclarationStorage: null,
      zonalValuePerSqmUnit: 20_000,
      zonalValuePerSqmParking: 20_000,
      sqmUnit: 40,
      sqmParking: 10,
      sqmStorage: null,
    });
    expect(zonalValueBasis).toBe(1_000_000); // 20,000 * 40 + 20,000 * 10
    expect(taxBase).toBe(1_000_000);
  });

  it('picks zonal value when it exceeds TCP and FMV', () => {
    const { taxBase } = computeCwtTaxBase({
      netTCP: 500_000,
      fmvPerTaxDeclarationUnit: 600_000,
      fmvPerTaxDeclarationParking: null,
      fmvPerTaxDeclarationStorage: null,
      zonalValuePerSqmUnit: 30_000,
      zonalValuePerSqmParking: 30_000,
      sqmUnit: 40,
      sqmParking: 10,
      sqmStorage: null,
    });
    expect(taxBase).toBe(1_500_000); // 30,000 * 40 + 30,000 * 10
  });

  it('sums unit and parking bases separately when their rates differ', () => {
    const { taxBase, zonalValueBasis } = computeCwtTaxBase({
      netTCP: 0,
      fmvPerTaxDeclarationUnit: null,
      fmvPerTaxDeclarationParking: null,
      fmvPerTaxDeclarationStorage: null,
      zonalValuePerSqmUnit: 63_000,
      zonalValuePerSqmParking: 44_100, // 70% of unit rate, per BIR's parking rule
      sqmUnit: 100,
      sqmParking: 12.5,
      sqmStorage: null,
    });
    expect(zonalValueBasis).toBe(6_851_250); // 63,000*100 + 44,100*12.5
    expect(taxBase).toBe(6_851_250);
  });

  it('storage always uses the unit rate, even when parking has a different rate', () => {
    const { taxBase, zonalValueBasis } = computeCwtTaxBase({
      netTCP: 0,
      fmvPerTaxDeclarationUnit: null,
      fmvPerTaxDeclarationParking: null,
      fmvPerTaxDeclarationStorage: null,
      zonalValuePerSqmUnit: 63_000,
      zonalValuePerSqmParking: 44_100,
      sqmUnit: 100,
      sqmParking: 12.5,
      sqmStorage: 9.32,
    });
    expect(zonalValueBasis).toBe(7_438_410); // 63,000*100 + 44,100*12.5 + 63,000*9.32 (storage uses the UNIT rate)
    expect(taxBase).toBe(7_438_410);
  });

  it('returns null when no inputs are available', () => {
    const { taxBase } = computeCwtTaxBase({
      netTCP: null,
      fmvPerTaxDeclarationUnit: null,
      fmvPerTaxDeclarationParking: null,
      fmvPerTaxDeclarationStorage: null,
      zonalValuePerSqmUnit: null,
      zonalValuePerSqmParking: null,
      sqmUnit: null,
      sqmParking: null,
      sqmStorage: null,
    });
    expect(taxBase).toBeNull();
  });
});

describe('computeDeadline', () => {
  it('Individual + Installment: 10th of month after LAST payment', () => {
    const input = baseInput({
      buyerClassification: 'INDIVIDUAL',
      taxTagging: 'INSTALLMENT',
      paymentRecords: [
        { paymentDate: new Date('2023-01-15'), totalCollection: 10000, isSubtotal: false },
        { paymentDate: new Date('2023-05-20'), totalCollection: 10000, isSubtotal: false },
        { paymentDate: new Date('2023-03-10'), totalCollection: 10000, isSubtotal: false },
      ],
    });
    const result = computeDeadline(input);
    expect(result.primaryDeadline?.toISOString().slice(0, 10)).toBe('2023-06-10');
  });

  it('ETB + Installment: one deadline per payment, primary is earliest', () => {
    const input = baseInput({
      buyerClassification: 'ETB',
      taxTagging: 'INSTALLMENT',
      paymentRecords: [
        // Not round-thousands, so this isn't treated as a reservation fee —
        // see the dedicated reservation-fee tests below for that case.
        { paymentDate: new Date('2023-01-15'), totalCollection: 123456, isSubtotal: false },
        { paymentDate: new Date('2023-02-15'), totalCollection: 200001, isSubtotal: false },
      ],
    });
    const result = computeDeadline(input);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].basisAmount).toBe(5511.43); // (123456 / 1.12) * 5%, net of VAT
    expect(result.entries[1].basisAmount).toBe(8928.62); // (200001 / 1.12) * 5%
    expect(result.primaryDeadline?.toISOString().slice(0, 10)).toBe('2023-02-10');
  });

  it('ETB + Installment: folds a round-thousands reservation fee into the 1st downpayment, net of VAT', () => {
    // Exact figures from real contract 2000000007819: reservation fee
    // 25,000 has no reliable principal/VAT breakdown in the source ledger
    // (booked as principal=25,000, VAT=0), so its net-of-VAT value is
    // derived via /1.12. The 1st downpayment's own recorded principal
    // (4,531.25) is trusted as-is — its VAT split doesn't follow a clean
    // 12% ratio in the real data, so it must NOT be re-derived from its
    // gross total (that would give the wrong answer).
    const input = baseInput({
      buyerClassification: 'ETB',
      taxTagging: 'INSTALLMENT',
      paymentRecords: [
        { paymentDate: new Date('2023-01-05'), totalCollection: 25_000, isSubtotal: false }, // reservation fee
        {
          paymentDate: new Date('2023-02-15'),
          totalCollection: 8_075,
          paymentPrincipal: 4_531.25,
          paymentVat: 3_543.75,
          isSubtotal: false,
        }, // 1st downpayment
        { paymentDate: new Date('2023-03-15'), totalCollection: 8_075, isSubtotal: false },
      ],
    });
    const result = computeDeadline(input);
    // Reservation fee + 1st DP collapse into a single entry anchored on the
    // 1st DP's date; the third (unrelated) payment stays separate.
    // Basis = (25,000 / 1.12) + 4,531.25 = 26,852.68; CWT = 26,852.68 * 5%.
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].basisAmount).toBe(1342.63);
    expect(result.entries[0].date.toISOString().slice(0, 10)).toBe('2023-03-10'); // 10th after the 1st DP's date
    expect(result.entries[0].description).toContain('reservation fee of 25000');
    expect(result.entries[0].description).toContain('net of VAT: 22321.43');
    expect(result.entries[1].basisAmount).toBe(360.49); // (8,075 / 1.12) * 5%, unaffected by the merge
  });

  it('ETB + Installment: trusts the recorded principal for the 1st downpayment even when its VAT split is irregular', () => {
    // Isolates the fix: without a recorded principal, we'd derive
    // 8,075/1.12 = 7,209.82 for the 1st downpayment — very different from
    // its actual booked principal of 4,531.25. The ledger's own figure
    // must win.
    const input = baseInput({
      buyerClassification: 'ETB',
      taxTagging: 'INSTALLMENT',
      paymentRecords: [
        {
          paymentDate: new Date('2023-02-15'),
          totalCollection: 8_075,
          paymentPrincipal: 4_531.25,
          paymentVat: 3_543.75,
          isSubtotal: false,
        },
      ],
    });
    const result = computeDeadline(input);
    expect(result.entries[0].basisAmount).toBe(226.56); // 4,531.25 * 5%, not (8,075/1.12)*5% = 360.49
  });

  it('ETB + Installment: keeps each row correctly matched to its own entry when two rows share a payment date', () => {
    // Regression: real contract 2000000002661 has two rows both dated
    // 2018-05-21 (OR 3035611 and OR 3035613), the first of which is the 1st
    // downpayment (merges with the reservation fee). Date-keyed matching
    // let the second row's entry silently overwrite the first's, giving
    // both rows the same (wrong) amount.
    const input = baseInput({
      buyerClassification: 'ETB',
      taxTagging: 'INSTALLMENT',
      paymentRecords: [
        { paymentDate: new Date('2023-01-05'), totalCollection: 25_000, isSubtotal: false }, // reservation fee
        {
          paymentDate: new Date('2023-02-15'),
          totalCollection: 2_168_500,
          paymentPrincipal: 1_925_446.43,
          paymentVat: 243_053.57,
          isSubtotal: false,
        }, // 1st downpayment — merges with reservation fee
        {
          paymentDate: new Date('2023-02-15'), // same date as the row above
          totalCollection: 189_042,
          paymentPrincipal: 168_787.5,
          paymentVat: 20_254.5,
          isSubtotal: false,
        },
      ],
    });
    const deadline = computeDeadline(input);
    expect(deadline.entries).toHaveLength(2);
    // Entry 0: reservation fee (25,000/1.12=22,321.43) + 1st DP principal (1,925,446.43) = 1,947,767.86 * 5%
    expect(deadline.entries[0].basisAmount).toBe(97388.39);
    // Entry 1: the second same-date row's OWN principal, untouched by the merge
    expect(deadline.entries[1].basisAmount).toBe(8439.38); // 168,787.5 * 5%

    // Pass cwtTaxDue equal to the raw sum so no true-up shortfall is added
    // on top — this test is isolating the duplicate-date matching fix, not
    // the true-up behavior (covered separately above).
    const lines = computePerPaymentLines(input, deadline, 97388.39 + 8439.38, new Date('2025-01-01'));
    const [, firstDp, secondSameDate] = lines;
    // Both rows land in the same calendar month (Feb 2023), so per the tax
    // team's "last row in the month" rule the per-payment TABLE consolidates
    // their two entries onto the second (last) row — the first downpayment
    // row shows no should-be due of its own. `deadline.entries` above stays
    // unmerged (it drives FIFO aging/the deadline summary), only this
    // per-row display table is consolidated.
    expect(firstDp.shouldBeCwtDue).toBeNull();
    expect(secondSameDate.shouldBeCwtDue).toBe(105_827.77); // 97,388.39 + 8,439.38
    expect(secondSameDate.applicableDeadline?.toISOString().slice(0, 10)).toBe('2023-03-10');
  });

  it('ETB + Installment: does not merge when the first payment is not round-thousands', () => {
    const input = baseInput({
      buyerClassification: 'ETB',
      taxTagging: 'INSTALLMENT',
      paymentRecords: [
        { paymentDate: new Date('2023-01-05'), totalCollection: 8_432.17, isSubtotal: false },
        { paymentDate: new Date('2023-02-15'), totalCollection: 8_075, isSubtotal: false },
      ],
    });
    const result = computeDeadline(input);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].basisAmount).toBe(376.44); // (8,432.17 / 1.12) * 5%, not merged
  });

  it('ETB + Installment: does not merge a lone round-thousands payment (nothing to merge into)', () => {
    const input = baseInput({
      buyerClassification: 'ETB',
      taxTagging: 'INSTALLMENT',
      paymentRecords: [{ paymentDate: new Date('2023-01-05'), totalCollection: 25_000, isSubtotal: false }],
    });
    const result = computeDeadline(input);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].basisAmount).toBe(1116.07); // (25,000 / 1.12) * 5%
  });

  it('Cash Deferred: triggers on payment where cumulative exceeds 25% of Net TCP', () => {
    const input = baseInput({
      buyerClassification: 'CORPORATION',
      taxTagging: 'CASH_DEFERRED',
      netTCP: 1_000_000,
      paymentRecords: [
        { paymentDate: new Date('2023-01-01'), totalCollection: 100000, isSubtotal: false }, // cum 100k (10%)
        { paymentDate: new Date('2023-02-01'), totalCollection: 100000, isSubtotal: false }, // cum 200k (20%)
        { paymentDate: new Date('2023-03-01'), totalCollection: 100000, isSubtotal: false }, // cum 300k (30%) -> trigger
        { paymentDate: new Date('2023-04-01'), totalCollection: 100000, isSubtotal: false },
      ],
    });
    const result = computeDeadline(input);
    expect(result.primaryDeadline?.toISOString().slice(0, 10)).toBe('2023-04-10');
  });

  it('Cash Deferred: no deadline when threshold never crossed', () => {
    const input = baseInput({
      buyerClassification: 'CORPORATION',
      taxTagging: 'CASH_DEFERRED',
      netTCP: 1_000_000,
      paymentRecords: [{ paymentDate: new Date('2023-01-01'), totalCollection: 100000, isSubtotal: false }],
    });
    const result = computeDeadline(input);
    expect(result.primaryDeadline).toBeNull();
  });

  it('AR Sale: null deadline unless manually overridden', () => {
    const withoutOverride = computeDeadline(baseInput({ taxTagging: 'AR_SALE' }));
    expect(withoutOverride.primaryDeadline).toBeNull();

    const withOverride = computeDeadline(
      baseInput({ taxTagging: 'AR_SALE', manualDeadlineOverride: new Date('2023-09-10') }),
    );
    expect(withOverride.primaryDeadline?.toISOString().slice(0, 10)).toBe('2023-09-10');
  });
});

describe('compromisePenaltyFor', () => {
  it.each([
    [0, 0],
    [4999, 1000],
    [5000, 1000],
    [5001, 3000],
    [15000, 3000],
    [15001, 5000],
    [20000, 5000],
    [20001, 10000],
    [50000, 10000],
    [50001, 15000],
    [500000, 15000],
    [500001, 20000],
    [1000000, 20000],
    [1000001, 25000],
  ])('bracket for %d -> %d', (amount, expected) => {
    expect(compromisePenaltyFor(amount)).toBe(expected);
  });
});

describe('computePenalties', () => {
  it('uses 20% interest rate for deadlines before 2018-01-01', () => {
    const deadline = new Date('2017-06-10');
    const asOf = new Date('2018-06-10'); // 365 days later
    const result = computePenalties(100000, deadline, asOf);
    expect(result?.interestRate).toBe(0.2);
    expect(result?.surcharge).toBe(25000);
    expect(result?.compromisePenalty).toBe(15000);
    expect(result?.interest).toBeCloseTo(100000 * 0.2 * (365 / 365), 2);
  });

  it('uses 12% interest rate for deadlines on/after 2018-01-01', () => {
    const deadline = new Date('2018-01-01');
    const asOf = new Date('2019-01-01'); // 365 days later
    const result = computePenalties(100000, deadline, asOf);
    expect(result?.interestRate).toBe(0.12);
    expect(result?.interest).toBeCloseTo(100000 * 0.12, 2);
  });

  it('returns null when there is no exposure', () => {
    expect(computePenalties(0, new Date('2020-01-01'), new Date())).toBeNull();
    expect(computePenalties(-500, new Date('2020-01-01'), new Date())).toBeNull();
  });

  it('returns null when deadline is unknown', () => {
    expect(computePenalties(1000, null, new Date())).toBeNull();
  });
});

describe('computeExposure', () => {
  it('flags MISSING_DATA when no tax base inputs are present', () => {
    const result = computeExposure(
      baseInput({
        netTCP: null,
        fmvPerTaxDeclarationUnit: null,
        fmvPerTaxDeclarationParking: null,
        fmvPerTaxDeclarationStorage: null,
        zonalValuePerSqmUnit: null,
        zonalValuePerSqmParking: null,
        sqmUnit: null,
        sqmParking: null,
        sqmStorage: null,
      }),
    );
    expect(result.status).toBe('MISSING_DATA');
    expect(result.penalties).toBeNull();
  });

  it('is COMPLIANT when actual remittance meets or exceeds CWT due', () => {
    const input = baseInput({
      taxTagging: 'CASH_DEFERRED',
      buyerClassification: 'CORPORATION',
      netTCP: 100000,
      fmvPerTaxDeclarationUnit: null,
      fmvPerTaxDeclarationParking: null,
      fmvPerTaxDeclarationStorage: null,
      zonalValuePerSqmUnit: null,
      zonalValuePerSqmParking: null,
      sqmUnit: null,
      sqmParking: null,
      sqmStorage: null,
      paymentRecords: [{ paymentDate: new Date('2020-01-01'), totalCollection: 100000, isSubtotal: false }],
      collectionEvents: [{ actualTaxDue: 5000, datePaid: new Date('2020-02-05'), transactionDate: null, sourceTaxBase: null }],
    });
    const result = computeExposure(input, new Date('2021-01-01'));
    expect(result.cwtTaxDue).toBe(5000);
    expect(result.status).toBe('COMPLIANT');
    expect(result.variance).toBe(0);
    expect(result.penalties).toBeNull();
  });

  it('is UNDER_REMITTED and computes penalties when remittance falls short', () => {
    const input = baseInput({
      taxTagging: 'CASH_DEFERRED',
      buyerClassification: 'CORPORATION',
      netTCP: 100000,
      fmvPerTaxDeclarationUnit: null,
      fmvPerTaxDeclarationParking: null,
      fmvPerTaxDeclarationStorage: null,
      zonalValuePerSqmUnit: null,
      zonalValuePerSqmParking: null,
      sqmUnit: null,
      sqmParking: null,
      sqmStorage: null,
      paymentRecords: [{ paymentDate: new Date('2020-01-01'), totalCollection: 100000, isSubtotal: false }],
      collectionEvents: [{ actualTaxDue: 2000, datePaid: new Date('2020-02-05'), transactionDate: null, sourceTaxBase: null }],
    });
    const result = computeExposure(input, new Date('2021-02-10')); // ~1 year after 2020-02-10 deadline
    expect(result.cwtTaxDue).toBe(5000);
    expect(result.variance).toBe(3000);
    expect(result.status).toBe('UNDER_REMITTED');
    expect(result.penalties).not.toBeNull();
    expect(result.penalties?.surcharge).toBe(750); // 25% of 3000
    expect(result.penalties?.compromisePenalty).toBe(1000); // bracket for <=5000
  });
});

describe('computePerPaymentLines', () => {
  it('ETB + Installment: each row is strictly its own principal x 5%, with no reconciliation shortfall applied', () => {
    const input = baseInput({
      buyerClassification: 'ETB',
      taxTagging: 'INSTALLMENT',
      netTCP: 100_000,
      fmvPerTaxDeclarationUnit: null,
      fmvPerTaxDeclarationParking: null,
      fmvPerTaxDeclarationStorage: null,
      zonalValuePerSqmUnit: null,
      zonalValuePerSqmParking: null,
      sqmUnit: null,
      sqmParking: null,
      sqmStorage: null,
      paymentRecords: [
        // Not round-thousands, so the reservation-fee merge rule doesn't
        // kick in here.
        { paymentDate: new Date('2020-01-01'), totalCollection: 40_001, isSubtotal: false },
        { paymentDate: new Date('2020-02-01'), totalCollection: 49_999, isSubtotal: false },
      ],
    });
    const deadline = computeDeadline(input);
    // Net-of-VAT per-collection dues: (40,001/1.12)*5% = 1,785.76 and
    // (49,999/1.12)*5% = 2,232.10 — these sum short of the contract's
    // overall Base x 5% (5,000), but per the tax team that shortfall is NOT
    // trued up onto any row; each line stands on its own.
    const lines = computePerPaymentLines(input, deadline, 5000, new Date('2025-01-01'));
    expect(lines).toHaveLength(2);
    expect(lines[0].shouldBeCwtDue).toBe(1785.76);
    expect(lines[1].shouldBeCwtDue).toBe(2232.1);
  });

  it('ETB + Installment: multiple rows in the same calendar month are summed onto the LAST row of that month', () => {
    const input = baseInput({
      buyerClassification: 'ETB',
      taxTagging: 'INSTALLMENT',
      netTCP: 100_000,
      fmvPerTaxDeclarationUnit: null,
      fmvPerTaxDeclarationParking: null,
      fmvPerTaxDeclarationStorage: null,
      zonalValuePerSqmUnit: null,
      zonalValuePerSqmParking: null,
      sqmUnit: null,
      sqmParking: null,
      sqmStorage: null,
      paymentRecords: [
        // Not round-thousands, so the reservation-fee merge rule doesn't
        // kick in here — these are two independent installment payments
        // that both happen to land in March.
        { paymentDate: new Date('2020-03-05'), totalCollection: 40_001, isSubtotal: false },
        { paymentDate: new Date('2020-03-20'), totalCollection: 49_999, isSubtotal: false },
      ],
    });
    const deadline = computeDeadline(input);
    const lines = computePerPaymentLines(input, deadline, 1785.76 + 2232.1, new Date('2025-01-01'));
    expect(lines[0].shouldBeCwtDue).toBeNull();
    expect(lines[0].applicableDeadline).toBeNull();
    expect(lines[1].shouldBeCwtDue).toBe(4017.86); // 1,785.76 + 2,232.10
    expect(lines[1].applicableDeadline?.toISOString().slice(0, 10)).toBe('2020-04-10');
  });

  it('Individual + Installment: only the triggering (last) payment carries the due; others have no obligation', () => {
    const input = baseInput({
      buyerClassification: 'INDIVIDUAL',
      taxTagging: 'INSTALLMENT',
      paymentRecords: [
        { paymentDate: new Date('2020-01-01'), totalCollection: 50_000, isSubtotal: false },
        { paymentDate: new Date('2020-02-01'), totalCollection: 50_000, isSubtotal: false },
      ],
    });
    const deadline = computeDeadline(input);
    const lines = computePerPaymentLines(input, deadline, 50_000, new Date('2025-01-01'));
    expect(lines[0].shouldBeCwtDue).toBeNull();
    expect(lines[0].applicableDeadline).toBeNull();
    expect(lines[1].shouldBeCwtDue).toBe(50_000);
    expect(lines[1].applicableDeadline?.toISOString().slice(0, 10)).toBe('2020-03-10');
  });

  it('Cash Deferred: when multiple payments share the triggering month, the due/deadline land on the LAST such row, not the exact row that crossed 25%', () => {
    const input = baseInput({
      buyerClassification: 'CORPORATION',
      taxTagging: 'CASH_DEFERRED',
      netTCP: 680_357.14,
      paymentRecords: [
        { paymentDate: new Date('2024-04-03'), totalCollection: 100_000, isSubtotal: false },
        { paymentDate: new Date('2024-08-14'), totalCollection: 0, isSubtotal: false },
        // Cumulative through here: 100,000 + 128,600 = 228,600 (33.6% of Net
        // TCP) — this row alone crosses the 25% threshold, but a later row
        // shares the same calendar month, so per the tax team the due/
        // deadline must be shown on that later row instead.
        { paymentDate: new Date('2024-08-14'), totalCollection: 128_600, isSubtotal: false },
        { paymentDate: new Date('2024-08-14'), totalCollection: 0, isSubtotal: false },
        { paymentDate: new Date('2024-08-14'), totalCollection: 533_400, isSubtotal: false },
      ],
    });
    const deadline = computeDeadline(input);
    const lines = computePerPaymentLines(input, deadline, 121_160, new Date('2025-01-01'));
    expect(lines[2].shouldBeCwtDue).toBeNull();
    expect(lines[2].applicableDeadline).toBeNull();
    expect(lines[4].shouldBeCwtDue).toBe(121_160);
    expect(lines[4].applicableDeadline?.toISOString().slice(0, 10)).toBe('2024-09-10');
  });

  it('returns an empty array when there are no payment records', () => {
    const input = baseInput({ paymentRecords: [] });
    const deadline = computeDeadline(input);
    expect(computePerPaymentLines(input, deadline, 5000, new Date('2025-01-01'))).toEqual([]);
  });

  it('does not track cumulative or status fields — each line is a standalone snapshot', () => {
    const input = baseInput({
      buyerClassification: 'ETB',
      taxTagging: 'INSTALLMENT',
      netTCP: 40_000,
      fmvPerTaxDeclarationUnit: null,
      fmvPerTaxDeclarationParking: null,
      fmvPerTaxDeclarationStorage: null,
      zonalValuePerSqmUnit: null,
      zonalValuePerSqmParking: null,
      sqmUnit: null,
      sqmParking: null,
      sqmStorage: null,
      paymentRecords: [{ paymentDate: new Date('2021-01-01'), totalCollection: 40_000, isSubtotal: false }],
    });
    const deadline = computeDeadline(input);
    const lines = computePerPaymentLines(input, deadline, 2000, new Date('2025-01-01'));
    expect(lines[0]).not.toHaveProperty('cumulativeShouldBeDue');
    expect(lines[0]).not.toHaveProperty('cumulativeActualRemitted');
    expect(lines[0]).not.toHaveProperty('cumulativeVariance');
    expect(lines[0]).not.toHaveProperty('lineStatus');
  });

  describe('CWT file (OCLP 1606 Summary) side-by-side matching', () => {
    it('matches a CWT file entry to the ledger row in the same month/year', () => {
      const input = baseInput({
        buyerClassification: 'ETB',
        taxTagging: 'INSTALLMENT',
        paymentRecords: [
          { paymentDate: new Date('2021-09-22'), totalCollection: 8_075, paymentPrincipal: 4_531.25, isSubtotal: false },
        ],
        collectionEvents: [
          {
            actualTaxDue: 1476.56,
            sourceTaxBase: 29531.25,
            transactionDate: new Date('2021-09-30'), // month-end, same month as the payment
            datePaid: new Date('2021-10-11'),
          },
        ],
      });
      const deadline = computeDeadline(input);
      const lines = computePerPaymentLines(input, deadline, 1476.56, new Date('2025-01-01'));
      expect(lines).toHaveLength(1);
      expect(lines[0].cwtFileTaxDue).toBe(1476.56);
      expect(lines[0].cwtFileTaxBase).toBe(29531.25);
      expect(lines[0].cwtFileTransactionDates[0].toISOString().slice(0, 10)).toBe('2021-09-30');
      expect(lines[0].cwtFileDatesPaid[0].toISOString().slice(0, 10)).toBe('2021-10-11');
    });

    it('sums multiple same-month CWT file entries onto one row and lists every date', () => {
      const input = baseInput({
        buyerClassification: 'ETB',
        taxTagging: 'INSTALLMENT',
        paymentRecords: [{ paymentDate: new Date('2021-09-05'), totalCollection: 10_000, isSubtotal: false }],
        collectionEvents: [
          { actualTaxDue: 300, sourceTaxBase: 6000, transactionDate: new Date('2021-09-15'), datePaid: new Date('2021-10-05') },
          { actualTaxDue: 200, sourceTaxBase: 4000, transactionDate: new Date('2021-09-28'), datePaid: new Date('2021-10-11') },
        ],
      });
      const deadline = computeDeadline(input);
      const lines = computePerPaymentLines(input, deadline, 500, new Date('2025-01-01'));
      expect(lines[0].cwtFileTaxDue).toBe(500);
      expect(lines[0].cwtFileTaxBase).toBe(10000);
      expect(lines[0].cwtFileTransactionDates).toHaveLength(2);
      expect(lines[0].cwtFileDatesPaid).toHaveLength(2);
    });

    it('only the LAST ledger row in a month claims that month\'s CWT file entries', () => {
      const input = baseInput({
        buyerClassification: 'ETB',
        taxTagging: 'INSTALLMENT',
        paymentRecords: [
          { paymentDate: new Date('2021-09-05'), totalCollection: 10_000, isSubtotal: false },
          { paymentDate: new Date('2021-09-20'), totalCollection: 5_000, isSubtotal: false },
        ],
        collectionEvents: [
          { actualTaxDue: 500, sourceTaxBase: 10000, transactionDate: new Date('2021-09-30'), datePaid: new Date('2021-10-11') },
        ],
      });
      const deadline = computeDeadline(input);
      const lines = computePerPaymentLines(input, deadline, 750, new Date('2025-01-01'));
      expect(lines[0].cwtFileTaxDue).toBeNull();
      expect(lines[1].cwtFileTaxDue).toBe(500);
    });

    it('surfaces CWT file entries with no matching ledger month as trailing rows, so the total always ties out', () => {
      const input = baseInput({
        buyerClassification: 'ETB',
        taxTagging: 'INSTALLMENT',
        paymentRecords: [{ paymentDate: new Date('2021-09-05'), totalCollection: 10_000, isSubtotal: false }],
        collectionEvents: [
          { actualTaxDue: 500, sourceTaxBase: 10000, transactionDate: new Date('2021-09-30'), datePaid: new Date('2021-10-11') },
          // No ledger row falls in December — this entry has nowhere to attach.
          { actualTaxDue: 75, sourceTaxBase: 1500, transactionDate: new Date('2021-12-31'), datePaid: new Date('2022-01-10') },
        ],
      });
      const deadline = computeDeadline(input);
      const lines = computePerPaymentLines(input, deadline, 500, new Date('2025-01-01'));
      expect(lines).toHaveLength(2); // 1 ledger row + 1 unmatched trailing row
      const trailing = lines[1];
      expect(trailing.paymentDate).toBeNull();
      expect(trailing.cwtFileTaxDue).toBe(75);

      const totalCwtFileTaxDue = round2(lines.reduce((s, l) => s + (l.cwtFileTaxDue ?? 0), 0));
      expect(totalCwtFileTaxDue).toBe(575); // ties out to the full CWT file total (500 + 75)
    });

    it('leaves CWT file columns empty when there are no collection events', () => {
      const input = baseInput({
        buyerClassification: 'ETB',
        taxTagging: 'INSTALLMENT',
        paymentRecords: [{ paymentDate: new Date('2021-09-05'), totalCollection: 10_000, isSubtotal: false }],
        collectionEvents: [],
      });
      const deadline = computeDeadline(input);
      const lines = computePerPaymentLines(input, deadline, 500, new Date('2025-01-01'));
      expect(lines[0].cwtFileTaxDue).toBeNull();
      expect(lines[0].cwtFileTransactionDates).toEqual([]);
    });

    it('real scenario (contract 2000000002661, rows 1-3): CWT file data lands on the 3rd (last) row of the shared month', () => {
      const input = baseInput({
        buyerClassification: 'ETB',
        taxTagging: 'INSTALLMENT',
        paymentRecords: [
          { paymentDate: new Date('2018-05-10'), totalCollection: 100_000, isSubtotal: false }, // reservation fee
          {
            paymentDate: new Date('2018-05-21'),
            totalCollection: 2_168_500,
            paymentPrincipal: 1_925_446.43,
            isSubtotal: false,
          },
          {
            paymentDate: new Date('2018-05-21'),
            totalCollection: 189_042,
            paymentPrincipal: 168_787.5,
            isSubtotal: false,
          },
        ],
        collectionEvents: [
          {
            actualTaxDue: 100736.61,
            sourceTaxBase: 2014732.14,
            transactionDate: new Date('2018-05-31'),
            datePaid: new Date('2018-06-11'),
          },
        ],
      });
      const deadline = computeDeadline(input);
      const lines = computePerPaymentLines(input, deadline, 100736.61, new Date('2025-01-01'));
      expect(lines).toHaveLength(3);
      expect(lines[0].cwtFileTaxDue).toBeNull();
      expect(lines[1].cwtFileTaxDue).toBeNull();
      expect(lines[2].cwtFileTaxDue).toBe(100736.61); // 3rd row — last in May 2018
    });
  });

  describe('remittedInDeadlineMonth and difference columns', () => {
    it('flags YES when the date paid falls in the same month as the applicable deadline', () => {
      const input = baseInput({
        buyerClassification: 'ETB',
        taxTagging: 'INSTALLMENT',
        paymentRecords: [{ paymentDate: new Date('2021-09-22'), totalCollection: 8_075, isSubtotal: false }],
        collectionEvents: [
          // Deadline is 2021-10-10; remitted 2021-10-11 — same month.
          { actualTaxDue: 360.49, sourceTaxBase: 7209.82, transactionDate: new Date('2021-09-30'), datePaid: new Date('2021-10-11') },
        ],
      });
      const deadline = computeDeadline(input);
      const lines = computePerPaymentLines(input, deadline, 360.49, new Date('2025-01-01'));
      expect(lines[0].applicableDeadline?.toISOString().slice(0, 10)).toBe('2021-10-10');
      expect(lines[0].remittedInDeadlineMonth).toBe(true);
    });

    it('flags NO when the date paid falls in a different month than the applicable deadline', () => {
      const input = baseInput({
        buyerClassification: 'ETB',
        taxTagging: 'INSTALLMENT',
        paymentRecords: [{ paymentDate: new Date('2021-09-22'), totalCollection: 8_075, isSubtotal: false }],
        collectionEvents: [
          // Deadline is 2021-10-10; remitted late, in November.
          { actualTaxDue: 360.49, sourceTaxBase: 7209.82, transactionDate: new Date('2021-09-30'), datePaid: new Date('2021-11-05') },
        ],
      });
      const deadline = computeDeadline(input);
      const lines = computePerPaymentLines(input, deadline, 360.49, new Date('2025-01-01'));
      expect(lines[0].remittedInDeadlineMonth).toBe(false);
    });

    it('computes difference as Should-Be CWT Due minus CWT File Tax Due', () => {
      const input = baseInput({
        buyerClassification: 'ETB',
        taxTagging: 'INSTALLMENT',
        paymentRecords: [
          { paymentDate: new Date('2021-09-22'), totalCollection: 8_075, paymentPrincipal: 4_531.25, isSubtotal: false },
        ],
        collectionEvents: [
          { actualTaxDue: 300, sourceTaxBase: 6000, transactionDate: new Date('2021-09-30'), datePaid: new Date('2021-10-11') },
        ],
      });
      const deadline = computeDeadline(input);
      const lines = computePerPaymentLines(input, deadline, 226.56, new Date('2025-01-01')); // 4,531.25 * 5%
      expect(lines[0].shouldBeCwtDue).toBe(226.56);
      expect(lines[0].cwtFileTaxDue).toBe(300);
      expect(lines[0].difference).toBe(round2(226.56 - 300)); // -73.44
    });

    it('leaves remittedInDeadlineMonth null but treats a missing CWT file match as 0 remitted for difference', () => {
      // No CWT file entry was found at all for this row's month — for a tax
      // exposure tool that must read as "nothing was remitted," i.e. the
      // full should-be due is exposure, not as "nothing to compare."
      const input = baseInput({
        buyerClassification: 'ETB',
        taxTagging: 'INSTALLMENT',
        paymentRecords: [{ paymentDate: new Date('2021-09-22'), totalCollection: 8_075, isSubtotal: false }],
        collectionEvents: [],
      });
      const deadline = computeDeadline(input);
      const lines = computePerPaymentLines(input, deadline, 360.49, new Date('2025-01-01'));
      expect(lines[0].remittedInDeadlineMonth).toBeNull();
      expect(lines[0].cwtFileTaxDue).toBeNull(); // raw column still shows "no data found"
      expect(lines[0].difference).toBe(360.49); // but the computed gap treats it as 0 remitted
    });
  });

  describe('per-row penalties', () => {
    it('computes surcharge/compromise/interest on the row difference, reusing the same rules as the contract-level calculation', () => {
      const input = baseInput({
        buyerClassification: 'ETB',
        taxTagging: 'INSTALLMENT',
        paymentRecords: [
          { paymentDate: new Date('2021-09-22'), totalCollection: 8_075, paymentPrincipal: 7_209.8, isSubtotal: false },
        ],
        collectionEvents: [], // nothing remitted -> full should-be due is exposure
      });
      const deadline = computeDeadline(input);
      // Deadline is 2021-10-10; asOfDate is exactly 365 days later (post-2018 -> 12% rate).
      const lines = computePerPaymentLines(input, deadline, 360.49, new Date('2022-10-10'));
      const line = lines[0];
      expect(line.difference).toBe(360.49);
      expect(line.penalties).not.toBeNull();
      expect(line.penalties?.surcharge).toBe(90.12); // 25% of 360.49
      expect(line.penalties?.compromisePenalty).toBe(1000); // bracket for <=5,000
      expect(line.penalties?.interestRate).toBe(0.12);
      expect(line.penalties?.daysLate).toBe(365);
      expect(line.penalties?.interest).toBeCloseTo(360.49 * 0.12, 2);
      expect(line.penalties?.totalPenalties).toBe(
        round2(line.penalties!.surcharge + line.penalties!.compromisePenalty + line.penalties!.interest),
      );
    });

    it('does not compute penalties when the row is fully covered (difference <= 0)', () => {
      const input = baseInput({
        buyerClassification: 'ETB',
        taxTagging: 'INSTALLMENT',
        paymentRecords: [
          { paymentDate: new Date('2021-09-22'), totalCollection: 8_075, paymentPrincipal: 7_209.8, isSubtotal: false },
        ],
        collectionEvents: [
          { actualTaxDue: 360.49, sourceTaxBase: 7209.8, transactionDate: new Date('2021-09-30'), datePaid: new Date('2021-10-11') },
        ],
      });
      const deadline = computeDeadline(input);
      const lines = computePerPaymentLines(input, deadline, 360.49, new Date('2022-10-10'));
      expect(lines[0].difference).toBe(0);
      expect(lines[0].penalties).toBeNull();
    });

    it('never computes a difference or penalties for the reservation fee row', () => {
      const input = baseInput({
        buyerClassification: 'ETB',
        taxTagging: 'INSTALLMENT',
        // The reservation fee (05/10) is the only payment in its month, so
        // if a CWT file entry happened to land in that same month, it would
        // (per the "last row of month" rule) attach to this row too — but
        // it must never produce a difference/penalty since it has no
        // should-be due of its own.
        paymentRecords: [
          { paymentDate: new Date('2018-05-10'), totalCollection: 100_000, isSubtotal: false },
          { paymentDate: new Date('2018-06-21'), totalCollection: 8_075, paymentPrincipal: 4_531.25, isSubtotal: false },
        ],
        collectionEvents: [
          { actualTaxDue: 50, sourceTaxBase: 1000, transactionDate: new Date('2018-05-31'), datePaid: new Date('2018-06-11') },
        ],
      });
      const deadline = computeDeadline(input);
      const lines = computePerPaymentLines(input, deadline, 4735.87, new Date('2025-01-01'));
      expect(lines[0].cwtFileTaxDue).toBe(50); // matched (last/only row in May 2018)
      expect(lines[0].shouldBeCwtDue).toBeNull(); // reservation fee — no obligation of its own
      expect(lines[0].difference).toBeNull();
      expect(lines[0].penalties).toBeNull();
      expect(lines[0].totalDue).toBeNull();
    });
  });

  describe('totalDue column', () => {
    it('sums Difference and Total Penalties into a single per-row grand total', () => {
      const input = baseInput({
        buyerClassification: 'ETB',
        taxTagging: 'INSTALLMENT',
        paymentRecords: [
          { paymentDate: new Date('2021-09-22'), totalCollection: 8_075, paymentPrincipal: 7_209.8, isSubtotal: false },
        ],
        collectionEvents: [], // nothing remitted -> full should-be due is exposure
      });
      const deadline = computeDeadline(input);
      const lines = computePerPaymentLines(input, deadline, 360.49, new Date('2022-10-10'));
      const line = lines[0];
      expect(line.difference).toBe(360.49);
      expect(line.penalties?.totalPenalties).toBeDefined();
      expect(line.totalDue).toBe(round2(line.difference! + line.penalties!.totalPenalties));
    });

    it('is null when the row has no penalties (fully covered or nothing to compare)', () => {
      const input = baseInput({
        buyerClassification: 'ETB',
        taxTagging: 'INSTALLMENT',
        paymentRecords: [
          { paymentDate: new Date('2021-09-22'), totalCollection: 8_075, paymentPrincipal: 7_209.8, isSubtotal: false },
        ],
        collectionEvents: [
          { actualTaxDue: 360.49, sourceTaxBase: 7209.8, transactionDate: new Date('2021-09-30'), datePaid: new Date('2021-10-11') },
        ],
      });
      const deadline = computeDeadline(input);
      const lines = computePerPaymentLines(input, deadline, 360.49, new Date('2022-10-10'));
      expect(lines[0].penalties).toBeNull();
      expect(lines[0].totalDue).toBeNull();
    });
  });
});
