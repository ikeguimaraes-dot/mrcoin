-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('ADMIN', 'SYSTEM');

-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_actorAdminUserId_fkey";

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "actorType" "AuditActorType" NOT NULL DEFAULT 'ADMIN',
ALTER COLUMN "actorAdminUserId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "CoinBatch" ADD COLUMN     "idempotencyKey" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "asaasCustomerId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CoinBatch_pspChargeId_key" ON "CoinBatch"("pspChargeId");

-- CreateIndex
CREATE UNIQUE INDEX "CoinBatch_idempotencyKey_key" ON "CoinBatch"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_asaasCustomerId_key" ON "Organization"("asaasCustomerId");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorAdminUserId_fkey" FOREIGN KEY ("actorAdminUserId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

