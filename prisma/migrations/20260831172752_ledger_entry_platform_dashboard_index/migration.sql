-- CreateIndex
CREATE INDEX "LedgerEntry_type_referenceType_createdAt_idx" ON "LedgerEntry"("type", "referenceType", "createdAt");
