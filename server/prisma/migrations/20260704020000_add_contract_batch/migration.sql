-- Add upload-batch reference to contracts and import batches.
ALTER TABLE "Contract" ADD COLUMN "batchNumber" INTEGER;
ALTER TABLE "Contract" ADD COLUMN "batchDate" TIMESTAMP(3);
ALTER TABLE "ImportBatch" ADD COLUMN "batchNumber" INTEGER;

-- Backfill existing contracts: contracts created within the same second are
-- treated as one upload batch; batches are numbered by creation order.
UPDATE "Contract" c
SET "batchNumber" = r.bn,
    "batchDate" = date_trunc('second', c."createdAt")
FROM (
  SELECT id, DENSE_RANK() OVER (ORDER BY date_trunc('second', "createdAt")) AS bn
  FROM "Contract"
) r
WHERE c.id = r.id;

-- Backfill CONTRACT_LIST import batches with a sequential number by upload time.
UPDATE "ImportBatch" b
SET "batchNumber" = r.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "importedAt") AS rn
  FROM "ImportBatch" WHERE "type" = 'CONTRACT_LIST'
) r
WHERE b.id = r.id;
