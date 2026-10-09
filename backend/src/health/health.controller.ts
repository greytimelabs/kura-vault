import { Controller, Get } from '@nestjs/common';
import { SetupService } from '../modules/setup/setup.service';

@Controller('health')
export class HealthController {
  constructor(private readonly setupService: SetupService) {}

  /**
   * Public. Clients call this before sign-in to confirm that a server URL the
   * user typed really is a Kura Vault server, and to learn whether it still
   * needs its owner account created.
   */
  @Get()
  async check() {
    return {
      status: 'ok',
      app: 'kura-vault',
      apiVersion: 'v1',
      setupRequired: await this.setupService.isSetupRequired(),
      timestamp: new Date().toISOString(),
    };
  }
}
