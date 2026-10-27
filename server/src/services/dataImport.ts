import { prisma } from '../lib/prisma';
import { parseCustomerLedger } from '../parsers/customerLedgerParser';
import { Oclp1606Row, parseOclp1606Workbook } from '../parsers/oclp1606Parser';

// Shared import logic used by both the HTTP upload routes and the automatic
// folder sync, so there is a single source of truth for how a Customer Ledger
// or an OCLP 1606 Summary is turned into database rows.

export async function importCustomerLedgerBuffer(
  contractNumber: string,
  buffer: Buffer,
  filename: string,
): Promise<{ ok: true; paymentRecordsImported: number } | { ok: false; reason: 'contract-not-found' }> {
  const contract = await prisma.contract.findUnique({ where: { contractNumber } });
  if (!contract) return { ok: false, reason: 'contract-not-found' };

  const parsed = await parseCustomerLedger(buffer);

  await prisma.$transaction([
    prisma.paymentRecord.deleteMany({ where: { contractId: contract.id } }),
    prisma.contract.update({
      where: { id: contract.id },
      data: {
        buyerName: parsed.buyerName ?? contract.buyerName,
        estate: parsed.estate ?? contract.estate,
        tower: parsed.tower ?? contract.tower,
        unit: parsed.unit ?? contract.unit,
        totalTCP: parsed.totalTCP ?? undefined,
        netTCP: parsed.netTCP ?? undefined,
        customerLedgerFileName: filename,
        paymentRecords: { create: parsed.paymentRecords.map((p) => ({ ...p })) },
      },
    }),
  ]);

  await prisma.importBatch.create({
    data: { type: 'CUSTOMER_LEDGER', filename, rowCount: parsed.paymentRecords.length },
  });

  return { ok: true, paymentRecordsImported: parsed.paymentRecords.length };
}

// Links 1606 rows to our contracts.
//
// A unit's buyer (and contract number) can change mid-payment; the 1606 file's
// "Base contract" column anchors every remittance for that unit's lineage to one
// stable number, regardless of which buyer's contract number a given row was
// actually filed under. For each of our contracts the Base contract is looked up
// FIRST in the FINAL tab (the base on rows filed under its own number); only when
// FINAL has no row for it do we use the "Contracts - look up" tab (contract
// number -> Base Contract). Then every FINAL row on that Base contract — filed
// under a previous buyer's number, say — is attributed to the contract, so the
// remittances made under a previous buyer still count.
export function buildRowLinker(
  rows: Pick<Oclp1606Row, 'contractNumberRaw' | 'baseContract'>[],
  baseLookup: Map<string, string>,
  contractByNumber: Map<string, string>,
) {
  const baseOfContract = new Map<string, string>();
  for (const row of rows) {
    if (contractByNumber.has(row.contractNumberRaw) && row.baseContract && !baseOfContract.has(row.contractNumberRaw)) {
      baseOfContract.set(row.contractNumberRaw, row.baseContract);
    }
  }
  for (const contractNumber of contractByNumber.keys()) {
    if (baseOfContract.has(contractNumber)) continue;
    const viaLookup = baseLookup.get(contractNumber);
    if (viaLookup) baseOfContract.set(contractNumber, viaLookup);
  }
  const contractIdByBaseContract = new Map<string, string>();
  for (const [contractNumber, base] of baseOfContract) {
    contractIdByBaseContract.set(base, contractByNumber.get(contractNumber)!);
  }

  // A row's own Base contract, else the look-up tab's entry for its contract number.
  const rowBase = (row: Pick<Oclp1606Row, 'contractNumberRaw' | 'baseContract'>): string | null =>
    row.baseContract ?? baseLookup.get(row.contractNumberRaw) ?? null;

  const resolveContractId = (row: Pick<Oclp1606Row, 'contractNumberRaw' | 'baseContract'>): string | null => {
    const direct = contractByNumber.get(row.contractNumberRaw);
    if (direct) return direct;
    const base = rowBase(row);
    return (base ? contractIdByBaseContract.get(base) : undefined) ?? null;
  };

  return { resolveContractId, rowBase };
}

export async function importOclp1606File(
  filePath: string,
  filename: string,
): Promise<{ totalRows: number; matchedRows: number; unmatchedRows: number; contractsUpdated: number }> {
  const { rows, baseLookup } = await parseOclp1606Workbook(filePath);
  const contracts = await prisma.contract.findMany({ select: { id: true, contractNumber: true } });
  const contractByNumber = new Map(contracts.map((c) => [c.contractNumber, c.id]));
  const { resolveContractId, rowBase } = buildRowLinker(rows, baseLookup, contractByNumber);

  let matched = 0;
  let unmatched = 0;
  const matchedContractIds = new Set<string>();

  for (const row of rows) {
    const contractId = resolveContractId(row);
    if (contractId) {
      matched++;
      matchedContractIds.add(contractId);
    } else {
      unmatched++;
    }
  }

  // The 1606 workbook is the complete remittance dataset, so replace ALL
  // collection events wholesale. (Deleting only matched contracts' events left
  // unmatched rows to accumulate on every re-import — doubling the table each
  // time the sync re-parsed the file.)
  await prisma.cwtCollectionEvent.deleteMany({});
  await prisma.cwtCollectionEvent.createMany({
    data: rows.map((row) => ({
      contractId: resolveContractId(row),
      contractNumberRaw: row.contractNumberRaw,
      baseContract: rowBase(row),
      buyerClassification: row.buyerClassification,
      taxTagging: row.taxTagging,
      sourceTaxBase: row.sourceTaxBase,
      sourceRate: row.sourceRate,
      actualTaxDue: row.actualTaxDue,
      transactionDate: row.transactionDate,
      datePaid: row.datePaid,
      remarks: row.remarks,
    })),
  });

  await prisma.importBatch.create({
    data: { type: 'OCLP_1606_SUMMARY', filename, rowCount: rows.length },
  });

  return { totalRows: rows.length, matchedRows: matched, unmatchedRows: unmatched, contractsUpdated: matchedContractIds.size };
}
