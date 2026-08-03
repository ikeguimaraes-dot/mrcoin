import { Body, Controller, HttpCode, HttpStatus, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminRole } from '@prisma/client';
import { Request } from 'express';
import { AdminAuth } from '../../common/decorators/admin-auth.decorator';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AdminJwtPayload } from '../../common/guards/jwt-payload.types';
import { AdminInvitesService } from './admin-invites.service';
import { RequestMeta } from '../auth/token.service';
import { InviteAdminDto, inviteAdminSchema } from './dto/invite-admin.schema';
import { AcceptInviteDto, acceptInviteSchema } from './dto/accept-invite.schema';
import { ChangeRoleDto, changeRoleSchema } from './dto/change-role.schema';

function requestMeta(request: Request): RequestMeta {
  return { ip: request.ip, userAgent: request.headers['user-agent'] };
}

function toCallerIdentity(admin: AdminJwtPayload) {
  return { id: admin.sub, organizationId: admin.organizationId, role: admin.role };
}

@ApiTags('organizations')
@Controller('organizations/admins')
export class AdminInvitesController {
  constructor(private readonly adminInvitesService: AdminInvitesService) {}

  @Post('invites')
  @AdminAuth(AdminRole.MANAGER)
  @AuditAction('ADMIN_INVITE_CREATED')
  @ApiOperation({ summary: 'Convida um novo AdminUser pra organização do chamador' })
  invite(
    @CurrentAdmin() admin: AdminJwtPayload,
    @Body(new ZodValidationPipe(inviteAdminSchema)) body: InviteAdminDto,
  ) {
    return this.adminInvitesService.invite(toCallerIdentity(admin), body);
  }

  @Post('invites/:token/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Aceita um convite e define a senha — cria o AdminUser. Pra OWNER/MANAGER devolve ' +
      'MFA_SETUP_REQUIRED em vez de sessão (MFA é obrigatório antes de qualquer token válido).',
  })
  accept(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(acceptInviteSchema)) body: AcceptInviteDto,
    @Req() request: Request,
  ) {
    return this.adminInvitesService.accept(token, body, requestMeta(request));
  }

  @Patch(':id/role')
  @AdminAuth(AdminRole.OWNER)
  @AuditAction('ADMIN_ROLE_CHANGED')
  @ApiOperation({ summary: 'Troca o papel de um AdminUser da organização (somente OWNER)' })
  changeRole(
    @CurrentAdmin() admin: AdminJwtPayload,
    @Param('id') targetAdminId: string,
    @Body(new ZodValidationPipe(changeRoleSchema)) body: ChangeRoleDto,
  ) {
    return this.adminInvitesService.changeRole(toCallerIdentity(admin), targetAdminId, body);
  }

  @Patch(':id/deactivate')
  @AdminAuth(AdminRole.MANAGER)
  @AuditAction('ADMIN_DEACTIVATED')
  @ApiOperation({ summary: 'Desativa um AdminUser de rank inferior ao do chamador' })
  deactivate(@CurrentAdmin() admin: AdminJwtPayload, @Param('id') targetAdminId: string) {
    return this.adminInvitesService.deactivate(toCallerIdentity(admin), targetAdminId);
  }
}
