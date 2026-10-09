import { IsUUID, IsOptional, IsNumber } from 'class-validator';
import { IsEncoded } from '../../../common/validation';

export class AddMediaToAlbumDto {
  @IsUUID()
  mediaId: string;

  /** The item's key wrapped under the album key, so people the album is shared with can open it. */
  @IsEncoded(128)
  keyWrapped: string;

  @IsEncoded(32)
  keyNonce: string;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}
