import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminAuth } from '../../common/decorators/admin-auth.decorator';
import { TenantOrganizationId } from '../../common/decorators/tenant-organization-id.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { DASHBOARD_TIMESERIES_DEFAULT_DAYS } from './dashboard.constants';
import { DashboardService } from './dashboard.service';
import {
  DashboardTimeseriesQueryDto,
  dashboardTimeseriesQuerySchema,
} from './dto/dashboard-timeseries-query.schema';
import { DashboardSummaryResponseDto, DashboardTimeseriesResponseDto } from './dto/dashboard-response.schema';

@ApiTags('dashboard')
@Controller('admin/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  @AdminAuth()
  @ApiOperation({ summary: 'Saldo disponível, saldo em circulação e resgatado no mês corrente' })
  @ApiOkResponse({ type: DashboardSummaryResponseDto })
  getSummary(@TenantOrganizationId() organizationId: string) {
    return this.dashboardService.getSummary(organizationId);
  }

  @Get('timeseries')
  @AdminAuth()
  @ApiOperation({ summary: 'Série diária de coins emitidos e resgatados nos últimos N dias' })
  @ApiOkResponse({ type: DashboardTimeseriesResponseDto })
  getTimeseries(
    @TenantOrganizationId() organizationId: string,
    @Query(new ZodValidationPipe(dashboardTimeseriesQuerySchema)) query: DashboardTimeseriesQueryDto,
  ) {
    return this.dashboardService.getTimeseries(
      organizationId,
      query.days ?? DASHBOARD_TIMESERIES_DEFAULT_DAYS,
    );
  }
}
