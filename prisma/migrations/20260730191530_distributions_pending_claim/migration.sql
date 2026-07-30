-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'PENDING_CLAIM');

-- AlterTable
ALTER TABLE "Distribution" ADD COLUMN     "idempotencyKey" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE UNIQUE INDEX "Distribution_idempotencyKey_key" ON "Distribution"("idempotencyKey");

