// Build everything: web client (used by browser, Electron, Android and the LAN host), single-file
// artifact page, and the Node server bundle.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const dev = process.argv.includes('--dev');
const out = 'dist';
fs.mkdirSync(path.join(out, 'web'), { recursive: true });
fs.mkdirSync(path.join(out, 'artifact'), { recursive: true });

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

const client = await esbuild.build({
  entryPoints: ['src/client/main.js'],
  bundle: true, format: 'iife', minify: !dev, sourcemap: false, write: false, target: ['es2020', 'chrome90', 'safari15'],
  loader: { '.css': 'text', '.woff2': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
});
const js = client.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

const head = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<meta name="theme-color" content="#0b0f13">
<title>MechForce</title>`;
const fullPage = `<!doctype html>
<html lang="en"><head>${head}
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M32 4 58 19v26L32 60 6 45V19z" fill="#121a21" stroke="#ffb23e" stroke-width="4"/><path d="M20 44V22l12 12 12-12v22" fill="none" stroke="#ffb23e" stroke-width="5"/></svg>')}">
</head><body>
<script>${js}</script>
</body></html>
`;
fs.writeFileSync(path.join(out, 'web', 'index.html'), fullPage);

// Artifact host wraps the page in its own document skeleton.
const artifact = `<title>MechForce</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>html,body{height:100%;margin:0;background:#0b0f13;color:#e9edf1;overflow:hidden}</style>
<script>${js}</script>
`;
fs.writeFileSync(path.join(out, 'artifact', 'mechforce.html'), artifact);

await esbuild.build({
  entryPoints: ['server/server.js'],
  bundle: true, platform: 'node', format: 'cjs', target: 'node18', outfile: path.join(out, 'server.cjs'),
  external: ['bufferutil', 'utf-8-validate'], minify: false, legalComments: 'none',
  logLevel: 'error',
});

console.log(`MechForce ${pkg.version}: web ${(fullPage.length / 1024).toFixed(0)} KB, server ${(fs.statSync(path.join(out, 'server.cjs')).size / 1024).toFixed(0)} KB`);
