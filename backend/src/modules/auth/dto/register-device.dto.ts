import { IsString, IsNotEmpty, MinLength, MaxLength, Matches, IsOptional } from 'class-validator';

export class RegisterDeviceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  /**
   * Unique device identifier.
   * On mobile: from device_info_plus or similar.
   * Must be deterministic per device.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  deviceId: string;

  /**
   * Password for this device registration.
   * NOT the vault passphrase.
   * Used for API authentication.
   */
  @IsString()
  @MinLength(12, { message: 'Password must be at least 12 characters' })
  @MaxLength(128)
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/,
    { message: 'Password must contain uppercase, lowercase, number, and special character' },
  )
  password: string;

  /**
   * One-time invite code (required for non-first-user registration).
   * First device registered becomes the owner.
   */
  @IsString()
  @IsOptional()
  inviteCode?: string;
}
