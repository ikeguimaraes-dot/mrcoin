import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlatformAdminAuth } from '../decorators/platform-admin-auth.decorator';
import { PlatformDashboardService } from './platform-dashboard.service';
import { PlatformDashboardResponseDto } from './dto/platform-dashboard-response.schema';

@ApiTags('platform-dashboard')
@Controller('platform/dashboard')
export class PlatformDashboardController {
  constructor(private readonly dashboardService: PlatformDashboardService) {}

  @Get()
  @PlatformAdminAuth()
  @ApiOperation({ summary: 'Visão consolidada da plataforma inteira — cards, séries mensais, rankings e atividade recente' })
  @ApiOkResponse({ type: PlatformDashboardResponseDto })
  getDashboard() {
    return this.dashboardService.getDashboard();
  }
}
