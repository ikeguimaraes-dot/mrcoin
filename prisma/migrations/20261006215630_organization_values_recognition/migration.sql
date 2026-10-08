-- AlterTable
ALTER TABLE "Distribution" ADD COLUMN     "message" TEXT,
ADD COLUMN     "organizationValueId" TEXT;

-- CreateTable
CREATE TABLE "OrganizationValue" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrganizationValue_organizationId_isActive_sortOrder_idx" ON "OrganizationValue"("organizationId", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationValue_organizationId_name_key" ON "OrganizationValue"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Distribution_organizationValueId_idx" ON "Distribution"("organizationValueId");

-- AddForeignKey
ALTER TABLE "Distribution" ADD CONSTRAINT "Distribution_organizationValueId_fkey" FOREIGN KEY ("organizationValueId") REFERENCES "OrganizationValue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationValue" ADD CONSTRAINT "OrganizationValue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
