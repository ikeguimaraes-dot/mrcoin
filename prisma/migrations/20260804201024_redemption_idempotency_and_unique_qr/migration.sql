-- AlterTable
ALTER TABLE "Redemption" ADD COLUMN     "idempotencyKey" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Redemption_qrPayload_key" ON "Redemption"("qrPayload");

-- CreateIndex
CREATE UNIQUE INDEX "Redemption_idempotencyKey_key" ON "Redemption"("idempotencyKey");
