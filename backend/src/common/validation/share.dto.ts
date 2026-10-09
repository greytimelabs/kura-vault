import { IsEnum, IsUUID } from 'class-validator';
import { SharePermission } from '../types';
import { IsEncoded, IsSignature } from './index';

/** Share a vault or an album with one user. */
export class AddMemberDto {
  @IsUUID()
  userId: string;

  @IsEnum(SharePermission)
  permission: SharePermission;

  /** The vault or album key sealed to the recipient's public key by the sharer's client. */
  @IsEncoded(512)
  wrappedKey: string;

  /** The sharer's signature over the sealed key. */
  @IsSignature()
  grantSig: string;
}

export class UpdateMemberDto {
  @IsEnum(SharePermission)
  permission: SharePermission;
}
