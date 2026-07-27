import { Module } from '@nestjs/common';
import { SignupController } from './signup.controller';
import { SignupService } from './signup.service';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

@Module({
  controllers: [SignupController, DevicesController],
  providers: [SignupService, DevicesService],
})
export class UsersModule {}
