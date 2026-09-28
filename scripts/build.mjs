// Builds the Pages app (dist/app.js) and the engine copied into user repositories (dist/engine/draw.mjs).
// `node scripts/build.mjs --serve` rebuilds on change and serves the site on http://localhost:4173.
import * as esbuild from 'esbuild';

import { ENGINE_BANNER_PREFIX, ENGINE_VERSION } from '../src/shared/version.js';

const serve = process.argv.includes('--serve');

const engine = {
  entryPoints: ['engine/draw.mjs'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'dist/engine/draw.mjs',
  banner: { js: `${ENGINE_BANNER_PREFIX}${ENGINE_VERSION}\n// Installed by GitToPaint. Do not edit: saving your drawing replaces this file.` },
  logLevel: 'info',
};

const app = {
  entryPoints: ['src/app.js'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  loader: { '.js': 'jsx', '.woff': 'file', '.woff2': 'file' },
  outfile: 'dist/app.js',
  minify: !serve,
  logLevel: 'info',
};

await esbuild.build(engine);

if (serve) {
  const context = await esbuild.context(app);
  await context.watch();
  const { port } = await context.serve({ servedir: '.', port: 4173 });
  console.log(`GitToPaint dev server on http://localhost:${port}`);
} else {
  await esbuild.build(app);
}
