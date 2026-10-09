import { IsString, IsEnum, IsOptional, IsNumber, IsUUID } from 'class-validator';
import { MediaType } from '../../../common/types';

export class UploadInitDto {
  @IsUUID()
  vaultId: string;

  @IsEnum(MediaType)
  mediaType: MediaType;

  @IsOptional()
  @IsString()
  capturedAt?: string; // ISO date string

  @IsOptional()
  @IsNumber()
  width?: number;

  @IsOptional()
  @IsNumber()
  height?: number;

  @IsOptional()
  @IsNumber()
  durationSeconds?: number;

  @IsOptional()
  @IsNumber()
  fileSizeBytes?: number;
}
