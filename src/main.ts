import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from './app.module';
import { swaggerConfig } from './swagger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, swaggerConfig));
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
