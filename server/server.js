// Camote Furioso co-op server for local play: serves the game files and runs the rooms (server/rooms.js).
// Run: npm start   (PORT env var, default 8080). The hosted version runs on Cloudflare (worker/index.js).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const CF = require('../shared/game.js');
const { createLobby } = require('./rooms.js');

const PORT = +process.env.PORT || 8080;
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = new Set(['index.html', 'shared/game.js']);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  const ok = PUBLIC.has(rel) || /^assets\/[a-z_]+\.png$/.test(rel);
  if (rel === 'health') { res.writeHead(200); return res.end('ok'); }
  if (!ok) { res.writeHead(404); return res.end('No encontrado'); }
  const file = path.join(ROOT, rel);
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('No encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
});

const lobby = createLobby(CF);
const wss = new WebSocketServer({ server, maxPayload: 4096, perMessageDeflate: { threshold: 1024 } });
wss.on('connection', ws => {
  const c = lobby.connect({ send: s => ws.send(s), open: () => ws.readyState === 1, slow: () => ws.bufferedAmount > 1 << 20 });
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => lobby.message(c, String(raw)));
  ws.on('close', () => lobby.close(c));
});
lobby.loop(() => Number(process.hrtime.bigint() / 1000n) / 1000);

// drop dead connections
setInterval(() => {
  for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); }
}, 15000);

server.listen(PORT, () => console.log(`Camote Furioso en http://localhost:${PORT}`));
