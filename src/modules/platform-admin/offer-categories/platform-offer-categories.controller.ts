import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { PlatformAdminJwtPayload } from '../../../common/guards/jwt-payload.types';
import { CurrentPlatformAdmin } from '../decorators/current-platform-admin.decorator';
import { PlatformAdminAuth } from '../decorators/platform-admin-auth.decorator';
import {
  CreateOfferCategoryDto,
  createOfferCategorySchema,
  ListOfferCategoriesQueryDto,
  listOfferCategoriesQuerySchema,
  OfferCategoryListResponseDto,
  OfferCategoryResponseDto,
  UpdateOfferCategoryDto,
  updateOfferCategorySchema,
} from './dto/offer-category.schema';
import { PlatformOfferCategoriesService } from './platform-offer-categories.service';

@ApiTags('platform-offer-categories')
@Controller('platform/offer-categories')
export class PlatformOfferCategoriesController {
  constructor(private readonly service: PlatformOfferCategoriesService) {}

  @Get()
  @PlatformAdminAuth()
  @ApiOkResponse({ type: OfferCategoryListResponseDto })
  list(
    @Query(new ZodValidationPipe(listOfferCategoriesQuerySchema))
    query: ListOfferCategoriesQueryDto,
  ) {
    return this.service.list(query);
  }

  @Post()
  @PlatformAdminAuth()
  @ApiOperation({ summary: 'Cria uma categoria administrável de ofertas' })
  @ApiCreatedResponse({ type: OfferCategoryResponseDto })
  create(
    @Body(new ZodValidationPipe(createOfferCategorySchema)) body: CreateOfferCategoryDto,
    @CurrentPlatformAdmin() admin: PlatformAdminJwtPayload,
    @Req() request: Request,
  ) {
    return this.service.create(admin.sub, body, request.ip);
  }

  @Patch(':id')
  @PlatformAdminAuth()
  @ApiOkResponse({ type: OfferCategoryResponseDto })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateOfferCategorySchema)) body: UpdateOfferCategoryDto,
    @CurrentPlatformAdmin() admin: PlatformAdminJwtPayload,
    @Req() request: Request,
  ) {
    return this.service.update(admin.sub, id, body, request.ip);
  }

  @Delete(':id')
  @HttpCode(204)
  @PlatformAdminAuth()
  @ApiNoContentResponse()
  async remove(
    @Param('id') id: string,
    @CurrentPlatformAdmin() admin: PlatformAdminJwtPayload,
    @Req() request: Request,
  ): Promise<void> {
    await this.service.remove(admin.sub, id, request.ip);
  }
}
