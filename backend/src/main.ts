// Must stay first: loads .env and *_FILE secrets before any configuration is read
import './config/load-env';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import cookieParser = require('cookie-parser');
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const config = app.get(ConfigService);

  // Behind the web container (or another proxy), the client address is in X-Forwarded-For.
  // Rate limiting and lockout key on it, so only the configured hops are believed
  app.set('trust proxy', config.get('app.trustProxy'));

  // Security headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
    // No preload and no subdomains by default: both reach beyond this server and are hard to undo
    hsts: config.get<number>('app.hsts.maxAge')! > 0
      ? { maxAge: config.get<number>('app.hsts.maxAge'), includeSubDomains: config.get<boolean>('app.hsts.includeSubDomains') }
      : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }));

  // Web clients keep their refresh token in an httpOnly cookie
  app.use(cookieParser());

  // CORS
  app.enableCors({
    origin: config.get<string[]>('app.corsOrigins'),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID', 'X-Client'],
    credentials: true,
    maxAge: 3600,
  });

  // Global validation pipe
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strip unknown properties
      forbidNonWhitelisted: true, // Throw on unknown properties
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      disableErrorMessages: config.get('app.nodeEnv') === 'production',
    }),
  );

  const port = config.get<number>('app.port', 3000);
  await app.listen(port);
  logger.log(`Kura Vault API ${config.get('app.version')} running on port ${port}`);
}

bootstrap();
