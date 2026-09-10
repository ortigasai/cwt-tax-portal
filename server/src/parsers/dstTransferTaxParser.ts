import ExcelJS from 'exceljs';
import { cellText, normalizeContractNumber, parseDate, parseNumber } from './parseUtils';

// The DST & Transfer Tax Review template — see dstTransferTaxTemplate.ts for
// the blank download. Column order matches what the tax reviewer fills in;
// lookup is by header name (case-insensitive) so column reordering in the
// uploaded file doesn't break parsing.
export interface DstTransferTaxInputRow {
  contractNumber: string;
  tower: string | null;
  unitStorageArea: number | null;
  parkingArea: number | null;
  ctsNotaryDate: Date | null;
  tcpNetOfVat: number | null;
  fmvPerTaxDeclaration: number | null;
}

export async function parseDstTransferTaxUpload(buffer: Buffer): Promise<DstTransferTaxInputRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const headerRow = sheet.getRow(1);
  const columnIndex: Record<string, number> = {};
  for (let c = 1; c <= headerRow.cellCount; c++) {
    const label = cellText(headerRow.getCell(c).value)?.toLowerCase();
    if (label) columnIndex[label] = c;
  }

  const get = (row: ExcelJS.Row, label: string) => (columnIndex[label] ? row.getCell(columnIndex[label]).value : undefined);

  const rows: DstTransferTaxInputRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const contractNumber = normalizeContractNumber(get(row, 'contract number'));
    if (!contractNumber) continue;
    rows.push({
      contractNumber,
      tower: cellText(get(row, 'tower')),
      unitStorageArea: parseNumber(get(row, 'unit/storage area')),
      parkingArea: parseNumber(get(row, 'parking area')),
      ctsNotaryDate: parseDate(get(row, 'cts notary date')),
      tcpNetOfVat: parseNumber(get(row, 'tcp, net of vat')),
      fmvPerTaxDeclaration: parseNumber(get(row, 'fmv per tax declaration')),
    });
  }
  return rows;
}
