import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SetupService } from './setup.service';
import { SetupDto } from './dto/setup.dto';

@Controller('setup')
export class SetupController {
  constructor(private readonly setupService: SetupService) {}

  /** Public, and only answers while the server has no owner. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async setup(@Body() dto: SetupDto) {
    return this.setupService.createOwner(dto);
  }
}
