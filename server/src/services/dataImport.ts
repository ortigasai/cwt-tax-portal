import { prisma } from '../lib/prisma';
import { parseCustomerLedger } from '../parsers/customerLedgerParser';
import { parseOclp1606Summary } from '../parsers/oclp1606Parser';

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

export async function importOclp1606File(
  filePath: string,
  filename: string,
): Promise<{ totalRows: number; matchedRows: number; unmatchedRows: number; contractsUpdated: number }> {
  const rows = await parseOclp1606Summary(filePath);
  const contracts = await prisma.contract.findMany({ select: { id: true, contractNumber: true } });
  const contractByNumber = new Map(contracts.map((c) => [c.contractNumber, c.id]));

  // A unit's buyer (and contract number) can change mid-payment; the 1606
  // file's "Base contract" column anchors every remittance for that unit's
  // lineage to one stable number, regardless of which buyer's contract
  // number a given row was actually filed under. First pass: find, for each
  // Base contract value, which of our contracts it belongs to — from rows
  // that directly match a known contract number. Second pass: any row that
  // doesn't directly match (e.g. filed under a since-superseded contract
  // number) falls back to that Base-contract-derived link, so remittances
  // made under a previous buyer still attribute to the current contract.
  const contractIdByBaseContract = new Map<string, string>();
  for (const row of rows) {
    const directId = contractByNumber.get(row.contractNumberRaw);
    if (directId && row.baseContract) contractIdByBaseContract.set(row.baseContract, directId);
  }

  function resolveContractId(row: (typeof rows)[number]): string | null {
    return contractByNumber.get(row.contractNumberRaw) ?? (row.baseContract ? contractIdByBaseContract.get(row.baseContract) : undefined) ?? null;
  }

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
      baseContract: row.baseContract,
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
