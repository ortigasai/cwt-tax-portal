import ExcelJS from 'exceljs';
import { ExposureResult, round2, formatMDY } from '../services/computation';

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
  paymentRecords: LedgerExportPaymentRow[];
  exposure: ExposureResult;
}

const CURRENCY_FMT = '#,##0.00';
const DATE_FMT = 'mm/dd/yyyy';
const COMPANY_NAME = 'ORTIGAS & COMPANY LIMITED PARTNERSHIP';

function bold(cell: ExcelJS.Cell): void {
  cell.font = { bold: true };
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

// Sheet 2: a duplicate of the same payment ledger, side by side with the
// per-line "should-be" CWT computation, so a reviewer can scan left-to-right
// on one row to see whether that specific payment has exposure. FS 7.2
// Sheet 2 fields (buyer classification, tax tagging, deadline, zonal
// value, FMV, tax base/due, remitted, variance, penalties) are summarized
// in the header block above the table.
function buildDuplicateSheet(wb: ExcelJS.Workbook, input: LedgerExportInput): void {
  const sheet = wb.addWorksheet('Tax Payment Ledger - Duplicate');
  sheet.columns = [
    { width: 12 }, { width: 22 }, { width: 12 }, { width: 14 }, { width: 16 }, { width: 12 },
    { width: 14 }, { width: 14 }, { width: 16 }, { width: 16 }, { width: 14 }, { width: 14 },
    { width: 16 }, { width: 14 },
    { width: 12 }, { width: 14 }, { width: 12 }, { width: 10 }, { width: 14 },
    { width: 14 }, { width: 16 }, { width: 16 },
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
    ['Status', e.status],
    ['Deadline Rule Applied', e.deadline.note],
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
  pr++; // blank spacer row
  const taxBaseRow = sheet.getRow(pr++);
  taxBaseRow.getCell(pivotCol).value = 'Tax Base';
  bold(taxBaseRow.getCell(pivotCol));
  taxBaseRow.getCell(pivotCol + 4).value = taxBaseSourceLabel(e.taxBaseSource);

  // The summary block (col H onward) can run longer than the UNIT/BUYER/
  // CONTRACT block (col A-F, fixed by writeHeaderBlock at row 16) — start
  // the table below whichever block is taller, with a blank row between,
  // so the table's "Should-Be CWT Due" column (also col H) never collides
  // with summary rows like Surcharge/Compromise Penalty/Total Penalties.
  const tableHeaderRowIdx = Math.max(headerRowIdx, summaryRows.length + 2);
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
  ];
  headerRow.eachCell((c) => {
    bold(c);
    c.border = { bottom: { style: 'thin' } };
  });

  let rowIdx = tableHeaderRowIdx + 1;
  for (const line of e.perPaymentLines) {
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
    row.getCell(7).value = line.applicableDeadline ?? '';
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
    row.getCell(13).value = line.remittedInDeadlineMonth === null ? '' : line.remittedInDeadlineMonth ? 'Yes' : 'No';
    row.getCell(14).value = line.difference ?? '';
    if (line.difference !== null) row.getCell(14).numFmt = CURRENCY_FMT;

    row.getCell(15).value = line.penalties?.surcharge ?? '';
    if (line.penalties) row.getCell(15).numFmt = CURRENCY_FMT;
    row.getCell(16).value = line.penalties?.compromisePenalty ?? '';
    if (line.penalties) row.getCell(16).numFmt = CURRENCY_FMT;
    row.getCell(17).value = line.penalties?.interest ?? '';
    if (line.penalties) row.getCell(17).numFmt = CURRENCY_FMT;
    row.getCell(18).value = line.penalties?.daysLate ?? '';
    row.getCell(19).value = line.penalties?.totalPenalties ?? '';
    if (line.penalties) row.getCell(19).numFmt = CURRENCY_FMT;
    row.getCell(20).value = line.totalDue ?? '';
    if (line.totalDue !== null) row.getCell(20).numFmt = CURRENCY_FMT;
    row.getCell(21).value = line.cwtFileContractNumbers.join(', ');
    row.getCell(22).value = line.cwtFileBaseContracts.join(', ');
  }

  // Reconciliation footer — confirms the table's CWT File Tax Due column
  // ties out exactly to the CWT file's total remitted for this contract.
  const totalRow = sheet.getRow(rowIdx + 1);
  totalRow.getCell(7).value = 'TOTAL';
  const shouldBeDueTotal = e.perPaymentLines.reduce((s, l) => s + (l.shouldBeCwtDue ?? 0), 0);
  totalRow.getCell(8).value = shouldBeDueTotal;
  totalRow.getCell(8).numFmt = CURRENCY_FMT;
  const cwtFileTaxDueTotal = e.perPaymentLines.reduce((s, l) => s + (l.cwtFileTaxDue ?? 0), 0);
  totalRow.getCell(12).value = cwtFileTaxDueTotal;
  totalRow.getCell(12).numFmt = CURRENCY_FMT;
  const differenceTotal = e.perPaymentLines.reduce((s, l) => s + (l.difference ?? 0), 0);
  totalRow.getCell(14).value = differenceTotal;
  totalRow.getCell(14).numFmt = CURRENCY_FMT;
  // surchargeTotal / compromiseTotal / interestTotal / totalPenaltiesSum /
  // totalDueSum were already computed above — reused here so the summary
  // block's figures are always identical to this row's, by construction.
  totalRow.getCell(15).value = surchargeTotal;
  totalRow.getCell(15).numFmt = CURRENCY_FMT;
  totalRow.getCell(16).value = compromiseTotal;
  totalRow.getCell(16).numFmt = CURRENCY_FMT;
  totalRow.getCell(17).value = interestTotal;
  totalRow.getCell(17).numFmt = CURRENCY_FMT;
  totalRow.getCell(19).value = totalPenaltiesSum;
  totalRow.getCell(19).numFmt = CURRENCY_FMT;
  totalRow.getCell(20).value = totalDueSum;
  totalRow.getCell(20).numFmt = CURRENCY_FMT;
  totalRow.eachCell((c) => bold(c));

  const tieOutRow = sheet.getRow(rowIdx + 2);
  tieOutRow.getCell(9).value = 'Ties to CWT file total remitted:';
  tieOutRow.getCell(11).value = e.actualRemitted;
  tieOutRow.getCell(11).numFmt = CURRENCY_FMT;
}

export async function generateLedgerExcel(input: LedgerExportInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CWT Tax Exposure Portal';
  wb.created = new Date();
  buildLedgerSheet(wb, input);
  buildDuplicateSheet(wb, input);
  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
