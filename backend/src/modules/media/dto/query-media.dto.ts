import { IsOptional, IsUUID, IsString, IsNumber, Min, Max, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryMediaDto {
  /** Required unless `albumId` is given. */
  @ValidateIf((dto: QueryMediaDto) => !dto.albumId || dto.vaultId !== undefined)
  @IsUUID()
  vaultId?: string;

  @IsOptional()
  @IsUUID()
  albumId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @IsOptional()
  @IsString()
  yearMonth?: string; // e.g., '2024-03'
}
