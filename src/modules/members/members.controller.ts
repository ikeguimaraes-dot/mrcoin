import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminAuth } from '../../common/decorators/admin-auth.decorator';
import { TenantOrganizationId } from '../../common/decorators/tenant-organization-id.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { MembersService } from './members.service';
import { ListMembersQueryDto, listMembersQuerySchema } from './dto/list-members-query.schema';
import {
  ListMemberEntriesQueryDto,
  listMemberEntriesQuerySchema,
} from './dto/list-member-entries-query.schema';
import { ListMembersResponseDto, MemberResponseDto } from './dto/member-response.schema';
import { LedgerEntryListResponseDto } from '../ledger/dto/ledger-entry-response.schema';

@ApiTags('members')
@Controller('admin/members')
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @Get()
  @AdminAuth()
  @ApiOperation({ summary: 'Diretório paginado de membros da organização, com filtro opcional por CPF' })
  @ApiOkResponse({ type: ListMembersResponseDto })
  listMembers(
    @TenantOrganizationId() organizationId: string,
    @Query(new ZodValidationPipe(listMembersQuerySchema)) query: ListMembersQueryDto,
  ) {
    return this.membersService.listMembers(organizationId, query);
  }

  @Get(':membershipId')
  @AdminAuth()
  @ApiOperation({ summary: 'Detalhe de um membro da organização do chamador' })
  @ApiOkResponse({ type: MemberResponseDto })
  getMember(@TenantOrganizationId() organizationId: string, @Param('membershipId') membershipId: string) {
    return this.membersService.getMember(organizationId, membershipId);
  }

  @Get(':membershipId/entries')
  @AdminAuth()
  @ApiOperation({ summary: 'Extrato paginado da carteira de um membro' })
  @ApiOkResponse({ type: LedgerEntryListResponseDto })
  getMemberEntries(
    @TenantOrganizationId() organizationId: string,
    @Param('membershipId') membershipId: string,
    @Query(new ZodValidationPipe(listMemberEntriesQuerySchema)) query: ListMemberEntriesQueryDto,
  ) {
    return this.membersService.getMemberEntries(organizationId, membershipId, query);
  }
}
