import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserJwtGuard } from '../../common/guards/user-jwt.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { UserJwtPayload } from '../../common/guards/jwt-payload.types';
import { RankingService } from './ranking.service';
import { RankingQueryDto, rankingQuerySchema } from './dto/ranking-query.schema';
import { RankingResponseDto } from './dto/ranking-response.schema';

@ApiTags('wallets')
@Controller('ranking')
@UseGuards(UserJwtGuard)
export class RankingController {
  constructor(private readonly rankingService: RankingService) {}

  @Get('consent')
  getConsent(@CurrentUser() user: UserJwtPayload, @Query(new ZodValidationPipe(rankingQuerySchema)) query: RankingQueryDto) {
    return this.rankingService.getConsent(user.sub, query.organizationId);
  }

  @Put('consent')
  setConsent(@CurrentUser() user: UserJwtPayload, @Query(new ZodValidationPipe(rankingQuerySchema)) query: RankingQueryDto,
    @Body(new ZodValidationPipe(z.object({ rankingConsent: z.boolean() }))) body: { rankingConsent: boolean }) {
    return this.rankingService.setConsent(user.sub, query.organizationId, body.rankingConsent);
  }

  @Get()
  @ApiOperation({ summary: 'Top 10 de coins ganhos por distribuição no mês (ou período informado) na organização' })
  @ApiOkResponse({ type: RankingResponseDto })
  getRanking(@CurrentUser() user: UserJwtPayload, @Query(new ZodValidationPipe(rankingQuerySchema)) query: RankingQueryDto) {
    return this.rankingService.getRanking(user.sub, query.organizationId, query.period);
  }
}
