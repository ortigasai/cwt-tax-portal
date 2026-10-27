import ExcelJS from 'exceljs';
import { ExposureResult, round2, formatMDY } from '../services/computation';
import type { TaggingAnalysis } from '../services/contractExposureService';

export interface LedgerExportPaymentRow {
  paymentDate: Date | null;
  totalCollection: number | null;
  clearingDocument: string | null;
  orNumber: string | null;
  paymentPrincipal: number | null;
  paymentVat: number | null;
  isSubtotal: boolean;
}

export interface LedgerExportInput {
  contractNumber: string;
  buyerName: string | null;
  estate: string | null;
  tower: string | null;
  unit: string | null;
  totalTCP: number | null;
  netTCP: number | null;
  buyerClassification: string | null;
  taxTagging: string | null;
  fmvPerTaxDeclarationUnit: number | null;
  fmvPerTaxDeclarationParking: number | null;
  fmvPerTaxDeclarationStorage: number | null;
  // Parking has its own rate; storage has none — it always shares the unit's
  // rate (see computation.ts computeCwtTaxBase).
  zonalValuePerSqmUnit: number | null;
  zonalValuePerSqmParking: number | null;
  sqmUnit: number | null;
  sqmParking: number | null;
  sqmStorage: number | null;
  ctsNotaryDate: Date | null;
  rdo: string | null;
  // Our own reading of what the tagging should be (25% rule) — see analyzeTagging.
  taggingAnalysis?: TaggingAnalysis | null;
  paymentRecords: LedgerExportPaymentRow[];
  exposure: ExposureResult;
}

const CURRENCY_FMT = '#,##0.00';
const DATE_FMT = 'mm/dd/yyyy';
const COMPANY_NAME = 'ORTIGAS & COMPANY LIMITED PARTNERSHIP';

function bold(cell: ExcelJS.Cell): void {
  cell.font = { bold: true };
}

// Writes a live Excel formula (so the cell shows its working, like any
// spreadsheet) together with the value the engine computed, so viewers that do
// not recalculate still show the right number. The formula is only used when it
// reproduces the engine's value; otherwise the plain value is written.
function formulaCell(cell: ExcelJS.Cell, formula: string, engineValue: number | null, recomputed: number): void {
  if (engineValue !== null && Math.abs(engineValue - recomputed) > 0.011) {
    cell.value = engineValue;
  } else {
    cell.value = { formula, result: engineValue ?? recomputed };
  }
  cell.numFmt = CURRENCY_FMT;
}

// A single date renders as an actual Excel date (numFmt applied by the
// caller); multiple dates (FS Section 8: "reflect all dates" when a
// contract has more than one CWT actual payment date) render as a
// comma-joined text list since a cell can't hold more than one date value.
function formatDateList(dates: Date[]): Date | string {
  if (dates.length === 0) return '';
  if (dates.length === 1) return dates[0];
  return dates.map((d) => formatMDY(d)).join(', ');
}

function taxBaseSourceLabel(source: ExposureResult['taxBaseSource']): string {
  if (source === 'NET_TCP') return 'Net TCP';
  if (source === 'FMV_PER_TAX_DECLARATION') return 'FMV per Tax Declaration';
  if (source === 'ZONAL_VALUE') return 'Zonal Value';
  return '';
}

// Renders the "UNIT INFORMATION / BUYER INFORMATION" + "CONTRACT
// INFORMATION" header block exactly as it appears in
// Tax Payment Ledger Template.xlsx, starting at row 1. Returns the row
// number immediately after the header block (where the payment table
// should begin).
function writeHeaderBlock(sheet: ExcelJS.Worksheet, input: LedgerExportInput): number {
  sheet.getCell('A1').value = COMPANY_NAME;
  bold(sheet.getCell('A1'));

  sheet.getCell('A4').value = 'UNIT INFORMATION';
  bold(sheet.getCell('A4'));
  sheet.getCell('E4').value = 'BUYER INFORMATION';
  bold(sheet.getCell('E4'));

  sheet.getCell('A5').value = 'Estate';
  sheet.getCell('B5').value = input.estate ?? '';
  sheet.getCell('E5').value = 'Customer No.';

  sheet.getCell('A6').value = 'Project';
  sheet.getCell('B6').value = input.tower ?? '';
  sheet.getCell('E6').value = "Buyer's Name";
  sheet.getCell('F6').value = input.buyerName ?? '';

  sheet.getCell('A7').value = 'Units';
  sheet.getCell('B7').value = input.unit ?? '';

  sheet.getCell('A9').value = 'CONTRACT INFORMATION';
  bold(sheet.getCell('A9'));
  sheet.getCell('A10').value = 'Contract No.';
  sheet.getCell('B10').value = input.contractNumber;
  sheet.getCell('A11').value = 'Total Contract Price (TCP)';
  sheet.getCell('B11').value = input.totalTCP ?? '';
  sheet.getCell('B11').numFmt = CURRENCY_FMT;
  sheet.getCell('A12').value = 'Net TCP';
  sheet.getCell('B12').value = input.netTCP ?? '';
  sheet.getCell('B12').numFmt = CURRENCY_FMT;

  return 16; // template's payment table header starts here
}

// Sheet 1: mirrors Tax Payment Ledger Template.xlsx exactly — header block
// plus the 6-column payment table. No CWT computation columns here; that's
// what the duplicate sheet is for.
function buildLedgerSheet(wb: ExcelJS.Workbook, input: LedgerExportInput): void {
  const sheet = wb.addWorksheet('Tax Payment Ledger');
  sheet.columns = [{ width: 14 }, { width: 16 }, { width: 18 }, { width: 14 }, { width: 16 }, { width: 14 }];

  const headerRowIdx = writeHeaderBlock(sheet, input);
  const headerRow = sheet.getRow(headerRowIdx);
  headerRow.values = ['Payment Date', 'Total Collection', 'Clearing Document', 'OR Number', 'Payment Principal', 'Payment VAT'];
  headerRow.eachCell((c) => {
    bold(c);
    c.border = { bottom: { style: 'thin' } };
  });

  const realPayments = input.paymentRecords.filter((p) => !p.isSubtotal);
  let rowIdx = headerRowIdx + 1;
  for (const p of realPayments) {
    const row = sheet.getRow(rowIdx++);
    row.getCell(1).value = p.paymentDate ?? '';
    if (p.paymentDate) row.getCell(1).numFmt = DATE_FMT;
    row.getCell(2).value = p.totalCollection ?? '';
    row.getCell(2).numFmt = CURRENCY_FMT;
    row.getCell(3).value = p.clearingDocument ?? '';
    row.getCell(4).value = p.orNumber ?? '';
    row.getCell(5).value = p.paymentPrincipal ?? '';
    row.getCell(5).numFmt = CURRENCY_FMT;
    row.getCell(6).value = p.paymentVat ?? '';
    row.getCell(6).numFmt = CURRENCY_FMT;
  }
}

// Compromise penalty bracket as a nested IF on the penalty base cell (same
// brackets as compromisePenaltyFor).
const compromiseFormula = (base: string) =>
  `IF(${base}<=0,0,IF(${base}<=5000,1000,IF(${base}<=15000,3000,IF(${base}<=20000,5000,` +
  `IF(${base}<=50000,10000,IF(${base}<=500000,15000,IF(${base}<=1000000,20000,25000)))))))`;

const money = (n: number) => String(round2(n));
const dateExpr = (d: Date) => `DATE(${d.getUTCFullYear()},${d.getUTCMonth() + 1},${d.getUTCDate()})`;

// Shows a late row's penalties the way a spreadsheet would work them out:
//   Penalty Base (W) = what is still unpaid + the portions paid after the deadline
//   Surcharge  (O) = 25% x base
//   Compromise (P) = bracket of the base
//   Days       (R) = days from the deadline (G) to the date paid / to $I$16 for the unpaid part
//   Interest   (Q) = base x 12% (20% before 2018) x days / 365 — per late-paid portion to
//                    its own paid date, the unpaid part to the as-of date.
// A formula is only written where it reproduces the engine's figure; otherwise
// the plain value stays.
function writePenaltyFormulas(row: ExcelJS.Row, r: number, line: ExposureResult['perPaymentLines'][number]): void {
  const pen = line.penalties!;
  const w = line.penaltyWorking!;
  const G = `G${r}`;
  const hasLate = w.lateParts.length > 0;
  const unpaidIsDifference = line.difference !== null && Math.abs(line.difference - w.unpaid) < 0.005;

  // W: Penalty Base — the unpaid part is the row's Difference (N) when they agree.
  const baseTerms = [...w.lateParts.map((p) => money(p.amount)), ...(w.unpaid > 0 ? [unpaidIsDifference ? `N${r}` : money(w.unpaid)] : [])];
  const baseFormula = baseTerms.length === 1 && baseTerms[0] === `N${r}` ? `N${r}` : `ROUND(${baseTerms.join('+')},2)`;
  formulaCell(row.getCell(23), baseFormula, w.base, w.base);

  // O: Surcharge
  formulaCell(row.getCell(15), `ROUND(0.25*W${r},2)`, pen.surcharge, round2(0.25 * w.base));

  // P: Compromise penalty
  formulaCell(row.getCell(16), compromiseFormula(`W${r}`), pen.compromisePenalty, pen.compromisePenalty);

  // R: Days
  const dayTerms = [
    ...w.lateParts.map((p) => `${dateExpr(p.paidAt)}-${G}`),
    ...(w.unpaid > 0 ? [`$I$16-${G}`] : []),
  ];
  const daysFormula = dayTerms.length === 1 ? dayTerms[0] : `MAX(${dayTerms.join(',')})`;
  const dayCell = row.getCell(18);
  dayCell.value = { formula: daysFormula, result: pen.daysLate };
  dayCell.numFmt = '0';

  // Q: Interest
  const simple = !hasLate && w.unpaid > 0;
  const interestTerms = [
    ...w.lateParts.map((p) => `${money(p.amount)}*${w.rate}*(${dateExpr(p.paidAt)}-${G})/365`),
    ...(w.unpaid > 0 ? [`${money(w.unpaid)}*${w.rate}*($I$16-${G})/365`] : []),
  ];
  const recomputedInterest = round2(
    w.lateParts.reduce((acc, p) => acc + (p.amount * w.rate * p.days) / 365, 0) + (w.unpaid * w.rate * w.unpaidDays) / 365,
  );
  formulaCell(
    row.getCell(17),
    simple ? `ROUND(W${r}*${w.rate}*R${r}/365,2)` : `ROUND(${interestTerms.join('+')},2)`,
    pen.interest,
    recomputedInterest,
  );
}

// Sheet 2: a duplicate of the same payment ledger, side by side with the
// per-line "should-be" CWT computation, so a reviewer can scan left-to-right
// on one row to see whether that specific payment has exposure. FS 7.2
// Sheet 2 fields (buyer classification, tax tagging, deadline, zonal
// value, FMV, tax base/due, remitted, variance, penalties) are summarized
// in the header block above the table.
function buildDuplicateSheet(wb: ExcelJS.Workbook, input: LedgerExportInput, sheetName = 'Tax Payment Ledger - Duplicate'): void {
  const sheet = wb.addWorksheet(sheetName);
  sheet.columns = [
    { width: 12 }, { width: 22 }, { width: 12 }, { width: 14 }, { width: 16 }, { width: 12 },
    { width: 14 }, { width: 14 }, { width: 16 }, { width: 16 }, { width: 14 }, { width: 14 },
    { width: 16 }, { width: 14 },
    { width: 12 }, { width: 14 }, { width: 12 }, { width: 10 }, { width: 14 },
    { width: 14 }, { width: 16 }, { width: 16 }, { width: 18 }, { width: 46 },
  ];

  const headerRowIdx = writeHeaderBlock(sheet, input);
  const e = input.exposure;

  // Per-row penalty sums (from the payment-line table below) — these are the
  // real, actionable amounts even on an overall-COMPLIANT contract, since a
  // specific collection can have been remitted late even though the total
  // eventually caught up. The summary block surfaces these sums directly
  // (rather than the contract-level penalty, which is only ever nonzero when
  // the contract is UNDER_REMITTED) so "Total Amount Due" always reflects
  // real per-row exposure instead of reading 0.00 on a technically-compliant
  // contract.
  const surchargeTotal = round2(e.perPaymentLines.reduce((s, l) => s + (l.penalties?.surcharge ?? 0), 0));
  const compromiseTotal = round2(e.perPaymentLines.reduce((s, l) => s + (l.penalties?.compromisePenalty ?? 0), 0));
  const interestTotal = round2(e.perPaymentLines.reduce((s, l) => s + (l.penalties?.interest ?? 0), 0));
  const totalPenaltiesSum = round2(e.perPaymentLines.reduce((s, l) => s + (l.penalties?.totalPenalties ?? 0), 0));
  const totalDueSum = round2(e.perPaymentLines.reduce((s, l) => s + (l.totalDue ?? 0), 0));

  // Left-hand label/value block — contract-level facts only. The
  // unit/parking/storage sqm, zonal value, and FMV breakdown moved to the
  // pivot table on the right (see below) so this column isn't repeating the
  // same figures twice.
  // Row positions of the payment table below — the summary formulas point at its
  // total row, so they are fixed before anything is written.
  const tableHeaderRowIdx = Math.max(headerRowIdx, 15 + 2);
  const firstDataRow = tableHeaderRowIdx + 1;
  const lastDataRow = tableHeaderRowIdx + e.perPaymentLines.length;
  const totalRowIdx = lastDataRow + 2;

  const summaryRows: [string, string | number | null][] = [
    ['Buyer Classification', input.buyerClassification],
    ['Tax Tagging', input.taxTagging],
    ['CTS Notary Date', input.ctsNotaryDate ? formatMDY(input.ctsNotaryDate) : 'Not on file'],
    ['RDO', input.rdo ?? 'No mapping for this tower — check bir.gov.ph/zonal-values'],
    ['Net TCP', input.netTCP],
    ['CWT Tax Base (highest of the above)', e.cwtTaxBase],
    ['CWT Tax Due (Tax Base x 5%)', e.cwtTaxDue],
    ['Actual CWT Remitted (total)', e.actualRemitted],
    ['CWT Variance / Exposure (total)', e.variance],
    ['Status', e.status === 'NON_COMPLIANT' ? 'NOT COMPLIANT (penalties computed)' : e.status],
    ['Surcharge', surchargeTotal],
    ['Compromise Penalty', compromiseTotal],
    ['Interest', interestTotal],
    ['Total Penalties', totalPenaltiesSum],
    ['Total Amount Due (linked to Total Penalties computed below)', totalDueSum],
  ];

  let r = 1;
  const summaryCol = 8; // start summary block to the right (col H) so it doesn't collide with the UNIT/BUYER/CONTRACT block on the left
  summaryRows.forEach(([label, value]) => {
    const row = sheet.getRow(r++);
    row.getCell(summaryCol).value = label;
    bold(row.getCell(summaryCol));
    row.getCell(summaryCol + 1).value = value ?? '';
    if (typeof value === 'number') row.getCell(summaryCol + 1).numFmt = CURRENCY_FMT;
  });

  // The figures below show their working as Excel formulas instead of bare
  // amounts (cell references: I = this summary column, B12 = Net TCP, O = the
  // pivot's Total column, row `totalRowIdx` = the table's TOTAL row).
  const I = (n: number) => sheet.getCell(n, summaryCol + 1);
  const hasBase = e.cwtTaxBase !== null && e.cwtTaxDue !== null;
  if (input.netTCP !== null) formulaCell(I(5), 'B12', input.netTCP, input.netTCP);
  if (hasBase) {
    // Highest of Net TCP / Zonal Value / FMV (pivot totals O4:O6).
    formulaCell(I(6), 'MAX(O4:O6)', e.cwtTaxBase, e.cwtTaxBase!);
    formulaCell(I(7), 'ROUND(I6*0.05,2)', e.cwtTaxDue, round2(e.cwtTaxBase! * 0.05));
    formulaCell(I(8), `L${totalRowIdx}`, e.actualRemitted, round2(e.perPaymentLines.reduce((acc, l) => acc + (l.cwtFileTaxDue ?? 0), 0)));
    formulaCell(I(9), 'I7-I8', e.variance, round2(e.cwtTaxDue! - e.actualRemitted));
    I(10).value = {
      formula: 'IF(I9>1,"UNDER_REMITTED",IF(I14>0,"NOT COMPLIANT (penalties computed)","COMPLIANT"))',
      result: e.status === 'NON_COMPLIANT' ? 'NOT COMPLIANT (penalties computed)' : e.status,
    };
  }
  formulaCell(I(11), `O${totalRowIdx}`, surchargeTotal, surchargeTotal);
  formulaCell(I(12), `P${totalRowIdx}`, compromiseTotal, compromiseTotal);
  formulaCell(I(13), `Q${totalRowIdx}`, interestTotal, interestTotal);
  formulaCell(I(14), 'SUM(I11:I13)', totalPenaltiesSum, round2(surchargeTotal + compromiseTotal + interestTotal));
  formulaCell(I(15), `T${totalRowIdx}`, totalDueSum, totalDueSum);

  // The date the penalty days/interest of unpaid amounts run to — the Days and
  // Interest formulas below point at this cell ($I$16).
  const asOf = e.perPaymentLines.find((l) => l.penaltyWorking)?.penaltyWorking?.asOf ?? null;
  if (asOf) {
    sheet.getCell(16, summaryCol).value = 'Penalties computed as of';
    bold(sheet.getCell(16, summaryCol));
    const asOfCell = sheet.getCell(16, summaryCol + 1);
    asOfCell.value = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()));
    asOfCell.numFmt = DATE_FMT;
  }

  // Right-hand pivot table — Unit / Parking / Storage / Total, replacing the
  // old repeated per-classification rows on the left with one compact grid.
  const pivotCol = 11; // column K, leaving column J (10) as a blank spacer
  const pivotHeader = sheet.getRow(1);
  ['', 'Unit', 'Parking', 'Storage', 'Total'].forEach((label, i) => {
    const cell = pivotHeader.getCell(pivotCol + i);
    cell.value = label;
    bold(cell);
  });

  const unitZv = input.zonalValuePerSqmUnit !== null && input.sqmUnit ? input.zonalValuePerSqmUnit * input.sqmUnit : 0;
  const parkingZv =
    input.zonalValuePerSqmParking !== null && input.sqmParking ? input.zonalValuePerSqmParking * input.sqmParking : 0;
  // Storage has no rate of its own — it always shares the unit's rate.
  const storageZv =
    input.zonalValuePerSqmUnit !== null && input.sqmStorage ? input.zonalValuePerSqmUnit * input.sqmStorage : 0;

  const pivotRows: { label: string; unit: number | null; parking: number | null; storage: number | null; total: number | string | null }[] = [
    { label: 'sqm', unit: input.sqmUnit, parking: input.sqmParking, storage: input.sqmStorage, total: null },
    {
      label: 'Zonal Value/sqm',
      unit: input.zonalValuePerSqmUnit,
      parking: input.zonalValuePerSqmParking,
      storage: input.zonalValuePerSqmUnit, // same rate as unit, always
      total: null,
    },
    {
      label: 'Total Zonal Value',
      unit: unitZv || null,
      parking: parkingZv || null,
      storage: storageZv || null,
      total: e.zonalValueBasis,
    },
    { label: 'Total TCP, net of VAT', unit: null, parking: null, storage: null, total: input.netTCP },
    {
      label: 'Total FMV per Tax Declaration',
      unit: input.fmvPerTaxDeclarationUnit,
      parking: input.fmvPerTaxDeclarationParking,
      storage: input.fmvPerTaxDeclarationStorage,
      total: e.fmvPerTaxDeclarationTotal,
    },
  ];

  let pr = 2;
  for (const row of pivotRows) {
    const sheetRow = sheet.getRow(pr++);
    sheetRow.getCell(pivotCol).value = row.label;
    bold(sheetRow.getCell(pivotCol));
    for (const [i, v] of [row.unit, row.parking, row.storage, row.total].entries()) {
      const cell = sheetRow.getCell(pivotCol + 1 + i);
      cell.value = v ?? '';
      if (typeof v === 'number') cell.numFmt = CURRENCY_FMT;
    }
  }
  // The pivot shows its working too (K = labels, L/M/N = Unit/Parking/Storage,
  // O = Total; rows: 2 sqm, 3 rate, 4 zonal value, 5 net TCP, 6 FMV).
  const P = (col: string, n: number) => sheet.getCell(`${col}${n}`);
  if (input.zonalValuePerSqmUnit !== null) formulaCell(P('N', 3), 'L3', input.zonalValuePerSqmUnit, input.zonalValuePerSqmUnit); // storage = unit rate
  if (unitZv) formulaCell(P('L', 4), 'L2*L3', unitZv, round2(unitZv));
  if (parkingZv) formulaCell(P('M', 4), 'M2*M3', parkingZv, round2(parkingZv));
  if (storageZv) formulaCell(P('N', 4), 'N2*N3', storageZv, round2(storageZv));
  if (e.zonalValueBasis !== null) formulaCell(P('O', 4), 'SUM(L4:N4)', e.zonalValueBasis, round2(unitZv + parkingZv + storageZv));
  if (input.netTCP !== null) formulaCell(P('O', 5), 'B12', input.netTCP, input.netTCP);
  if (e.fmvPerTaxDeclarationTotal !== null) {
    const fmvSum = round2((input.fmvPerTaxDeclarationUnit ?? 0) + (input.fmvPerTaxDeclarationParking ?? 0) + (input.fmvPerTaxDeclarationStorage ?? 0));
    formulaCell(P('O', 6), 'SUM(L6:N6)', e.fmvPerTaxDeclarationTotal, fmvSum);
  }
  pr++; // blank spacer row
  const taxBaseRow = sheet.getRow(pr++);
  taxBaseRow.getCell(pivotCol).value = 'Tax Base';
  bold(taxBaseRow.getCell(pivotCol));
  // The basis name (which of Net TCP / Zonal Value / FMV won) sits under the
  // Unit column; the amount itself goes in the Total column, aligned with the
  // other totals above it.
  const sourceLabel = taxBaseSourceLabel(e.taxBaseSource);
  if (e.cwtTaxBase !== null && sourceLabel) {
    // Ties go to Net TCP, then FMV, then Zonal Value — the same order the engine uses.
    taxBaseRow.getCell(pivotCol + 1).value = {
      formula: 'IF(I6=O5,"Net TCP",IF(I6=O6,"FMV per Tax Declaration","Zonal Value"))',
      result: sourceLabel,
    };
  } else {
    taxBaseRow.getCell(pivotCol + 1).value = sourceLabel;
  }
  const taxBaseAmountCell = taxBaseRow.getCell(pivotCol + 4);
  taxBaseAmountCell.value = e.cwtTaxBase ?? '';
  if (typeof e.cwtTaxBase === 'number') formulaCell(taxBaseAmountCell, 'I6', e.cwtTaxBase, e.cwtTaxBase);
  bold(taxBaseAmountCell);

  // Under the pivot: what the tax tagging SHOULD be by our own reading of the
  // ledger (Cash Deferred when the first-payment year's collections pass 25% of
  // the Total Contract Price, otherwise Installment), and the date it was passed.
  const ta = input.taggingAnalysis ?? null;
  const yellow: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
  const tagRowStart = pr + 1; // one blank row under the Tax Base row
  const tagRows: [string, ExcelJS.CellValue][] = [
    [
      'Should-be Tax Tagging',
      ta?.shouldBe ?? 'Cannot be told (no payments or no Total Contract Price)',
    ],
    [
      'Date considered Cash Deferred',
      ta?.shouldBe === 'CASH DEFERRED' && ta.triggerDate
        ? new Date(Date.UTC(ta.triggerDate.getUTCFullYear(), ta.triggerDate.getUTCMonth(), ta.triggerDate.getUTCDate()))
        : 'N/A',
    ],
    // Only meaningful when the should-be tagging is Cash Deferred — otherwise N/A.
    ['25% of Total Contract Price (VAT inclusive)', ta?.shouldBe === 'CASH DEFERRED' ? '' : 'N/A'],
    ['Cash Deferred Actual Collections (VAT inclusive)', ta?.shouldBe === 'CASH DEFERRED' ? '' : 'N/A'],
  ];
  tagRows.forEach(([label, value], i) => {
    const row = sheet.getRow(tagRowStart + i);
    row.getCell(pivotCol).value = label;
    bold(row.getCell(pivotCol));
    const cell = row.getCell(pivotCol + 2);
    cell.value = value;
    bold(cell);
    if (value instanceof Date) cell.numFmt = DATE_FMT;
  });
  if (ta?.shouldBe === 'CASH DEFERRED' && ta.triggerDate && e.perPaymentLines.length > 0) {
    // Everything actually collected (Total Collection, VAT inclusive) on or before
    // the Cash Deferred date — a SUMIF over the table's Payment Date / Total Collection columns.
    const cutoff = ta.triggerDate.getTime();
    const collected = round2(
      e.perPaymentLines.reduce(
        (sum, l) => (l.paymentDate && l.paymentDate.getTime() <= cutoff ? sum + (l.totalCollection ?? 0) : sum),
        0,
      ),
    );
    const dateRef = `${String.fromCharCode(64 + pivotCol + 2)}${tagRowStart + 1}`;
    const cell = sheet.getRow(tagRowStart + 3).getCell(pivotCol + 2);
    cell.value = {
      formula: `SUMIF(A${firstDataRow}:A${lastDataRow},"<="&${dateRef},B${firstDataRow}:B${lastDataRow})`,
      result: collected,
    };
    cell.numFmt = CURRENCY_FMT;
    bold(cell);
  }
  if (ta?.shouldBe === 'CASH DEFERRED' && ta.threshold != null && input.totalTCP !== null) {
    // 25% x the Total Contract Price (VAT inclusive) shown at B11.
    const cell = sheet.getRow(tagRowStart + 2).getCell(pivotCol + 2);
    cell.value = { formula: 'ROUND(B11*0.25,2)', result: ta.threshold };
    cell.numFmt = CURRENCY_FMT;
    bold(cell);
  }

  // The payment on which the collections passed 25% (the date above) is
  // highlighted in the table below.
  let highlightIdx = -1;
  if (ta?.shouldBe === 'CASH DEFERRED' && ta.triggerDate && ta.threshold !== null && ta.firstYear !== null) {
    let cumulative = 0;
    e.perPaymentLines.forEach((l, i) => {
      if (highlightIdx >= 0 || !l.paymentDate || l.totalCollection === null) return;
      if (l.paymentDate.getUTCFullYear() !== ta.firstYear) return;
      cumulative += l.totalCollection;
      if (cumulative > ta.threshold!) highlightIdx = i;
    });
    const sameDay = (a: Date | null, b: Date) => a !== null && a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
    if (highlightIdx < 0 || !sameDay(e.perPaymentLines[highlightIdx].paymentDate, ta.triggerDate)) {
      highlightIdx = e.perPaymentLines.findIndex((l) => sameDay(l.paymentDate, ta.triggerDate!));
    }
  }

  // The summary block (col H onward) can run longer than the UNIT/BUYER/
  // CONTRACT block (col A-F, fixed by writeHeaderBlock at row 16) — start
  // the table below whichever block is taller, with a blank row between,
  // so the table's "Should-Be CWT Due" column (also col H) never collides
  // with summary rows like Surcharge/Compromise Penalty/Total Penalties.
  const headerRow = sheet.getRow(tableHeaderRowIdx);
  headerRow.values = [
    'Payment Date',
    'Total Collection',
    'Clearing Document',
    'OR Number',
    'Payment Principal',
    'Payment VAT',
    'Applicable CWT Deadline',
    'Should-Be CWT Due',
    'CWT File Transaction Date',
    'CWT File Date Paid',
    'CWT File Tax Base',
    'CWT File Tax Due',
    'Remitted in Deadline Month?',
    'Difference (Should-Be less CWT File)',
    'Surcharge',
    'Compromise Penalty',
    'Interest',
    'Days',
    'Total Penalties',
    'Total',
    'CWT File Contract Number',
    'CWT File Base Contract',
    'Penalty Base (Unpaid + Late-Paid)',
  ];
  headerRow.eachCell((c) => {
    bold(c);
    c.border = { bottom: { style: 'thin' } };
  });

  let rowIdx = tableHeaderRowIdx + 1;
  let lineIdx = -1;
  for (const line of e.perPaymentLines) {
    lineIdx++;
    const row = sheet.getRow(rowIdx++);
    row.getCell(1).value = line.paymentDate ?? '';
    if (line.paymentDate) row.getCell(1).numFmt = DATE_FMT;
    row.getCell(2).value = line.totalCollection ?? '';
    row.getCell(2).numFmt = CURRENCY_FMT;
    row.getCell(3).value = line.clearingDocument ?? '';
    row.getCell(4).value = line.orNumber ?? '';
    row.getCell(5).value = line.paymentPrincipal ?? '';
    row.getCell(5).numFmt = CURRENCY_FMT;
    row.getCell(6).value = line.paymentVat ?? '';
    row.getCell(6).numFmt = CURRENCY_FMT;
    // A payment after an AR Sale bulk remittance has no deadline — say why
    // rather than leaving the cell blank.
    row.getCell(7).value = line.coveredByBulkRemittance
      ? 'Covered by AR Sale bulk remittance'
      : (line.applicableDeadline ?? '');
    if (line.applicableDeadline) row.getCell(7).numFmt = DATE_FMT;
    row.getCell(8).value = line.shouldBeCwtDue ?? '';
    if (line.shouldBeCwtDue !== null) row.getCell(8).numFmt = CURRENCY_FMT;

    const txnDates = formatDateList(line.cwtFileTransactionDates);
    row.getCell(9).value = txnDates;
    if (txnDates instanceof Date) row.getCell(9).numFmt = DATE_FMT;
    const paidDates = formatDateList(line.cwtFileDatesPaid);
    row.getCell(10).value = paidDates;
    if (paidDates instanceof Date) row.getCell(10).numFmt = DATE_FMT;
    row.getCell(11).value = line.cwtFileTaxBase ?? '';
    if (line.cwtFileTaxBase !== null) row.getCell(11).numFmt = CURRENCY_FMT;
    row.getCell(12).value = line.cwtFileTaxDue ?? '';
    if (line.cwtFileTaxDue !== null) row.getCell(12).numFmt = CURRENCY_FMT;
    row.getCell(13).value = line.paidInAdvance
      ? 'Paid in advance'
      : line.remittedInDeadlineMonth === null
        ? ''
        : line.remittedInDeadlineMonth
          ? 'Yes'
          : 'No';
    row.getCell(14).value = line.difference ?? '';
    if (line.difference !== null) row.getCell(14).numFmt = CURRENCY_FMT;

    row.getCell(15).value = line.penalties?.surcharge ?? '';
    if (line.penalties) row.getCell(15).numFmt = CURRENCY_FMT;
    row.getCell(16).value = line.penalties?.compromisePenalty ?? '';
    if (line.penalties) row.getCell(16).numFmt = CURRENCY_FMT;
    row.getCell(17).value = line.penalties?.interest ?? '';
    if (line.penalties) row.getCell(17).numFmt = CURRENCY_FMT;
    row.getCell(18).value = line.penalties?.daysLate ?? '';
    if (line.penalties && line.penaltyWorking) writePenaltyFormulas(row, rowIdx - 1, line);
    row.getCell(19).value = line.penalties?.totalPenalties ?? '';
    if (line.penalties) {
      // Surcharge + Compromise + Interest, shown as the formula it is.
      formulaCell(
        row.getCell(19),
        `ROUND(SUM(O${rowIdx - 1}:Q${rowIdx - 1}),2)`,
        line.penalties.totalPenalties,
        round2(line.penalties.surcharge + line.penalties.compromisePenalty + line.penalties.interest),
      );
    }
    row.getCell(20).value = line.totalDue ?? '';
    if (line.totalDue !== null) {
      if (line.difference !== null && line.penalties) {
        // Total = what is still unpaid (Difference) + the penalties on it.
        formulaCell(row.getCell(20), `ROUND(N${rowIdx - 1}+S${rowIdx - 1},2)`, line.totalDue, round2(line.difference + line.penalties.totalPenalties));
      } else {
        row.getCell(20).numFmt = CURRENCY_FMT;
      }
    }
    row.getCell(21).value = line.cwtFileContractNumbers.join(', ');
    row.getCell(22).value = line.cwtFileBaseContracts.join(', ');
    if (lineIdx === highlightIdx) {
      for (let c = 1; c <= 23; c++) row.getCell(c).fill = yellow;
      row.getCell(24).value = '◄ collections passed 25% of the Total Contract Price here — Cash Deferred from this date';
      row.getCell(24).font = { bold: true };
    }
  }

  // Reconciliation footer — confirms the table's CWT File Tax Due column
  // ties out exactly to the CWT file's total remitted for this contract.
  const totalRow = sheet.getRow(rowIdx + 1);
  totalRow.getCell(7).value = 'TOTAL';
  const col = (n: number) => String.fromCharCode(64 + n);
  const sumCell = (n: number, value: number) => {
    const cell = totalRow.getCell(n);
    if (e.perPaymentLines.length > 0) {
      cell.value = { formula: `SUM(${col(n)}${firstDataRow}:${col(n)}${lastDataRow})`, result: value };
    } else {
      cell.value = value;
    }
    cell.numFmt = CURRENCY_FMT;
  };
  sumCell(8, e.perPaymentLines.reduce((s, l) => s + (l.shouldBeCwtDue ?? 0), 0));
  sumCell(12, e.perPaymentLines.reduce((s, l) => s + (l.cwtFileTaxDue ?? 0), 0));
  sumCell(14, e.perPaymentLines.reduce((s, l) => s + (l.difference ?? 0), 0));
  // Penalty totals — the summary block above points at these cells.
  sumCell(15, surchargeTotal);
  sumCell(16, compromiseTotal);
  sumCell(17, interestTotal);
  sumCell(19, totalPenaltiesSum);
  sumCell(20, totalDueSum);
  totalRow.eachCell((c) => bold(c));

  const tieOutRow = sheet.getRow(rowIdx + 2);
  tieOutRow.getCell(9).value = 'Ties to CWT file total remitted:';
  tieOutRow.getCell(11).value = e.actualRemitted;
  tieOutRow.getCell(11).numFmt = CURRENCY_FMT;
}

export async function generateLedgerExcel(input: LedgerExportInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Pre-ONETT';
  wb.created = new Date();
  // Recalculate every formula when the file is opened, so the cached values never matter.
  wb.calcProperties.fullCalcOnLoad = true;
  buildLedgerSheet(wb, input);
  buildDuplicateSheet(wb, input);
  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

// ---------------------------------------------------------------------------
// One workbook for a whole batch: an Index sheet followed by every contract's
// "Tax Payment Ledger - Duplicate" sheet (named by contract number), instead of
// one Excel file per contract. The Index pulls each contract's figures from its
// own sheet with formulas (e.g. ='2000000008098'!I14), so it always agrees.
// ---------------------------------------------------------------------------

export interface BatchDuplicateEntry {
  input: LedgerExportInput;
  analysisLabel: string;
}

const STATUS_TEXT: Record<string, string> = {
  COMPLIANT: 'Compliant',
  UNDER_REMITTED: 'Under-remitted',
  NON_COMPLIANT: 'Not compliant',
  MISSING_DATA: 'Missing data',
};

export async function generateBatchDuplicatesExcel(
  entries: BatchDuplicateEntry[],
  meta: { title: string; generatedAt?: Date },
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Pre-ONETT';
  const generatedAt = meta.generatedAt ?? new Date();
  wb.created = generatedAt;
  wb.calcProperties.fullCalcOnLoad = true;

  const index = wb.addWorksheet('Index', { views: [{ state: 'frozen', ySplit: 4 }] });
  index.columns = [
    { width: 18 }, { width: 34 }, { width: 18 }, { width: 22 }, { width: 12 }, { width: 16 },
    { width: 16 }, { width: 18 }, { width: 16 }, { width: 16 }, { width: 18 },
  ];
  index.addRow([`Tax Payment Ledgers — ${meta.title}`]).font = { bold: true, size: 14 };
  index.addRow([`Generated ${generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC · ${entries.length} contract(s) — one sheet each (click a contract number)`]);
  index.addRow([]);
  const head = index.addRow([
    'Contract No.', "Buyer's Name", 'Tower', 'Unit', 'Analysis', 'CWT Status',
    'CWT Tax Due', 'Actual CWT Remitted', 'Variance', 'Total Penalties', 'Total Amount Due',
  ]);
  head.font = { bold: true };
  head.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7ECF5' } };
    c.border = { bottom: { style: 'thin' } };
  });

  const totalsStart = index.rowCount + 1;
  for (const { input, analysisLabel } of entries) {
    const name = input.contractNumber.slice(0, 31);
    buildDuplicateSheet(wb, input, name);
    const e = input.exposure;
    const row = index.addRow([
      { text: input.contractNumber, hyperlink: `#'${name}'!A1` },
      input.buyerName ?? '',
      input.tower ?? '',
      input.unit ?? '',
      analysisLabel,
      STATUS_TEXT[e.status] ?? e.status,
    ]);
    row.getCell(1).font = { color: { argb: 'FF0B5ED7' }, underline: true };
    const hasBase = e.cwtTaxBase !== null && e.cwtTaxDue !== null;
    if (hasBase) {
      const surcharge = round2(e.perPaymentLines.reduce((s, l) => s + (l.penalties?.surcharge ?? 0), 0));
      const compromise = round2(e.perPaymentLines.reduce((s, l) => s + (l.penalties?.compromisePenalty ?? 0), 0));
      const interest = round2(e.perPaymentLines.reduce((s, l) => s + (l.penalties?.interest ?? 0), 0));
      const penalties = round2(surcharge + compromise + interest);
      const totalDue = round2(e.perPaymentLines.reduce((s, l) => s + (l.totalDue ?? 0), 0));
      const cells: [number, string, number | null][] = [
        [7, 'I7', e.cwtTaxDue],
        [8, 'I8', e.actualRemitted],
        [9, 'I9', e.variance],
        [10, 'I14', penalties],
        [11, 'I15', totalDue],
      ];
      for (const [col, ref, value] of cells) {
        const cell = row.getCell(col);
        cell.value = { formula: `'${name}'!${ref}`, result: value ?? 0 };
        cell.numFmt = CURRENCY_FMT;
      }
    }
  }
  if (entries.length > 0) {
    const first = totalsStart;
    const last = index.rowCount;
    const total = index.addRow(['TOTAL']);
    total.font = { bold: true };
    for (const col of [7, 8, 9, 10, 11]) {
      const letter = String.fromCharCode(64 + col);
      let sum = 0;
      for (let r = first; r <= last; r++) {
        const v = index.getCell(r, col).value as { result?: number } | null;
        if (v && typeof v === 'object' && typeof v.result === 'number') sum += v.result;
      }
      const cell = total.getCell(col);
      cell.value = { formula: `SUM(${letter}${first}:${letter}${last})`, result: round2(sum) };
      cell.numFmt = CURRENCY_FMT;
    }
  }
  index.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 11 } };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
