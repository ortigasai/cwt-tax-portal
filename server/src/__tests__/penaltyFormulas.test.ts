import ExcelJS from 'exceljs';
import { generateLedgerExcel, type LedgerExportInput } from '../generators/ledgerExcelGenerator';
import { computeContractExposure, ContractWithRelations } from '../services/contractExposureService';

const dec = (n: number) => ({ toNumber: () => n });
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const pay = (date: string, total: number, principal: number) => ({
  paymentDate: d(date), totalCollection: dec(total), paymentPrincipal: dec(principal), isSubtotal: false,
});
const event = (paid: string, txn: string, due: number) => ({
  buyerClassification: 'ETB', taxTagging: 'INSTALLMENT', actualTaxDue: dec(due), datePaid: d(paid), transactionDate: d(txn),
  sourceTaxBase: null, baseContract: null, contractNumberRaw: null, remarks: null,
});

// Modelled on 2000000008098: ETB + Installment whose 2021 collections pass 25% of the TCP, so it is computed as Cash
// Deferred — the CWT (5% of Net TCP 17,072,500 = 853,625) was due 12/10/2021.
function contract(events: ReturnType<typeof event>[]): ContractWithRelations {
  return {
    contractNumber: '2000000008098', tower: 'MAVEN TOWER', netTCP: dec(17_072_500), totalTCP: dec(19_120_200),
    zonalValuePerSqmUnit: null, zonalValuePerSqmParking: null, sqmUnit: null, sqmParking: null, sqmStorage: null,
    matchedRptRecord: null, matchedParkingRptRecord: null, matchedStorageRptRecord: null,
    paymentRecords: [pay('2021-09-08', 3_550_000, 3_169_642.86), pay('2021-11-24', 1_450_000, 1_294_642.86)],
    collectionEvents: events,
  } as unknown as ContractWithRelations;
}

async function sheetFor(c: ContractWithRelations, asOf: Date) {
  const input: LedgerExportInput = {
    contractNumber: c.contractNumber, buyerName: 'JUAN', estate: null, tower: 'MAVEN TOWER', unit: 'B1',
    totalTCP: 19_120_200, netTCP: 17_072_500, buyerClassification: 'ETB', taxTagging: 'INSTALLMENT',
    fmvPerTaxDeclarationUnit: null, fmvPerTaxDeclarationParking: null, fmvPerTaxDeclarationStorage: null,
    zonalValuePerSqmUnit: null, zonalValuePerSqmParking: null, sqmUnit: null, sqmParking: null, sqmStorage: null,
    ctsNotaryDate: null, rdo: null, paymentRecords: [], exposure: computeContractExposure(c, asOf),
  };
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await generateLedgerExcel(input)) as unknown as ExcelJS.Buffer);
  return { sheet: wb.getWorksheet('Tax Payment Ledger - Duplicate')!, input };
}

// A tiny evaluator for the penalty formulas: cell refs -> their (cached) values, DATE -> Excel serial.
function evaluate(sheet: ExcelJS.Worksheet, formula: string): number {
  const serial = (y: number, m: number, day: number) => Date.UTC(y, m - 1, day) / 86_400_000 + 25_569;
  const valueOf = (ref: string): number => {
    const v = sheet.getCell(ref.replace(/\$/g, '')).value as unknown;
    if (v instanceof Date) return v.getTime() / 86_400_000 + 25_569;
    if (v && typeof v === 'object' && 'result' in (v as object)) return Number((v as { result: unknown }).result);
    return Number(v);
  };
  const js = formula
    .replace(/\$?[A-Z]{1,2}\$?\d+/g, (m) => String(valueOf(m)))
    .replace(/\bDATE\(/g, 'DATE(')
    .replace(/\bIF\(/g, 'IF(')
    .replace(/\bROUND\(/g, 'ROUND(')
    .replace(/\bMAX\(/g, 'Math.max(');
  const IF = (c: boolean, a: number, b: number) => (c ? a : b);
  const ROUND = (n: number, dp: number) => Math.round((n + Number.EPSILON) * 10 ** dp) / 10 ** dp;
  const DATE = serial;
  return Function('IF', 'ROUND', 'DATE', `return (${js});`)(IF, ROUND, DATE) as number;
}

// Finds the table row that carries penalties and returns its row number.
function penaltyRow(sheet: ExcelJS.Worksheet): number {
  for (let r = 17; r < 60; r++) {
    const o = sheet.getCell(`O${r}`).value as unknown;
    if (o && typeof o === 'object' && 'formula' in (o as object)) return r;
  }
  throw new Error('no penalty row found');
}

describe('penalties in the Tax Payment Ledger - Duplicate are live Excel formulas', () => {
  it('a late-paid row: base, surcharge, compromise, days and interest are formulas that reproduce the engine', async () => {
    // 43,170 of the CWT was only remitted on 02/10/2022, after the 12/10/2021 deadline.
    const c = contract([event('2021-10-11', '2021-09-30', 158_482.14), event('2021-12-10', '2021-11-30', 651_972.86), event('2022-02-10', '2022-01-31', 43_170)]);
    const { sheet } = await sheetFor(c, d('2026-10-01'));
    const r = penaltyRow(sheet);

    for (const col of ['W', 'O', 'P', 'Q', 'R']) {
      const cell = sheet.getCell(`${col}${r}`).value as { formula: string; result: number };
      expect(cell.formula).toBeTruthy();
      expect(evaluate(sheet, cell.formula)).toBeCloseTo(Number(cell.result), 2);
    }
    expect((sheet.getCell(`O${r}`).value as { formula: string }).formula).toBe(`ROUND(0.25*W${r},2)`);
    expect((sheet.getCell(`P${r}`).value as { formula: string }).formula).toContain('IF(');
    expect(Number((sheet.getCell(`O${r}`).value as { result: number }).result)).toBeCloseTo(10_792.5, 2); // 25% x 43,170
    expect(Number((sheet.getCell(`P${r}`).value as { result: number }).result)).toBe(10_000);
    // Total penalties still sum the three formula cells.
    expect((sheet.getCell(`S${r}`).value as { formula: string }).formula).toBe(`ROUND(SUM(O${r}:Q${r}),2)`);
  });

  it('an unpaid row: Penalty Base = Difference, Days run to the "as of" cell, interest = base x 12% x days / 365', async () => {
    // The last 43,170 was never remitted.
    const c = contract([event('2021-10-11', '2021-09-30', 158_482.14), event('2021-12-10', '2021-11-30', 651_972.86)]);
    const { sheet } = await sheetFor(c, d('2026-10-01'));
    const r = penaltyRow(sheet);

    expect((sheet.getCell(`W${r}`).value as { formula: string }).formula).toBe(`N${r}`);
    expect((sheet.getCell(`R${r}`).value as { formula: string }).formula).toBe(`$I$16-G${r}`);
    expect((sheet.getCell(`Q${r}`).value as { formula: string }).formula).toBe(`ROUND(W${r}*0.12*R${r}/365,2)`);
    expect(sheet.getCell('H16').value).toBe('Penalties computed as of');
    for (const col of ['W', 'O', 'P', 'Q', 'R']) {
      const cell = sheet.getCell(`${col}${r}`).value as { formula: string; result: number };
      expect(evaluate(sheet, cell.formula)).toBeCloseTo(Number(cell.result), 2);
    }
  });
});
