import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { downloadFile, fetchMetadata, listItems, SharePointItemMetadata } from './sharepointApi';
import { contractFromLedgerName, findLedgerDir, getDataDir, syncFromFolder, SyncSummary } from './folderSync';
import { importCustomerLedgerBuffer } from './dataImport';
import { parseCustomerLedger } from '../parsers/customerLedgerParser';
import { nonCurrentClearingDocs } from '../lib/clearingSeries';
import { fetchReviewedLedger } from './reviewedLedgers';

// Pulls the SharePoint-hosted reference files this app depends on straight
// from the live "Tax Team" library (via the IT-issued API — see
// sharepointApi.ts) into the local watched folder, then runs the normal
// folder sync so the new data is loaded. Replaces the earlier manual
// workflow (download via a signed-in browser, or guess from local OneDrive
// sync) with a single button.

const OCLP_FILENAME = 'OCLP - 1606 Summary_2009 onwards.xlsx';
const ZONAL_VALUE_FILENAME = 'ZONAL VALUE.xlsx';

// SharePoint paths, relative to the "tax-team-api" scope's root ("Tax Team"
// site, "Documents" library) — overridable in case the team reorganizes
// these folders later.
const OCLP_SHAREPOINT_PATH =
  process.env.SHAREPOINT_1606_PATH ?? '/02. OCLP/TAXES/01. 1606/01 FILED CWT(1606)/OCLP - 1606 Summary_2009 onwards.xlsx';
const ZONAL_VALUE_SHAREPOINT_PATH = process.env.SHAREPOINT_ZONAL_VALUE_PATH ?? '/02. OCLP/TITLE TRANSFER FILES/ZONAL VALUE.xlsx';
// Customer ledgers now come from here going forward (per user instruction
// 2026-09-18), not just whatever's dropped locally -- this folder is a
// whole directory of Customer_Ledger_<contract number>.xlsx files, unlike
// the two single-file pulls above.
const LEDGERS_SHAREPOINT_PATH =
  process.env.SHAREPOINT_LEDGERS_PATH ??
  '/10. PROJECTS AND STUDIES/2026 Claude_Payment Ledger/CLAUDE PAYMENT LEDGER_FINAL/Ledgers';

function localOclpPath(): string {
  return path.join(getDataDir(), OCLP_FILENAME);
}

export function localOclpFilePath(): string {
  return localOclpPath();
}

function localZonalPath(): string {
  const zonalDir = process.env.ZONAL_VALUES_DIR ?? getDataDir();
  return path.join(zonalDir, ZONAL_VALUE_FILENAME);
}

// The official/master 1606 workbook (as filed with BIR) has no "Base
// contract" column — the tax team adds that column themselves to track a
// unit's remittance lineage across a buyer transfer (see
// base_contract matching in dataImport.ts). Every time we pull a fresh copy
// from SharePoint, that column would otherwise be lost. So: read whatever
// Base Contract values are already known from the CURRENT local file (which
// carries forward everything learned in previous pulls) before overwriting
// it, then re-apply them to the fresh data — a contract number not seen
// before defaults to referencing itself (no known transfer), matching the
// convention already used throughout this data.
function readBaseContractMap(filePath: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(filePath)) return map;
  try {
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets['FINAL'];
    if (!ws) return map;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }) as unknown[][];
    for (let i = 2; i < rows.length; i++) {
      const contractNo = String(rows[i][2] ?? '').trim();
      const baseContract = String(rows[i][14] ?? '').trim();
      if (contractNo && baseContract && !map.has(contractNo)) map.set(contractNo, baseContract);
    }
  } catch {
    // Unreadable/corrupt existing file — proceed with an empty map rather
    // than fail the whole SharePoint pull over it.
  }
  return map;
}

// Looks at just the FINAL tab of a downloaded 1606 workbook: does it already
// have a "Base Contract" header in column O, and how many data rows have a
// value there?
function inspectNativeBaseContract(buffer: Buffer): { headerPresent: boolean; filled: number; blank: number } {
  const wb = XLSX.read(buffer, { type: 'buffer', sheets: 'FINAL' });
  const ws = wb.Sheets['FINAL'];
  if (!ws) return { headerPresent: false, filled: 0, blank: 0 };
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }) as unknown[][];
  const headerPresent = /base\s*contract/i.test(String(rows[1]?.[14] ?? ''));
  let filled = 0;
  let blank = 0;
  for (let i = 2; i < rows.length; i++) {
    if (!String(rows[i][2] ?? '').trim()) continue;
    if (String(rows[i][14] ?? '').trim()) filled++;
    else blank++;
  }
  return { headerPresent, filled, blank };
}

function applyBaseContract(buffer: Buffer, baseContractMap: Map<string, string>): { buffer: Buffer; matched: number; selfReferenced: number } {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets['FINAL'];
  if (!ws || !ws['!ref']) return { buffer, matched: 0, selfReferenced: 0 };

  const range = XLSX.utils.decode_range(ws['!ref']);
  const headerCell = ws[XLSX.utils.encode_cell({ r: 1, c: 14 })];
  if (!headerCell || !String(headerCell.v ?? '').trim()) {
    XLSX.utils.sheet_add_aoa(ws, [['Base Contract']], { origin: { r: 1, c: 14 } });
  }

  let matched = 0;
  let selfReferenced = 0;
  for (let r = 2; r <= range.e.r; r++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: 2 })];
    const contractNo = cell ? String(cell.v).trim() : '';
    if (!contractNo) continue;
    const existing = ws[XLSX.utils.encode_cell({ r, c: 14 })];
    if (existing && String(existing.v ?? '').trim()) {
      matched++; // already filled in the file itself — leave it alone
      continue;
    }
    const bc = baseContractMap.get(contractNo);
    if (bc) {
      matched++;
      XLSX.utils.sheet_add_aoa(ws, [[bc]], { origin: { r, c: 14 } });
    } else {
      selfReferenced++;
      XLSX.utils.sheet_add_aoa(ws, [[contractNo]], { origin: { r, c: 14 } });
    }
  }
  ws['!ref'] = XLSX.utils.encode_range({ s: range.s, e: { r: range.e.r, c: Math.max(range.e.c, 14) } });

  const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return { buffer: out, matched, selfReferenced };
}

export interface SharePointUpdateSummary {
  ranAt: string;
  oclp: {
    sharepointModifiedAt: string;
    sharepointSizeBytes: number;
    baseContractMatched: number;
    baseContractSelfReferenced: number;
  };
  zonalValue: {
    sharepointModifiedAt: string;
    sharepointSizeBytes: number;
    skipped: boolean; // true when the local copy was already current
  };
  ledgers: {
    filesChecked: number;
    filesDownloaded: string[];
  };
  folderSync: SyncSummary;
}

// Mirrors every Customer_Ledger_*.xlsx in the SharePoint Ledgers folder
// into the local ledger folder (see findLedgerDir in folderSync.ts) —
// downloading only what's new or changed (by size + modified time), same
// as the Zonal Value up-to-date check above. The actual loading into the
// database happens afterward via the normal syncFromFolder call, same as
// any locally-dropped ledger file.
async function syncLedgersFromSharePoint(): Promise<{ filesChecked: number; filesDownloaded: string[] }> {
  const localDir = findLedgerDir();
  fs.mkdirSync(localDir, { recursive: true });

  const remote = await listItems('tax-team-api', LEDGERS_SHAREPOINT_PATH);
  const files = remote.items.filter((item) => item.type === 'file' && contractFromLedgerName(item.name) !== null);

  const downloaded: string[] = [];
  for (const item of files) {
    const localPath = path.join(localDir, item.name);
    const localStat = fs.existsSync(localPath) ? fs.statSync(localPath) : null;
    const upToDate =
      localStat !== null && localStat.size === item.size && localStat.mtime.getTime() >= new Date(item.modified_at).getTime();
    if (upToDate) continue;

    const raw = await downloadFile('tax-team-api', item.path);
    fs.writeFileSync(localPath, raw);
    fs.utimesSync(localPath, new Date(), new Date(item.modified_at));
    downloaded.push(item.name);
  }

  return { filesChecked: files.length, filesDownloaded: downloaded };
}

// Pulls the 1606 Summary (FINAL tab is what the importer reads) from
// SharePoint into the local watched folder, carrying the Base Contract
// column forward from the current local copy. Read-only against SharePoint.
// Unless `force`, skips the (large) download when the local copy's
// timestamp already matches SharePoint's modified time — the local file is
// stamped with SharePoint's modified time after every pull so this check
// works on the next call.
export async function pullOclpFromSharePoint(
  opts: { force?: boolean } = {},
): Promise<{
  meta: SharePointItemMetadata;
  downloaded: boolean;
  baseContractMatched: number;
  baseContractSelfReferenced: number;
}> {
  const meta = await fetchMetadata('tax-team-api', OCLP_SHAREPOINT_PATH);
  const localPath = localOclpPath();
  const stat = fs.existsSync(localPath) ? fs.statSync(localPath) : null;
  const current = stat !== null && Math.abs(stat.mtime.getTime() - new Date(meta.modified_at).getTime()) < 2000;
  if (!opts.force && current) {
    return { meta, downloaded: false, baseContractMatched: 0, baseContractSelfReferenced: 0 };
  }

  const raw = await downloadFile('tax-team-api', OCLP_SHAREPOINT_PATH);

  // The tax team now maintains the "Base Contract" column (O) in the
  // SharePoint file itself. When it's there and essentially filled in, that
  // column is the source of truth: save the file byte-for-byte untouched
  // (no re-serialising a 19MB workbook into a 98MB one, and no overwriting
  // the team's values with older local ones).
  const native = inspectNativeBaseContract(raw);
  const total = native.filled + native.blank;
  if (native.headerPresent && total > 0 && native.filled / total >= 0.9) {
    fs.writeFileSync(localPath, raw);
    fs.utimesSync(localPath, new Date(), new Date(meta.modified_at));
    return { meta, downloaded: true, baseContractMatched: native.filled, baseContractSelfReferenced: native.blank };
  }

  // Older file without the column (or barely started): carry Base Contract
  // values forward from the current local copy, never overwriting a value
  // that's already in the file.
  const baseContractMap = readBaseContractMap(localPath);
  const { buffer, matched, selfReferenced } = applyBaseContract(raw, baseContractMap);
  fs.writeFileSync(localPath, buffer);
  fs.utimesSync(localPath, new Date(), new Date(meta.modified_at));
  return { meta, downloaded: true, baseContractMatched: matched, baseContractSelfReferenced: selfReferenced };
}

// Retrieves just the given contracts' customer ledgers (not the whole
// folder) and imports each one. Source order: the SharePoint Ledgers
// folder, then the local ledger folder as a fallback. A contract with no
// ledger anywhere is reported as notFound, not an error.
// A ledger that is not LedgerFit's latest, corrected one: some payment rows
// still carry a clearing document outside the "14" series (see
// lib/clearingSeries.ts).
export interface LedgerNotLatest {
  contractNumber: string;
  fileName: string;
  nonCurrentDocs: number;
  sample: string[];
}

export async function fetchLedgersForContracts(
  contractNumbers: string[],
): Promise<{
  loaded: string[];
  fromReviewed: string[];
  notFound: string[];
  notLatest: LedgerNotLatest[];
  errors: string[];
}> {
  const loaded: string[] = [];
  const fromReviewed: string[] = [];
  const notFound: string[] = [];
  const notLatest: LedgerNotLatest[] = [];
  const errors: string[] = [];
  const localDir = findLedgerDir();

  // File names carry a suffix in LedgerFit's current style
  // ("ledgerfit_<contract>_dates-per-SI.xlsx"), so list the folder once and
  // match each contract by the number inside the name. If a contract has
  // both styles, the LedgerFit one wins; among several, the newest.
  const rank = (it: SharePointItemMetadata) =>
    (it.name.toLowerCase().startsWith('ledgerfit_') ? 1e15 : 0) + Date.parse(it.modified_at || '') || 0;
  // Every candidate file per contract, best first. The first one whose
  // clearing documents are all in the current series wins; if none is, the
  // best-ranked is used and flagged as not the latest ledger.
  const remoteCandidates = new Map<string, SharePointItemMetadata[]>();
  let listingTruncated = false;
  try {
    const listing = await listItems('tax-team-api', LEDGERS_SHAREPOINT_PATH);
    listingTruncated = listing.truncated;
    for (const it of listing.items) {
      if (it.type !== 'file') continue;
      const n = contractFromLedgerName(it.name);
      if (!n) continue;
      const list = remoteCandidates.get(n) ?? [];
      list.push(it);
      remoteCandidates.set(n, list);
    }
    for (const list of remoteCandidates.values()) list.sort((a, b) => rank(b) - rank(a));
  } catch (e) {
    errors.push(`SharePoint Ledgers folder: ${(e as Error).message} — falling back to the local ledger folder`);
  }

  for (const n of contractNumbers) {
    let fileName = `ledgerfit_${n}`;
    try {
      // First choice: the Tax team's Reviewed & Accepted ledger (LedgerFit's
      // corrected combined ledger, served by the DOAS system).
      const reviewed = await fetchReviewedLedger(n).catch(() => null);
      if (reviewed) {
        const r = await importCustomerLedgerBuffer(n, reviewed.buffer, reviewed.fileName);
        if (r.ok) {
          loaded.push(n);
          fromReviewed.push(n);
        } else {
          errors.push(`Ledger ${reviewed.fileName}: contract ${n} could not be created`);
        }
        const stale = await nonCurrentSeriesIn(reviewed.buffer);
        if (stale.length > 0) {
          notLatest.push({ contractNumber: n, fileName: reviewed.fileName, nonCurrentDocs: stale.length, sample: stale.slice(0, 3) });
        }
        continue;
      }

      let buf: Buffer | null = null;
      const candidates = remoteCandidates.get(n) ?? [];
      if (candidates.length > 0) {
        for (const item of candidates) {
          const candidate = await downloadFile('tax-team-api', item.path);
          if (buf === null) {
            // Best-ranked file: the fallback if no candidate is fully current.
            buf = candidate;
            fileName = item.name;
          }
          if (await isCurrentSeries(candidate)) {
            buf = candidate;
            fileName = item.name;
            break;
          }
        }
      } else if (listingTruncated) {
        // Listing was cut off, so absence from it proves nothing — try the
        // two exact names directly. A 404 just means "not there".
        for (const guess of [`ledgerfit_${n}_dates-per-SI.xlsx`, `Customer_Ledger_${n}.xlsx`]) {
          try {
            buf = await downloadFile('tax-team-api', `${LEDGERS_SHAREPOINT_PATH}/${guess}`);
            fileName = guess;
            break;
          } catch (e) {
            if (!/\(404\)/.test((e as Error).message)) throw e;
          }
        }
      }
      if (!buf && fs.existsSync(localDir)) {
        const local = fs
          .readdirSync(localDir)
          .filter((f) => contractFromLedgerName(f) === n)
          .sort((a, b) => Number(b.toLowerCase().startsWith('ledgerfit_')) - Number(a.toLowerCase().startsWith('ledgerfit_')));
        if (local.length > 0) {
          fileName = local[0];
          buf = fs.readFileSync(path.join(localDir, local[0]));
        }
      }
      if (!buf) {
        notFound.push(n);
        continue;
      }
      const r = await importCustomerLedgerBuffer(n, buf, fileName);
      if (r.ok) loaded.push(n);
      else errors.push(`Ledger ${fileName}: contract ${n} could not be created`);

      const stale = await nonCurrentSeriesIn(buf);
      if (stale.length > 0) {
        notLatest.push({ contractNumber: n, fileName, nonCurrentDocs: stale.length, sample: stale.slice(0, 3) });
      }
    } catch (e) {
      errors.push(`Ledger ${fileName}: ${(e as Error).message}`);
    }
  }
  return { loaded, fromReviewed, notFound, notLatest, errors };
}

async function nonCurrentSeriesIn(buffer: Buffer): Promise<string[]> {
  const parsed = await parseCustomerLedger(buffer);
  return nonCurrentClearingDocs(parsed.paymentRecords.filter((p) => !p.isSubtotal).map((p) => p.clearingDocument));
}

async function isCurrentSeries(buffer: Buffer): Promise<boolean> {
  try {
    return (await nonCurrentSeriesIn(buffer)).length === 0;
  } catch {
    return false;
  }
}

export async function updateFromSharePoint(): Promise<SharePointUpdateSummary> {
  // 1606 Summary — always re-pulled here (the manual "Update from
  // SharePoint" button), even if the timestamp looks current.
  const {
    meta: oclpMeta,
    baseContractMatched: matched,
    baseContractSelfReferenced: selfReferenced,
  } = await pullOclpFromSharePoint({ force: true });

  // Zonal Value — small enough, and changes rarely enough, that it's worth
  // skipping the download entirely when the local copy is already current
  // (compare size + modified time against what SharePoint reports).
  const zonalMeta = await fetchMetadata('tax-team-api', ZONAL_VALUE_SHAREPOINT_PATH);
  const zonalLocalPath = localZonalPath();
  const zonalLocalStat = fs.existsSync(zonalLocalPath) ? fs.statSync(zonalLocalPath) : null;
  const zonalUpToDate =
    zonalLocalStat !== null &&
    zonalLocalStat.size === zonalMeta.size &&
    zonalLocalStat.mtime.getTime() >= new Date(zonalMeta.modified_at).getTime();
  if (!zonalUpToDate) {
    const zonalRaw = await downloadFile('tax-team-api', ZONAL_VALUE_SHAREPOINT_PATH);
    fs.writeFileSync(zonalLocalPath, zonalRaw);
    fs.utimesSync(zonalLocalPath, new Date(), new Date(zonalMeta.modified_at));
  }

  // Customer ledgers — mirror the whole SharePoint Ledgers folder down
  // before the folder sync below, so any new/changed ledger it finds gets
  // loaded in the same run.
  const ledgersResult = await syncLedgersFromSharePoint();

  const folderSyncSummary = await syncFromFolder({ force: true });

  return {
    ranAt: new Date().toISOString(),
    oclp: {
      sharepointModifiedAt: oclpMeta.modified_at,
      sharepointSizeBytes: oclpMeta.size,
      baseContractMatched: matched,
      baseContractSelfReferenced: selfReferenced,
    },
    zonalValue: {
      sharepointModifiedAt: zonalMeta.modified_at,
      sharepointSizeBytes: zonalMeta.size,
      skipped: zonalUpToDate,
    },
    ledgers: ledgersResult,
    folderSync: folderSyncSummary,
  };
}
