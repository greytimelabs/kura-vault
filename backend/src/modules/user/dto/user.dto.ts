import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { AccessLevel, UserStatus } from '../../../common/types';
import { IsAccountPassword, IsEncoded, IsSignature } from '../../../common/validation';

export class UpdateUserDto {
  @IsOptional()
  @IsEnum(AccessLevel)
  accessLevel?: AccessLevel;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}

export class CertifyUserDto {
  @IsSignature()
  keyCert: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  currentPassword: string;

  @IsAccountPassword()
  newPassword: string;
}

/** A new master passphrase: the same private keys, encrypted again under a new salt. */
export class ChangeKeysDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  currentPassword: string;

  @IsEncoded(64)
  kdfSalt: string;

  @IsEncoded(1024)
  encryptedPrivateKeys: string;

  @IsEncoded(32)
  privateKeysNonce: string;
}
