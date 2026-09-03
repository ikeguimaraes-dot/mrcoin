-- AlterEnum
ALTER TYPE "BatchStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "CoinBatch" ADD COLUMN     "approvedByPlatformAdminId" TEXT,
ADD COLUMN     "rejectedByPlatformAdminId" TEXT,
ADD COLUMN     "rejectionReason" TEXT;
