-- Contracts the user deleted; the folder sync will not recreate these.
CREATE TABLE "SuppressedContract" (
    "contractNumber" TEXT NOT NULL,
    "suppressedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SuppressedContract_pkey" PRIMARY KEY ("contractNumber")
);
