import { Module } from '@nestjs/common';
import { ConversionRateService } from './conversion-rate.service';

@Module({
  providers: [ConversionRateService],
  exports: [ConversionRateService],
})
export class SettingsModule {}
