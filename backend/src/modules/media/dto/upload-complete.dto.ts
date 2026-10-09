import { IsString, IsNotEmpty, IsUUID, IsOptional, IsEnum, IsNumber } from 'class-validator';
import { MediaType } from '../../../common/types';

export class UploadCompleteDto {
  @IsUUID()
  mediaId: string;

  @IsUUID()
  vaultId: string;

  @IsEnum(MediaType)
  @IsOptional()
  mediaType?: MediaType;

  @IsOptional()
  @IsString()
  capturedAt?: string;

  @IsOptional()
  @IsNumber()
  width?: number;

  @IsOptional()
  @IsNumber()
  height?: number;

  @IsOptional()
  @IsNumber()
  fileSizeBytes?: number;

  @IsOptional()
  @IsNumber()
  durationSeconds?: number;

  /**
   * DEK encrypted with the vault's KEK. Base64.
   */
  @IsString()
  @IsNotEmpty()
  encryptedDek: string;

  @IsString()
  @IsNotEmpty()
  dekNonce: string;

  @IsString()
  @IsNotEmpty()
  thumbIv: string;

  @IsString()
  @IsNotEmpty()
  previewIv: string;

  @IsString()
  @IsNotEmpty()
  originalIv: string;

  /**
   * Sensitive metadata encrypted with vault KEK. Base64.
   */
  @IsOptional()
  @IsString()
  encryptedMeta?: string;

  @IsOptional()
  @IsString()
  metaNonce?: string;
}
