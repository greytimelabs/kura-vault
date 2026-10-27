// schema.org JSON-LD, so search engines and AI answers read the same facts the page states.
import { CONTACT_EMAIL, ORG_NAME, PLAY_URL, REPO_URL, SITE_URL, VERSION } from './site';

type Node = Record<string, unknown>;

const ORG_ID = `${SITE_URL}/#organization`;
const SITE_ID = `${SITE_URL}/#website`;
const APP_ID = `${SITE_URL}/#software`;

export const organization: Node = {
  '@type': 'Organization',
  '@id': ORG_ID,
  name: ORG_NAME,
  url: SITE_URL,
  email: CONTACT_EMAIL,
  logo: `${SITE_URL}/og/logo.png`,
  sameAs: ['https://github.com/greytimelabs'],
};

export const website: Node = {
  '@type': 'WebSite',
  '@id': SITE_ID,
  name: 'Kura Vault',
  url: SITE_URL,
  inLanguage: 'en',
  publisher: { '@id': ORG_ID },
};

export const softwareApplication: Node = {
  '@type': 'SoftwareApplication',
  '@id': APP_ID,
  name: 'Kura Vault',
  description:
    'Self-hosted, end-to-end encrypted storage for personal photos and videos. Media is encrypted on the device before upload; the server stores only ciphertext.',
  url: SITE_URL,
  applicationCategory: 'MultimediaApplication',
  applicationSubCategory: 'Encrypted photo and video storage',
  operatingSystem: 'Android, Web browser, Linux (server, Docker)',
  softwareVersion: VERSION,
  license: 'https://opensource.org/license/mit',
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  downloadUrl: [PLAY_URL, `${REPO_URL}/releases/latest`],
  installUrl: PLAY_URL,
  publisher: { '@id': ORG_ID },
  image: `${SITE_URL}/og/home.png`,
  featureList: [
    'End-to-end encryption with AES-256-GCM and a random key per file',
    'Argon2id-protected master passphrase that never leaves the device',
    'Multiple vaults, each with its own passphrase, hidden until unlocked',
    'Sharing of vaults and albums without sharing a passphrase',
    'Direct-to-storage uploads and downloads with pre-signed URLs',
    'Invite-only accounts managed by the server owner',
    'Command-line bulk import with resume',
    'Any S3-compatible storage: bundled Garage, AWS S3, Cloudflare R2, Backblaze B2',
  ],
};

export const sourceCode: Node = {
  '@type': 'SoftwareSourceCode',
  name: 'kura-vault',
  codeRepository: REPO_URL,
  license: 'https://opensource.org/license/mit',
  programmingLanguage: ['TypeScript', 'Dart'],
  targetProduct: { '@id': APP_ID },
};

export function faqPage(items: { q: string; a: string }[]): Node {
  return {
    '@type': 'FAQPage',
    mainEntity: items.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
}

export function breadcrumbs(trail: { name: string; path: string }[]): Node {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: [{ name: 'Home', path: '' }, ...trail].map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: `${SITE_URL}${item.path}`,
    })),
  };
}

export function article(a: { headline: string; description: string; path: string; modified: string }): Node {
  return {
    '@type': 'TechArticle',
    headline: a.headline,
    description: a.description,
    url: `${SITE_URL}${a.path}`,
    dateModified: a.modified,
    inLanguage: 'en',
    author: { '@id': ORG_ID },
    publisher: { '@id': ORG_ID },
    about: { '@id': APP_ID },
  };
}

export function graph(nodes: Node[]): string {
  // Escape < so the JSON can never close its <script> element
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': [organization, website, ...nodes] }).replace(
    /</g,
    '\\u003c',
  );
}
