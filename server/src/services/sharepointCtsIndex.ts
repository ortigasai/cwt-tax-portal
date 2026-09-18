import { downloadFile } from './sharepointApi';

// Parses /cts_files.txt at the "dcmg-elib" scope root -- a `dir /s`-style
// recursive listing of every CTS PDF in the whole Property Sales library
// (someone's local sync snapshot, refreshed periodically) -- into
// contractNumber -> every CTS PDF found in that contract's own folder.
// Used to auto-attach a contract's CTS on folder sync when no local CTS
// has been dropped in DATA_SYNC_DIR's CTS folder, instead of crawling the
// API folder-by-folder through a 250GB+ tree.
//
// The library is organized Estate -> Tower -> "<contract number> <buyer
// name> <unit code>" folder -> CTS PDF(s), and a unit that changed buyers
// mid-sale has a nested "<prior contract number> <prior buyer> old buyer"
// subfolder with its own CTS. Indexing by each folder's own leaf name's
// leading contract number handles both cases identically, with no special
// casing needed -- an "old buyer" folder just indexes under the prior
// contract's own number, exactly like a top-level folder would.

export interface CtsIndexEntry {
  contractNumber: string;
  folderPath: string; // full path as recorded in cts_files.txt (local machine path, informational)
  fileName: string;
  modifiedAt: Date;
  sizeBytes: number;
}

const INDEX_PATH = '/cts_files.txt';
const SCOPE = 'dcmg-elib';
// Everything up to and including this in a `dir`-listed path is the local
// sync root, not part of the SharePoint-relative path the API expects.
const LIBRARY_ROOT_MARKER = 'Property Sales - Documents';

let cached: { fetchedAt: number; index: Map<string, CtsIndexEntry[]> } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

const DIR_LINE = /^ Directory of (.+)$/;
const FILE_LINE = /^(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}\s?(?:AM|PM))\s+\(?([\d,]+)\)?\s+(.+\.pdf)\s*$/i;

export function parseCtsIndex(text: string): Map<string, CtsIndexEntry[]> {
  const map = new Map<string, CtsIndexEntry[]>();
  let currentFolder: string | null = null;
  let currentContractNumber: string | null = null;

  for (const line of text.split(/\r?\n/)) {
    const dirMatch = line.match(DIR_LINE);
    if (dirMatch) {
      currentFolder = dirMatch[1].trim();
      const lastSegment = currentFolder.split('\\').pop() ?? '';
      const numMatch = lastSegment.match(/^(\d{6,})\b/);
      currentContractNumber = numMatch ? numMatch[1] : null;
      continue;
    }
    if (!currentContractNumber || !currentFolder) continue;
    const fileMatch = line.match(FILE_LINE);
    if (!fileMatch) continue;
    const [, dateStr, timeStr, sizeStr, fileName] = fileMatch;
    const modifiedAt = new Date(`${dateStr} ${timeStr}`);
    const entry: CtsIndexEntry = {
      contractNumber: currentContractNumber,
      folderPath: currentFolder,
      fileName: fileName.trim(),
      modifiedAt: Number.isNaN(modifiedAt.getTime()) ? new Date(0) : modifiedAt,
      sizeBytes: Number(sizeStr.replace(/,/g, '')),
    };
    const list = map.get(currentContractNumber) ?? [];
    list.push(entry);
    map.set(currentContractNumber, list);
  }
  return map;
}

export async function getCtsIndex(opts: { force?: boolean } = {}): Promise<Map<string, CtsIndexEntry[]>> {
  if (!opts.force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.index;
  }
  const buf = await downloadFile(SCOPE, INDEX_PATH);
  const index = parseCtsIndex(buf.toString('utf8'));
  cached = { fetchedAt: Date.now(), index };
  return index;
}

// Best candidate when a folder has more than one CTS (e.g. "CTS 1.pdf",
// "CTS 2.pdf", a supplement): the most recently modified file. A proxy for
// "latest by notary date" -- confirming the actual notary date still needs
// opening the file, per the established manual CTS-reading workflow.
export function pickLatestCts(entries: CtsIndexEntry[]): CtsIndexEntry | null {
  if (entries.length === 0) return null;
  return [...entries].sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime())[0];
}

function toApiPath(entry: CtsIndexEntry): string {
  const idx = entry.folderPath.indexOf(LIBRARY_ROOT_MARKER);
  const rel = idx >= 0 ? entry.folderPath.slice(idx + LIBRARY_ROOT_MARKER.length) : entry.folderPath;
  const relForward = rel.replace(/\\/g, '/');
  return `${relForward}/${entry.fileName}`.replace(/\/{2,}/g, '/');
}

export async function downloadCtsFile(entry: CtsIndexEntry): Promise<Buffer> {
  return downloadFile(SCOPE, toApiPath(entry));
}
