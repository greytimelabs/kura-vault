/**
 * One web build serves one of two deployments.
 *
 * Off (the default): the client is served by the same host as its API, as in the
 * self-hosted image. One server, the refresh token in an httpOnly cookie.
 *
 * On: a client hosted apart from any server. The user types a server address, can
 * hold accounts on several servers, and refresh tokens live in browser storage,
 * because a cookie cannot cross to another site.
 */
export const MULTI_SERVER = import.meta.env.VITE_MULTI_SERVER === 'true';
