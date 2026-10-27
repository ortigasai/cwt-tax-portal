import { holidayName, isBusinessDay, isProjectedYear, nextBusinessDay, projectedHolidays } from '../lib/phHolidays';
import { computeExposure, computePenalties, computeDeadline, computePerPaymentLines, ContractComputationInput } from '../services/computation';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null);

describe('Philippine business days', () => {
  it('moves a Sunday deadline to the Monday (May 10 -> May 11)', () => {
    expect(d('2026-05-10').getUTCDay()).toBe(0);
    expect(iso(nextBusinessDay(d('2026-05-10')))).toBe('2026-05-11');
  });

  it('moves a Saturday deadline past the weekend to Monday', () => {
    expect(d('2025-05-10').getUTCDay()).toBe(6);
    // Mon May 12, 2025 was the election day, a special non-working day (Proc. 878) -> Tue May 13.
    expect(iso(nextBusinessDay(d('2025-05-10')))).toBe('2025-05-13');
  });

  it('keeps an ordinary weekday', () => {
    expect(iso(nextBusinessDay(d('2025-12-10')))).toBe('2025-12-10');
  });

  it('skips regular holidays, including when they follow a weekend', () => {
    // Sat Jun 10 2023 -> Sun -> Mon Jun 12 is Independence Day -> Tue Jun 13.
    expect(iso(nextBusinessDay(d('2023-06-10')))).toBe('2023-06-13');
    expect(holidayName(d('2023-06-12'))).toBe('Independence Day');
  });

  it('knows the Holy Week days from the Easter date', () => {
    expect(isBusinessDay(d('2020-04-09'))).toBe(false); // Maundy Thursday and Araw ng Kagitingan coincided
    expect(holidayName(d('2020-04-10'))).toBe('Good Friday');
    expect(holidayName(d('2026-04-03'))).toBe('Good Friday');
    expect(holidayName(d('2026-04-02'))).toBe('Maundy Thursday');
  });

  it('knows National Heroes Day (last Monday of August) and the special non-working days', () => {
    expect(holidayName(d('2026-08-31'))).toBe('National Heroes Day');
    expect(holidayName(d('2025-08-25'))).toBe('National Heroes Day');
    expect(holidayName(d('2024-11-01'))).toBe("All Saints' Day");
    expect(holidayName(d('2024-12-24'))).toBe('Christmas Eve');
    expect(holidayName(d('2022-12-24'))).toBeNull(); // only a holiday from 2023
  });

  it('knows proclaimed days (Eid) from the table', () => {
    expect(holidayName(d('2024-04-10'))).toBe("Eid'l Fitr");
    expect(isBusinessDay(d('2024-04-10'))).toBe(false);
    expect(iso(nextBusinessDay(d('2024-04-10')))).toBe('2024-04-11');
  });
});

describe('year-by-year lists follow the Palace proclamations', () => {
  it('Eid\'l Fitr 2025 was Tuesday April 1 (Proc. 839), not March 31', () => {
    expect(holidayName(d('2025-04-01'))).toBe("Eid'l Fitr");
    expect(isBusinessDay(d('2025-03-31'))).toBe(true);
  });

  it('2023 (Proc. 90): April 10 and November 27 are holidays, Thursday November 30 is a working day', () => {
    expect(holidayName(d('2023-04-10'))).toBe('Araw ng Kagitingan');
    expect(iso(nextBusinessDay(d('2023-04-10')))).toBe('2023-04-11');
    expect(holidayName(d('2023-11-27'))).toBe('Bonifacio Day');
    expect(isBusinessDay(d('2023-11-30'))).toBe(true);
    expect(holidayName(d('2023-01-02'))).not.toBeNull();
    expect(holidayName(d('2023-10-30'))).not.toBeNull(); // Proc. 359, barangay elections
  });

  it('2021 (Proc. 1107): All Souls, Christmas Eve and the last day of the year are special WORKING days', () => {
    expect(isBusinessDay(d('2021-11-02'))).toBe(true);
    expect(isBusinessDay(d('2021-12-24'))).toBe(true);
    expect(isBusinessDay(d('2021-12-31'))).toBe(true);
    expect(holidayName(d('2021-02-25'))).not.toBeNull(); // EDSA was still non-working in 2021
  });

  it('2022 (Proc. 1236): EDSA Feb 25 non-working; election day, Oct 31 (Proc. 79) and Eid are holidays', () => {
    expect(holidayName(d('2022-02-25'))).not.toBeNull();
    expect(holidayName(d('2022-05-09'))).not.toBeNull();
    expect(holidayName(d('2022-10-31'))).not.toBeNull();
    expect(holidayName(d('2022-05-03'))).toBe("Eid'l Fitr");
    expect(isBusinessDay(d('2022-11-02'))).toBe(true);
  });

  it('2025 (Proc. 727): Oct 31 is a special day, election day May 12 (Proc. 878)', () => {
    expect(holidayName(d('2025-10-31'))).toBe("All Saints' Day Eve");
    expect(holidayName(d('2025-05-12'))).not.toBeNull();
    expect(isBusinessDay(d('2025-02-25'))).toBe(true); // EDSA is a special working day
  });

  it('2026 (Proc. 1006) and 2027 (Proc. 1427)', () => {
    expect(holidayName(d('2026-03-20'))).toBe("Eid'l Fitr");
    expect(holidayName(d('2026-05-27'))).toBe("Eid'l Adha");
    expect(isBusinessDay(d('2026-02-25'))).toBe(true);
    expect(holidayName(d('2027-03-26'))).toBe('Good Friday');
    expect(holidayName(d('2027-08-30'))).toBe('National Heroes Day');
  });

  it('a deadline on Good Friday 2020 (Apr 10) moves to Monday Apr 13', () => {
    expect(iso(nextBusinessDay(d('2020-04-10')))).toBe('2020-04-13');
  });
});

describe('years without a proclamation yet use a projected calendar', () => {
  it('flags years with no proclamation on file, not the official ones', () => {
    expect(isProjectedYear(2026)).toBe(false);
    expect(isProjectedYear(2027)).toBe(false);
    expect(isProjectedYear(2028)).toBe(true);
    expect(isProjectedYear(2030)).toBe(true);
  });

  it('the Eid projection is within a day of the dates actually proclaimed (2017-2026)', () => {
    const actual: Record<number, [string, string]> = {
      2017: ['06-26', '09-01'], 2018: ['06-15', '08-21'], 2019: ['06-05', '08-12'], 2020: ['05-25', '07-31'],
      2021: ['05-13', '07-20'], 2022: ['05-03', '07-09'], 2023: ['04-21', '06-28'], 2024: ['04-10', '06-17'],
      2025: ['04-01', '06-06'], 2026: ['03-20', '05-27'],
    };
    const near = (year: number, md: string, name: string) => {
      const target = Date.parse(`${year}-${md}T00:00:00Z`);
      return [...projectedHolidays(year).entries()].some(
        ([k, n]) => n === name && Math.abs(Date.parse(`${k}T00:00:00Z`) - target) <= 86_400_000,
      );
    };
    for (const [y, [fitr, adha]] of Object.entries(actual)) {
      expect(near(Number(y), fitr, "Eid'l Fitr")).toBe(true);
      expect(near(Number(y), adha, "Eid'l Adha")).toBe(true);
    }
  });

  it('projects the standing holidays for 2028-2030', () => {
    expect(holidayName(d('2028-01-01'))).toBe("New Year's Day");
    expect(holidayName(d('2028-04-14'))).toBe('Good Friday'); // Easter 2028 is April 16
    expect(holidayName(d('2028-08-28'))).toBe('National Heroes Day');
    expect(holidayName(d('2028-05-08'))).toBe('National and Local Elections'); // 2nd Monday of May 2028
    expect(holidayName(d('2029-02-13'))).toBe('Chinese New Year');
    expect(holidayName(d('2030-12-25'))).toBe('Christmas Day');
    expect(isBusinessDay(d('2029-05-09'))).toBe(true); // no election in 2029
  });

  it('a deadline in a projected year carries a note saying so', () => {
    const inp = {
      netTCP: 1_000_000, totalTCP: 1_120_000,
      fmvPerTaxDeclarationUnit: null, fmvPerTaxDeclarationParking: null, fmvPerTaxDeclarationStorage: null,
      zonalValuePerSqmUnit: null, zonalValuePerSqmParking: null, sqmUnit: null, sqmParking: null, sqmStorage: null,
      buyerClassification: 'INDIVIDUAL', taxTagging: 'INSTALLMENT', manualDeadlineOverride: null,
      paymentRecords: [{ paymentDate: d('2028-04-20'), totalCollection: 112_000, paymentPrincipal: 100_000, isSubtotal: false }],
      collectionEvents: [],
    } as unknown as ContractComputationInput;
    const result = computeExposure(inp, d('2028-06-01'));
    expect(result.deadline.note).toContain('no holiday proclamation is on file for 2028');
    const official = computeExposure({ ...inp, paymentRecords: [{ paymentDate: d('2026-04-20'), totalCollection: 112_000, paymentPrincipal: 100_000, isSubtotal: false }] } as ContractComputationInput, d('2026-06-01'));
    expect(official.deadline.note).not.toContain('no holiday proclamation');
  });
});

describe('deadlines and penalties use the adjusted business day', () => {
  const input = (payDate: string): ContractComputationInput =>
    ({
      netTCP: 1_000_000,
      fmvPerTaxDeclarationUnit: null,
      fmvPerTaxDeclarationParking: null,
      fmvPerTaxDeclarationStorage: null,
      zonalValuePerSqmUnit: null,
      zonalValuePerSqmParking: null,
      sqmUnit: null,
      sqmParking: null,
      sqmStorage: null,
      buyerClassification: 'ETB',
      taxTagging: 'INSTALLMENT',
      manualDeadlineOverride: null,
      paymentRecords: [{ paymentDate: d(payDate), totalCollection: 112_000, paymentPrincipal: 100_000, isSubtotal: false }],
      collectionEvents: [],
    }) as ContractComputationInput;

  it('a payment in April whose May 10 deadline is a Sunday is due May 11', () => {
    // 2026-05-10 is a Sunday.
    const result = computeDeadline(input('2026-04-15'));
    expect(iso(result.primaryDeadline)).toBe('2026-05-11');
  });

  it('interest runs from the adjusted deadline, not the Sunday', () => {
    const p = computePenalties(10_000, d('2026-05-11'), d('2027-05-11'));
    expect(p?.daysLate).toBe(365);
  });

  it('a remittance made on the adjusted day is on time (no penalty)', () => {
    const inp = input('2026-04-15');
    inp.collectionEvents = [
      { actualTaxDue: 5_000, datePaid: d('2026-05-11'), transactionDate: d('2026-04-30'), sourceTaxBase: null },
    ];
    const lines = computePerPaymentLines(inp, computeDeadline(inp), 5_000, d('2026-10-01'));
    expect(iso(lines[0].applicableDeadline)).toBe('2026-05-11');
    expect(lines[0].penalties).toBeNull();
  });

  it('a remittance one day after the adjusted deadline is late', () => {
    const inp = input('2026-04-15');
    inp.collectionEvents = [
      { actualTaxDue: 5_000, datePaid: d('2026-05-12'), transactionDate: d('2026-04-30'), sourceTaxBase: null },
    ];
    const lines = computePerPaymentLines(inp, computeDeadline(inp), 5_000, d('2026-10-01'));
    expect(lines[0].penalties).not.toBeNull();
    expect(lines[0].penalties?.daysLate).toBe(1);
  });
});
