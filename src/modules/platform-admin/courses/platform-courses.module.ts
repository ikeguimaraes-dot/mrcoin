import { Module } from '@nestjs/common';
import { PlatformAdminModule } from '../platform-admin.module';
import { PlatformCoursesController } from './platform-courses.controller';
import { PlatformCoursesService } from './platform-courses.service';

@Module({
  imports: [PlatformAdminModule],
  controllers: [PlatformCoursesController],
  providers: [PlatformCoursesService],
})
export class PlatformCoursesModule {}
