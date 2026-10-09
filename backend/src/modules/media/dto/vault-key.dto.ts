import { IsEncoded } from '../../../common/validation';

/** The item's key wrapped under its vault key, added by a vault member for an item uploaded through an album. */
export class SetVaultKeyDto {
  @IsEncoded(128)
  keyWrapped: string;

  @IsEncoded(32)
  keyNonce: string;
}
