// Copies the public game files into dist/ for Cloudflare Workers Assets (run by wrangler before deploy).
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..'), OUT = path.join(ROOT, 'dist');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'shared'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(OUT, 'index.html'));
fs.copyFileSync(path.join(ROOT, 'shared/game.js'), path.join(OUT, 'shared/game.js'));
const pngs = fs.readdirSync(path.join(ROOT, 'assets')).filter(f => /^[a-z_]+\.png$/.test(f));
for (const f of pngs) fs.copyFileSync(path.join(ROOT, 'assets', f), path.join(OUT, 'assets', f));
console.log(`dist/: index.html, shared/game.js, ${pngs.length} sprites`);
