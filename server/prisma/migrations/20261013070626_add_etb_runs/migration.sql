-- CreateTable
CREATE TABLE "EtbRun" (
    "id" SERIAL NOT NULL,
    "title" TEXT,
    "filename" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "contractNumbers" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EtbRun_pkey" PRIMARY KEY ("id")
);
