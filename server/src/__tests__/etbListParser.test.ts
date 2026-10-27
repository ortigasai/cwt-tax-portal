import ExcelJS from 'exceljs';
import { parseEtbList } from '../parsers/contractListParser';

async function workbook(rows: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

describe('parseEtbList', () => {
  it('reads contract numbers with a start date per row', async () => {
    const buf = await workbook([
      ['Contract Number', 'Start Date of ETB'],
      ['2000000000001', new Date(Date.UTC(2026, 0, 15))],
      [2000000000002, '03/20/2026'],
      ['2000000000003', '5-Oct-2026'],
      ['2000000000004', 'Nov 7, 2026'],
      ['[2000000000005]', null],
      ['2000000000006', 'not a date'],
      ['2000000000001', new Date(Date.UTC(2027, 0, 1))], // duplicate: first row wins
    ]);
    const { rows, hasDateColumn } = await parseEtbList(buf);
    expect(hasDateColumn).toBe(true);
    expect(rows.map((r) => r.contractNumber)).toEqual([
      '2000000000001',
      '2000000000002',
      '2000000000003',
      '2000000000004',
      '2000000000005',
      '2000000000006',
    ]);
    expect(rows.map((r) => iso(r.startDate))).toEqual(['2026-01-15', '2026-03-20', '2026-10-05', '2026-11-07', null, null]);
    expect(rows[5].badDate).toBe('not a date');
    expect(rows[4].badDate).toBeNull();
  });

  it('still reads a plain one-column list (no start dates)', async () => {
    const buf = await workbook([['Contract No.'], ['2000000000010'], ['2000000000011']]);
    const { rows } = await parseEtbList(buf);
    expect(rows.map((r) => r.contractNumber)).toEqual(['2000000000010', '2000000000011']);
    expect(rows.every((r) => r.startDate === null)).toBe(true);
  });

  it('finds the columns in either order', async () => {
    const buf = await workbook([
      ['Start Date of ETB', 'Contract Number'],
      [new Date(Date.UTC(2026, 5, 1)), '2000000000020'],
    ]);
    const { rows } = await parseEtbList(buf);
    expect(rows).toHaveLength(1);
    expect(rows[0].contractNumber).toBe('2000000000020');
    expect(iso(rows[0].startDate)).toBe('2026-06-01');
  });
});
