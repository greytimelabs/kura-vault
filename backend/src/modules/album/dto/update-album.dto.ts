import { IsOptional, IsUUID, IsNumber } from 'class-validator';
import { IsEncoded } from '../../../common/validation';

export class UpdateAlbumDto {
  @IsOptional()
  @IsEncoded(1024)
  nameEncrypted?: string;

  @IsOptional()
  @IsEncoded(32)
  nameNonce?: string;

  @IsOptional()
  @IsUUID()
  coverMediaId?: string;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}
