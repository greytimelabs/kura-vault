// The text served at /llms.txt and /llms-full.txt (https://llmstxt.org), built from
// the same data as the pages so the two never disagree.
import { CHECKED, COMPARISONS, type Cell } from './compare';
import { FAQ } from './faq';
import { APP_URL, CONTACT_EMAIL, DOCS_URL, INSTALL_COMMANDS, PLAY_URL, REPO_URL, SITE_URL, VERSION } from './site';

const SUMMARY = `> Kura Vault is free, open-source (MIT), self-hosted storage for personal photos and videos with end-to-end encryption. Media is encrypted on the device before upload; the server stores ciphertext in S3-compatible storage and wrapped keys in PostgreSQL, and never sees a passphrase, a key or a decrypted file. Published by Greytimelabs. Current version: ${VERSION}.`;

const FACTS = `Key facts:

- Encryption: AES-256-GCM with a random key per file, a fresh 12-byte IV per encryption, and the owning row ids authenticated as additional data. File names, location data, album names and vault names are encrypted too.
- Key derivation: Argon2id v1.3 (3 iterations, 64 MiB, parallelism 1). The master passphrase never leaves the device.
- Sharing: vault and album keys are sealed to the recipient's X25519 public key and signed with Ed25519. The server owner certifies users' keys; invite links bind a new user's keys with a secret in the URL fragment the server never sees.
- Multiple vaults per account, each with its own passphrase. Vaults you created are not listed until their passphrase is entered.
- Accounts are invite-only. The server owner cannot read vaults that were not shared with them.
- Storage: bundled Garage, or any S3-compatible bucket (AWS S3, Cloudflare R2, Backblaze B2). Uploads and downloads use pre-signed URLs.
- Clients: Android app on Google Play (${PLAY_URL}), web client served by your own server or hosted at ${APP_URL}, and a command-line bulk import tool. No iOS App Store release yet.
- Self-hosting: Linux (amd64 or arm64), 1 CPU, 1 GB memory, Docker Compose v2, a domain and HTTPS via your own reverse proxy.
- Not included: face recognition, smart search, automatic background backup from phones.
- Status: young project, not yet independently audited.`;

export function llmsTxt(): string {
  return `# Kura Vault

${SUMMARY}

${FACTS}

## Pages

- [Home](${SITE_URL}/): what Kura Vault is, how it works, features, self-hosting and FAQ
- [Security model](${SITE_URL}/security): the cryptography, threats and mitigations, what is not hidden, and limits
- [Compare](${SITE_URL}/compare): honest comparisons with other photo storage
${COMPARISONS.map((c) => `- [Kura Vault vs ${c.name}](${SITE_URL}/compare/${c.slug}): ${c.description}`).join('\n')}
- [Privacy policy](${SITE_URL}/privacy)
- [Delete your account](${SITE_URL}/delete-account)

## Documentation

- [Source code](${REPO_URL})
- [Self-hosting guide](${DOCS_URL}/self-hosting.md)
- [Security model, technical](${DOCS_URL}/security.md)
- [Cryptography specification](${DOCS_URL}/crypto/README.md)
- [Changelog](${REPO_URL}/blob/main/CHANGELOG.md)

## Optional

- [Full text of this site](${SITE_URL}/llms-full.txt)
- Contact: ${CONTACT_EMAIL}
`;
}

const cell = (c: Cell) => c.text;

export function llmsFullTxt(): string {
  const comparisons = COMPARISONS.map(
    (c) => `## Kura Vault vs ${c.name}

Source: ${SITE_URL}/compare/${c.slug} (checked ${CHECKED})

${c.summary}

| | Kura Vault | ${c.name} |
|---|---|---|
${c.rows.map((r) => `| ${r.label} | ${cell(r.kura)} | ${cell(r.them)} |`).join('\n')}

Choose ${c.name} if:
${c.chooseThem.map((x) => `- ${x}`).join('\n')}

Choose Kura Vault if:
${c.chooseKura.map((x) => `- ${x}`).join('\n')}

Sources: ${c.sources.map((s) => s.url).join(', ')}`,
  ).join('\n\n');

  return `# Kura Vault

${SUMMARY}

Website: ${SITE_URL}
Source: ${REPO_URL}

${FACTS}

## How it works

1. On your device: each photo or video gets its own random key and is encrypted with AES-256-GCM, along with its metadata. That key is wrapped by the vault key, which is protected by keys derived from your passphrases with Argon2id.
2. On your server: PostgreSQL holds wrapped keys, salts, public keys and the structural metadata needed to sort and authorise. The bucket holds opaque blobs. Someone with full access to the API, the database and the bucket still cannot view anything without a user's master passphrase.
3. On your other devices and those of people you share with: keys are unwrapped locally. Sharing seals the vault or album key to the recipient's public key; nothing is re-encrypted and no passphrase is shared.

## What the server can see

Usernames, roles and public keys; how many vaults, albums and items exist and who they are shared with; per item: photo or video, capture time, dimensions, duration, file size and uploader; and access patterns. See ${SITE_URL}/security.

## Install

\`\`\`sh
${INSTALL_COMMANDS.join('\n')}
\`\`\`

The installer downloads a release, checks every file against the release's SHA256SUMS, generates all secrets and asks before starting anything. Full guide: ${DOCS_URL}/self-hosting.md

## Frequently asked questions

${FAQ.map(({ q, a }) => `### ${q}\n\n${a}`).join('\n\n')}

${comparisons}
`;
}
