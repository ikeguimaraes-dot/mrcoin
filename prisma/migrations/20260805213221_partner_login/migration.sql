-- AlterTable
ALTER TABLE "Partner" ADD COLUMN     "passwordHash" TEXT;

-- CreateTable
CREATE TABLE "PartnerRefreshToken" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "replacedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "PartnerRefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerRefreshToken_tokenHash_key" ON "PartnerRefreshToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerRefreshToken_replacedById_key" ON "PartnerRefreshToken"("replacedById");

-- CreateIndex
CREATE INDEX "PartnerRefreshToken_partnerId_idx" ON "PartnerRefreshToken"("partnerId");

-- CreateIndex
CREATE INDEX "PartnerRefreshToken_family_idx" ON "PartnerRefreshToken"("family");

-- AddForeignKey
ALTER TABLE "PartnerRefreshToken" ADD CONSTRAINT "PartnerRefreshToken_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
