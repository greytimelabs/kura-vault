import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class RefreshTokenDto {
  /**
   * Sent in the body by the mobile app. Web clients omit it and send the
   * httpOnly refresh cookie instead.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  refreshToken?: string;
}
