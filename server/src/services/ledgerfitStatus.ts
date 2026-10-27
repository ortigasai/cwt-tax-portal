// Read-only lookup of a contract's LedgerFit session — where the corrected,
// combined payment ledger is built (old contract ledgers spliced in place of
// the 23-series lump rows) and from which the "ledgerfit_<contract>…xlsx"
// files in the SharePoint Ledgers folder are exported. Used to tell the user
// WHY a ledger isn't the latest one and where to fix it.
//
// GET-only against <DOAS_API_URL>/api/ledgerfit/sessions; best effort — every
// failure just means "no session info".

import { doasFetch } from './doasAuth';

const TIMEOUT_MS = 30_000;
const TTL_MS = 2 * 60_000;

export interface LedgerfitSessionInfo {
  sessionId: string;
  status: string;
  updatedAt: string;
  batchName: string | null;
  hasOldLedger: boolean;
  approved: boolean;
}

interface SessionRow {
  id: string;
  contract_no: string;
  status: string;
  updated_at: string;
  approved_at: string | null;
  batch_name: string | null;
  has_old_ledger: boolean;
}

let cache: { at: number; byContract: Map<string, LedgerfitSessionInfo> } | null = null;

async function loadSessions(): Promise<Map<string, LedgerfitSessionInfo>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.byContract;
  const res = await doasFetch('/api/ledgerfit/sessions', TIMEOUT_MS);
  if (!res.ok) throw new Error(`LedgerFit sessions → HTTP ${res.status}`);
  const body = (await res.json()) as { rows: SessionRow[] };

  // A contract can have several sessions (one per endorsement batch): the most
  // recently updated one is the current state of its ledger.
  const byContract = new Map<string, LedgerfitSessionInfo>();
  for (const s of body.rows ?? []) {
    const current = byContract.get(s.contract_no);
    if (current && current.updatedAt >= s.updated_at) continue;
    byContract.set(s.contract_no, {
      sessionId: String(s.id),
      status: s.status,
      updatedAt: s.updated_at,
      batchName: s.batch_name,
      hasOldLedger: Boolean(s.has_old_ledger),
      approved: Boolean(s.approved_at),
    });
  }
  cache = { at: Date.now(), byContract };
  return byContract;
}

export async function lookupLedgerfitSession(contractNumber: string): Promise<LedgerfitSessionInfo | null> {
  try {
    return (await loadSessions()).get(contractNumber) ?? null;
  } catch {
    return null;
  }
}

// One plain sentence on what to do, from the session's state.
export function describeLedgerfitSession(info: LedgerfitSessionInfo | null): string {
  if (!info) return 'No LedgerFit session was found for this contract — load its ledger into LedgerFit first.';
  const where = `LedgerFit session #${info.sessionId}`;
  switch (info.status) {
    case 'requires_old':
      return `${where} is still waiting for the old contract's ledger — the 23-series rows have not been replaced yet.`;
    case 'parsed':
      return `${where} is parsed but its clean-up / old-ledger mapping has not been completed.`;
    case 'complete_mapped':
    case 'approved':
      return `${where} is ${info.status.replace('_', ' ')} (updated ${info.updatedAt.slice(0, 10)}) — re-export "Export .xlsx — dates per actual SI" from it into the SharePoint Ledgers folder.`;
    default:
      return `${where} has status "${info.status}" (updated ${info.updatedAt.slice(0, 10)}).`;
  }
}
