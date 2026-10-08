import { Module } from '@nestjs/common';
import { OrganizationValuesController } from './organization-values.controller';
import { OrganizationValuesService } from './organization-values.service';

@Module({
  controllers: [OrganizationValuesController],
  providers: [OrganizationValuesService],
})
export class OrganizationValuesModule {}
