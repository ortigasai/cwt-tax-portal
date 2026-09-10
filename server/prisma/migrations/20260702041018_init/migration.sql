-- CreateEnum
CREATE TYPE "ImportType" AS ENUM ('CONTRACT_LIST', 'CUSTOMER_LEDGER', 'OCLP_1606_SUMMARY', 'RPT_ALL_TOWERS');

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "contractNumber" TEXT NOT NULL,
    "buyerName" TEXT,
    "estate" TEXT,
    "tower" TEXT,
    "unit" TEXT,
    "totalTCP" DECIMAL(18,2),
    "netTCP" DECIMAL(18,2),
    "ctsNotaryDate" TIMESTAMP(3),
    "sqmUnit" DECIMAL(10,2),
    "sqmParking" DECIMAL(10,2),
    "ctsFileName" TEXT,
    "zonalValuePerSqm" DECIMAL(18,2),
    "matchedRptRecordId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRecord" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "baselineDate" TIMESTAMP(3),
    "paymentDate" TIMESTAMP(3),
    "totalCollection" DECIMAL(18,2),
    "clearingDocument" TEXT,
    "orNumber" TEXT,
    "paymentPrincipal" DECIMAL(18,2),
    "paymentVat" DECIMAL(18,2),
    "isSubtotal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CwtCollectionEvent" (
    "id" TEXT NOT NULL,
    "contractId" TEXT,
    "contractNumberRaw" TEXT NOT NULL,
    "buyerClassification" TEXT,
    "taxTagging" TEXT,
    "sourceTaxBase" DECIMAL(18,2),
    "sourceRate" DECIMAL(6,4),
    "actualTaxDue" DECIMAL(18,2),
    "transactionDate" TIMESTAMP(3),
    "datePaid" TIMESTAMP(3),
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CwtCollectionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RptTowerRecord" (
    "id" TEXT NOT NULL,
    "tower" TEXT NOT NULL,
    "type" TEXT,
    "floor" TEXT,
    "unit" TEXT NOT NULL,
    "cct" TEXT,
    "taxDeclarationNumber" TEXT,
    "fairMarketValue" DECIMAL(18,2) NOT NULL,
    "estate" TEXT,

    CONSTRAINT "RptTowerRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZonalValueDocument" (
    "id" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "rdo" TEXT,
    "title" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZonalValueDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "type" "ImportType" NOT NULL,
    "filename" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Contract_contractNumber_key" ON "Contract"("contractNumber");

-- CreateIndex
CREATE INDEX "PaymentRecord_contractId_idx" ON "PaymentRecord"("contractId");

-- CreateIndex
CREATE INDEX "CwtCollectionEvent_contractId_idx" ON "CwtCollectionEvent"("contractId");

-- CreateIndex
CREATE INDEX "CwtCollectionEvent_contractNumberRaw_idx" ON "CwtCollectionEvent"("contractNumberRaw");

-- CreateIndex
CREATE INDEX "RptTowerRecord_tower_unit_idx" ON "RptTowerRecord"("tower", "unit");

-- CreateIndex
CREATE UNIQUE INDEX "ZonalValueDocument_region_sourceUrl_key" ON "ZonalValueDocument"("region", "sourceUrl");

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_matchedRptRecordId_fkey" FOREIGN KEY ("matchedRptRecordId") REFERENCES "RptTowerRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CwtCollectionEvent" ADD CONSTRAINT "CwtCollectionEvent_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
