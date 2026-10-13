import ExcelJS from 'exceljs';

// The payment ledger source of truth: the DOAS system's "Reviewed & Accepted"
// ledgers (<DOAS_API_URL>/reviewed-ledgers). These are LedgerFit's corrected,
// combined ledgers — old-contract payments already spliced in place of the
// 23-series lump rows — that the Tax team has reviewed and accepted, stored
// server-side and served as ready-made data. Read-only GETs.
//
// Each payment's date is its `effective_date` (the actual SI date where one
// was resolved, otherwise the ledger date), which is exactly what LedgerFit's
// "Export .xlsx — dates per actual SI" file carries.
//
// The ledger is handed to the normal import path as an in-memory workbook in
// LedgerFit's export layout, so parsing, storage and the 14-series check are
// the same as for any ledger file.

const BASE_URL = (process.env.DOAS_API_URL ?? 'http://192.168.16.239:4100').replace(/\/+$/, '');
const TIMEOUT_MS = 60_000;
const LIST_TTL_MS = 2 * 60_000;

// customerLedgerFileName of a contract loaded from here — also how the folder
// sync recognises (and leaves alone) such a contract.
export const REVIEWED_LEDGER_PREFIX = 'Reviewed & Accepted ledger';

interface ReviewedRow {
  payment_date: string | null;
  effective_date: string | null;
  clearing_doc: string | null;
  or_number: string | null;
  payment_principal: number | string | null;
  payment_vat: number | string | null;
  total_collection: number | string | null;
}

interface ReviewedDetail {
  contract_no: string;
  batch_name: string | null;
  session_id: string | null;
  tax_accepted_at: string | null;
  tax_accepted_by: string | null;
  tcp: number | string | null;
  net_tcp: number | string | null;
  header: {
    buyer_name?: string | null;
    estate?: string | null;
    project?: string | null;
    unit?: string | null;
    tcp?: number | null;
    net_tcp?: number | null;
  } | null;
  rows: ReviewedRow[];
}

export interface ReviewedLedger {
  buffer: Buffer;
  fileName: string;
  sessionId: string | null;
  acceptedAt: string | null;
  acceptedBy: string | null;
  rowCount: number;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

let listCache: { at: number; contracts: Set<string> } | null = null;

async function reviewedContracts(): Promise<Set<string>> {
  if (listCache && Date.now() - listCache.at < LIST_TTL_MS) return listCache.contracts;
  const body = await getJson<{ rows: { contract_no: string }[] }>('/api/reviewed-ledgers');
  const contracts = new Set((body.rows ?? []).map((r) => String(r.contract_no)));
  listCache = { at: Date.now(), contracts };
  return contracts;
}

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function isoDay(s: string | null | undefined): Date | null {
  const m = String(s ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}

// null when the contract has no reviewed & accepted ledger (or the service
// can't be reached — callers then fall back to the other sources).
export async function fetchReviewedLedger(contractNumber: string): Promise<ReviewedLedger | null> {
  let has: boolean;
  try {
    has = (await reviewedContracts()).has(contractNumber);
  } catch {
    return null;
  }
  if (!has) return null;

  const d = await getJson<ReviewedDetail>(`/api/reviewed-ledgers/${encodeURIComponent(contractNumber)}`);
  const rows = (d.rows ?? []).filter((r) => isoDay(r.effective_date ?? r.payment_date));
  if (rows.length === 0) return null;

  const h = d.header ?? {};
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Extracted');
  ws.addRow(['Contract No.', contractNumber]);
  ws.addRow(["Buyer's Name", h.buyer_name ?? '']);
  ws.addRow(['Estate', h.estate ?? '']);
  ws.addRow(['Project', h.project ?? '']);
  ws.addRow(['Unit', h.unit ?? '']);
  ws.addRow(['Total Contract Price (incl. VAT)', num(h.tcp) ?? num(d.tcp) ?? '']);
  ws.addRow(['Net TCP', num(h.net_tcp) ?? num(d.net_tcp) ?? '']);
  ws.addRow([]);
  ws.addRow(['Payment Date', 'Clearing Document', 'OR Number', 'Payment Principal', 'Payment VAT', 'TOTAL']);

  let p = 0;
  let v = 0;
  let t = 0;
  for (const r of rows) {
    const principal = num(r.payment_principal) ?? 0;
    const vat = num(r.payment_vat) ?? 0;
    const total = num(r.total_collection) ?? r2(principal + vat);
    p += principal;
    v += vat;
    t += total;
    const or = String(r.or_number ?? '').trim();
    ws.addRow([
      isoDay(r.effective_date ?? r.payment_date),
      String(r.clearing_doc ?? ''),
      /^(nan|null)$/i.test(or) ? '' : or,
      principal,
      vat,
      total,
    ]);
  }
  ws.addRow(['TOTAL', '', '', r2(p), r2(v), r2(t)]);

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return {
    buffer,
    fileName: `${REVIEWED_LEDGER_PREFIX} — ${contractNumber}${d.session_id ? ` (LedgerFit session #${d.session_id})` : ''}.xlsx`,
    sessionId: d.session_id ?? null,
    acceptedAt: d.tax_accepted_at ?? null,
    acceptedBy: d.tax_accepted_by ?? null,
    rowCount: rows.length,
  };
}
