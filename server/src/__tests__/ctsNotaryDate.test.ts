import { buildCtsIndex } from '../services/ctsDataSync';

const row = (contract: string, o: { dcmg?: string | null; deed?: string | null; area?: number } = {}) => ({
  old_contract_no: contract,
  subproject: 'AVILA TOWER',
  unit_no: '5-S-02P',
  saleable_area: o.area ?? 47,
  cts_notary_date: o.dcmg ?? null,
  extract: { cts_date: o.deed ?? null, parking_area: 12.5 },
});

describe('CTS notary date comes from the DOAS "read from deed" column', () => {
  it('uses the deed-read CTS date even when the DCMG endorsement date differs', () => {
    const idx = buildCtsIndex([{ name: 'B1', rows: [row('1', { dcmg: '2025-01-04', deed: '2025-04-21' })] }]);
    const rec = idx.get('1')!;
    expect(rec.notaryDate).toBe('2025-04-21');
    expect(rec.notarySource).toBe('deed');
    expect(rec.legacyNotaryDate).toBe('2025-01-04'); // what the old rule would have used
  });

  it('takes the LATEST date when the contract has several rows / batches', () => {
    const idx = buildCtsIndex([
      { name: 'new', rows: [row('2', { deed: '2025-08-29' })] },
      { name: 'old', rows: [row('2', { deed: '2025-09-29' }), row('2', { deed: '2025-07-01' })] },
    ]);
    expect(idx.get('2')!.notaryDate).toBe('2025-09-29'); // later date wins, not the newest batch
  });

  it('falls back to the latest DCMG date only when no row has a deed-read date', () => {
    const idx = buildCtsIndex([
      { name: 'b2', rows: [row('3', { dcmg: '2025-04-25' })] },
      { name: 'b1', rows: [row('3', { dcmg: '2025-05-02' })] },
    ]);
    const rec = idx.get('3')!;
    expect(rec.notaryDate).toBe('2025-05-02');
    expect(rec.notarySource).toBe('dcmg');
  });

  it('ignores the 1900-01-01 placeholder and empty values', () => {
    const idx = buildCtsIndex([{ name: 'b', rows: [row('4', { dcmg: '1900-01-01', deed: '1900-01-01' })] }]);
    expect(idx.get('4')!.notaryDate).toBeNull();
    expect(idx.get('4')!.notarySource).toBeNull();
  });

  it('takes unit / parking SQM from the deed column, not the DCMG saleable area', () => {
    const idx = buildCtsIndex([
      {
        name: 'b',
        rows: [{ ...row('6', { area: 47 }), extract: { unit_area: 46.5, parking_area: 12.5 } }],
      },
    ]);
    const rec = idx.get('6')!;
    expect(rec.sqmUnit).toBe(46.5);
    expect(rec.legacySqmUnit).toBe(47);
    expect(rec.sqmParking).toBe(12.5);
  });

  it('prefers the value corrected on the DOAS screen over the raw deed read', () => {
    const idx = buildCtsIndex([
      {
        name: 'b',
        rows: [{ ...row('7'), unit_area_sqm: 48, parking_area_sqm: 25, extract: { unit_area: 46, parking_area: 12.5 } }],
      },
    ]);
    const rec = idx.get('7')!;
    expect(rec.sqmUnit).toBe(48);
    expect(rec.sqmParking).toBe(25);
    expect(rec.legacySqmParking).toBe(12.5);
  });

  it('falls back to the saleable area only when the deed gave no unit area', () => {
    const idx = buildCtsIndex([{ name: 'b', rows: [row('8', { area: 52 })] }]);
    expect(idx.get('8')!.sqmUnit).toBe(52);
  });

  it('still fills the SQM and tower from the first batch that has them', () => {
    const idx = buildCtsIndex([{ name: 'b', rows: [row('5', { deed: '2025-01-01', area: 76 })] }]);
    const rec = idx.get('5')!;
    expect(rec.sqmUnit).toBe(76);
    expect(rec.sqmParking).toBe(12.5);
    expect(rec.tower).toBe('AVILA TOWER');
  });
});
