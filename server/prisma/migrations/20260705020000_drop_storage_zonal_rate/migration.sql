-- Storage never has its own BIR zonal rate — per the tax team, a storage
-- room always carries the same rate as its unit (both fall under the same
-- RC/CC schedule row). Drop the now-redundant column; computation.ts reuses
-- zonalValuePerSqmUnit for storage's sqm going forward.
ALTER TABLE "Contract" DROP COLUMN "zonalValuePerSqmStorage";
ALTER TABLE "ContractManualOverride" DROP COLUMN "zonalValuePerSqmStorage";
