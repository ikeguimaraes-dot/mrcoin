import { Module } from '@nestjs/common';
import { PartnerMeController } from './partner-me.controller';
import { PartnerLoginController } from './partner-login.controller';
import { PartnerRefreshController } from './partner-refresh.controller';
import { PartnersController } from './partners.controller';
import { AdminPartnersController } from './admin-partners.controller';
import { PartnersService } from './partners.service';
import { PartnerLoginService } from './partner-login.service';
import { PartnerTokenService } from './partner-token.service';

@Module({
  // PartnerMeController (rota literal GET /partners/me) precisa vir ANTES de
  // PartnersController (rota GET /partners/:id) — Express resolve por ordem de registro, e
  // :id combina com qualquer segmento. Trocar a ordem quebra /partners/me silenciosamente.
  controllers: [
    PartnerMeController,
    PartnerLoginController,
    PartnerRefreshController,
    PartnersController,
    AdminPartnersController,
  ],
  providers: [PartnersService, PartnerLoginService, PartnerTokenService],
  exports: [PartnersService, PartnerTokenService],
})
export class PartnersModule {}
