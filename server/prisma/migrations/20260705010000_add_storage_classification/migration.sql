-- Add a third "Storage" classification alongside Unit and Parking — a single
-- Contract to Sell commonly bundles a unit, a storage room, and a parking
-- slot as three separately BIR-valued line items.

ALTER TABLE "Contract" ADD COLUMN "sqmStorage" DECIMAL(10,2);
ALTER TABLE "Contract" ADD COLUMN "zonalValuePerSqmStorage" DECIMAL(18,2);
ALTER TABLE "Contract" ADD COLUMN "matchedStorageRptRecordId" TEXT;
ALTER TABLE "Contract"
  ADD CONSTRAINT "Contract_matchedStorageRptRecordId_fkey"
  FOREIGN KEY ("matchedStorageRptRecordId") REFERENCES "RptTowerRecord"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContractManualOverride" ADD COLUMN "sqmStorage" DECIMAL(10,2);
ALTER TABLE "ContractManualOverride" ADD COLUMN "zonalValuePerSqmStorage" DECIMAL(18,2);
ALTER TABLE "ContractManualOverride" ADD COLUMN "matchedStorageRptRecordId" TEXT;

-- Data correction: contract 2000000011021's CTS (The Glaston Tower, 7th
-- Floor, Unit SF-A) is explicitly a "Storage" unit type (verified by reading
-- the actual CTS PDF), not a general Unit. Its 9.32 sqm was recorded under
-- sqmUnit before this classification existed — move it to sqmStorage in both
-- the live Contract row and its manual-override shadow (so a future
-- delete+resync doesn't put it back under sqmUnit).
UPDATE "Contract"
SET "sqmStorage" = "sqmUnit", "sqmUnit" = NULL
WHERE "contractNumber" = '2000000011021' AND "sqmUnit" IS NOT NULL;

UPDATE "ContractManualOverride"
SET "sqmStorage" = "sqmUnit", "sqmUnit" = NULL
WHERE "contractNumber" = '2000000011021' AND "sqmUnit" IS NOT NULL;
