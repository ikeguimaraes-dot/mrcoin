-- CreateEnum
CREATE TYPE "SpinStatus" AS ENUM ('PENDING', 'REDEEMED', 'EXPIRED');

-- AlterEnum
ALTER TYPE "LedgerReferenceType" ADD VALUE 'SPIN';

-- CreateTable
CREATE TABLE "SpinGrant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpinGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Spin" (
    "id" TEXT NOT NULL,
    "spinGrantId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "reservedBatchId" TEXT NOT NULL,
    "status" "SpinStatus" NOT NULL DEFAULT 'PENDING',
    "sectorIndex" INTEGER,
    "coinsAwarded" INTEGER,
    "ledgerEntryId" TEXT,
    "redeemIdempotencyKey" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "redeemedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Spin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpinGrant_idempotencyKey_key" ON "SpinGrant"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SpinGrant_organizationId_idx" ON "SpinGrant"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Spin_ledgerEntryId_key" ON "Spin"("ledgerEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "Spin_redeemIdempotencyKey_key" ON "Spin"("redeemIdempotencyKey");

-- CreateIndex
CREATE INDEX "Spin_membershipId_status_expiresAt_idx" ON "Spin"("membershipId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "Spin_reservedBatchId_idx" ON "Spin"("reservedBatchId");

-- AddForeignKey
ALTER TABLE "SpinGrant" ADD CONSTRAINT "SpinGrant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpinGrant" ADD CONSTRAINT "SpinGrant_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpinGrant" ADD CONSTRAINT "SpinGrant_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Spin" ADD CONSTRAINT "Spin_spinGrantId_fkey" FOREIGN KEY ("spinGrantId") REFERENCES "SpinGrant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Spin" ADD CONSTRAINT "Spin_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Spin" ADD CONSTRAINT "Spin_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Spin" ADD CONSTRAINT "Spin_reservedBatchId_fkey" FOREIGN KEY ("reservedBatchId") REFERENCES "CoinBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
