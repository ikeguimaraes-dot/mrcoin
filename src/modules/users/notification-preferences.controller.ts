import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserJwtGuard } from '../../common/guards/user-jwt.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { UserJwtPayload } from '../../common/guards/jwt-payload.types';
import { NotificationPreferencesService } from './notification-preferences.service';
import {
  NotificationPreferencesResponseDto,
  UpdateNotificationPreferencesDto,
  updateNotificationPreferencesSchema,
} from './dto/notification-preferences.schema';

@ApiTags('users')
@Controller('users/me/notification-preferences')
@UseGuards(UserJwtGuard)
export class NotificationPreferencesController {
  constructor(private readonly notificationPreferencesService: NotificationPreferencesService) {}

  @Get()
  @ApiOperation({ summary: 'Preferência de notificação do usuário autenticado' })
  @ApiOkResponse({ type: NotificationPreferencesResponseDto })
  get(@CurrentUser() user: UserJwtPayload) {
    return this.notificationPreferencesService.get(user.sub);
  }

  @Patch()
  @ApiOperation({ summary: 'Atualiza a preferência de notificação do usuário autenticado' })
  @ApiOkResponse({ type: NotificationPreferencesResponseDto })
  update(
    @CurrentUser() user: UserJwtPayload,
    @Body(new ZodValidationPipe(updateNotificationPreferencesSchema)) body: UpdateNotificationPreferencesDto,
  ) {
    return this.notificationPreferencesService.update(user.sub, body);
  }
}
