// Parses a plain calendar date ("YYYY-MM-DD") from a query/body value into a
// Date at midnight UTC — the same convention the rest of the app stores dates
// in. Returns null for anything missing or not a real date.
export function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  // Reject rollovers like 2026-02-31.
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
    ? d
    : null;
}
