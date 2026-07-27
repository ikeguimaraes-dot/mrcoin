import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserJwtGuard } from '../../common/guards/user-jwt.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { UserJwtPayload } from '../../common/guards/jwt-payload.types';
import { DevicesService } from './devices.service';
import { RegisterDeviceInput, registerDeviceSchema } from './dto/register-device.schema';

@ApiTags('users')
@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Post()
  @UseGuards(UserJwtGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Registra (ou atualiza) o device do usuário autenticado — upsert por fingerprint' })
  register(
    @CurrentUser() user: UserJwtPayload,
    @Body(new ZodValidationPipe(registerDeviceSchema)) body: RegisterDeviceInput,
  ) {
    return this.devicesService.register(user.sub, body);
  }
}
