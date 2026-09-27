import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import requestLogger from './common/middleware/request-logging.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Attach request logging middleware early in the pipeline
  app.use(requestLogger as any);

  // Validate incoming requests for DTOs globally
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // ── OpenAPI / Swagger (#969) ────────────────────────────────────────────────
  // Enabled by default; set SWAGGER_ENABLED=false to disable (e.g. production).
  if (process.env['SWAGGER_ENABLED'] !== 'false') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Mux Backend API')
      .setDescription(
        'Backend infrastructure for Mux Protocol — invisible wallets, ' +
          'payment orchestration, and Soroban smart contract interaction on Stellar.',
      )
      .setVersion('1.0')
      .setContact(
        'Mux Labs',
        'https://github.com/mux-labs/mux-backend',
        '',
      )
      .setLicense('MIT', 'https://opensource.org/licenses/MIT')
      // ── Security schemes ──────────────────────────────────────────────────
      // ApiKeyAuth: API keys issued to developers (format: mux_live_* / mux_test_*)
      // Transmitted via:  Authorization: Bearer <key>
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'ApiKey',
          name: 'Authorization',
          description:
            'Developer API key — format: `mux_live_<32chars>` or `mux_test_<32chars>`. ' +
            'Transmitted as `Authorization: Bearer <key>`.',
          in: 'header',
        },
        'ApiKeyAuth',
      )
      // PublicEndpoint tag: documents routes that are intentionally unauthenticated
      // (e.g. POST /auth/authenticate, GET /health, GET /ready).
      .addTag('public', 'Unauthenticated endpoints — no API key required')
      .addTag('auth', 'Authentication and user onboarding')
      .addTag('wallets', 'Invisible wallet lifecycle management')
      .addTag('payments', 'Payment orchestration with developer-scoped isolation')
      .addTag('transactions', 'Stellar transaction relay and signing')
      .addTag('api-keys', 'API key management for developers')
      .addTag('limits', 'Spending limit enforcement')
      .addTag('developers', 'Developer account management')
      .addTag('projects', 'Project management under a developer account')
      .addTag('webhooks', 'Outbound webhook delivery and configuration')
      .addTag('key-management', 'Stellar keypair lifecycle and rotation')
      .addTag('recovery', 'Wallet recovery flows')
      .addTag('health', 'Liveness and readiness probes')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api', app, document, {
      swaggerOptions: {
        // Persist auth token across page reloads
        persistAuthorization: true,
        // Show request duration in Swagger UI
        displayRequestDuration: true,
      },
    });
  }

  await app.listen(process.env['PORT'] ?? 3000);
}

bootstrap();
