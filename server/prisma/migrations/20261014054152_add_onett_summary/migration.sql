-- CreateTable
CREATE TABLE "OnettSummary" (
    "id" SERIAL NOT NULL,
    "title" TEXT,
    "files" JSONB NOT NULL DEFAULT '[]',
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "statusNote" TEXT,
    "accounts" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnettSummary_pkey" PRIMARY KEY ("id")
);
