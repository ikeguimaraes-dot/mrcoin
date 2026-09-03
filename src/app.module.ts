import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type Redis from 'ioredis';
import { Env, validateEnv } from './config/env.schema';
import { PrismaModule } from './prisma/prisma.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AuditLogInterceptor } from './common/interceptors/audit-log.interceptor';
import { CommonModule } from './common/common.module';
import { RedisModule, BULLMQ_REDIS_CLIENT } from './common/redis/redis.module';
import { HealthModule } from './modules/health/health.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { AuthModule } from './modules/auth/auth.module';
import { PlatformAdminModule } from './modules/platform-admin/platform-admin.module';
import { PlatformOrganizationsModule } from './modules/platform-admin/organizations/platform-organizations.module';
import { PlatformPartnersModule } from './modules/platform-admin/partners/platform-partners.module';
import { PlatformOffersModule } from './modules/platform-admin/offers/platform-offers.module';
import { PlatformDashboardModule } from './modules/platform-admin/dashboard/platform-dashboard.module';
import { PlatformRedemptionsModule } from './modules/platform-admin/redemptions/platform-redemptions.module';
import { PlatformBatchesModule } from './modules/platform-admin/batches/platform-batches.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { UsersModule } from './modules/users/users.module';
import { WalletsModule } from './modules/wallets/wallets.module';
import { BillingModule } from './modules/billing/billing.module';
import { BatchesModule } from './modules/batches/batches.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { DistributionsModule } from './modules/distributions/distributions.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { MembersModule } from './modules/members/members.module';
import { PartnersModule } from './modules/partners/partners.module';
import { OffersModule } from './modules/offers/offers.module';
import { RedemptionsModule } from './modules/redemptions/redemptions.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    PrismaModule,
    RedisModule,
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
      }),
    }),
    BullModule.forRootAsync({
      inject: [BULLMQ_REDIS_CLIENT],
      useFactory: (connection: Redis) => ({
        connection,
        defaultJobOptions: {
          removeOnComplete: { count: 30 },
          removeOnFail: { count: 90 },
        },
      }),
    }),
    CommonModule,
    HealthModule,
    LedgerModule,
    JobsModule,
    AuthModule,
    PlatformAdminModule,
    PlatformOrganizationsModule,
    PlatformPartnersModule,
    PlatformOffersModule,
    PlatformDashboardModule,
    PlatformRedemptionsModule,
    PlatformBatchesModule,
    OrganizationsModule,
    UsersModule,
    WalletsModule,
    BillingModule,
    BatchesModule,
    WebhooksModule,
    DistributionsModule,
    DashboardModule,
    MembersModule,
    PartnersModule,
    OffersModule,
    RedemptionsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
  ],
})
export class AppModule {}
