-- DropIndex
DROP INDEX "ConversionRate_createdAt_idx";

-- AlterTable
ALTER TABLE "ConversionRate" ADD COLUMN     "organizationId" TEXT;

-- CreateIndex
CREATE INDEX "ConversionRate_organizationId_createdAt_idx" ON "ConversionRate"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "ConversionRate" ADD CONSTRAINT "ConversionRate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: toda organização existente ganha sua própria linha de taxa, copiando o valor da
-- taxa global mais recente (as linhas antigas com organizationId NULL ficam órfãs, história
-- preservada). Id determinístico — sem depender de extensão de geração de UUID no Postgres.
INSERT INTO "ConversionRate" ("id", "organizationId", "coinsPerRealScaled", "createdAt")
SELECT
  'seed-org-rate-' || o."id",
  o."id",
  (SELECT "coinsPerRealScaled" FROM "ConversionRate" WHERE "organizationId" IS NULL ORDER BY "createdAt" DESC LIMIT 1),
  CURRENT_TIMESTAMP
FROM "Organization" o;
