import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { downloadFile, fetchMetadata } from './sharepointApi';
import { getDataDir, syncFromFolder, SyncSummary } from './folderSync';

// Pulls the two SharePoint-hosted reference files this app depends on
// straight from the live "Tax Team" library (via the IT-issued API — see
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

function localOclpPath(): string {
  return path.join(getDataDir(), OCLP_FILENAME);
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

function applyBaseContract(buffer: Buffer, baseContractMap: Map<string, string>): { buffer: Buffer; matched: number; selfReferenced: number } {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets['FINAL'];
  if (!ws || !ws['!ref']) return { buffer, matched: 0, selfReferenced: 0 };

  const range = XLSX.utils.decode_range(ws['!ref']);
  XLSX.utils.sheet_add_aoa(ws, [['Base contract']], { origin: { r: 1, c: 14 } });

  let matched = 0;
  let selfReferenced = 0;
  for (let r = 2; r <= range.e.r; r++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: 2 })];
    const contractNo = cell ? String(cell.v).trim() : '';
    if (!contractNo) continue;
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
  folderSync: SyncSummary;
}

export async function updateFromSharePoint(): Promise<SharePointUpdateSummary> {
  // 1606 Summary — always re-pulled (it's filed continuously; there's no
  // cheap way to know in advance whether new rows landed since a size/mtime
  // check wouldn't catch newly-added remittances without re-downloading).
  const oclpMeta = await fetchMetadata('tax-team-api', OCLP_SHAREPOINT_PATH);
  const baseContractMap = readBaseContractMap(localOclpPath());
  const oclpRaw = await downloadFile('tax-team-api', OCLP_SHAREPOINT_PATH);
  const { buffer: oclpMerged, matched, selfReferenced } = applyBaseContract(oclpRaw, baseContractMap);
  fs.writeFileSync(localOclpPath(), oclpMerged);

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
    folderSync: folderSyncSummary,
  };
}
