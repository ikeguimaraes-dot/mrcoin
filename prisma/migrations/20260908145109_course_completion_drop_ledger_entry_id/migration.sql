/*
  Warnings:

  - You are about to drop the column `ledgerEntryId` on the `CourseCompletion` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "CourseCompletion_ledgerEntryId_key";

-- AlterTable
ALTER TABLE "CourseCompletion" DROP COLUMN "ledgerEntryId";
