import { registerAs } from '@nestjs/config';

/** `PUBLIC_URL` without a trailing slash, or undefined when unset. */
export function publicUrlOf(env: NodeJS.ProcessEnv): string | undefined {
  return env.PUBLIC_URL ? env.PUBLIC_URL.replace(/\/+$/, '') : undefined;
}

/**
 * Express `trust proxy`: how many proxies in front of the API to believe about the
 * client address. `false` (the default) when nothing is in front, a hop count such as
 * `1` behind the bundled web container, or a comma-separated list of proxy addresses.
 */
export function trustProxyOf(value: string | undefined): boolean | number | string {
  if (!value || value === 'false') return false;
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  return value;
}

/** CORS_ORIGINS, always including the server's own PUBLIC_URL. */
export function corsOriginsOf(list: string | undefined, publicUrl: string | undefined): string[] {
  const origins = (list ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
  if (publicUrl && !origins.includes(publicUrl)) origins.unshift(publicUrl);
  return origins.length > 0 ? origins : ['http://localhost:3000'];
}

export const appConfig = registerAs('app', () => {
  const publicUrl = publicUrlOf(process.env);
  return {
    // Names the run environment only; security settings have their own variables
    nodeEnv: process.env.NODE_ENV || 'production',
    port: parseInt(process.env.PORT || '3000', 10),
    version: process.env.APP_VERSION || 'dev',
    publicUrl,
    corsOrigins: corsOriginsOf(process.env.CORS_ORIGINS, publicUrl),
    // Safari drops Secure cookies on http://localhost, so they follow the scheme users reach us on
    secureCookies: publicUrl?.startsWith('https://') ?? false,
    trustProxy: trustProxyOf(process.env.TRUST_PROXY),
    hsts: {
      maxAge: parseInt(process.env.HSTS_MAX_AGE || '31536000', 10),
      includeSubDomains: process.env.HSTS_INCLUDE_SUBDOMAINS === 'true',
    },
  };
});
