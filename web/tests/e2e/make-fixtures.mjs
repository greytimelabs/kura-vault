// One-off generator for tests/fixtures. Run with: node tests/e2e/make-fixtures.mjs
// Uses the image library the migration CLI already depends on.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../../migration-cli/package.json', import.meta.url));
const sharp = require('sharp');
const out = fileURLToPath(new URL('../fixtures/', import.meta.url));
mkdirSync(out, { recursive: true });

const picture = (width, height, from, to, text) =>
  sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
        </linearGradient></defs>
        <rect width="100%" height="100%" fill="url(#g)"/>
        <circle cx="${width * 0.7}" cy="${height * 0.35}" r="${height * 0.18}" fill="#fff" fill-opacity="0.85"/>
        <text x="50%" y="88%" font-family="Helvetica" font-size="${height * 0.12}" fill="#fff" text-anchor="middle">${text}</text>
      </svg>`,
    ),
  );

await picture(1600, 1200, '#c0392b', '#f39c12', 'march')
  .jpeg({ quality: 88 })
  .withExif({ IFD2: { DateTimeOriginal: '2024:03:15 10:30:00' } })
  .toFile(out + 'march.jpg');

await picture(1200, 1600, '#16a085', '#2980b9', 'portrait').png().toFile(out + 'portrait.png');
await picture(1400, 900, '#8e44ad', '#2c3e50', 'wide').webp({ quality: 85 }).toFile(out + 'wide.webp');
console.log('fixtures written to', out);
