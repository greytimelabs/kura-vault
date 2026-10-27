// Comparison pages. Every claim about another product links to the source it came from,
// and each page shows when it was checked. Re-check before changing CHECKED.
export const CHECKED = '27 October 2026';
export const CHECKED_ISO = '2026-10-27';

export type Mark = 'yes' | 'no' | 'partial';
export interface Cell {
  mark: Mark;
  text: string;
}
export interface Row {
  label: string;
  kura: Cell;
  them: Cell;
}
export interface Comparison {
  slug: string;
  name: string;
  /** Under 60 characters with " | Kura Vault" left off */
  title: string;
  description: string;
  summary: string;
  /** Where the other product is the better choice. Said plainly; it is why the rest is believable. */
  chooseThem: string[];
  chooseKura: string[];
  rows: Row[];
  sources: { label: string; url: string }[];
}

const KURA = {
  e2ee: { mark: 'yes', text: 'Yes. Media, file names, location, album and vault names' },
  selfHost: { mark: 'yes', text: 'Yes, with Docker Compose. It is the only way to run it' },
  licence: { mark: 'yes', text: 'MIT' },
  bucket: { mark: 'yes', text: 'Bundled Garage, or any S3-compatible bucket' },
  audit: { mark: 'no', text: 'Not yet' },
  ml: { mark: 'no', text: 'No. The server cannot see photos to index them' },
  backup: { mark: 'partial', text: 'Uploads run while the app is open' },
  apps: { mark: 'partial', text: 'Android, web. Not in the App Store yet' },
  hosted: { mark: 'no', text: 'No. You run the server' },
  price: { mark: 'yes', text: 'Free. You pay for your own server and storage' },
} satisfies Record<string, Cell>;

export const COMPARISONS: Comparison[] = [
  {
    slug: 'immich',
    name: 'Immich',
    title: 'Kura Vault vs Immich: encrypted vs full-featured',
    description:
      'Immich and Kura Vault are both self-hosted photo apps. Immich has AI search and auto backup; Kura Vault encrypts everything end to end.',
    summary:
      'Immich is the most popular self-hosted Google Photos replacement, with face recognition, CLIP search, maps and automatic phone backup. It is not end-to-end encrypted: the server reads your photos so it can index them, so anyone with the server’s disk can see your library. Kura Vault makes the opposite trade. The server never sees a photo, so it cannot index one.',
    chooseThem: [
      'You want face recognition, smart search, a map and memories.',
      'You want automatic background backup from iOS and Android.',
      'You trust everyone who can reach the server’s disk and backups.',
    ],
    chooseKura: [
      'Your photos sit on hardware or storage someone else could access: a VPS, a cloud bucket, a shared machine.',
      'You want several people on one server without the admin being able to view their photos.',
      'You want an S3 bucket to hold your library and to learn nothing from it.',
    ],
    rows: [
      { label: 'End-to-end encrypted', kura: KURA.e2ee, them: { mark: 'no', text: 'No. The server processes your originals' } },
      { label: 'Self-hosted', kura: KURA.selfHost, them: { mark: 'yes', text: 'Yes' } },
      { label: 'Licence', kura: KURA.licence, them: { mark: 'yes', text: 'AGPL-3.0' } },
      { label: 'Storage', kura: KURA.bucket, them: { mark: 'partial', text: 'Local disk. No native S3 support upstream' } },
      { label: 'Face recognition and smart search', kura: KURA.ml, them: { mark: 'yes', text: 'Yes, on the server (CLIP, face clustering)' } },
      { label: 'Automatic phone backup', kura: KURA.backup, them: { mark: 'yes', text: 'Yes, foreground and background' } },
      { label: 'Apps', kura: KURA.apps, them: { mark: 'yes', text: 'iOS, Android, web' } },
      { label: 'Price', kura: KURA.price, them: { mark: 'yes', text: 'Free to self-host' } },
    ],
    sources: [
      { label: 'Immich FAQ', url: 'https://docs.immich.app/FAQ' },
      { label: 'Immich on GitHub', url: 'https://github.com/immich-app/immich' },
      { label: 'Immich object storage discussion', url: 'https://github.com/immich-app/immich/discussions/23745' },
    ],
  },
  {
    slug: 'ente',
    name: 'Ente',
    title: 'Kura Vault vs Ente: two end-to-end encrypted photo apps',
    description:
      'Ente and Kura Vault both encrypt photos end to end. Ente is hosted-first and audited; Kura Vault is self-host only, MIT, with hidden vaults.',
    summary:
      'Ente is the closest thing to Kura Vault: an end-to-end encrypted photo app with open-source clients and server. It is a mature, hosted service that has been audited by Cure53 and others, has apps on every platform and does face recognition on the device. Kura Vault is younger and smaller, made only to be self-hosted, and built around separate vaults that each have their own passphrase.',
    chooseThem: [
      'You want a hosted service with a free tier and nothing to run.',
      'You want a product with completed independent security audits today.',
      'You want iOS and desktop apps, automatic backup and on-device face recognition.',
    ],
    chooseKura: [
      'You want to self-host with a single Docker Compose install and keep the bucket of your choice.',
      'You want vaults that each have their own passphrase and stay hidden until it is entered.',
      'You want an owner-run server where accounts exist only by invite.',
      'You prefer the MIT licence.',
    ],
    rows: [
      { label: 'End-to-end encrypted', kura: KURA.e2ee, them: { mark: 'yes', text: 'Yes' } },
      { label: 'Self-hosted', kura: KURA.selfHost, them: { mark: 'yes', text: 'Yes (the Museum server), alongside the hosted service' } },
      { label: 'Hosted service', kura: KURA.hosted, them: { mark: 'yes', text: 'Yes, with 10 GB free' } },
      { label: 'Licence', kura: KURA.licence, them: { mark: 'yes', text: 'AGPL-3.0' } },
      { label: 'Independent security audit', kura: KURA.audit, them: { mark: 'yes', text: 'Yes: Cure53, Symbolic Software, Fallible' } },
      { label: 'Face recognition and smart search', kura: KURA.ml, them: { mark: 'yes', text: 'Yes, on the device, in the mobile and desktop apps' } },
      { label: 'Apps', kura: KURA.apps, them: { mark: 'yes', text: 'iOS, Android, F-Droid, web, Windows, macOS, Linux' } },
    ],
    sources: [
      { label: 'Ente on GitHub', url: 'https://github.com/ente-io/ente' },
      { label: 'Ente: machine learning', url: 'https://ente.com/help/photos/features/search-and-discovery/machine-learning' },
      { label: 'Ente: CERN-sponsored audit', url: 'https://ente.com/blog/cern-audit' },
    ],
  },
  {
    slug: 'google-photos-icloud',
    name: 'Google Photos and iCloud',
    title: 'Kura Vault vs Google Photos and iCloud Photos',
    description:
      'A private Google Photos and iCloud alternative: Kura Vault encrypts on your device and runs on your own server. What you give up and gain.',
    summary:
      'Google Photos and iCloud Photos are convenient and polished, and they hold the keys to your library. Google encrypts photos in transit and at rest, but not end to end. iCloud Photos is end-to-end encrypted only if you turn on Advanced Data Protection, and even then some metadata keys stay with Apple and Shared Albums are excluded. Kura Vault encrypts every photo on your device, always, and stores it on a server you run.',
    chooseThem: [
      'You want zero maintenance, and you are comfortable with the provider holding the keys (or with turning on Advanced Data Protection on Apple devices).',
      'You rely on search, memories, editing and deep phone integration.',
    ],
    chooseKura: [
      'You do not want any company to be able to read your library, by default and without opt-in settings.',
      'You want to own the hardware or choose the bucket, and leave without an export.',
      'You want to share with family without handing a provider the shared keys.',
    ],
    rows: [
      {
        label: 'End-to-end encrypted',
        kura: { mark: 'yes', text: 'Always, for every user' },
        them: { mark: 'partial', text: 'Google: no. iCloud: only with Advanced Data Protection turned on' },
      },
      {
        label: 'Who can decrypt your photos',
        kura: { mark: 'yes', text: 'Only your devices and the people you share with' },
        them: { mark: 'no', text: 'Google, and Apple unless Advanced Data Protection is on' },
      },
      {
        label: 'Shared albums encrypted end to end',
        kura: { mark: 'yes', text: 'Yes. Keys are sealed to each recipient' },
        them: { mark: 'no', text: 'iCloud Shared Albums: no, even with Advanced Data Protection' },
      },
      { label: 'Self-hosted', kura: KURA.selfHost, them: { mark: 'no', text: 'No' } },
      { label: 'Open source', kura: KURA.licence, them: { mark: 'no', text: 'No' } },
      { label: 'Face recognition and search', kura: KURA.ml, them: { mark: 'yes', text: 'Yes' } },
      { label: 'Automatic phone backup', kura: KURA.backup, them: { mark: 'yes', text: 'Yes' } },
    ],
    sources: [
      { label: 'Apple: iCloud data security overview', url: 'https://support.apple.com/en-us/102651' },
      { label: 'Google Safety Center: Photos', url: 'https://safety.google/intl/en_us/photos/' },
    ],
  },
  {
    slug: 'photoprism-nextcloud',
    name: 'PhotoPrism and Nextcloud',
    title: 'Kura Vault vs PhotoPrism and Nextcloud',
    description:
      'PhotoPrism and Nextcloud are self-hosted but readable by the server admin. How Kura Vault differs, and when they are the better pick.',
    summary:
      'PhotoPrism is a self-hosted photo library with AI tagging and face recognition. Nextcloud is a self-hosted file and collaboration suite with photo apps. Both run on your server, and both let that server read your photos. Nextcloud’s server-side encryption is built to protect external storage, not to keep files from the admin: in its default mode admins can decrypt any user’s files. Its separate end-to-end encryption works per folder, through the desktop and mobile clients.',
    chooseThem: [
      'You want AI tagging, faces, places and RAW handling (PhotoPrism).',
      'You want one server for files, calendars, contacts and photos (Nextcloud).',
      'Only you, or people you fully trust, can reach the server.',
    ],
    chooseKura: [
      'The admin, the host or the bucket should not be able to view anyone’s photos.',
      'You want photo and video storage that is encrypted end to end by default, not per folder.',
    ],
    rows: [
      {
        label: 'End-to-end encrypted by default',
        kura: KURA.e2ee,
        them: { mark: 'no', text: 'PhotoPrism: no. Nextcloud: an optional per-folder E2EE app' },
      },
      {
        label: 'Hidden from the server admin',
        kura: { mark: 'yes', text: 'Yes' },
        them: { mark: 'no', text: 'No. With Nextcloud server-side encryption in its default mode, admins can decrypt any user’s files' },
      },
      { label: 'Self-hosted', kura: KURA.selfHost, them: { mark: 'yes', text: 'Yes' } },
      {
        label: 'Licence',
        kura: KURA.licence,
        them: { mark: 'partial', text: 'Nextcloud: AGPL-3.0. PhotoPrism: AGPL Community Edition; the default image is under its Plus licence' },
      },
      { label: 'Face recognition and tagging', kura: KURA.ml, them: { mark: 'yes', text: 'PhotoPrism: yes. Nextcloud: through apps' } },
    ],
    sources: [
      { label: 'Nextcloud: encryption configuration', url: 'https://docs.nextcloud.com/server/latest/admin_manual/configuration_files/encryption_configuration.html' },
      { label: 'PhotoPrism FAQ', url: 'https://docs.photoprism.app/getting-started/faq/' },
    ],
  },
];

export const comparison = (slug: string) => COMPARISONS.find((c) => c.slug === slug)!;
