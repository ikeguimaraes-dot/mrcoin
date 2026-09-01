/*
  Warnings:

  - You are about to drop the column `externalRef` on the `UserSignupRequest` table. All the data in the column will be lost.
  - You are about to drop the column `membershipType` on the `UserSignupRequest` table. All the data in the column will be lost.
  - You are about to drop the column `organizationId` on the `UserSignupRequest` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "UserSignupRequest" DROP CONSTRAINT "UserSignupRequest_organizationId_fkey";

-- AlterTable
ALTER TABLE "UserSignupRequest" DROP COLUMN "externalRef",
DROP COLUMN "membershipType",
DROP COLUMN "organizationId";
