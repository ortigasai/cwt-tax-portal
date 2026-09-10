// ExcelJS's streaming reader (used for large files) returns formula cells
// as `{ formula, result }` rather than the computed value directly, and
// returns date-formatted cells as raw serial numbers rather than Date
// objects (no access to cell style info while streaming). Unwrap both here
// so every parse helper can treat cell values uniformly.
function unwrapCellValue(value: unknown): unknown {
  if (value && typeof value === 'object' && 'result' in (value as Record<string, unknown>)) {
    return (value as { result: unknown }).result;
  }
  return value;
}

// Excel's date epoch is 1899-12-30 (the well-known SheetJS/ExcelJS
// convention that also compensates for Excel's 1900 leap-year bug).
function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial)) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
}

export function parseNumber(rawValue: unknown): number | null {
  const value = unwrapCellValue(rawValue);
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[₱,\s]/g, '').trim();
    if (cleaned === '' || cleaned === '-') return null;
    const n = Number.parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function parseDate(rawValue: unknown): Date | null {
  const value = unwrapCellValue(rawValue);
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') return excelSerialToDate(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    // MM/DD/YYYY (with optional time component)
    const mdy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (mdy) {
      const [, m, d, y] = mdy;
      const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
      return Number.isNaN(date.getTime()) ? null : date;
    }
    // ISO-like YYYY-MM-DD
    const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) {
      const [, y, m, d] = iso;
      const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
      return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
  }
  return null;
}

// Contract numbers appear as bare integers, strings, or bracketed strings
// like "[2000000007819]" depending on the source file.
export function normalizeContractNumber(rawValue: unknown): string | null {
  const value = unwrapCellValue(rawValue);
  if (value === null || value === undefined) return null;
  const raw = typeof value === 'number' ? String(value) : String(value);
  const cleaned = raw.replace(/[[\]\s]/g, '').trim();
  return cleaned === '' ? null : cleaned;
}

export function cellText(rawValue: unknown): string | null {
  const value = unwrapCellValue(rawValue);
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}
