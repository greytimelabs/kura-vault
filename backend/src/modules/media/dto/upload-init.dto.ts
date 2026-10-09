import { IsEnum, IsOptional, IsNumber, IsUUID } from 'class-validator';
import { MediaType } from '../../../common/types';

export class UploadInitDto {
  @IsUUID()
  vaultId: string;

  /** The album being uploaded into. Required for someone who has the album but not its vault. */
  @IsOptional()
  @IsUUID()
  albumId?: string;

  @IsEnum(MediaType)
  mediaType: MediaType;

  @IsOptional()
  @IsNumber()
  fileSizeBytes?: number;
}
