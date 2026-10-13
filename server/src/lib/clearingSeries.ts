// The payment ledger the portal computes from must be LedgerFit's corrected,
// combined ledger — in which every payment carries a clearing document in the
// current "14" series. A clearing document that starts with anything else
// (typically the "23" series: a lump-sum transfer row that LedgerFit has not
// yet replaced with the old contract's own payments) means the file being read
// is not the latest ledger.
export const CURRENT_CLEARING_PREFIX = '14';

// The clearing documents (as written in the ledger) that are NOT in the
// current series. Blank clearing documents are ignored — subtotal/total rows
// don't have one.
export function nonCurrentClearingDocs(docs: ReadonlyArray<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const d of docs) {
    const v = (d ?? '').trim();
    if (v && !v.startsWith(CURRENT_CLEARING_PREFIX)) out.push(v);
  }
  return out;
}
