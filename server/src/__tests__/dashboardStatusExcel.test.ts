import ExcelJS from 'exceljs';
import { generateDashboardStatusExcel, type DashboardStatusRow } from '../generators/dashboardStatusExcel';

const row = (o: Partial<DashboardStatusRow>): DashboardStatusRow => ({
  contractNumber: '2000000000001',
  buyerName: 'JUAN DELA CRUZ',
  tower: 'MAVEN TOWER',
  unit: 'B1-R1',
  batchNumber: 7,
  batchTitle: 'October Batch',
  batchDate: '2026-10-21T00:00:00Z',
  buyerClassification: 'ETB',
  taxTagging: 'INSTALLMENT',
  taxTaggingNote: null,
  ctsNotaryDate: new Date('2024-08-22T00:00:00Z'),
  netTCP: 4_017_857.14,
  cwtTaxBase: 4_017_857.14,
  cwtTaxDue: 200_892.86,
  actualRemitted: 200_892.86,
  variance: 0,
  totalPenalties: 22_238.34,
  status: 'NON_COMPLIANT',
  analysisState: 'DONE',
  missing: [],
  ...o,
});

describe('generateDashboardStatusExcel', () => {
  it('lists every missing item and summarises the counts', async () => {
    const buf = await generateDashboardStatusExcel([
      row({}),
      row({ contractNumber: '2000000000002', analysisState: 'PENDING', status: 'MISSING_DATA', missing: ['Payment ledger', '1606 remittances', 'CTS notary date', 'Unit SQM'] }),
      row({ contractNumber: '2000000000003', analysisState: 'PENDING', status: 'UNDER_REMITTED', missing: ['1606 remittances'] }),
    ]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);

    const ws = wb.getWorksheet('Dashboard status')!;
    expect(ws.rowCount).toBe(4);
    const missingCol = (ws.getRow(1).values as string[]).indexOf('Still Needed (all items)');
    expect(ws.getRow(3).getCell(missingCol).value).toBe('Payment ledger\n1606 remittances\nCTS notary date\nUnit SQM');
    expect(ws.getRow(2).getCell(missingCol).value ?? '').toBe('');

    const lines: Record<string, number> = {};
    wb.getWorksheet('Summary')!.eachRow((r) => {
      const label = r.getCell(1).value;
      const n = r.getCell(2).value;
      if (typeof label === 'string' && typeof n === 'number') lines[label] = n;
    });
    expect(lines['Done (ledger can be downloaded)']).toBe(1);
    expect(lines['Pending (something still missing)']).toBe(2);
    expect(lines['1606 remittances']).toBe(2);
    expect(lines['Payment ledger']).toBe(1);
    expect(lines['Missing data']).toBe(1);
  });
});
