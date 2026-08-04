-- DropForeignKey
ALTER TABLE "UserSignupRequest" DROP CONSTRAINT "UserSignupRequest_organizationId_fkey";

-- DropIndex
DROP INDEX "UserSignupRequest_cpfHash_organizationId_idx";

-- AlterTable
ALTER TABLE "UserSignupRequest" ALTER COLUMN "organizationId" DROP NOT NULL,
ALTER COLUMN "membershipType" DROP NOT NULL;

-- CreateTable
CREATE TABLE "UserRefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "replacedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "UserRefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserRefreshToken_tokenHash_key" ON "UserRefreshToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "UserRefreshToken_replacedById_key" ON "UserRefreshToken"("replacedById");

-- CreateIndex
CREATE INDEX "UserRefreshToken_userId_idx" ON "UserRefreshToken"("userId");

-- CreateIndex
CREATE INDEX "UserRefreshToken_family_idx" ON "UserRefreshToken"("family");

-- CreateIndex
CREATE INDEX "UserSignupRequest_cpfHash_idx" ON "UserSignupRequest"("cpfHash");

-- AddForeignKey
ALTER TABLE "UserRefreshToken" ADD CONSTRAINT "UserRefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSignupRequest" ADD CONSTRAINT "UserSignupRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
