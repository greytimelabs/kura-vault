import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';
import { MAX_DELETE_BATCH } from '../../../common/constants';

/** Items to erase for good, all in vaults the caller can write to. */
export class DeleteMediaDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_DELETE_BATCH)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  ids: string[];
}
