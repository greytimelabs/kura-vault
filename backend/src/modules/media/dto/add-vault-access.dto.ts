import { IsString, IsNotEmpty, IsUUID, IsOptional } from 'class-validator';

export class AddVaultAccessDto {
  @IsUUID()
  targetVaultId: string;

  @IsString()
  @IsNotEmpty()
  encryptedDek: string;

  @IsString()
  @IsNotEmpty()
  dekNonce: string;

  @IsOptional()
  @IsString()
  encryptedMeta?: string;

  @IsOptional()
  @IsString()
  metaNonce?: string;
}
