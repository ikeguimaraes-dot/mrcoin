-- DropForeignKey
ALTER TABLE "AdminInvite" DROP CONSTRAINT "AdminInvite_invitedByAdminUserId_fkey";

-- AlterTable
ALTER TABLE "AdminInvite" ALTER COLUMN "invitedByAdminUserId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "AdminInvite" ADD CONSTRAINT "AdminInvite_invitedByAdminUserId_fkey" FOREIGN KEY ("invitedByAdminUserId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

