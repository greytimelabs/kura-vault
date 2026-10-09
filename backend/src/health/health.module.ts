import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { SetupModule } from '../modules/setup/setup.module';

@Module({
  imports: [SetupModule],
  controllers: [HealthController],
})
export class HealthModule {}
