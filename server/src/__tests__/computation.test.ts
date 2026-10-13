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

  it('ETB start date: only payments on/after it carry a per-collection obligation', () => {
    const records = [
      { paymentDate: new Date('2023-01-15'), totalCollection: 123456, isSubtotal: false },
      { paymentDate: new Date('2023-02-15'), totalCollection: 200001, isSubtotal: false },
      { paymentDate: new Date('2023-03-15'), totalCollection: 112000, isSubtotal: false },
    ];
    const withStart = baseInput({
      buyerClassification: 'ETB',
      taxTagging: 'INSTALLMENT',
      etbStartDate: new Date('2023-02-15'), // inclusive
      paymentRecords: records,
    });
    const result = computeDeadline(withStart);
    expect(result.entries.map((e) => e.date.toISOString().slice(0, 10))).toEqual(['2023-03-10', '2023-04-10']);
    expect(result.primaryDeadline?.toISOString().slice(0, 10)).toBe('2023-03-10');
    expect(result.note).toContain('ETB start date (02/15/2023)');

    // The per-payment table lines up: the pre-start row has no obligation of its own.
    const exposure = computeExposure(withStart, new Date('2023-06-01'));
    const lines = exposure.perPaymentLines.filter((l) => l.paymentDate);
    expect(lines.map((l) => l.shouldBeCwtDue)).toEqual([null, 8928.62, 5000]);

    // Without a start date every payment is scheduled, as before.
    const noStart = computeDeadline({ ...withStart, etbStartDate: null });
    expect(noStart.entries).toHaveLength(3);
  });

  it('AR Sale remark: payments after the bulk CWT remittance carry no CWT due, deadline or penalty', () => {
    // Real shape of contract 2000000004977: Individual + Installment whose
    // whole CWT was remitted in one 1606 row (remarks "AR SALE") in 2020,
    // while amortization kept running until 2025.
    const input = baseInput({
      buyerClassification: 'INDIVIDUAL',
      taxTagging: 'INSTALLMENT',
      netTCP: 1_000_000,
      fmvPerTaxDeclarationUnit: null,
      zonalValuePerSqmUnit: null,
      zonalValuePerSqmParking: null,
      paymentRecords: [
        { paymentDate: new Date('2020-08-27'), totalCollection: 560000, isSubtotal: false },
        { paymentDate: new Date('2022-03-15'), totalCollection: 224000, isSubtotal: false },
        { paymentDate: new Date('2025-09-17'), totalCollection: 224000, isSubtotal: false },
      ],
      collectionEvents: [
        {
          actualTaxDue: 50_000,
          datePaid: new Date('2020-09-10'),
          transactionDate: new Date('2020-08-30'),
          sourceTaxBase: 1_000_000,
          remarks: 'AR SALE',
        },
      ],
    });
    const exposure = computeExposure(input, new Date('2026-10-12'));
    expect(exposure.status).toBe('COMPLIANT');
    expect(exposure.penalties).toBeNull();
    const dated = exposure.perPaymentLines.filter((l) => l.paymentDate);
    // The trigger row (last payment, 2025) is after the bulk remittance: nothing due, no penalty.
    const last = dated[dated.length - 1];
    expect(last.coveredByBulkRemittance).toBe(true);
    expect(last.shouldBeCwtDue).toBeNull();
    expect(last.applicableDeadline).toBeNull();
    expect(last.penalties).toBeNull();
    expect(last.totalDue).toBeNull();
    expect(dated.every((l) => l.penalties === null)).toBe(true);
    expect(exposure.deadline.note).toContain('AR Sale');
  });

  describe('interest stops on the date the CWT was actually paid', () => {
    const days = (a: string, b: string) =>
      Math.floor((new Date(b).getTime() - new Date(a).getTime()) / (24 * 60 * 60 * 1000));
    const etb = (events: ContractComputationInput['collectionEvents']) =>
      baseInput({
        buyerClassification: 'ETB',
        taxTagging: 'INSTALLMENT',
        netTCP: 100_000,
        fmvPerTaxDeclarationUnit: null,
        zonalValuePerSqmUnit: null,
        zonalValuePerSqmParking: null,
        paymentRecords: [
          { paymentDate: new Date('2021-01-15'), totalCollection: 112000, isSubtotal: false, paymentPrincipal: 100000 },
        ],
        collectionEvents: events,
      });

    it('a late remittance: interest runs from the deadline to the paid date, not to today', () => {
      const exposure = computeExposure(
        etb([{ actualTaxDue: 5_000, datePaid: new Date('2024-03-10'), transactionDate: new Date('2024-03-01'), sourceTaxBase: 100_000 }]),
        new Date('2026-10-12'),
      );
      const row = exposure.perPaymentLines.filter((l) => l.paymentDate)[0];
      const lateDays = days('2021-02-10', '2024-03-10'); // deadline 02/10/2021 -> paid 03/10/2024
      expect(row.penalties?.daysLate).toBe(lateDays);
      expect(row.penalties?.interest).toBe(round2(5_000 * 0.12 * (lateDays / 365)));
      expect(row.penalties?.surcharge).toBe(1_250);
      expect(row.penalties?.compromisePenalty).toBe(1_000);
      // Nothing is outstanding any more.
      expect(row.difference).toBe(0);
      expect(row.totalDue).toBe(row.penalties!.totalPenalties);
      expect(exposure.status).toBe('NON_COMPLIANT');
    });

    it('part paid late, part still unpaid: the paid part stops at its paid date, the rest runs to today', () => {
      const asOf = '2026-10-12';
      const exposure = computeExposure(
        etb([{ actualTaxDue: 3_000, datePaid: new Date('2022-02-10'), transactionDate: new Date('2022-01-31'), sourceTaxBase: 60_000 }]),
        new Date(asOf),
      );
      const row = exposure.perPaymentLines.filter((l) => l.paymentDate)[0];
      const paidDays = days('2021-02-10', '2022-02-10');
      const openDays = days('2021-02-10', asOf);
      expect(row.difference).toBe(2_000); // still unpaid
      expect(row.penalties?.interest).toBe(round2(3_000 * 0.12 * (paidDays / 365) + 2_000 * 0.12 * (openDays / 365)));
      expect(row.penalties?.surcharge).toBe(1_250); // 25% of the whole 5,000 that was late or unpaid
      expect(row.penalties?.daysLate).toBe(openDays);
    });

    it('paid on the deadline, or the next working day when it falls on a weekend: no penalty', () => {
      // Deadline 02/10/2021 is a Wednesday — paid that day.
      const onDay = computeExposure(
        etb([{ actualTaxDue: 5_000, datePaid: new Date('2021-02-10'), transactionDate: new Date('2021-01-31'), sourceTaxBase: 100_000 }]),
        new Date('2026-10-12'),
      );
      expect(onDay.perPaymentLines.filter((l) => l.paymentDate)[0].penalties).toBeNull();
      expect(onDay.status).toBe('COMPLIANT');

      // Deadline 10/10/2021 is a Sunday — paying Monday 10/11 is on time.
      const weekend = baseInput({
        buyerClassification: 'ETB',
        taxTagging: 'INSTALLMENT',
        netTCP: 100_000,
        fmvPerTaxDeclarationUnit: null,
        zonalValuePerSqmUnit: null,
        zonalValuePerSqmParking: null,
        paymentRecords: [
          { paymentDate: new Date('2021-09-08'), totalCollection: 112000, isSubtotal: false, paymentPrincipal: 100000 },
        ],
        collectionEvents: [
          { actualTaxDue: 5_000, datePaid: new Date('2021-10-11'), transactionDate: new Date('2021-09-30'), sourceTaxBase: 100_000 },
        ],
      });
      expect(computeExposure(weekend, new Date('2026-10-12')).status).toBe('COMPLIANT');
    });
  });

  it('Not compliant: totals tie out but a late payment carries a computed penalty', () => {
    const input = baseInput({
      buyerClassification: 'ETB',
      taxTagging: 'INSTALLMENT',
      netTCP: 100_000,
      fmvPerTaxDeclarationUnit: null,
      zonalValuePerSqmUnit: null,
      zonalValuePerSqmParking: null,
      paymentRecords: [
        { paymentDate: new Date('2021-01-15'), totalCollection: 112000, isSubtotal: false, paymentPrincipal: 100000 },
      ],
      // The full CWT was remitted, but three years after its 02/10/2021 deadline.
      collectionEvents: [
        { actualTaxDue: 5_000, datePaid: new Date('2024-03-10'), transactionDate: new Date('2024-03-01'), sourceTaxBase: 100_000 },
      ],
    });
    const exposure = computeExposure(input, new Date('2026-10-12'));
    expect(exposure.variance).toBe(0);
    expect(exposure.penalties).toBeNull(); // no contract-level penalty…
    expect(exposure.rowPenaltiesTotal).toBeGreaterThan(0); // …but the row's penalty was computed
    expect(exposure.status).toBe('NON_COMPLIANT');
  });

  it('Compliant stays compliant when nothing was late (no computed penalty anywhere)', () => {
    const input = baseInput({
      buyerClassification: 'ETB',
      taxTagging: 'INSTALLMENT',
      netTCP: 100_000,
      fmvPerTaxDeclarationUnit: null,
      zonalValuePerSqmUnit: null,
      zonalValuePerSqmParking: null,
      paymentRecords: [
        { paymentDate: new Date('2021-01-15'), totalCollection: 112000, isSubtotal: false, paymentPrincipal: 100000 },
      ],
      collectionEvents: [
        { actualTaxDue: 5_000, datePaid: new Date('2021-02-08'), transactionDate: new Date('2021-01-31'), sourceTaxBase: 100_000 },
      ],
    });
    const exposure = computeExposure(input, new Date('2026-10-12'));
    expect(exposure.rowPenaltiesTotal).toBe(0);
    expect(exposure.status).toBe('COMPLIANT');
  });

  it('CWT paid in full in advance (no AR Sale remark): later payments carry no shortfall or penalty', () => {
    // Shape of contract 2000000008098: ETB + Installment, the whole CWT filed
    // across three early 1606 rows, payments continuing for years after.
    const input = baseInput({
      buyerClassification: 'ETB',
      taxTagging: 'INSTALLMENT',
      netTCP: 1_000_000,
      fmvPerTaxDeclarationUnit: null,
      zonalValuePerSqmUnit: null,
      zonalValuePerSqmParking: null,
      paymentRecords: [
        { paymentDate: new Date('2021-09-08'), totalCollection: 560000, isSubtotal: false, paymentPrincipal: 500000 },
        { paymentDate: new Date('2022-03-22'), totalCollection: 112000, isSubtotal: false, paymentPrincipal: 100000 },
        { paymentDate: new Date('2024-06-24'), totalCollection: 112000, isSubtotal: false, paymentPrincipal: 100000 },
        { paymentDate: new Date('2025-08-07'), totalCollection: 336000, isSubtotal: false, paymentPrincipal: 300000 },
      ],
      collectionEvents: [
        { actualTaxDue: 25_000, datePaid: new Date('2021-10-11'), transactionDate: new Date('2021-09-30'), sourceTaxBase: 500_000 },
        { actualTaxDue: 25_000, datePaid: new Date('2022-02-10'), transactionDate: new Date('2022-01-31'), sourceTaxBase: 500_000 },
      ],
    });
    const exposure = computeExposure(input, new Date('2026-10-12'));
    expect(exposure.cwtTaxDue).toBe(50_000);
    expect(exposure.actualRemitted).toBe(50_000);
    expect(exposure.status).toBe('COMPLIANT');
    const dated = exposure.perPaymentLines.filter((l) => l.paymentDate);
    // First row is met by its own month's remittance; the three later rows would
    // each be "short" month-by-month but are covered by the advance remittance.
    expect(dated.map((l) => l.paidInAdvance)).toEqual([false, true, true, true]);
    for (const l of dated.slice(1)) {
      expect(l.difference).toBe(0);
      expect(l.penalties).toBeNull();
      expect(l.totalDue).toBeNull();
      expect(l.shouldBeCwtDue).not.toBeNull(); // the amount stays visible
    }
    expect(exposure.deadline.note).toContain('remitted in advance already covered 3 payment(s)');
  });

  it('CWT only partly remitted ahead: a payment is still penalised once the advance no longer covers it', () => {
    const input = baseInput({
      buyerClassification: 'ETB',
      taxTagging: 'INSTALLMENT',
      netTCP: 1_000_000,
      fmvPerTaxDeclarationUnit: null,
      zonalValuePerSqmUnit: null,
      zonalValuePerSqmParking: null,
      paymentRecords: [
        { paymentDate: new Date('2021-09-08'), totalCollection: 560000, isSubtotal: false, paymentPrincipal: 500000 },
        { paymentDate: new Date('2024-06-24'), totalCollection: 560000, isSubtotal: false, paymentPrincipal: 500000 },
      ],
      collectionEvents: [
        { actualTaxDue: 25_000, datePaid: new Date('2021-10-11'), transactionDate: new Date('2021-09-30'), sourceTaxBase: 500_000 },
      ],
    });
    const exposure = computeExposure(input, new Date('2026-10-12'));
    const dated = exposure.perPaymentLines.filter((l) => l.paymentDate);
    expect(dated[1].paidInAdvance).toBe(false);
    expect(dated[1].difference).toBe(25_000);
    expect(dated[1].penalties).not.toBeNull();
    expect(exposure.status).toBe('UNDER_REMITTED');
  });

  it('AR Sale remark, remitted in full: ties out, the bulk row shows the CWT due with a zero difference', () => {
    const input = baseInput({
      buyerClassification: 'INDIVIDUAL',
      taxTagging: 'INSTALLMENT',
      netTCP: 1_000_000,
      fmvPerTaxDeclarationUnit: null,
      zonalValuePerSqmUnit: null,
      zonalValuePerSqmParking: null,
      paymentRecords: [
        { paymentDate: new Date('2020-08-27'), totalCollection: 560000, isSubtotal: false },
        { paymentDate: new Date('2025-09-17'), totalCollection: 224000, isSubtotal: false },
      ],
      collectionEvents: [
        { actualTaxDue: 50_000, datePaid: new Date('2020-09-10'), transactionDate: new Date('2020-08-30'), sourceTaxBase: 1_000_000, remarks: 'AR SALE' },
      ],
    });
    const exposure = computeExposure(input, new Date('2026-10-12'));
    const [bulkRow, lastRow] = exposure.perPaymentLines.filter((l) => l.paymentDate);
    expect(bulkRow.shouldBeCwtDue).toBe(50_000);
    expect(bulkRow.cwtFileTaxDue).toBe(50_000);
    expect(bulkRow.difference).toBe(0);
    expect(bulkRow.penalties).toBeNull();
    expect(lastRow.shouldBeCwtDue).toBeNull();
    expect(exposure.deadline.note).toContain('tied');
  });

  it('AR Sale remark but the remittance is SHORT: still flagged under-remitted, penalties from the AR Sale deadline', () => {
    const input = baseInput({
      buyerClassification: 'INDIVIDUAL',
      taxTagging: 'INSTALLMENT',
      netTCP: 1_000_000,
      fmvPerTaxDeclarationUnit: null,
      zonalValuePerSqmUnit: null,
      zonalValuePerSqmParking: null,
      paymentRecords: [
        { paymentDate: new Date('2020-08-27'), totalCollection: 560000, isSubtotal: false },
        { paymentDate: new Date('2025-09-17'), totalCollection: 224000, isSubtotal: false },
      ],
      collectionEvents: [
        { actualTaxDue: 30_000, datePaid: new Date('2020-09-10'), transactionDate: new Date('2020-08-30'), sourceTaxBase: 600_000, remarks: 'AR SALE' },
      ],
    });
    const exposure = computeExposure(input, new Date('2026-10-12'));
    expect(exposure.status).toBe('UNDER_REMITTED');
    expect(exposure.variance).toBe(20_000);
    // Penalties are anchored on 10th of the month after the AR Sale (09/10/2020), not the 2025 amortization.
    expect(exposure.deadline.primaryDeadline?.toISOString().slice(0, 10)).toBe('2020-09-10');
    expect(exposure.penalties).not.toBeNull();
    expect(exposure.penalties!.surcharge).toBe(5_000);
    expect(exposure.penalties!.daysLate).toBeGreaterThan(2000);
    expect(exposure.deadline.note).toContain('SHORT by ₱20,000.00');

    // The same shortfall is visible on the bulk remittance's row; later payments stay clean.
    const [bulkRow, lastRow] = exposure.perPaymentLines.filter((l) => l.paymentDate);
    expect(bulkRow.shouldBeCwtDue).toBe(50_000);
    expect(bulkRow.difference).toBe(20_000);
    expect(bulkRow.penalties).not.toBeNull();
    expect(lastRow.coveredByBulkRemittance).toBe(true);
    expect(lastRow.penalties).toBeNull();
  });

  it('No AR Sale remark but remitted in full ahead: the last payment keeps its should-be CWT yet carries no penalty', () => {
    const input = baseInput({
      buyerClassification: 'INDIVIDUAL',
      taxTagging: 'INSTALLMENT',
      netTCP: 1_000_000,
      fmvPerTaxDeclarationUnit: null,
      zonalValuePerSqmUnit: null,
      zonalValuePerSqmParking: null,
      paymentRecords: [
        { paymentDate: new Date('2020-08-27'), totalCollection: 560000, isSubtotal: false },
        { paymentDate: new Date('2025-09-17'), totalCollection: 224000, isSubtotal: false },
      ],
      collectionEvents: [
        {
          actualTaxDue: 50_000,
          datePaid: new Date('2020-09-10'),
          transactionDate: new Date('2020-08-30'),
          sourceTaxBase: 1_000_000,
          remarks: null,
        },
      ],
    });
    const last = computeExposure(input, new Date('2026-10-12')).perPaymentLines.filter((l) => l.paymentDate).pop()!;
    expect(last.coveredByBulkRemittance).toBe(false);
    expect(last.shouldBeCwtDue).toBe(50_000);
    expect(last.paidInAdvance).toBe(true);
    expect(last.difference).toBe(0);
    expect(last.penalties).toBeNull();
  });

  it('AR Sale remark + ETB: only payments up to the bulk remittance carry per-collection obligations', () => {
    const result = computeDeadline(
      baseInput({
        buyerClassification: 'ETB',
        taxTagging: 'INSTALLMENT',
        paymentRecords: [
          { paymentDate: new Date('2020-01-15'), totalCollection: 112000, isSubtotal: false },
          { paymentDate: new Date('2020-08-27'), totalCollection: 112000, isSubtotal: false },
          { paymentDate: new Date('2021-03-15'), totalCollection: 112000, isSubtotal: false },
        ],
        collectionEvents: [
          { actualTaxDue: 50_000, datePaid: new Date('2020-09-10'), transactionDate: new Date('2020-08-30'), sourceTaxBase: 1_000_000, remarks: 'AR Sale' },
        ],
      }),
    );
    expect(result.entries.map((e) => e.date.toISOString().slice(0, 10))).toEqual(['2020-02-10', '2020-09-10']);
  });

  it('ETB start date after every payment: no deadlines are scheduled', () => {
    const result = computeDeadline(
      baseInput({
        buyerClassification: 'ETB',
        taxTagging: 'INSTALLMENT',
        etbStartDate: new Date('2030-01-01'),
        paymentRecords: [{ paymentDate: new Date('2023-01-15'), totalCollection: 123456, isSubtotal: false }],
      }),
    );
    expect(result.entries).toHaveLength(0);
    expect(result.primaryDeadline).toBeNull();
    expect(result.note).toContain('No payment on or after the ETB start date');
  });

  it('ETB + Installment: the first and second payments are computed exactly like the third onward — no reservation-fee folding', () => {
    // Same figures as real contract 2000000007819. A round-thousands first
    // payment (25,000) used to be folded into the 1st downpayment; per the
    // tax team the first and second rows now follow the same rule as every
    // later row: each payment is its own obligation, on its own VAT-exclusive
    // principal (the ledger's recorded principal when present, otherwise
    // total / 1.12), due the 10th of the following month.
    const input = baseInput({
      buyerClassification: 'ETB',
      taxTagging: 'INSTALLMENT',
      paymentRecords: [
        { paymentDate: new Date('2023-01-05'), totalCollection: 25_000, isSubtotal: false }, // 1st payment
        {
          paymentDate: new Date('2023-02-15'),
          totalCollection: 8_075,
          paymentPrincipal: 4_531.25,
          paymentVat: 3_543.75,
          isSubtotal: false,
        }, // 2nd payment
        { paymentDate: new Date('2023-03-15'), totalCollection: 8_075, isSubtotal: false }, // 3rd payment
      ],
    });
    const result = computeDeadline(input);
    expect(result.entries).toHaveLength(3);
    expect(result.entries[0].basisAmount).toBe(1116.07); // (25,000 / 1.12) * 5% — its own entry
    expect(result.entries[0].date.toISOString().slice(0, 10)).toBe('2023-02-10');
    expect(result.entries[1].basisAmount).toBe(226.56); // recorded principal 4,531.25 * 5% — NOT combined with row 1
    expect(result.entries[1].date.toISOString().slice(0, 10)).toBe('2023-03-10');
    expect(result.entries[2].basisAmount).toBe(360.49); // (8,075 / 1.12) * 5%
    expect(result.entries[2].date.toISOString().slice(0, 10)).toBe('2023-04-10');
    for (const e of result.entries) expect(e.description).not.toContain('reservation fee');
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
    // 2018-05-21 (OR 3035611 and OR 3035613). Date-keyed matching let the
    // second row's entry silently overwrite the first's, giving both rows
    // the same (wrong) amount.
    const input = baseInput({
      buyerClassification: 'ETB',
      taxTagging: 'INSTALLMENT',
      paymentRecords: [
        { paymentDate: new Date('2023-01-05'), totalCollection: 25_000, isSubtotal: false }, // 1st payment
        {
          paymentDate: new Date('2023-02-15'),
          totalCollection: 2_168_500,
          paymentPrincipal: 1_925_446.43,
          paymentVat: 243_053.57,
          isSubtotal: false,
        }, // 2nd payment
        {
          paymentDate: new Date('2023-02-15'), // same date as the row above
          totalCollection: 189_042,
          paymentPrincipal: 168_787.5,
          paymentVat: 20_254.5,
          isSubtotal: false,
        }, // 3rd payment
      ],
    });
    const deadline = computeDeadline(input);
    expect(deadline.entries).toHaveLength(3);
    expect(deadline.entries[0].basisAmount).toBe(1116.07); // (25,000 / 1.12) * 5%
    expect(deadline.entries[1].basisAmount).toBe(96272.32); // 1,925,446.43 * 5% — its own principal, nothing folded in
    // The second same-date row keeps its OWN principal, not the previous row's.
    expect(deadline.entries[2].basisAmount).toBe(8439.38); // 168,787.5 * 5%

    // Pass cwtTaxDue equal to the raw sum so no true-up shortfall is added
    // on top — this test is isolating the duplicate-date matching fix, not
    // the true-up behavior (covered separately above).
    const lines = computePerPaymentLines(input, deadline, 1116.07 + 96272.32 + 8439.38, new Date('2025-01-01'));
    const [firstPayment, secondPayment, thirdSameDate] = lines;
    // The first payment is alone in its month, so it carries its own should-be
    // due and deadline like any other row.
    expect(firstPayment.shouldBeCwtDue).toBe(1116.07);
    expect(firstPayment.applicableDeadline?.toISOString().slice(0, 10)).toBe('2023-02-10');
    // The second and third rows land in the same calendar month (Feb 2023),
    // so per the tax team's "last row in the month" rule the per-payment
    // TABLE consolidates their two entries onto the last row — the second
    // row shows no should-be due of its own. `deadline.entries` above stays
    // unconsolidated (it drives FIFO aging/the deadline summary); only this
    // per-row display table is consolidated.
    expect(secondPayment.shouldBeCwtDue).toBeNull();
    expect(thirdSameDate.shouldBeCwtDue).toBe(104_711.7); // 96,272.32 + 8,439.38
    expect(thirdSameDate.applicableDeadline?.toISOString().slice(0, 10)).toBe('2023-03-10');
  });

  it('ETB + Installment: a first payment that is not round-thousands is computed on its own', () => {
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
    expect(result.entries[0].basisAmount).toBe(376.44); // (8,432.17 / 1.12) * 5%
  });

  it('ETB + Installment: a lone round-thousands payment is computed on its own too', () => {
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
        // Two independent installment payments that both happen to land in
        // March.
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
          { paymentDate: new Date('2018-05-10'), totalCollection: 100_000, isSubtotal: false }, // 1st payment
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

    it('computes the first payment like any other row: its own should-be due, difference and penalties', () => {
      const input = baseInput({
        buyerClassification: 'ETB',
        taxTagging: 'INSTALLMENT',
        // The first payment (05/10) is alone in its month, so the CWT file
        // entry in that month attaches to it, and — with the first and second
        // rows computed exactly like the third onward — it has its own
        // should-be due to compare that remittance against.
        paymentRecords: [
          { paymentDate: new Date('2018-05-10'), totalCollection: 100_000, isSubtotal: false },
          { paymentDate: new Date('2018-06-21'), totalCollection: 8_075, paymentPrincipal: 4_531.25, isSubtotal: false },
        ],
        collectionEvents: [
          { actualTaxDue: 50, sourceTaxBase: 1000, transactionDate: new Date('2018-05-31'), datePaid: new Date('2018-06-11') },
        ],
      });
      const deadline = computeDeadline(input);
      const lines = computePerPaymentLines(input, deadline, 4690.85, new Date('2025-01-01'));
      expect(lines[0].cwtFileTaxDue).toBe(50); // matched (last/only row in May 2018)
      expect(lines[0].shouldBeCwtDue).toBe(4464.29); // (100,000 / 1.12) * 5%
      expect(lines[0].applicableDeadline?.toISOString().slice(0, 10)).toBe('2018-06-10');
      expect(lines[0].difference).toBe(4414.29); // 4,464.29 - 50 remitted
      expect(lines[0].penalties).not.toBeNull();
      expect(lines[0].totalDue).toBe(round2(4414.29 + lines[0].penalties!.totalPenalties));
      // The second payment is its own obligation too (recorded principal * 5%).
      expect(lines[1].shouldBeCwtDue).toBe(226.56);
      expect(lines[1].applicableDeadline?.toISOString().slice(0, 10)).toBe('2018-07-10');
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
