import ExcelJS from 'exceljs';
import { cellText, normalizeContractNumber, parseDate } from './parseUtils';

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

export interface EtbListRow {
  contractNumber: string;
  /** The row's own ETB start date, or null when the cell was empty. */
  startDate: Date | null;
  /** What was in the date cell when it could not be read as a date. */
  badDate: string | null;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// "Oct 5, 2026", "5 Oct 2026", "5-Oct-26" as well as the numeric forms parseDate reads.
function parseStartDateCell(value: unknown): { date: Date | null; bad: string | null } {
  const raw = cellText(value);
  if (raw === null) return { date: null, bad: null };
  const direct = parseDate(value);
  if (direct) {
    // A Date from Excel is a UTC-midnight calendar date; keep just Y-M-D.
    return { date: new Date(Date.UTC(direct.getUTCFullYear(), direct.getUTCMonth(), direct.getUTCDate())), bad: null };
  }
  const t = raw.replace(/\s+/g, ' ').trim();
  let m = /^(\d{1,2})[-\s]([A-Za-z]{3,9})\.?[-\s,]*(\d{2,4})$/.exec(t);
  let day: number | undefined;
  let mon: number | undefined;
  let year: number | undefined;
  if (m) {
    day = Number(m[1]);
    mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
    year = Number(m[3]);
  } else if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{2,4})$/.exec(t))) {
    mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
    day = Number(m[2]);
    year = Number(m[3]);
  }
  if (day !== undefined && mon !== undefined && year !== undefined) {
    if (year < 100) year += 2000;
    const d = new Date(Date.UTC(year, mon, day));
    if (d.getUTCFullYear() === year && d.getUTCMonth() === mon && d.getUTCDate() === day) return { date: d, bad: null };
  }
  return { date: null, bad: raw };
}

// An Excel file with a "Contract Number" column and a "Start Date of ETB" column
// (any header containing "start" or "etb" — falling back to the cell after the
// contract column). Rows may leave the date empty (the run's default applies).
// A contract listed twice keeps its first row.
export async function parseEtbList(buffer: Buffer): Promise<{ rows: EtbListRow[]; hasDateColumn: boolean }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { rows: [], hasDateColumn: false };

  let headerRow = 0;
  let contractCol = 1;
  let dateCol = 0;
  outer: for (let r = 1; r <= Math.min(sheet.rowCount, 10); r++) {
    const row = sheet.getRow(r);
    for (let c = 1; c <= Math.max(row.cellCount, 2); c++) {
      const v = row.getCell(c).value;
      if (typeof v === 'string' && /contract/i.test(v)) {
        headerRow = r;
        contractCol = c;
        for (let d = 1; d <= Math.max(row.cellCount, 2); d++) {
          const h = row.getCell(d).value;
          if (d !== c && typeof h === 'string' && /start|etb|date/i.test(h)) {
            dateCol = d;
            break;
          }
        }
        break outer;
      }
    }
  }
  if (headerRow > 0 && dateCol === 0) dateCol = contractCol + 1;
  if (headerRow === 0) dateCol = 2;

  const rows: EtbListRow[] = [];
  const seen = new Set<string>();
  for (let r = headerRow > 0 ? headerRow + 1 : 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const contractNumber = normalizeContractNumber(row.getCell(contractCol).value);
    if (!contractNumber || seen.has(contractNumber)) continue;
    seen.add(contractNumber);
    const { date, bad } = parseStartDateCell(row.getCell(dateCol).value);
    rows.push({ contractNumber, startDate: date, badDate: bad });
  }
  return { rows, hasDateColumn: dateCol > 0 };
}
