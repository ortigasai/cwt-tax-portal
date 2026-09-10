import ExcelJS from 'exceljs';
import { DstTransferTaxComputedRow } from '../services/dstTransferTaxCompute';

const CURRENCY_FMT = '#,##0.00';
const DATE_FMT = 'mm/dd/yyyy';

// Column order the reviewer fills in — see dstTransferTaxParser.ts, which
// matches these header names case-insensitively so reordering is safe.
const TEMPLATE_HEADERS = [
  'Contract Number',
  'Tower',
  'Unit/Storage Area',
  'Parking Area',
  'CTS Notary Date',
  'TCP, net of VAT',
  'FMV per Tax Declaration',
];

export async function generateDstTransferTaxTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CWT Tax Exposure Portal';
  wb.created = new Date();
  const sheet = wb.addWorksheet('DST & Transfer Tax');
  sheet.columns = TEMPLATE_HEADERS.map((h) => ({ header: h, width: Math.max(18, h.length + 2) }));
  sheet.getRow(1).eachCell((c) => {
    c.font = { bold: true };
    c.border = { bottom: { style: 'thin' } };
  });
  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

// Traced (RDO, Tagging) and two full computed sets appended after the 7
// uploaded columns: one "as of CTS Notary Date" (the rate window that
// actually applied when the Contract to Sell was notarized) and one "as of
// DOAS" (Deed of Absolute Sale — always the current/latest rate, see
// dstTransferTaxCompute.ts). All Total ZV columns carry real Excel formulas
// referencing that row's own cells, not just the pre-computed numbers, per
// the reviewer's request to see the computation the way an Excel workbook
// normally shows it.
const OUTPUT_HEADERS = [
  ...TEMPLATE_HEADERS,
  'RDO',
  'Tagging',
  'Unit/Storage ZV/sqm',
  'Parking ZV/sqm',
  'Total ZV Unit/Storage',
  'Total ZV Parking',
  'Total ZV at the time of CTS',
  'Zonal Match Notes (CTS)',
  'Unit/Storage ZV/sqm',
  'Parking ZV/sqm',
  'Total ZV Unit/Storage',
  'Total ZV Parking',
  'Total ZV at the time of DOAS',
  'Zonal Match Notes (DOAS)',
  'DST Tax Base',
  'DST Due',
  'Transfer Tax',
];

// Each zonal-value set's 5 rate/total columns are grouped under one merged
// header band, the same way a reviewer would group these by hand — the
// per-column names repeat under both bands (disambiguated by the band
// itself), matching how the reviewer described the two sets.
const CTS_GROUP_LABEL = 'Zonal Value at the time of CTS';
const CTS_GROUP_FIRST_COL = 10; // J: Unit/Storage ZV/sqm
const CTS_GROUP_LAST_COL = 14; // N: Total ZV at the time of CTS

const DOAS_GROUP_LABEL = 'Zonal Value at the time of DOAS';
const DOAS_GROUP_FIRST_COL = 16; // P: Unit/Storage ZV/sqm
const DOAS_GROUP_LAST_COL = 20; // T: Total ZV at the time of DOAS

function writeGroupBand(sheet: ExcelJS.Worksheet, label: string, firstCol: number, lastCol: number): void {
  sheet.mergeCells(1, firstCol, 1, lastCol);
  const cell = sheet.getCell(1, firstCol);
  cell.value = label;
  cell.font = { bold: true };
  cell.alignment = { horizontal: 'center' };
  for (let c = firstCol; c <= lastCol; c++) {
    sheet.getCell(1, c).border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  }
}

export async function generateDstTransferTaxComputation(rows: DstTransferTaxComputedRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CWT Tax Exposure Portal';
  wb.created = new Date();
  const sheet = wb.addWorksheet('DST & Transfer Tax');
  sheet.columns = OUTPUT_HEADERS.map((h) => ({ width: Math.max(16, h.length + 2) }));

  // Row 1: merged group-header bands over each zonal value set.
  writeGroupBand(sheet, CTS_GROUP_LABEL, CTS_GROUP_FIRST_COL, CTS_GROUP_LAST_COL);
  writeGroupBand(sheet, DOAS_GROUP_LABEL, DOAS_GROUP_FIRST_COL, DOAS_GROUP_LAST_COL);

  // Row 2: the actual column headers.
  const headerRow = sheet.getRow(2);
  headerRow.values = OUTPUT_HEADERS;
  headerRow.eachCell((c) => {
    c.font = { bold: true };
    c.border = { bottom: { style: 'thin' } };
  });

  rows.forEach((r, i) => {
    const excelRow = i + 3; // group-header bands are row 1, column headers are row 2
    const row = sheet.getRow(excelRow);
    // Numeric columns involved in the Total ZV formulas must be left truly
    // blank (null) rather than '' when missing — ExcelJS writes '' as a
    // text value, and Excel's arithmetic on a text cell throws #VALUE! on
    // recalculation (a genuinely blank cell, by contrast, is treated as 0),
    // which is what forced every Total ZV formula to error out for rows
    // missing an area. Same treatment for F/G for consistency, even though
    // they aren't part of a formula here.
    row.getCell(1).value = r.contractNumber;
    row.getCell(2).value = r.tower ?? '';
    row.getCell(3).value = r.unitStorageArea ?? null;
    row.getCell(4).value = r.parkingArea ?? null;
    row.getCell(5).value = r.ctsNotaryDate ?? '';
    if (r.ctsNotaryDate) row.getCell(5).numFmt = DATE_FMT;
    row.getCell(6).value = r.tcpNetOfVat ?? null;
    if (r.tcpNetOfVat !== null) row.getCell(6).numFmt = CURRENCY_FMT;
    row.getCell(7).value = r.fmvPerTaxDeclaration ?? null;
    if (r.fmvPerTaxDeclaration !== null) row.getCell(7).numFmt = CURRENCY_FMT;

    row.getCell(8).value = r.rdo ?? '';
    row.getCell(9).value = r.tagging ?? '';

    // --- Zonal Value at the time of CTS (J–N), notes in O ---
    row.getCell(10).value = r.unitZvPerSqm ?? null;
    if (r.unitZvPerSqm !== null) row.getCell(10).numFmt = CURRENCY_FMT;
    row.getCell(11).value = r.parkingZvPerSqm ?? null;
    if (r.parkingZvPerSqm !== null) row.getCell(11).numFmt = CURRENCY_FMT;
    // Total ZV Unit/Storage = Unit/Storage Area (C) x Unit/Storage ZV/sqm (J)
    row.getCell(12).value = { formula: `C${excelRow}*J${excelRow}`, result: r.totalZvUnitStorage ?? 0 };
    row.getCell(12).numFmt = CURRENCY_FMT;
    // Total ZV Parking = Parking Area (D) x Parking ZV/sqm (K)
    row.getCell(13).value = { formula: `D${excelRow}*K${excelRow}`, result: r.totalZvParking ?? 0 };
    row.getCell(13).numFmt = CURRENCY_FMT;
    // Total ZV at the time of CTS = Total ZV Unit/Storage (L) + Total ZV Parking (M)
    row.getCell(14).value = { formula: `L${excelRow}+M${excelRow}`, result: r.totalZv ?? 0 };
    row.getCell(14).numFmt = CURRENCY_FMT;
    row.getCell(15).value = r.zonalMatchNotes ?? '';

    // --- Zonal Value at the time of DOAS (P–T), notes in U ---
    row.getCell(16).value = r.doasUnitZvPerSqm ?? null;
    if (r.doasUnitZvPerSqm !== null) row.getCell(16).numFmt = CURRENCY_FMT;
    row.getCell(17).value = r.doasParkingZvPerSqm ?? null;
    if (r.doasParkingZvPerSqm !== null) row.getCell(17).numFmt = CURRENCY_FMT;
    // Total ZV Unit/Storage = Unit/Storage Area (C) x Unit/Storage ZV/sqm (P)
    row.getCell(18).value = { formula: `C${excelRow}*P${excelRow}`, result: r.doasTotalZvUnitStorage ?? 0 };
    row.getCell(18).numFmt = CURRENCY_FMT;
    // Total ZV Parking = Parking Area (D) x Parking ZV/sqm (Q)
    row.getCell(19).value = { formula: `D${excelRow}*Q${excelRow}`, result: r.doasTotalZvParking ?? 0 };
    row.getCell(19).numFmt = CURRENCY_FMT;
    // Total ZV at the time of DOAS = Total ZV Unit/Storage (R) + Total ZV Parking (S)
    row.getCell(20).value = { formula: `R${excelRow}+S${excelRow}`, result: r.doasTotalZv ?? 0 };
    row.getCell(20).numFmt = CURRENCY_FMT;
    row.getCell(21).value = r.doasZonalMatchNotes ?? '';

    // --- DST Tax Base / DST Due / Transfer Tax (V–X) ---
    // DST Tax Base = highest of TCP net of VAT (F), FMV per Tax Declaration
    // (G), and Total ZV at the time of CTS (N), rounded UP to the nearest
    // thousand. MAX ignores blank cells (rather than treating them as 0),
    // same as computeDstTransferTaxRow's JS-side maxOf().
    row.getCell(22).value = {
      formula: `CEILING(MAX(F${excelRow},G${excelRow},N${excelRow}),1000)`,
      result: r.dstTaxBase ?? 0,
    };
    row.getCell(22).numFmt = CURRENCY_FMT;
    // DST Due = DST Tax Base (V) x 1.5%
    row.getCell(23).value = { formula: `V${excelRow}*1.5%`, result: r.dstDue ?? 0 };
    row.getCell(23).numFmt = CURRENCY_FMT;
    // Transfer Tax depends on the tower's RDO (H): RDO 40 = (highest of F,
    // G, Total ZV at the time of DOAS (T) x 0.75%) + 100; RDO 43 = same
    // basis x 0.75% with no +100; RDO 42 = TCP net of VAT (F) x 0.60%; any
    // other RDO has no defined rule, left blank rather than guessed.
    row.getCell(24).value = {
      formula:
        `IF(ISNUMBER(SEARCH("RDO 40",H${excelRow})),(MAX(F${excelRow},G${excelRow},T${excelRow})*0.75%)+100,` +
        `IF(ISNUMBER(SEARCH("RDO 43",H${excelRow})),MAX(F${excelRow},G${excelRow},T${excelRow})*0.75%,` +
        `IF(ISNUMBER(SEARCH("RDO 42",H${excelRow})),F${excelRow}*0.6%,"")))`,
      result: r.transferTax ?? undefined,
    };
    if (r.transferTax !== null) row.getCell(24).numFmt = CURRENCY_FMT;
  });

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
