import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as dotenv from 'dotenv';
import { RpcErrorFilter } from './common/filters/rpc-error.filter';

async function bootstrap() {
  dotenv.config();
  const app = await NestFactory.create(AppModule);

  // Enable CORS
  app.enableCors();

  // Global validation pipe
  app.useGlobalPipes(new ValidationPipe());

  // Global RPC error filter
  app.useGlobalFilters(new RpcErrorFilter());

  // Swagger setup
  const config = new DocumentBuilder()
    .setTitle('Nexus Agentic API')
    .setDescription('The API documentation for the LangGraph-powered Nexus Agent')
    .setVersion('1.0')
    .addTag('intent')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`🚀 NEXUS Agent Backend running on port ${port}`);
}
bootstrap();
