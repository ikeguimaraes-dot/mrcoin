-- CreateIndex
CREATE INDEX "LedgerEntry_walletId_type_referenceType_createdAt_idx" ON "LedgerEntry"("walletId", "type", "referenceType", "createdAt");
