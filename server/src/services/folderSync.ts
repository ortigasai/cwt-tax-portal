import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma';
import { importCustomerLedgerBuffer, importOclp1606File } from './dataImport';
import { contractFilePath } from '../lib/fileStorage';
import { applyManualOverrideIfAny } from './manualOverrides';

// Folder sync. The canonical data folder (and its subfolders) is the single
// source of truth for ledger/CTS/1606 data — anything the user drops there
// is picked up without a manual per-file upload. There is no background
// loop: this runs only when explicitly triggered — from the dashboard's
// "Sync from folder now" button, or automatically as part of uploading a
// contract-number list (see routes/contracts.ts).

const DEFAULT_DATA_DIR =
  'C:/Users/Corporate Finance AI/OneDrive - Ortigas & Company, Limited Partnership/2026 CWT portal';

const DATA_DIR = process.env.DATA_SYNC_DIR ?? DEFAULT_DATA_DIR;
const OCLP_FILE = path.join(DATA_DIR, 'OCLP - 1606 Summary_2009 onwards.xlsx');
const CTS_DIR = path.join(DATA_DIR, 'CTS');

export function getDataDir(): string {
  return DATA_DIR;
}

// Resolve the ledger subfolder by name pattern rather than an exact match —
// the tax team prefixes folders with a running number and has used both
// "Payment Ledger(s)" and "Customer Ledger" naming (e.g. "1. Customer
// Ledger"), and the exact wording/numbering can change over time. Falls
// back to the literal "Payment Ledger" name if no match is found, so an
// unnumbered setup still works.
function findLedgerDir(): string {
  try {
    const hit = fs.readdirSync(DATA_DIR, { withFileTypes: true }).find(
      (d) => d.isDirectory() && /(payment|customer)\s*ledgers?/i.test(d.name),
    );
    if (hit) return path.join(DATA_DIR, hit.name);
  } catch {
    /* fall through to default below */
  }
  return path.join(DATA_DIR, 'Payment Ledger');
}

// Track file signatures (mtime:size) so unchanged files are skipped on each
// pass. Cleared on process restart, which triggers a one-time full resync.
const fileSig = new Map<string, string>();
function signature(file: string): string | null {
  try {
    const s = fs.statSync(file);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return null;
  }
}
function hasChanged(file: string): boolean {
  const sig = signature(file);
  if (sig === null) return false;
  return fileSig.get(file) !== sig;
}
function markSynced(file: string): void {
  const sig = signature(file);
  if (sig !== null) fileSig.set(file, sig);
}

function contractFromLedgerName(filename: string): string | null {
  const m = filename.match(/Customer_Ledger_(\d+)\.xlsx$/i);
  return m ? m[1] : null;
}
function contractFromCtsName(filename: string): string | null {
  const m = filename.match(/(\d{6,})/);
  return m ? m[1] : null;
}

export interface SyncSummary {
  ranAt: string;
  durationMs: number;
  dataDir: string;
  contractsCreated: number;
  ledgersLoaded: string[];
  ledgersSkipped: number;
  oclpLoaded: boolean;
  oclpMatchedRows: number | null;
  ctsAttached: string[];
  errors: string[];
  skippedBusy?: boolean;
}

let running = false;
let last: SyncSummary | null = null;

export function getLastSync(): SyncSummary | null {
  return last;
}

export async function syncFromFolder(opts: { force?: boolean } = {}): Promise<SyncSummary> {
  if (running) {
    return (
      last ?? {
        ranAt: new Date().toISOString(),
        durationMs: 0,
        dataDir: DATA_DIR,
        contractsCreated: 0,
        ledgersLoaded: [],
        ledgersSkipped: 0,
        oclpLoaded: false,
        oclpMatchedRows: null,
        ctsAttached: [],
        errors: [],
        skippedBusy: true,
      }
    );
  }
  running = true;
  const start = Date.now();
  const summary: SyncSummary = {
    ranAt: new Date().toISOString(),
    durationMs: 0,
    dataDir: DATA_DIR,
    contractsCreated: 0,
    ledgersLoaded: [],
    ledgersSkipped: 0,
    oclpLoaded: false,
    oclpMatchedRows: null,
    ctsAttached: [],
    errors: [],
  };

  try {
    // 1. Discover customer ledger files.
    const ledgerDir = findLedgerDir();
    let ledgerFiles: string[] = [];
    try {
      ledgerFiles = fs
        .readdirSync(ledgerDir)
        .filter((f) => /^Customer_Ledger_\d+\.xlsx$/i.test(f) && !f.startsWith('~$'));
    } catch (e) {
      summary.errors.push(`Payment Ledger folder unreadable: ${(e as Error).message}`);
    }

    // 2. Ensure a contract stub exists for every ledger file. New stubs from
    //    one sync run are grouped into a single dated batch.
    const wanted = new Set<string>();
    for (const f of ledgerFiles) {
      const n = contractFromLedgerName(f);
      if (n) wanted.add(n);
    }
    // Contracts that must be loaded from their ledger regardless of the file's
    // signature — any wanted contract that is missing payment data (e.g. a new
    // stub, or one that was deleted and just recreated). Without this, a
    // recreated contract would stay an empty "Missing data" stub because its
    // unchanged file gets skipped.
    let needsLoad = new Set<string>(wanted);
    if (wanted.size > 0) {
      const withData = await prisma.contract.findMany({
        where: { contractNumber: { in: [...wanted] }, paymentRecords: { some: {} } },
        select: { contractNumber: true },
      });
      const hasData = new Set(withData.map((c) => c.contractNumber));
      needsLoad = new Set([...wanted].filter((n) => !hasData.has(n)));

      const existing = await prisma.contract.findMany({
        where: { contractNumber: { in: [...wanted] } },
        select: { contractNumber: true },
      });
      const existingSet = new Set(existing.map((c) => c.contractNumber));
      const toCreate = [...wanted].filter((n) => !existingSet.has(n));
      if (toCreate.length > 0) {
        const batchNumber = (await prisma.importBatch.count({ where: { type: 'CONTRACT_LIST' } })) + 1;
        const batchDate = new Date();
        for (const n of toCreate) {
          const created = await prisma.contract.create({ data: { contractNumber: n, batchNumber, batchDate } });
          // Re-hydrate any CTS/zonal research (notary date, SQM, zonal
          // value, FMV matches) saved before this contract was previously
          // deleted — see manualOverrides.ts.
          await applyManualOverrideIfAny(created.id, n);
        }
        await prisma.importBatch.create({
          data: {
            type: 'CONTRACT_LIST',
            filename: `Folder sync ${batchDate.toISOString().slice(0, 10)}`,
            rowCount: toCreate.length,
            batchNumber,
          },
        });
        summary.contractsCreated = toCreate.length;
      }
    }

    // 3. Load ledgers whose file changed, or whose contract is missing data.
    for (const f of ledgerFiles) {
      const n = contractFromLedgerName(f);
      if (!n) continue;
      const full = path.join(ledgerDir, f);
      if (!opts.force && !hasChanged(full) && !needsLoad.has(n)) {
        summary.ledgersSkipped++;
        continue;
      }
      try {
        const buf = fs.readFileSync(full);
        const r = await importCustomerLedgerBuffer(n, buf, f);
        if (r.ok) {
          summary.ledgersLoaded.push(n);
          markSynced(full);
        } else {
          summary.errors.push(`Ledger ${f}: contract ${n} could not be created`);
        }
      } catch (e) {
        summary.errors.push(`Ledger ${f}: ${(e as Error).message}`);
      }
    }

    // 4. OCLP 1606 Summary — reparse when the workbook changes, or when new
    // contracts were just created (step 2). New contracts must trigger a full
    // reparse, not just a per-number re-link: a contract's remittance history
    // can include rows filed under a previous buyer's contract number, only
    // discoverable via this file's full contractNumber+baseContract matching
    // (see dataImport.ts) — a narrower "relink orphans by this exact number"
    // pass would miss those base-contract-only rows entirely.
    if (fs.existsSync(OCLP_FILE) && (opts.force || hasChanged(OCLP_FILE) || summary.contractsCreated > 0)) {
      try {
        const r = await importOclp1606File(OCLP_FILE, path.basename(OCLP_FILE));
        summary.oclpLoaded = true;
        summary.oclpMatchedRows = r.matchedRows;
        markSynced(OCLP_FILE);
      } catch (e) {
        summary.errors.push(`OCLP 1606 Summary: ${(e as Error).message}`);
      }
    }

    // 5. CTS PDFs — attach to their contract (by leading contract number).
    let ctsFiles: string[] = [];
    try {
      ctsFiles = fs.readdirSync(CTS_DIR).filter((f) => /\.pdf$/i.test(f) && !f.startsWith('~$'));
    } catch {
      /* CTS folder optional */
    }
    for (const f of ctsFiles) {
      const n = contractFromCtsName(f);
      if (!n) continue;
      const full = path.join(CTS_DIR, f);
      if (!opts.force && !hasChanged(full) && !needsLoad.has(n)) continue;
      try {
        const contract = await prisma.contract.findUnique({ where: { contractNumber: n } });
        if (!contract) continue; // only attach to contracts we know about
        fs.writeFileSync(contractFilePath(n, f), fs.readFileSync(full));
        await prisma.contract.update({ where: { contractNumber: n }, data: { ctsFileName: f } });
        summary.ctsAttached.push(n);
        markSynced(full);
      } catch (e) {
        summary.errors.push(`CTS ${f}: ${(e as Error).message}`);
      }
    }
  } finally {
    summary.durationMs = Date.now() - start;
    last = summary;
    running = false;
  }

  return summary;
}

// There is no automatic/background sync loop anymore — syncFromFolder is
// only ever invoked in response to something the user actually did: the
// dashboard's "Sync from folder now" button (see routes/sync.ts), or
// uploading a contract-number list (see routes/contracts.ts's upload-list
// handler, which syncs right after creating the new contract stubs so their
// ledger/CTS/1606 data comes in from DATA_SYNC_DIR immediately rather than
// waiting on a background poll).
