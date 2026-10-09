import { IsUUID, IsOptional, IsNumber } from 'class-validator';

export class AddMediaToAlbumDto {
  @IsUUID()
  mediaId: string;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}
