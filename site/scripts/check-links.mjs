// Fails if a page in dist/ links to a page, file or #anchor that the build did
// not produce. Resolves paths the way Cloudflare Pages serves them: /security
// is security.html. External links are not fetched.
//
//   node scripts/check-links.mjs   (after pnpm build)
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const SITE = 'https://kura.greytimelabs.com';

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const pages = walk(DIST).filter((f) => f.endsWith('.html'));

// Redirects in _redirects are valid targets too
const redirected = new Set(
  readFileSync(join(DIST, '_redirects'), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => l.split(/\s+/)[0]),
);

function fileFor(path) {
  if (path === '/' || path === '') return join(DIST, 'index.html');
  const p = join(DIST, decodeURIComponent(path));
  for (const candidate of [p, `${p}.html`, join(p, 'index.html')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const ids = new Map();
const idsOf = (file) => {
  if (!ids.has(file)) ids.set(file, new Set([...readFileSync(file, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  return ids.get(file);
};

const failures = [];
for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  for (const [, attr, raw] of html.matchAll(/\s(href|src)="([^"]+)"/g)) {
    let url = raw.replaceAll('&amp;', '&');
    if (url.startsWith(SITE)) url = url.slice(SITE.length) || '/';
    if (/^[a-z]+:/i.test(url) || url.startsWith('//')) continue;
    const [path, hash] = url.split('#');
    const target = path ? fileFor(path.split('?')[0]) : page;
    const where = `${relative(DIST, page)}: ${attr}="${raw}"`;
    if (!target) {
      if (!redirected.has(path)) failures.push(`${where} → no such file`);
      continue;
    }
    if (hash && target.endsWith('.html') && !idsOf(target).has(hash)) failures.push(`${where} → no #${hash}`);
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`${pages.length} pages, all internal links resolve`);
