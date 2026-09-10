import { prisma } from '../lib/prisma';

// Persists a shadow copy of every manually-entered field (CTS notary date,
// SQM, zonal values, FMV matches, notes), keyed by contractNumber rather than
// the Contract row's own id. Call this after every successful manual PATCH so
// the shadow always reflects the latest known-good values.
export async function saveManualOverride(
  contractNumber: string,
  fields: {
    ctsNotaryDate: Date | null;
    sqmUnit: number | null;
    sqmParking: number | null;
    sqmStorage: number | null;
    zonalValuePerSqmUnit: number | null;
    zonalValuePerSqmParking: number | null;
    matchedRptRecordId: string | null;
    matchedParkingRptRecordId: string | null;
    matchedStorageRptRecordId: string | null;
    notes: string | null;
  },
): Promise<void> {
  await prisma.contractManualOverride.upsert({
    where: { contractNumber },
    create: { contractNumber, ...fields },
    update: { ...fields },
  });
}

// Re-applies a contract's saved manual fields the moment its Contract row is
// (re)created — e.g. by the folder sync recreating a stub for a contract that
// was previously deleted. Without this, CTS/zonal research done before a
// delete+recreate cycle would silently disappear.
export async function applyManualOverrideIfAny(contractId: string, contractNumber: string): Promise<void> {
  const override = await prisma.contractManualOverride.findUnique({ where: { contractNumber } });
  if (!override) return;
  await prisma.contract.update({
    where: { id: contractId },
    data: {
      ctsNotaryDate: override.ctsNotaryDate,
      sqmUnit: override.sqmUnit,
      sqmParking: override.sqmParking,
      sqmStorage: override.sqmStorage,
      zonalValuePerSqmUnit: override.zonalValuePerSqmUnit,
      zonalValuePerSqmParking: override.zonalValuePerSqmParking,
      matchedRptRecordId: override.matchedRptRecordId,
      matchedParkingRptRecordId: override.matchedParkingRptRecordId,
      matchedStorageRptRecordId: override.matchedStorageRptRecordId,
      notes: override.notes,
    },
  });
}
