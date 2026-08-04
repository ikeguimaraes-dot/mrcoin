-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "costInCoins" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "perUserLimit" INTEGER,
ADD COLUMN     "validFrom" TIMESTAMP(3),
ADD COLUMN     "validUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Partner" ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactPhone" TEXT;
