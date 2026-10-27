// Renders every brand file from the geometry in mark.mjs.
//
//   node build.mjs [path/to/Inter-otf-dir]
//
// Writes the SVGs to branding/, the PNG renders to branding/export/, and the
// favicon and touch icon of the web client (web/public/) and the website
// (site/public/).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';
import opentype from 'opentype.js';
import { C, markGroup } from './mark.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const B = join(here, '..');
const X = join(B, 'export');
const WEB = join(B, '..', 'web', 'public');
const SITE = join(B, '..', 'site', 'public');
const fontDir = process.argv[2] ?? join(here, 'fonts');
mkdirSync(X, { recursive: true });

const semibold = opentype.parse(readFileSync(join(fontDir, 'Inter-SemiBold.otf')).buffer);
const medium = opentype.parse(readFileSync(join(fontDir, 'Inter-Medium.otf')).buffer);

// Text as outlined path, so no font ships or needs to be installed.
function text(font, str, x, y, size, fill, tracking = 0) {
  let d = '';
  let cx = x;
  for (const g of font.stringToGlyphs(str)) {
    d += g.getPath(cx, y, size).toPathData(2);
    cx += (g.advanceWidth / font.unitsPerEm) * size + tracking * size;
  }
  return { svg: `<path fill="${fill}" d="${d}"/>`, width: cx - x - tracking * size };
}

const svg = (w, h, body, vb = `0 0 ${w} ${h}`) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${w}" height="${h}">${body}</svg>\n`;
const render = (src, width) => new Resvg(src, { fitTo: { mode: 'width', value: width } }).render();
const png = (src, file, width) => writeFileSync(file, render(src, width).asPng());

// Store graphics must not have an alpha channel, so write a 24-bit PNG.
function opaquePng(src, file, width) {
  const img = render(src, width);
  const { width: w, height: h, pixels } = img;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      pixels.copy(raw, y * (w * 3 + 1) + 1 + x * 3, (y * w + x) * 4, (y * w + x) * 4 + 3);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

// Mark bounds on the 1024 grid: x 188..836, y 200..824.
const MARK_VB = '164 176 696 672';
const write = (name, s) => {
  writeFileSync(join(B, name), s);
  return s;
};
// Mark scaled by `s` and centred on a square canvas of side `side`.
const centred = (fill, s, side = 1024) =>
  markGroup(fill, { scale: s, dx: side / 2 - 512 * s, dy: side / 2 - 512 * s });

const tile = (rx = 0) =>
  svg(1024, 1024, `<rect width="1024" height="1024"${rx ? ` rx="${rx}"` : ''} fill="${C.indigo}"/>${markGroup(C.plaster)}`);
const tileSvg = write('logo-tile.svg', tile());
const faviconSvg = write('favicon.svg', tile(224));
write('logo-mark.svg', svg(696, 672, markGroup(C.indigo), MARK_VB));
write('logo-mark-light.svg', svg(696, 672, markGroup(C.plaster), MARK_VB));
write('logo-mono.svg', svg(696, 672, markGroup('#000000'), MARK_VB));

// Horizontal lockup: mark at 0.25 scale (162 x 156) beside the wordmark.
function lockup(markFill, wordFill) {
  const s = 0.25;
  const pad = 16;
  const mark = markGroup(markFill, { scale: s, dx: pad - 188 * s, dy: pad - 200 * s });
  const word = text(semibold, 'Kura Vault', pad + 162 + 44, pad + 118, 112, wordFill, -0.02);
  const w = Math.ceil(pad + 162 + 44 + word.width + pad);
  return svg(w, 156 + 2 * pad, mark + word.svg);
}
const lockupSvg = write('logo-lockup.svg', lockup(C.indigo, C.ink));
const lockupLightSvg = write('logo-lockup-light.svg', lockup(C.plaster, C.plaster));

// Banner: mark on the left, wordmark and tagline on the right.
function banner(w, h) {
  const k = Math.min(w / 1024, h / 500);
  const ox = (w - 1024 * k) / 2;
  const oy = (h - 500 * k) / 2;
  const mark = markGroup(C.plaster, { scale: 0.42 * k, dx: ox + (88 - 188 * 0.42) * k, dy: h / 2 - 512 * 0.42 * k });
  const word = text(semibold, 'Kura Vault', ox + 420 * k, oy + 240 * k, 84 * k, C.plaster, -0.02);
  const tag = text(medium, 'Your photos. Your server. Your keys.', ox + 423 * k, oy + 300 * k, 30 * k, C.indigoLight);
  if (ox + 420 * k + Math.max(word.width, tag.width) > w - 48 * k) throw new Error(`banner ${w}x${h}: text overflows`);
  return svg(w, h, `<rect width="${w}" height="${h}" fill="${C.indigo}"/>${mark}${word.svg}${tag.svg}`);
}
const featureSvg = write('play-feature-graphic.svg', banner(1024, 500));

// Android adaptive icon layers: the mark sits inside the 66dp-of-108dp safe circle.
const adaptiveFg = write('adaptive-foreground.svg', svg(1024, 1024, centred(C.plaster, 0.72)));
const adaptiveMono = write('adaptive-monochrome.svg', svg(1024, 1024, centred('#000000', 0.72)));

// macOS: a rounded tile inset on Apple's 1024 grid (824 body, ~185 radius).
const macos = svg(1024, 1024, `<rect x="100" y="100" width="824" height="824" rx="185" fill="${C.indigo}"/>${centred(C.plaster, 0.8)}`);

// Splash: the mark fits the 768px circle the Android 12 splash keeps visible.
const splash = (fill) => svg(1152, 1152, centred(fill, 0.88, 1152));

// Raster exports.
png(tileSvg, join(X, 'play-icon-512.png'), 512);
png(tileSvg, join(X, 'app-icon-1024.png'), 1024);
png(macos, join(X, 'macos-icon-1024.png'), 1024);
png(adaptiveFg, join(X, 'adaptive-foreground-1024.png'), 1024);
png(adaptiveMono, join(X, 'adaptive-monochrome-1024.png'), 1024);
png(splash(C.indigo), join(X, 'splash-light.png'), 1152);
png(splash(C.plaster), join(X, 'splash-dark.png'), 1152);
png(lockupSvg, join(X, 'logo-lockup.png'), 1200);
png(lockupLightSvg, join(X, 'logo-lockup-light.png'), 1200);
png(svg(696, 672, markGroup(C.indigo), MARK_VB), join(X, 'logo-mark-512.png'), 512);
opaquePng(featureSvg, join(X, 'play-feature-graphic-1024x500.png'), 1024);
opaquePng(banner(1280, 640), join(X, 'github-social-1280x640.png'), 1280);

// Web client and website.
for (const dir of [WEB, SITE]) {
  writeFileSync(join(dir, 'favicon.svg'), faviconSvg);
  png(tileSvg, join(dir, 'apple-touch-icon.png'), 180);
}

// Contrast of the pairs the brand uses.
const lum = (hex) => {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return ((x + 0.05) / (y + 0.05)).toFixed(2);
};
console.log(
  `contrast: plaster/aizome ${ratio(C.plaster, C.indigo)}, aizome/white ${ratio(C.indigo, '#ffffff')}, ` +
    `aizome-light/ink ${ratio(C.indigoLight, C.ink)}, aizome-light/aizome ${ratio(C.indigoLight, C.indigo)}`,
);
