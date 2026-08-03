import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserJwtGuard } from '../../common/guards/user-jwt.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserJwtPayload } from '../../common/guards/jwt-payload.types';
import { MembershipsService } from './memberships.service';
import { MembershipListResponseDto } from './dto/membership-list-response.schema';

@ApiTags('wallets')
@Controller('memberships')
@UseGuards(UserJwtGuard)
export class MembershipsController {
  constructor(private readonly membershipsService: MembershipsService) {}

  @Get()
  @ApiOperation({ summary: 'Organizações e saldos do usuário autenticado — pra escolher qual carteira ver' })
  @ApiOkResponse({ type: MembershipListResponseDto })
  listMemberships(@CurrentUser() user: UserJwtPayload) {
    return this.membershipsService.listMemberships(user.sub);
  }
}
