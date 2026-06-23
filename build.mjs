import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';

const outdir = 'dist';

// Ensure dist exists
if (!existsSync(outdir)) mkdirSync(outdir, { recursive: true });

// Build content script (IIFE — no module system in content scripts)
await esbuild.build({
  entryPoints: ['src/content/extract-page.ts'],
  bundle: true,
  outfile: `${outdir}/content/extract-page.js`,
  format: 'iife',
  target: 'chrome120',
});

// Build service worker (ESM — manifest declares type: module)
await esbuild.build({
  entryPoints: ['src/service-worker/index.ts'],
  bundle: true,
  outfile: `${outdir}/service-worker/index.js`,
  format: 'esm',
  target: 'chrome120',
});

// Build side panel React app
await esbuild.build({
  entryPoints: ['src/sidepanel/main.tsx'],
  bundle: true,
  outfile: `${outdir}/sidepanel/main.js`,
  format: 'iife',
  target: 'chrome120',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
});

// Build popup script (IIFE — script running inside extension action popup)
await esbuild.build({
  entryPoints: ['src/popup/popup.ts'],
  bundle: true,
  outfile: `${outdir}/popup/popup.js`,
  format: 'iife',
  target: 'chrome120',
});

// Copy static HTML files
function copyStatic(src, dest) {
  const dir = dirname(dest);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  copyFileSync(src, dest);
}

copyStatic('src/sidepanel/index.html', `${outdir}/sidepanel/index.html`);
copyStatic('src/sidepanel/styles.css', `${outdir}/sidepanel/styles.css`);
copyStatic('src/popup/index.html', `${outdir}/popup/index.html`);

// Copy manifest.json → dist/manifest.json (already points to dist-relative paths)
copyStatic('manifest.json', `${outdir}/manifest.json`);

console.log('Extension build complete → dist/');
