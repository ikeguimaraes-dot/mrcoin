import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserJwtGuard } from '../../common/guards/user-jwt.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserJwtPayload } from '../../common/guards/jwt-payload.types';
import { MeService } from './me.service';
import { MeResponseDto } from './dto/me-response.schema';

@ApiTags('users')
@Controller('users/me')
@UseGuards(UserJwtGuard)
export class MeController {
  constructor(private readonly meService: MeService) {}

  @Get()
  @ApiOperation({ summary: 'Dados do usuário autenticado — nome, e-mail, CPF mascarado, preferência de notificação' })
  @ApiOkResponse({ type: MeResponseDto })
  getMe(@CurrentUser() user: UserJwtPayload) {
    return this.meService.getMe(user.sub);
  }
}
