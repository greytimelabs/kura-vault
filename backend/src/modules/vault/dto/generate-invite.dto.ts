import { IsUUID } from 'class-validator';

export class GenerateInviteDto {
  @IsUUID()
  vaultId: string;
}
