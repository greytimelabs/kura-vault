import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from '../../common/constants';

function makeController(nodeEnv = 'development') {
  const authService = {
    login: jest.fn(async () => ({
      accessToken: 'access',
      refreshToken: 'refresh-1',
      expiresIn: '15m',
      user: { id: 'user-1', username: 'user-one', role: 'owner', accessLevel: 'full' },
    })),
    refreshAccessToken: jest.fn(async () => ({
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
      expiresIn: '15m',
    })),
    logout: jest.fn(async () => undefined),
  };
  const configService = { get: jest.fn(() => nodeEnv) };
  const controller = new AuthController(authService as any, configService as any);
  const res = { cookie: jest.fn(), clearCookie: jest.fn() };
  return { controller, authService, res };
}

const webReq = (cookies: Record<string, string> = {}) => ({ headers: { 'x-client': 'web' }, cookies }) as any;
const appReq = (cookies: Record<string, string> = {}) => ({ headers: {}, cookies }) as any;
const credentials = { username: 'user-one', password: 'pw' };

describe('AuthController refresh cookie', () => {
  it('web login sets an httpOnly cookie and keeps the token out of the body', async () => {
    const { controller, res } = makeController();

    const body = await controller.login(credentials, webReq(), res as any);

    expect(body).not.toHaveProperty('refreshToken');
    expect(body).toMatchObject({ accessToken: 'access' });
    expect(res.cookie).toHaveBeenCalledWith(
      REFRESH_COOKIE_NAME,
      'refresh-1',
      expect.objectContaining({ httpOnly: true, sameSite: 'strict', secure: false, path: REFRESH_COOKIE_PATH }),
    );
  });

  it('the cookie is Secure in production', async () => {
    const { controller, res } = makeController('production');

    await controller.login(credentials, webReq(), res as any);

    expect(res.cookie.mock.calls[0][2]).toMatchObject({ secure: true });
  });

  it('app login still returns the refresh token in the body and sets no cookie', async () => {
    const { controller, res } = makeController();

    const body = await controller.login(credentials, appReq(), res as any);

    expect(body).toMatchObject({ refreshToken: 'refresh-1' });
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('web refresh reads the cookie and rotates it', async () => {
    const { controller, authService, res } = makeController();

    const body = await controller.refresh({}, webReq({ [REFRESH_COOKIE_NAME]: 'refresh-1' }), res as any);

    expect(authService.refreshAccessToken).toHaveBeenCalledWith('refresh-1');
    expect(body).toEqual({ accessToken: 'access-2', expiresIn: '15m' });
    expect(res.cookie.mock.calls[0][1]).toBe('refresh-2');
  });

  it('app refresh uses the body token and is returned the new one', async () => {
    const { controller, authService, res } = makeController();

    const body = await controller.refresh({ refreshToken: 'from-app' }, appReq(), res as any);

    expect(authService.refreshAccessToken).toHaveBeenCalledWith('from-app');
    expect(body).toMatchObject({ refreshToken: 'refresh-2' });
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('the cookie is ignored without the X-Client header', async () => {
    const { controller, authService, res } = makeController();

    await expect(
      controller.refresh({}, appReq({ [REFRESH_COOKIE_NAME]: 'refresh-1' }), res as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authService.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('a rejected cookie is cleared', async () => {
    const { controller, authService, res } = makeController();
    authService.refreshAccessToken.mockRejectedValue(new UnauthorizedException());

    await expect(
      controller.refresh({}, webReq({ [REFRESH_COOKIE_NAME]: 'revoked' }), res as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(res.clearCookie).toHaveBeenCalledWith(REFRESH_COOKIE_NAME, expect.objectContaining({ path: REFRESH_COOKIE_PATH }));
  });

  it('web logout ends the cookie\'s session and clears it', async () => {
    const { controller, authService, res } = makeController();
    const user = { sub: 'user-1', username: 'user-one', role: 'owner' } as any;

    await controller.logout(user, {}, webReq({ [REFRESH_COOKIE_NAME]: 'refresh-1' }), res as any);

    expect(authService.logout).toHaveBeenCalledWith('user-1', 'user-one', 'refresh-1');
    expect(res.clearCookie).toHaveBeenCalled();
  });

  it('app logout passes its body token through', async () => {
    const { controller, authService, res } = makeController();
    const user = { sub: 'user-1', username: 'user-one', role: 'owner' } as any;

    await controller.logout(user, { refreshToken: 'from-app' }, appReq(), res as any);

    expect(authService.logout).toHaveBeenCalledWith('user-1', 'user-one', 'from-app');
    expect(res.clearCookie).not.toHaveBeenCalled();
  });
});
