import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminAuth } from '../../common/decorators/admin-auth.decorator';
import { TenantOrganizationId } from '../../common/decorators/tenant-organization-id.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { MembersService } from './members.service';
import { ListMembersQuery, listMembersQuerySchema } from './dto/list-members-query.schema';
import {
  ListMemberEntriesQuery,
  listMemberEntriesQuerySchema,
} from './dto/list-member-entries-query.schema';

@ApiTags('members')
@Controller('admin/members')
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @Get()
  @AdminAuth()
  @ApiOperation({ summary: 'Diretório paginado de membros da organização, com filtro opcional por CPF' })
  listMembers(
    @TenantOrganizationId() organizationId: string,
    @Query(new ZodValidationPipe(listMembersQuerySchema)) query: ListMembersQuery,
  ) {
    return this.membersService.listMembers(organizationId, query);
  }

  @Get(':membershipId')
  @AdminAuth()
  @ApiOperation({ summary: 'Detalhe de um membro da organização do chamador' })
  getMember(@TenantOrganizationId() organizationId: string, @Param('membershipId') membershipId: string) {
    return this.membersService.getMember(organizationId, membershipId);
  }

  @Get(':membershipId/entries')
  @AdminAuth()
  @ApiOperation({ summary: 'Extrato paginado da carteira de um membro' })
  getMemberEntries(
    @TenantOrganizationId() organizationId: string,
    @Param('membershipId') membershipId: string,
    @Query(new ZodValidationPipe(listMemberEntriesQuerySchema)) query: ListMemberEntriesQuery,
  ) {
    return this.membersService.getMemberEntries(organizationId, membershipId, query);
  }
}
