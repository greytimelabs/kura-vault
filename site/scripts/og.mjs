// Renders the link-preview cards in public/og/ (1200 x 630) and the logo the
// Organization schema points at. The PNGs are committed, like branding/export/,
// so the deploy needs neither fonts nor a renderer.
//
//   pnpm og
//
// Text is outlined with opentype.js, as in branding/tools/build.mjs, so the
// fonts are the site's own (Source Serif 4 and Inter, from @fontsource).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import opentype from 'opentype.js';
import { C, markGroup } from '../../branding/tools/mark.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'public', 'og');
mkdirSync(OUT, { recursive: true });

const require = createRequire(import.meta.url);
const font = (pkg, file) => {
  const buf = readFileSync(join(dirname(require.resolve(`${pkg}/package.json`)), 'files', file));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
};
const serif = font('@fontsource/source-serif-4', 'source-serif-4-latin-500-normal.woff');
const sans = font('@fontsource/inter', 'inter-latin-500-normal.woff');
const sansBold = font('@fontsource/inter', 'inter-latin-600-normal.woff');

const MUTED = '#545C6B';
const LINE = '#DDD4C4';

function measure(f, str, size, tracking = 0) {
  let w = 0;
  for (const g of f.stringToGlyphs(str)) w += (g.advanceWidth / f.unitsPerEm) * size + tracking * size;
  return w;
}

function text(f, str, x, y, size, fill, tracking = 0) {
  let d = '';
  let cx = x;
  for (const g of f.stringToGlyphs(str)) {
    d += g.getPath(cx, y, size).toPathData(2);
    cx += (g.advanceWidth / f.unitsPerEm) * size + tracking * size;
  }
  return `<path fill="${fill}" d="${d}"/>`;
}

function wrap(f, str, size, width) {
  const lines = [];
  let line = '';
  for (const word of str.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(f, next, size) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  lines.push(line);
  return lines;
}

function card({ eyebrow, title, subtitle }) {
  const W = 1200;
  const H = 630;
  const X = 88;
  const textW = W - X * 2;

  // The largest title size that fits in two lines
  let size = 72;
  let lines = wrap(serif, title, size, textW);
  while (lines.length > 2 || lines.some((l) => measure(serif, l, size) > textW)) {
    size -= 2;
    lines = wrap(serif, title, size, textW);
  }
  const lead = size * 1.12;

  let body = `<rect width="${W}" height="${H}" fill="${C.plaster}"/>`;
  body += `<rect x="0" y="${H - 14}" width="${W}" height="14" fill="${C.indigo}"/>`;
  // Brand row
  body += `<rect x="${X}" y="68" width="64" height="64" rx="14" fill="${C.indigo}"/>`;
  body += markGroup(C.plaster, { scale: 40 / 696, dx: X + 12 - 164 * (40 / 696), dy: 80 - 164 * (40 / 696) });
  body += text(sansBold, 'Kura Vault', X + 88, 112, 30, C.ink, -0.01);
  body += text(sansBold, eyebrow.toUpperCase(), X, 206, 20, MUTED, 0.12);

  let y = 206 + 24 + size;
  for (const l of lines) {
    body += text(serif, l, X, y, size, C.ink, -0.012);
    y += lead;
  }
  if (subtitle) {
    for (const l of wrap(sans, subtitle, 28, textW).slice(0, 1)) {
      body += text(sans, l, X, y + 10, 28, MUTED);
      y += 40;
    }
  }
  body += `<line x1="${X}" y1="${H - 92}" x2="${W - X}" y2="${H - 92}" stroke="${LINE}" stroke-width="2"/>`;
  body += text(sans, 'kura.greytimelabs.com', X, H - 50, 24, MUTED);
  const tag = 'Open source  ·  End-to-end encrypted';
  body += text(sans, tag, W - X - measure(sans, tag, 24), H - 50, 24, MUTED);

  if (y > H - 110) throw new Error(`"${title}": text runs into the footer`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
}

const cards = {
  home: {
    eyebrow: 'Self-hosted photo storage',
    title: 'Your photos, kept in a storehouse only you can open.',
    subtitle: 'Encrypted on your device. The server only ever holds ciphertext.',
  },
  security: {
    eyebrow: 'Security model',
    title: 'What Kura Vault protects, and where it stops',
    subtitle: 'AES-256-GCM, Argon2id, sealed and signed keys.',
  },
  compare: { eyebrow: 'Compare', title: 'How Kura Vault compares', subtitle: 'Immich, Ente, Google Photos, iCloud, PhotoPrism, Nextcloud' },
  'compare-immich': { eyebrow: 'Compare', title: 'Kura Vault vs Immich', subtitle: 'End-to-end encryption or server-side AI search' },
  'compare-ente': { eyebrow: 'Compare', title: 'Kura Vault vs Ente', subtitle: 'Two end-to-end encrypted photo apps' },
  'compare-google-photos-icloud': {
    eyebrow: 'Compare',
    title: 'Kura Vault vs Google Photos and iCloud',
    subtitle: 'A private alternative you run yourself',
  },
  'compare-photoprism-nextcloud': {
    eyebrow: 'Compare',
    title: 'Kura Vault vs PhotoPrism and Nextcloud',
    subtitle: 'Self-hosted, and hidden from the server admin',
  },
  privacy: { eyebrow: 'Legal', title: 'Privacy policy', subtitle: 'No analytics, advertising or tracking in the apps.' },
  'delete-account': { eyebrow: 'Legal', title: 'Delete your Kura Vault account', subtitle: '' },
};

const render = (svg, width) => new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();

for (const [name, spec] of Object.entries(cards)) {
  writeFileSync(join(OUT, `${name}.png`), render(card(spec), 1200));
  console.log(`og/${name}.png`);
}

// Logo for the Organization schema: the app tile, as branding/logo-tile.svg draws it
const tile = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="${C.indigo}"/>${markGroup(C.plaster)}</svg>`;
writeFileSync(join(OUT, 'logo.png'), render(tile, 512));
console.log('og/logo.png');
