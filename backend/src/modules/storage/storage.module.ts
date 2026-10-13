import { Module, Global } from '@nestjs/common';
import { StorageService } from './storage.service';
import { BlobPurgeService } from './blob-purge.service';

@Global()
@Module({
  providers: [StorageService, BlobPurgeService],
  exports: [StorageService, BlobPurgeService],
})
export class StorageModule {}
