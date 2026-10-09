import {
  Controller, Post, Body, Req, Res, UseGuards, HttpCode, HttpStatus, UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, CookieOptions } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/types';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH, REFRESH_TOKEN_TTL_MS } from '../../common/constants';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutDto } from './dto/logout.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto);
    if (!this.isWebClient(req)) {
      return result;
    }

    const { refreshToken, ...body } = result;
    this.setRefreshCookie(res, refreshToken);
    return body;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (dto.refreshToken) {
      return this.authService.refreshAccessToken(dto.refreshToken);
    }

    const cookieToken = this.readRefreshCookie(req);
    if (!cookieToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    try {
      const { refreshToken, ...body } = await this.authService.refreshAccessToken(cookieToken);
      this.setRefreshCookie(res, refreshToken);
      return body;
    } catch (err) {
      this.clearRefreshCookie(res);
      throw err;
    }
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser() user: JwtPayload,
    @Body() dto: LogoutDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const isWeb = this.isWebClient(req);
    const refreshToken = dto?.refreshToken ?? this.readRefreshCookie(req);
    await this.authService.logout(user.sub, user.username, refreshToken);
    if (isWeb) {
      this.clearRefreshCookie(res);
    }
    return { message: 'Logged out successfully' };
  }

  /**
   * Web clients identify themselves with `X-Client: web`. A custom header cannot be
   * sent cross-site without a CORS preflight, so requiring it on every cookie path
   * (together with SameSite=Strict) keeps other sites from riding the cookie.
   */
  private isWebClient(req: Request): boolean {
    return req.headers['x-client'] === 'web';
  }

  private readRefreshCookie(req: Request): string | undefined {
    if (!this.isWebClient(req)) {
      return undefined;
    }
    const value = req.cookies?.[REFRESH_COOKIE_NAME];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'strict',
      // Safari drops Secure cookies on http://localhost, so only require it in production
      secure: this.configService.get<string>('app.nodeEnv') === 'production',
      path: REFRESH_COOKIE_PATH,
    };
  }

  private setRefreshCookie(res: Response, refreshToken: string): void {
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
      ...this.cookieOptions(),
      maxAge: REFRESH_TOKEN_TTL_MS,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE_NAME, this.cookieOptions());
  }
}
