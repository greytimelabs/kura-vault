import { IsEncoded, IsPublicKey } from '../../../common/validation';

/** Everything a client produces from a master passphrase. All of it is public or ciphertext. */
export class KeyMaterialDto {
  @IsEncoded(64)
  kdfSalt: string;

  @IsEncoded(1024)
  encryptedPrivateKeys: string;

  @IsEncoded(32)
  privateKeysNonce: string;

  @IsPublicKey()
  publicEncKey: string;

  @IsPublicKey()
  publicSignKey: string;
}
