// The marketing site at kura.greytimelabs.com. Static HTML with no inline
// script or style, so public/_headers can send a strict CSP.
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://kura.greytimelabs.com',
  trailingSlash: 'never',
  // Compression drops the space between a line of text and a link on the next line
  compressHTML: false,
  build: { format: 'file', inlineStylesheets: 'never' },
  integrations: [sitemap({ filter: (page) => !page.endsWith('/404') })],
  vite: {
    plugins: [tailwindcss()],
    // Nothing inlined as a data: URL or inline <script>
    build: { assetsInlineLimit: 0 },
    // Reads the version from web/package.json
    server: { fs: { allow: ['..'] } },
  },
});
