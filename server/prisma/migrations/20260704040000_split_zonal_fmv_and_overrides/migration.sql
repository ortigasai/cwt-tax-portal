-- Split zonal value / FMV match by unit vs parking classification, and add a
-- persistent manual-override shadow table so CTS/zonal research survives a
-- contract being deleted and recreated by the folder sync.

ALTER TABLE "Contract" ADD COLUMN "zonalValuePerSqmParking" DECIMAL(18,2);
ALTER TABLE "Contract" ADD COLUMN "matchedParkingRptRecordId" TEXT;
ALTER TABLE "Contract"
  ADD CONSTRAINT "Contract_matchedParkingRptRecordId_fkey"
  FOREIGN KEY ("matchedParkingRptRecordId") REFERENCES "RptTowerRecord"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: for contracts with no unit sqm (parking-only units, e.g. Maven
-- 2000000004280), the existing zonalValuePerSqm value was entered as that
-- unit's own rate — which for a parking-only contract IS the parking rate.
-- Move it to the new parking column so it lines up with the split.
UPDATE "Contract"
SET "zonalValuePerSqmParking" = "zonalValuePerSqm",
    "zonalValuePerSqm" = NULL
WHERE "sqmUnit" IS NULL AND "sqmParking" IS NOT NULL AND "zonalValuePerSqm" IS NOT NULL;

CREATE TABLE "ContractManualOverride" (
    "contractNumber" TEXT NOT NULL,
    "ctsNotaryDate" TIMESTAMP(3),
    "sqmUnit" DECIMAL(10,2),
    "sqmParking" DECIMAL(10,2),
    "zonalValuePerSqmUnit" DECIMAL(18,2),
    "zonalValuePerSqmParking" DECIMAL(18,2),
    "matchedRptRecordId" TEXT,
    "matchedParkingRptRecordId" TEXT,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContractManualOverride_pkey" PRIMARY KEY ("contractNumber")
);

-- Seed the override table from whatever manual data already exists on
-- Contract rows today, so existing work (2661, 4280, 11021) is protected
-- going forward without having to re-enter it.
INSERT INTO "ContractManualOverride" (
  "contractNumber", "ctsNotaryDate", "sqmUnit", "sqmParking",
  "zonalValuePerSqmUnit", "zonalValuePerSqmParking",
  "matchedRptRecordId", "matchedParkingRptRecordId", "notes", "updatedAt"
)
SELECT "contractNumber", "ctsNotaryDate", "sqmUnit", "sqmParking",
       "zonalValuePerSqm", "zonalValuePerSqmParking",
       "matchedRptRecordId", "matchedParkingRptRecordId", "notes", now()
FROM "Contract"
WHERE "ctsNotaryDate" IS NOT NULL OR "sqmUnit" IS NOT NULL OR "sqmParking" IS NOT NULL
   OR "zonalValuePerSqm" IS NOT NULL OR "zonalValuePerSqmParking" IS NOT NULL
   OR "matchedRptRecordId" IS NOT NULL OR "notes" IS NOT NULL;
