import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthService, HealthStatus } from './health.service';
import { HealthResponseDto } from './dto/health-response.schema';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Status da API e da conexão com o banco' })
  @ApiOkResponse({ type: HealthResponseDto, description: 'API e banco operacionais ou com falha reportada' })
  async check(): Promise<HealthStatus> {
    return this.healthService.check();
  }
}
