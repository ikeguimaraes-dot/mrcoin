-- CreateEnum
CREATE TYPE "PlatformAdminStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "PlatformAdmin" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "status" "PlatformAdminStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAdminRefreshToken" (
    "id" TEXT NOT NULL,
    "platformAdminId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "replacedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "PlatformAdminRefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAdminAuditLog" (
    "id" TEXT NOT NULL,
    "platformAdminId" TEXT,
    "action" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "ip" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAdmin_email_key" ON "PlatformAdmin"("email");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAdminRefreshToken_tokenHash_key" ON "PlatformAdminRefreshToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAdminRefreshToken_replacedById_key" ON "PlatformAdminRefreshToken"("replacedById");

-- CreateIndex
CREATE INDEX "PlatformAdminRefreshToken_platformAdminId_idx" ON "PlatformAdminRefreshToken"("platformAdminId");

-- CreateIndex
CREATE INDEX "PlatformAdminRefreshToken_family_idx" ON "PlatformAdminRefreshToken"("family");

-- CreateIndex
CREATE INDEX "PlatformAdminAuditLog_platformAdminId_createdAt_idx" ON "PlatformAdminAuditLog"("platformAdminId", "createdAt");

-- AddForeignKey
ALTER TABLE "PlatformAdminRefreshToken" ADD CONSTRAINT "PlatformAdminRefreshToken_platformAdminId_fkey" FOREIGN KEY ("platformAdminId") REFERENCES "PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformAdminAuditLog" ADD CONSTRAINT "PlatformAdminAuditLog_platformAdminId_fkey" FOREIGN KEY ("platformAdminId") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
