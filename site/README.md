# Website

The static site at [kura.greytimelabs.com](https://kura.greytimelabs.com): the
landing page, the security model in plain language, comparisons, and the
privacy and account deletion pages the Google Play listing links to. The web
client is not here; it is in [`web/`](../web) and hosted at
kura-app.greytimelabs.com.

Built with [Astro](https://astro.build) and Tailwind. The output is plain HTML
with no inline script or style, so [`public/_headers`](public/_headers) can
send a strict Content-Security-Policy. The only script is
[`public/site.js`](public/site.js) (theme switch, copy button), plus Cloudflare
Web Analytics when `PUBLIC_CF_BEACON_TOKEN` is set at build time.

## Commands

```bash
pnpm install
pnpm dev        # http://localhost:4321
pnpm check      # type check
pnpm build      # dist/
pnpm validate   # HTML validation of dist/
pnpm links      # every internal link and #anchor in dist/ resolves
pnpm og         # redraw the link-preview cards in public/og/
```

`pnpm-workspace.yaml` makes pnpm resolve only versions published at least two
weeks ago. [`deploy-site.yml`](../.github/workflows/deploy-site.yml) deploys
`main`; see [self-hosting](../docs/self-hosting.md#the-website).

## Where the words come from

The site restates the repository's documentation; it must not say anything
those files do not.

| Page | Source of truth |
|---|---|
| Landing, FAQ (`src/data/faq.ts`) | [README](../README.md), [self-hosting](../docs/self-hosting.md) |
| `/security` | [security](../docs/security.md), [crypto](../docs/crypto/README.md) |
| `/privacy`, `/delete-account` | Greytimelabs' policy. Change the "Last updated" date with the text |
| `/compare/*` (`src/data/compare.ts`) | Each product's own documentation, linked on the page. Update `CHECKED` when re-checked |

Facts the pages repeat (URLs, the install command, the version) are in
`src/data/site.ts`. The version is read from `web/package.json`.

For search engines and AI assistants: every page has a canonical URL, Open
Graph and Twitter cards, and schema.org JSON-LD (`src/data/schema.ts`).
`/llms.txt` and `/llms-full.txt` are generated from the same data as the pages
(`src/data/llms.ts`), and `public/robots.txt` welcomes AI crawlers. Cloudflare's
"Block AI bots" setting for the zone must stay off, or it overrides that.

## Screenshots

The hero shows a drawn mockup (`src/components/mockups/AppMockup.astro`), not a
screenshot. To use real ones, take them on a demo server with demo photos,
never a real library:

| Shot | Size | Content |
|---|---|---|
| Web timeline | 2560 × 1600 | Timeline of a vault with 30+ photos, light theme |
| Android unlock | 1080 × 2340 | The vault passphrase screen |
| Android timeline | 1080 × 2340 | A vault's timeline |

Save them as AVIF or WebP under `src/assets/` and render them with Astro's
`<Image>` (explicit width and height), in place of the mockup.
