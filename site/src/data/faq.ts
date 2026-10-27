// The landing page FAQ, also published as FAQPage JSON-LD and in llms-full.txt.
// Answers are plain text so the same string serves all three. Keep them true to docs/.
export const FAQ: { q: string; a: string }[] = [
  {
    q: 'Is Kura Vault free?',
    a: 'Yes. Kura Vault is open source under the MIT licence and free to self-host. You pay only for your own server and storage. Greytimelabs does not sell a hosted plan.',
  },
  {
    q: 'Can the person who runs the server see my photos?',
    a: 'No. Photos, videos, file names, location data, album names and vault names are encrypted on your device before upload. The server stores only ciphertext and wrapped keys, and the owner account cannot open a vault that was not shared with it. The server does see structural metadata such as usernames, item counts, capture times, dimensions and file sizes.',
  },
  {
    q: 'What happens if I forget my master passphrase?',
    a: 'Everything only your account could open becomes permanently unreadable. There is no recovery and the server owner cannot reset it. This is deliberate: a recovery path would also be a way in.',
  },
  {
    q: 'What do I need to self-host it?',
    a: 'A Linux server (amd64 or arm64) with at least 1 CPU core and 1 GB of memory, Docker with Compose v2, a domain name, and HTTPS from a reverse proxy such as Caddy, nginx, Traefik or Cloudflare Tunnel. The installer downloads a release, checks it against published checksums and generates every secret.',
  },
  {
    q: 'Which storage does it work with?',
    a: 'The default install bundles Garage, an S3-compatible store, on the same server. You can instead use your own bucket on any S3-compatible service, such as AWS S3, Cloudflare R2 or Backblaze B2. The bucket only ever holds ciphertext.',
  },
  {
    q: 'Is there an iOS app?',
    a: 'Not in the App Store yet. The Android app is on Google Play, and the web client works in any current browser, either from your own server or from the hosted client at kura-app.greytimelabs.com.',
  },
  {
    q: 'Has Kura Vault been independently audited?',
    a: 'Not yet. The design, the cryptography and the security rules are documented in the repository, and three independent implementations are kept byte-compatible by shared test vectors. Until there is an audit, do not make Kura Vault the only copy of anything you care about.',
  },
  {
    q: 'How do I bring in my existing photo library?',
    a: 'Use the migration CLI. It encrypts an existing folder of photos and videos on your computer and uploads it, and it can resume if it is interrupted.',
  },
  {
    q: 'How does sharing work without sharing a passphrase?',
    a: 'Each vault and album has its own random key. To share, your device seals that key to the other person’s public key and signs it. Nothing is re-encrypted, and the server only relays the sealed key. You can share a whole vault or a single album, for viewing or for adding.',
  },
  {
    q: 'Does it have face recognition or smart search?',
    a: 'No. The server cannot see your photos, so it cannot index them, and the apps do not analyse photos on the device. If AI search matters more to you than end-to-end encryption, a server-side app such as Immich is a better fit.',
  },
];
