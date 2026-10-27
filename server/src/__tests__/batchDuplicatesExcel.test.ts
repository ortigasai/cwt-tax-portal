import ExcelJS from 'exceljs';
import { generateBatchDuplicatesExcel, type LedgerExportInput } from '../generators/ledgerExcelGenerator';
import { computeContractExposure, ContractWithRelations } from '../services/contractExposureService';

const dec = (n: number) => ({ toNumber: () => n });
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

function entryFor(contractNumber: string, label: string) {
  const contract = {
    contractNumber,
    tower: 'MAVEN TOWER',
    netTCP: dec(17_072_500),
    zonalValuePerSqmUnit: null,
    zonalValuePerSqmParking: null,
    sqmUnit: null,
    sqmParking: null,
    sqmStorage: null,
    matchedRptRecord: null,
    matchedParkingRptRecord: null,
    matchedStorageRptRecord: null,
    paymentRecords: [
      { paymentDate: d('2021-09-08'), totalCollection: dec(3_550_000), paymentPrincipal: dec(3_169_642.86), isSubtotal: false },
    ],
    collectionEvents: [
      { buyerClassification: 'ETB', taxTagging: 'CASH_DEFERRED', actualTaxDue: dec(158_482.14), datePaid: d('2021-10-11'), transactionDate: d('2021-09-30'), sourceTaxBase: null, baseContract: null, contractNumberRaw: null, remarks: null },
    ],
  } as unknown as ContractWithRelations;
  const input: LedgerExportInput = {
    contractNumber,
    buyerName: 'JUAN DELA CRUZ',
    estate: null,
    tower: 'MAVEN TOWER',
    unit: 'B1-R1',
    totalTCP: 17_072_500,
    netTCP: 17_072_500,
    buyerClassification: 'ETB',
    taxTagging: 'CASH_DEFERRED',
    fmvPerTaxDeclarationUnit: null,
    fmvPerTaxDeclarationParking: null,
    fmvPerTaxDeclarationStorage: null,
    zonalValuePerSqmUnit: null,
    zonalValuePerSqmParking: null,
    sqmUnit: null,
    sqmParking: null,
    sqmStorage: null,
    ctsNotaryDate: null,
    rdo: null,
    paymentRecords: [
      { paymentDate: d('2021-09-08'), totalCollection: 3_550_000, clearingDocument: '1400000001', orNumber: null, paymentPrincipal: 3_169_642.86, paymentVat: 380_357.14, isSubtotal: false },
    ],
    exposure: computeContractExposure(contract, d('2026-10-22')),
  };
  return { input, analysisLabel: label };
}

describe('generateBatchDuplicatesExcel', () => {
  it('puts every contract\'s Duplicate sheet in ONE workbook, behind an Index sheet', async () => {
    const buf = await generateBatchDuplicatesExcel(
      [entryFor('2000000000001', 'Done'), entryFor('2000000000002', 'Provisional')],
      { title: 'Batch 3 — October', generatedAt: d('2026-10-22') },
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Index', '2000000000001', '2000000000002']);

    // Each contract sheet is a full Duplicate ledger (summary block present).
    const sheet = wb.getWorksheet('2000000000001')!;
    expect(sheet.getCell('I7').value).toBeTruthy();

    const index = wb.getWorksheet('Index')!;
    expect(index.getCell('A5').text).toBe('2000000000001');
    expect(index.getCell('A6').text).toBe('2000000000002');
    expect(index.getCell('E6').text).toBe('Provisional');
    // Figures are formulas pointing at each contract's own sheet.
    const taxDue = index.getCell('G5').value as { formula: string };
    expect(taxDue.formula).toBe("'2000000000001'!I7");
    const total = index.getCell('G7').value as { formula: string };
    expect(total.formula).toBe('SUM(G5:G6)');
  });
});
