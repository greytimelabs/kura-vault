import { IsString, IsOptional, IsUUID, IsNumber } from 'class-validator';

export class UpdateAlbumDto {
  @IsOptional()
  @IsString()
  nameEncrypted?: string;

  @IsOptional()
  @IsString()
  nameNonce?: string;

  @IsOptional()
  @IsUUID()
  coverMediaId?: string;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}
