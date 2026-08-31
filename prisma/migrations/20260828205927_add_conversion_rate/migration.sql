-- CreateTable
CREATE TABLE "ConversionRate" (
    "id" TEXT NOT NULL,
    "coinsPerRealScaled" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversionRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversionRate_createdAt_idx" ON "ConversionRate"("createdAt");

-- Semeia a primeira taxa (1,25 coins por R$1,00) — sem isso, POST /admin/batches ficaria
-- sem taxa nenhuma pra ler até alguém chamar PATCH /platform/settings/conversion-rate.
INSERT INTO "ConversionRate" ("id", "coinsPerRealScaled", "createdAt")
VALUES ('seed-conversion-rate-initial', 125, CURRENT_TIMESTAMP);
