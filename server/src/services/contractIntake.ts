import { prisma } from '../lib/prisma';
import { importOclp1606File } from './dataImport';
import { attachCtsFromSharePoint } from './folderSync';
import { fillCtsDataForContracts, type CtsDataFill } from './ctsDataSync';
import {
  fetchLedgersForContracts,
  localOclpFilePath,
  pullOclpFromSharePoint,
  type LedgerNotLatest,
} from './sharepointSync';
import { describeLedgerfitSession, lookupLedgerfitSession } from './ledgerfitStatus';
import fs from 'fs';
import path from 'path';

// What uploading a contract list does, for exactly the contracts in that
// list — nothing else is touched (no folder-wide sync):
//   1. each contract's Customer Ledger (SharePoint Ledgers folder, local
//      ledger folder as a fallback)
//   2. the OCLP 1606 Summary's FINAL tab — refreshed from SharePoint only if
//      it changed there — then linked to the contracts (incl. prior-buyer
//      remittances via Base Contract)
//   3. each contract's CTS from the SharePoint Property Sales library
//   4. the CTS notary date, unit/parking SQM and zonal value, from the DOAS
//      Notary Endorsement System's batches (empty fields only)
// The exposure computation itself needs no step: it's derived from the
// stored data every time a contract is read, so the caller just reads the
// contracts back once this returns. All SharePoint access is read-only.

export interface LedgerNotLatestInfo extends LedgerNotLatest {
  ledgerfitSessionId: string | null;
  ledgerfitStatus: string | null;
  advice: string;
}

export interface IntakeSummary {
  ledgersLoaded: string[];
  // Of those, the ones that came from the Tax team's Reviewed & Accepted
  // ledgers (the preferred source) rather than a SharePoint/local file.
  ledgersFromReviewed: string[];
  // Loaded, but from a SharePoint/local file because the contract is not in
  // Reviewed & Accepted yet — provisional until Tax reviews and accepts it.
  ledgersNotReviewed: string[];
  ledgersNotFound: string[];
  // Ledgers that loaded but are not LedgerFit's latest corrected ledger (some
  // clearing documents are not in the 14 series), with the LedgerFit session
  // state that explains why and what to do.
  ledgersNotLatest: LedgerNotLatestInfo[];
  // Why each not-found ledger isn't there, from its LedgerFit session.
  ledgersNotFoundAdvice: { contractNumber: string; advice: string }[];
  oclp: { refreshedFromSharePoint: boolean; matchedRows: number | null };
  ctsFetched: string[];
  ctsOnFile: string[];
  // Contracts whose CTS notary date / SQM / zonal value were filled in from
  // the DOAS batches during this retrieval, and which fields.
  ctsDataFilled: CtsDataFill[];
  // Contracts that now have both a CTS notary date and a unit SQM.
  ctsDataComplete: string[];
  errors: string[];
}

export interface IntakeProgress {
  stage: string;
  done: number;
  total: number;
}

// Contracts are processed in small groups so a progress callback can report
// "N of M" — one at a time for lists up to 30, larger groups beyond that.
function chunksOf<T>(items: T[]): T[][] {
  const size = Math.max(1, Math.ceil(items.length / 30));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function retrieveDataForContracts(
  contractNumbers: string[],
  onProgress?: (p: IntakeProgress) => void,
): Promise<IntakeSummary> {
  const errors: string[] = [];
  const total = contractNumbers.length;
  const report = (stage: string, done: number, of = total) => onProgress?.({ stage, done, total: of });

  // 1. Ledgers.
  const ledgers: Awaited<ReturnType<typeof fetchLedgersForContracts>> = {
    loaded: [],
    fromReviewed: [],
    notFound: [],
    notLatest: [],
    errors: [],
  };
  let processed = 0;
  report('Loading payment ledgers', 0);
  for (const group of chunksOf(contractNumbers)) {
    const part = await fetchLedgersForContracts(group);
    ledgers.loaded.push(...part.loaded);
    ledgers.fromReviewed.push(...part.fromReviewed);
    ledgers.notFound.push(...part.notFound);
    ledgers.notLatest.push(...part.notLatest);
    ledgers.errors.push(...part.errors);
    processed += group.length;
    report('Loading payment ledgers', processed);
  }
  errors.push(...ledgers.errors);
  const ledgersNotFoundAdvice: { contractNumber: string; advice: string }[] = [];
  for (const n of ledgers.notFound) {
    const session = await lookupLedgerfitSession(n);
    ledgersNotFoundAdvice.push({
      contractNumber: n,
      advice: session
        ? `Not in Reviewed & Accepted yet. ${describeLedgerfitSession(session)} No exported ledger is in the SharePoint Ledgers folder either.`
        : 'Not in Reviewed & Accepted, no exported ledger in the SharePoint Ledgers folder, and no LedgerFit session found.',
    });
  }
  const ledgersNotLatest: LedgerNotLatestInfo[] = [];
  for (const stale of ledgers.notLatest) {
    const session = await lookupLedgerfitSession(stale.contractNumber);
    ledgersNotLatest.push({
      ...stale,
      ledgerfitSessionId: session?.sessionId ?? null,
      ledgerfitStatus: session?.status ?? null,
      advice: describeLedgerfitSession(session),
    });
  }

  // 2. 1606 Summary.
  report('Updating the 1606 Summary', 0, 1);
  const oclp: IntakeSummary['oclp'] = { refreshedFromSharePoint: false, matchedRows: null };
  try {
    const pull = await pullOclpFromSharePoint();
    oclp.refreshedFromSharePoint = pull.downloaded;
  } catch (e) {
    errors.push(`1606 Summary (SharePoint): ${(e as Error).message} — using the local copy if there is one`);
  }
  const oclpPath = localOclpFilePath();
  if (fs.existsSync(oclpPath)) {
    try {
      const r = await importOclp1606File(oclpPath, path.basename(oclpPath));
      oclp.matchedRows = r.matchedRows;
    } catch (e) {
      errors.push(`1606 Summary import: ${(e as Error).message}`);
    }
  } else {
    errors.push('1606 Summary: no local copy and SharePoint could not be reached');
  }

  // 3. CTS.
  report('Attaching CTS files', 0);
  const cts: { fetched: string[]; errors: string[] } = { fetched: [], errors: [] };
  processed = 0;
  for (const group of chunksOf(contractNumbers)) {
    const part = await attachCtsFromSharePoint(group);
    cts.fetched.push(...part.fetched);
    cts.errors.push(...part.errors);
    processed += group.length;
    report('Attaching CTS files', processed);
  }
  errors.push(...cts.errors);
  const withCts = await prisma.contract.findMany({
    where: { contractNumber: { in: contractNumbers }, ctsFileName: { not: null } },
    select: { contractNumber: true },
  });

  // 4. CTS notary date / SQM / zonal value — from the DOAS batches, since the
  // CTS PDFs are scans with no readable text. Fills empty fields only.
  report('Reading CTS notary date and SQM from DOAS', 0, 1);
  const ctsData = await fillCtsDataForContracts(contractNumbers);
  errors.push(...ctsData.errors);
  const withNotary = await prisma.contract.findMany({
    where: { contractNumber: { in: contractNumbers }, ctsNotaryDate: { not: null }, sqmUnit: { not: null } },
    select: { contractNumber: true },
  });

  return {
    ledgersLoaded: ledgers.loaded,
    ledgersFromReviewed: ledgers.fromReviewed,
    ledgersNotReviewed: ledgers.loaded.filter((n) => !ledgers.fromReviewed.includes(n)),
    ledgersNotFound: ledgers.notFound,
    ledgersNotLatest,
    ledgersNotFoundAdvice,
    oclp,
    ctsFetched: cts.fetched,
    ctsOnFile: withCts.map((c) => c.contractNumber),
    ctsDataFilled: ctsData.filled,
    ctsDataComplete: withNotary.map((c) => c.contractNumber),
    errors,
  };
}
