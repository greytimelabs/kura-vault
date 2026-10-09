import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class LogoutDto {
  /**
   * The session to end. Web clients omit it and send the refresh cookie.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  refreshToken?: string;
}
