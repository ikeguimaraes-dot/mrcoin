import { DocumentBuilder } from '@nestjs/swagger';

export const swaggerConfig = new DocumentBuilder()
  .setTitle('coins-api')
  .setDescription('Backend único da plataforma de loyalty coins')
  .setVersion('0.1.0')
  .build();
