import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { AdminInvitesController } from './admin-invites.controller';
import { AdminInvitesService } from './admin-invites.service';
import { AuditLogController } from './audit-log.controller';
import { AuditLogService } from './audit-log.service';

@Module({
  imports: [AuthModule],
  controllers: [OrganizationsController, AdminInvitesController, AuditLogController],
  providers: [OrganizationsService, AdminInvitesService, AuditLogService],
})
export class OrganizationsModule {}
