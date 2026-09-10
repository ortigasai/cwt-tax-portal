-- AlterTable
ALTER TABLE "CwtCollectionEvent" ADD COLUMN     "baseContract" TEXT;

-- CreateIndex
CREATE INDEX "CwtCollectionEvent_baseContract_idx" ON "CwtCollectionEvent"("baseContract");
