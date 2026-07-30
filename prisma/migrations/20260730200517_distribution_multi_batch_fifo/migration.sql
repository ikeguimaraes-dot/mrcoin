-- AlterTable
ALTER TABLE "DistributionItem" DROP COLUMN "ledgerEntryId";

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN     "distributionItemId" TEXT;

-- CreateIndex
CREATE INDEX "LedgerEntry_distributionItemId_idx" ON "LedgerEntry"("distributionItemId");

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_distributionItemId_fkey" FOREIGN KEY ("distributionItemId") REFERENCES "DistributionItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

