// Camote Furioso co-op server: serves the game files and runs one authoritative simulation per room.
// Run: npm start   (PORT env var, default 8080)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const CF = require('../shared/game.js');

const PORT = +process.env.PORT || 8080;
const ROOT = path.resolve(__dirname, '..');
const TICK = 1 / 30;          // simulation step (s)
const SEND_EVERY = 2;         // send a snapshot every N ticks (15 Hz)
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

/* ---------- Rooms ---------- */
const rooms = new Map();
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function newCode() {
  let c;
  do { c = Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join(''); } while (rooms.has(c));
  return c;
}
function createRoom() {
  const room = { code: newCode(), world: CF.createWorld(), clients: new Map(), host: null, tick: 0 };
  rooms.set(room.code, room);
  return room;
}
function lobbyInfo(room) {
  const W = room.world;
  return {
    t: 'lobby', code: room.code, host: room.host, phase: W.phase, danger: W.danger,
    players: W.order.map(id => ({ id, name: W.players[id].name, char: W.players[id].char }))
  };
}
function broadcast(room, msg) { const s = JSON.stringify(msg); for (const ws of room.clients.values()) if (ws.readyState === 1) ws.send(s); }
function sendState(room) {
  const W = room.world, events = W.events; W.events = [];
  for (const [id, ws] of room.clients) {
    if (ws.readyState !== 1 || ws.bufferedAmount > 1 << 20) continue;  // skip slow clients instead of piling up
    ws.send(JSON.stringify({ t: 'state', s: CF.snapshot(W, id), ev: events }));
  }
}
function leave(ws) {
  const room = ws.room; if (!room) return;
  room.clients.delete(ws.pid);
  CF.removePlayer(room.world, ws.pid);
  ws.room = null;
  if (!room.clients.size) { rooms.delete(room.code); return; }
  if (room.host === ws.pid) room.host = room.clients.keys().next().value;
  broadcast(room, lobbyInfo(room));
}

/* ---------- WebSocket ---------- */
const wss = new WebSocketServer({ server, maxPayload: 4096, perMessageDeflate: { threshold: 1024 } });
let nextPid = 1;
wss.on('connection', ws => {
  ws.pid = 'p' + nextPid++;
  ws.room = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  const err = msg => ws.send(JSON.stringify({ t: 'error', msg }));

  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    const room = ws.room;
    switch (m.t) {
      case 'create': {
        if (room) return;
        const r = createRoom();
        CF.addPlayer(r.world, ws.pid, m.name, m.char);
        r.clients.set(ws.pid, ws); r.host = ws.pid; ws.room = r;
        ws.send(JSON.stringify({ t: 'joined', code: r.code, you: ws.pid }));
        broadcast(r, lobbyInfo(r));
        break;
      }
      case 'join': {
        if (room) return;
        const r = rooms.get(String(m.code || '').toUpperCase().trim());
        if (!r) return err('No existe una sala con ese código.');
        if (r.world.phase !== 'lobby') return err('Esa partida ya empezó. Espera a que vuelvan al lobby.');
        if (!CF.addPlayer(r.world, ws.pid, m.name, m.char)) return err(`La sala está llena (máximo ${CF.MAX_PLAYERS}).`);
        r.clients.set(ws.pid, ws); ws.room = r;
        ws.send(JSON.stringify({ t: 'joined', code: r.code, you: ws.pid }));
        broadcast(r, lobbyInfo(r));
        break;
      }
      case 'char':
        if (room) { CF.setChar(room.world, ws.pid, m.char); broadcast(room, lobbyInfo(room)); }
        break;
      case 'danger':
        if (room && room.host === ws.pid) { CF.setDanger(room.world, m.d); broadcast(room, lobbyInfo(room)); }
        break;
      case 'start':
        if (room && room.host === ws.pid && ['lobby', 'over', 'win'].includes(room.world.phase)) {
          CF.startRun(room.world); room.world.events = [];
          broadcast(room, lobbyInfo(room));
        }
        break;
      case 'lobby':
        if (room && room.host === ws.pid && ['over', 'win'].includes(room.world.phase)) {
          room.world.phase = 'lobby';
          broadcast(room, lobbyInfo(room));
        }
        break;
      case 'input':
        if (room) CF.setInput(room.world, ws.pid, m.mx, m.my, m.seq);
        break;
      case 'act':
        if (room && CF.act(room.world, ws.pid, String(m.a), m.arg)) sendState(room);
        break;
      case 'leave':
        leave(ws);
        break;
    }
  });
  ws.on('close', () => leave(ws));
});

/* ---------- Loops ---------- */
let last = process.hrtime.bigint(), acc = 0;
setInterval(() => {
  const now = process.hrtime.bigint();
  acc += Number(now - last) / 1e9; last = now;
  if (acc > .25) acc = .25;
  while (acc >= TICK) {
    acc -= TICK;
    for (const room of rooms.values()) {
      const W = room.world, before = W.phase;
      CF.step(W, TICK);
      if (++room.tick % SEND_EVERY === 0 || W.phase !== before) {
        if (W.phase !== 'lobby') sendState(room);
        if (W.phase !== before) broadcast(room, lobbyInfo(room));
      }
    }
  }
}, 1000 * TICK / 2);

// drop dead connections
setInterval(() => {
  for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); }
}, 15000);

server.listen(PORT, () => console.log(`Camote Furioso en http://localhost:${PORT}`));
