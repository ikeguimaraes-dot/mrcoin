-- AlterTable
ALTER TABLE "DistributionItem" ADD COLUMN     "cpfEncrypted" TEXT,
ADD COLUMN     "cpfHash" TEXT,
ADD COLUMN     "externalRef" TEXT,
ADD COLUMN     "membershipType" "MembershipType",
ADD COLUMN     "name" TEXT;

