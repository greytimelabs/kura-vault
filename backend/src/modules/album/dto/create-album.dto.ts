import { IsString, IsNotEmpty, IsUUID, IsOptional, IsNumber } from 'class-validator';

export class CreateAlbumDto {
  @IsUUID()
  vaultId: string;

  @IsString()
  @IsNotEmpty()
  nameEncrypted: string;

  @IsString()
  @IsNotEmpty()
  nameNonce: string;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}
