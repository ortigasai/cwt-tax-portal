import ExcelJS from 'exceljs';
import { generateLedgerExcel, type LedgerExportInput } from '../generators/ledgerExcelGenerator';
import { analyzeTagging, computeContractExposure, ContractWithRelations } from '../services/contractExposureService';

const dec = (n: number) => ({ toNumber: () => n });
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const pay = (date: string, total: number, principal: number) => ({
  paymentDate: d(date), totalCollection: dec(total), paymentPrincipal: dec(principal), isSubtotal: false,
});
const event = (paid: string, txn: string, due: number) => ({
  buyerClassification: 'ETB', taxTagging: 'INSTALLMENT', actualTaxDue: dec(due), datePaid: d(paid), transactionDate: d(txn),
  sourceTaxBase: null, baseContract: null, contractNumberRaw: null, remarks: null,
});

// TCP 19,120,200 -> 25% = 4,780,050.
function contract(payments: ReturnType<typeof pay>[]): ContractWithRelations {
  return {
    contractNumber: '2000000008098', tower: 'MAVEN TOWER', netTCP: dec(17_072_500), totalTCP: dec(19_120_200),
    zonalValuePerSqmUnit: null, zonalValuePerSqmParking: null, sqmUnit: null, sqmParking: null, sqmStorage: null,
    matchedRptRecord: null, matchedParkingRptRecord: null, matchedStorageRptRecord: null,
    paymentRecords: payments,
    collectionEvents: [event('2021-12-10', '2021-11-30', 853_625)],
  } as unknown as ContractWithRelations;
}

async function sheetFor(c: ContractWithRelations) {
  const input: LedgerExportInput = {
    contractNumber: c.contractNumber, buyerName: 'JUAN', estate: null, tower: 'MAVEN TOWER', unit: 'B1',
    totalTCP: 19_120_200, netTCP: 17_072_500, buyerClassification: 'ETB', taxTagging: 'INSTALLMENT',
    fmvPerTaxDeclarationUnit: null, fmvPerTaxDeclarationParking: null, fmvPerTaxDeclarationStorage: null,
    zonalValuePerSqmUnit: null, zonalValuePerSqmParking: null, sqmUnit: null, sqmParking: null, sqmStorage: null,
    ctsNotaryDate: null, rdo: null, paymentRecords: [],
    taggingAnalysis: analyzeTagging(c),
    exposure: computeContractExposure(c, d('2026-10-01')),
  };
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await generateLedgerExcel(input)) as unknown as ExcelJS.Buffer);
  return wb.getWorksheet('Tax Payment Ledger - Duplicate')!;
}

const isYellow = (cell: ExcelJS.Cell) => (cell.fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb === 'FFFFFF00';

describe('Should-be tax tagging (25% of the Total Contract Price)', () => {
  it('Cash Deferred: shows the date it was passed, the collection as of that date, and highlights that payment row', async () => {
    // 3,550,000 (09/08/2021) + 1,450,000 (11/24/2021) = 5,000,000 > 4,780,050 -> crossed on 11/24/2021.
    // A later 2021 payment (12/21/2021) must not count towards "as of that date".
    const sheet = await sheetFor(contract([pay('2021-09-08', 3_550_000, 3_169_642.86), pay('2021-11-24', 1_450_000, 1_294_642.86), pay('2021-12-21', 68_641, 61_286.61)]));

    expect(sheet.getCell('K10').value).toBe('Should-be Tax Tagging');
    expect(sheet.getCell('M10').value).toBe('CASH DEFERRED');
    expect(sheet.getCell('K11').value).toBe('Date considered Cash Deferred');
    expect((sheet.getCell('M11').value as Date).toISOString().slice(0, 10)).toBe('2021-11-24');
    expect(sheet.getCell('K12').value).toBe('25% of Total Contract Price (VAT inclusive)');
    expect((sheet.getCell('M12').value as { result: number }).result).toBe(4_780_050);
    expect(sheet.getCell('K13').value).toBe('Cash Deferred Actual Collections (VAT inclusive)');
    const collected = sheet.getCell('M13').value as { formula: string; result: number };
    expect(collected.result).toBe(5_000_000);
    expect(collected.formula).toContain('SUMIF(A');
    // The summary block itself carries no yellow fill — only the payment row is highlighted.
    expect(isYellow(sheet.getCell('K10'))).toBe(false);

    // The 11/24/2021 row is highlighted, the others are not.
    const rows: Record<string, boolean> = {};
    for (let r = 17; r < 40; r++) {
      const v = sheet.getCell(`A${r}`).value;
      if (v instanceof Date) rows[v.toISOString().slice(0, 10)] = isYellow(sheet.getCell(`B${r}`));
    }
    expect(rows).toEqual({ '2021-09-08': false, '2021-11-24': true, '2021-12-21': false });
  });

  it('Installment: not above 25% -> N/A for the date and the collection, and no row is highlighted', async () => {
    const sheet = await sheetFor(contract([pay('2021-09-08', 1_000_000, 892_857.14), pay('2022-05-10', 8_000_000, 7_142_857.14)]));

    expect(sheet.getCell('M10').value).toBe('INSTALLMENT');
    expect(sheet.getCell('M11').value).toBe('N/A');
    expect(sheet.getCell('M12').value).toBe('N/A'); // 25% of TCP: only for Cash Deferred
    expect(sheet.getCell('M13').value).toBe('N/A');
    for (let r = 17; r < 40; r++) expect(isYellow(sheet.getCell(`B${r}`))).toBe(false);
  });
});
