// Facts the whole site repeats. Keep them true to README.md and docs/.
import web from '../../../web/package.json';

export const SITE_URL = 'https://kura.greytimelabs.com';
export const APP_URL = 'https://kura-app.greytimelabs.com';
export const REPO_URL = 'https://github.com/greytimelabs/kura-vault';
export const DOCS_URL = `${REPO_URL}/blob/main/docs`;
export const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.kuravault.app';
export const CONTACT_EMAIL = 'contact@greytimelabs.com';
export const ORG_NAME = 'Greytimelabs';

/** The release this site describes, from the web client the release workflow versions with it. */
export const VERSION: string = web.version;

export const INSTALL_COMMANDS = [
  'curl -fsSLO https://github.com/greytimelabs/kura-vault/releases/latest/download/install.sh',
  'less install.sh && sh install.sh',
];

export const NAV = [
  { href: '/#how-it-works', label: 'How it works' },
  { href: '/security', label: 'Security' },
  { href: '/compare', label: 'Compare' },
  { href: '/#self-host', label: 'Self-host' },
];

let stars: Promise<number | null> | undefined;

/** Shown only once it is a number worth showing; fetched once per build so visitors make no API call. */
export function githubStars(): Promise<number | null> {
  stars ??= fetchStars();
  return stars;
}

async function fetchStars(): Promise<number | null> {
  try {
    const res = await fetch('https://api.github.com/repos/greytimelabs/kura-vault', {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const { stargazers_count } = (await res.json()) as { stargazers_count: number };
    return stargazers_count >= 25 ? stargazers_count : null;
  } catch {
    return null;
  }
}
