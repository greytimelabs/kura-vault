import { IsUUID, IsOptional, IsEnum, IsNumber, IsString } from 'class-validator';
import { MediaType } from '../../../common/types';
import { IsEncoded } from '../../../common/validation';

export class UploadCompleteDto {
  @IsUUID()
  mediaId: string;

  @IsUUID()
  vaultId: string;

  @IsOptional()
  @IsUUID()
  albumId?: string;

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

  /** The item's key wrapped under the vault key. Sent by uploaders who hold the vault key. */
  @IsOptional()
  @IsEncoded(128)
  keyWrappedVault?: string;

  @IsOptional()
  @IsEncoded(32)
  keyNonceVault?: string;

  /** The item's key wrapped under the album key. Sent with `albumId`. */
  @IsOptional()
  @IsEncoded(128)
  keyWrappedAlbum?: string;

  @IsOptional()
  @IsEncoded(32)
  keyNonceAlbum?: string;

  @IsEncoded(32)
  thumbIv: string;

  @IsEncoded(32)
  previewIv: string;

  @IsEncoded(32)
  originalIv: string;

  /** Sensitive metadata encrypted under the item's own key. */
  @IsOptional()
  @IsEncoded(8192)
  encryptedMeta?: string;

  @IsOptional()
  @IsEncoded(32)
  metaNonce?: string;
}
