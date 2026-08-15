import { defineConfig } from "vite";

/**
 * BlockBook build config.
 *
 * root:      src/ holds index.html and every module (docs/02-TRD.md §8).
 * publicDir: data/ is copied to the site root, so `fetch("./seed.json")` works
 *            identically in dev, in a production build, and inside the Tauri
 *            asset protocol — without duplicating data/seed.json anywhere.
 * outDir:    dist/ at the project root, which tauri.conf.json points at.
 */
export default defineConfig({
  root: "src",
  publicDir: "../data",
  // Tauri expects a fixed port and must fail rather than silently pick another.
  server: { port: 1420, strictPort: true },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "esnext",          // WebView2 on Windows 11 is evergreen Chromium
    sourcemap: true,
  },
  clearScreen: false,          // don't wipe Rust compiler output
});
