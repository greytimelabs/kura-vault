import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBase64, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

/** Lowercase, 3 to 32 characters. The only thing the server knows a person by. */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/;

export function IsUsername() {
  return applyDecorators(
    Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)),
    IsString(),
    Matches(USERNAME_PATTERN, {
      message: 'Username must be 3 to 32 characters: lowercase letters, digits, dot, dash or underscore',
    }),
  );
}

/** The sign-in password. Not the master passphrase and not a vault passphrase. */
export function IsAccountPassword() {
  return applyDecorators(
    IsString(),
    MinLength(12, { message: 'Password must be at least 12 characters' }),
    MaxLength(128),
    Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/, {
      message: 'Password must contain uppercase, lowercase, number, and special character',
    }),
  );
}

/** Base64 ciphertext or key material, with an upper bound so nothing oversized is stored. */
export function IsEncoded(maxLength = 512) {
  return applyDecorators(IsString(), IsBase64(), MinLength(1), MaxLength(maxLength));
}

/** A 32-byte public key in base64. */
export function IsPublicKey() {
  return applyDecorators(IsString(), IsBase64(), Length(44, 44));
}

/** A 64-byte Ed25519 signature in base64. */
export function IsSignature() {
  return applyDecorators(IsString(), IsBase64(), Length(88, 88));
}
