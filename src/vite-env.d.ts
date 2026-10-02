/// <reference types="svelte" />
/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

// mammoth's self-contained browser build (UMD); its API is typed where it is used (src/worker/convert.ts).
declare module 'mammoth/mammoth.browser.min.js';
