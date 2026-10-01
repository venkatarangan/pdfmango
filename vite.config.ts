/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// GitHub Pages cannot set headers, so the policy ships as a <meta> tag. It is added to built pages
// only: the dev server needs inline scripts and a websocket for hot reload.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://www.googletagmanager.com",
  "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com",
  "img-src 'self' data: blob: https://*.google-analytics.com https://www.googletagmanager.com",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

/** Fills %PDFMANGO_VERSION% in the HTML pages, so the footer always matches package.json. */
function appVersion(): Plugin {
  return { name: 'pdfmango-version', transformIndexHtml: (html) => html.replaceAll('%PDFMANGO_VERSION%', pkg.version) };
}

function contentSecurityPolicy(): Plugin {
  return {
    name: 'pdfmango-csp',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
  };
}

export default defineConfig({
  base: '/',
  plugins: [
    svelte(),
    appVersion(),
    contentSecurityPolicy(),
    // Offline support: the service worker precaches the app's own files (including the WASM
    // engine) and nothing else. No runtime caching, so user files and analytics are never stored.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script', // external registerSW.js, so the CSP needs no inline script
      includeAssets: ['favicon.png', 'brand/mangoidiots-logo.png', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'PDFMango',
        short_name: 'PDFMango',
        description: 'Merge, reorder, rotate and compress PDFs. Your files never leave your device.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#ffffff',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,png,svg,webmanifest}'],
        globIgnores: ['social-preview.png'],
        maximumFileSizeToCacheInBytes: 16 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackAllowlist: [/^\/$/],
        cleanupOutdatedCaches: true,
        clientsClaim: true, // control the page on the first visit, so it works offline straight away
        skipWaiting: true,
        runtimeCaching: [],
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    rollupOptions: {
      // MuPDF's glue imports node:fs/module only when running under Node; harmless in the browser.
      onLog(level, log, handler) {
        if (/externalized for browser compatibility/.test(log.message)) return;
        handler(level, log);
      },
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        about: resolve(import.meta.dirname, 'about/index.html'),
      },
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
