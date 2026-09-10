import ExcelJS from 'exceljs';
import { cellText, parseNumber } from './parseUtils';

export interface RptTowerRow {
  tower: string;
  type: string | null;
  floor: string | null;
  unit: string;
  cct: string | null;
  taxDeclarationNumber: string | null;
  fairMarketValue: number;
  estate: string | null;
}

// Expects the "ALL" sheet of RPT_ALL TOWERS.xlsx with header:
// Tower | Type | Floor | Unit | Condominium Certificate of Title |
// Tax Declaration Number (New) | Fair Market Value | Estate
export async function parseRptTowers(buffer: Buffer): Promise<RptTowerRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.getWorksheet('ALL') ?? workbook.worksheets[0];
  if (!sheet) return [];

  const headerRow = sheet.getRow(1);
  const columnIndex: Record<string, number> = {};
  for (let c = 1; c <= headerRow.cellCount; c++) {
    const label = cellText(headerRow.getCell(c).value)?.toLowerCase();
    if (label) columnIndex[label] = c;
  }

  const get = (row: ExcelJS.Row, label: string) => (columnIndex[label] ? row.getCell(columnIndex[label]).value : undefined);

  const rows: RptTowerRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const tower = cellText(get(row, 'tower'));
    const unit = cellText(get(row, 'unit'));
    const fmv = parseNumber(get(row, 'fair market value'));
    if (!tower || !unit || fmv === null) continue;
    rows.push({
      tower,
      unit,
      type: cellText(get(row, 'type')),
      floor: cellText(get(row, 'floor')),
      cct: cellText(get(row, 'condominium certificate of title')),
      taxDeclarationNumber: cellText(get(row, 'tax declaration number (new)')),
      fairMarketValue: fmv,
      estate: cellText(get(row, 'estate')),
    });
  }
  return rows;
}
