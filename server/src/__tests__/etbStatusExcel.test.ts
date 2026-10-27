import ExcelJS from 'exceljs';
import { generateEtbStatusExcel, type EtbStatusRow } from '../generators/etbStatusExcel';

const row = (o: Partial<EtbStatusRow>): EtbStatusRow => ({
  contractNumber: '2000000000001',
  buyerName: 'JUAN DELA CRUZ',
  tower: 'MAVEN TOWER',
  unit: 'B1',
  startDate: '2024-06-01',
  storedClassification: 'INDIVIDUAL',
  storedTagging: 'INSTALLMENT',
  analysisState: 'DONE',
  missing: [],
  status: 'COMPLIANT',
  ctsNotaryDate: '2023-01-15',
  netTCP: 1_000_000,
  cwtTaxBase: 1_000_000,
  taxBaseSource: 'NET_TCP',
  cwtTaxDue: 50_000,
  actualRemitted: 50_000,
  variance: 0,
  totalPenalties: 0,
  primaryDeadline: '2024-07-10',
  paymentCount: 12,
  paymentsBeforeStart: 3,
  ...o,
});

describe('generateEtbStatusExcel', () => {
  it('writes each contract with its ETB start date and every missing item, and a summary', async () => {
    const buf = await generateEtbStatusExcel(
      [
        row({}),
        row({ contractNumber: '2000000000002', startDate: null, analysisState: 'PENDING', status: 'MISSING_DATA', missing: ['Payment ledger', 'CTS notary date'] }),
      ],
      { title: 'October ETB list', defaultStart: null, ownStarts: 1, missingFromPortal: ['2000000000099'] },
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet('ETB status')!;
    const header = ws.getRow(1).values as string[];
    const startCol = header.indexOf('ETB Start Date');
    const missingCol = header.indexOf('Still Needed (all items)');
    expect((ws.getRow(2).getCell(startCol).value as Date).toISOString().slice(0, 10)).toBe('2024-06-01');
    expect(ws.getRow(3).getCell(startCol).value).toBe('All payments');
    expect(ws.getRow(3).getCell(missingCol).value).toBe('Payment ledger\nCTS notary date');

    const text: string[] = [];
    wb.getWorksheet('Summary')!.eachRow((r) => text.push(String(r.getCell(1).value)));
    expect(text.join('\n')).toContain('1 with their own ETB start date, the rest treated as all payments');
    expect(text.join('\n')).toContain('2000000000099');
  });
});
