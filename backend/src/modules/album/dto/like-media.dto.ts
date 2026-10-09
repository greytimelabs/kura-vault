import { IsUUID } from 'class-validator';

export class LikeMediaDto {
  @IsUUID()
  vaultId: string;
}
