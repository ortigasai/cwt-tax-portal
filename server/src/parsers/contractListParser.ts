import ExcelJS from 'exceljs';
import { normalizeContractNumber } from './parseUtils';

// Accepts a simple Excel file with a column of contract numbers. Looks for a
// header cell containing "contract" (case-insensitive); falls back to
// column A if no such header is found.
export async function parseContractList(buffer: Buffer): Promise<string[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  let headerRow = 0;
  let column = 1;
  outer: for (let r = 1; r <= Math.min(sheet.rowCount, 10); r++) {
    const row = sheet.getRow(r);
    for (let c = 1; c <= row.cellCount; c++) {
      const value = row.getCell(c).value;
      if (typeof value === 'string' && /contract/i.test(value)) {
        headerRow = r;
        column = c;
        break outer;
      }
    }
  }

  const startRow = headerRow > 0 ? headerRow + 1 : 1;
  const contractNumbers: string[] = [];
  const seen = new Set<string>();
  for (let r = startRow; r <= sheet.rowCount; r++) {
    const value = sheet.getRow(r).getCell(column).value;
    const normalized = normalizeContractNumber(value);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      contractNumbers.push(normalized);
    }
  }
  return contractNumbers;
}
