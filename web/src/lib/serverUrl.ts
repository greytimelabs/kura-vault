/** Why a typed server address was rejected. The message is shown to the user. */
export class ServerUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServerUrlError';
  }
}

// A page served over https may still call plain http on this machine
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Clean up a server address as typed into the server root: scheme, host, optional
 * port and path, no trailing slash and no `/api/v1`. Without a scheme, https is assumed.
 *
 * https is required: a browser will not let a hosted page call a plain http server.
 * The one exception is this machine itself, for development.
 */
export function parseServerUrl(input: string): string {
  const text = input.trim();
  if (!text) throw new ServerUrlError('Enter your server address');

  let url: URL;
  try {
    url = new URL(text.includes('://') ? text : `https://${text}`);
  } catch {
    throw new ServerUrlError('That is not a valid address');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ServerUrlError('The address must start with https://');
  }
  if (!url.hostname || url.username || url.password) {
    throw new ServerUrlError('That is not a valid address');
  }
  if (url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new ServerUrlError('The server must use https://');
  }

  const path = url.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  return `${url.protocol}//${url.host}${path}`;
}

export const apiBaseOf = (serverUrl: string) => `${serverUrl}/api/v1`;

/** Host and port, for display. */
export function hostOf(serverUrl: string): string {
  try {
    return new URL(serverUrl).host;
  } catch {
    return serverUrl;
  }
}
