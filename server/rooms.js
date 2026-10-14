// Room manager shared by the Node server (server/server.js) and the Cloudflare Durable Object (worker/index.js).
// A socket is any object with send(string), open() and slow() (true when the client is too far behind).
'use strict';

const TICK = 1 / 30;          // simulation step (s)
const SEND_EVERY = 2;         // send a snapshot every N ticks (15 Hz)
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function createLobby(CF) {
  const rooms = new Map();
  let nextPid = 1, clients = 0;

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
  function safeSend(sock, s) { try { if (sock.open()) sock.send(s); } catch (e) { } }
  function broadcast(room, msg) { const s = JSON.stringify(msg); for (const c of room.clients.values()) safeSend(c.sock, s); }
  function sendState(room) {
    const W = room.world, events = W.events; W.events = [];
    for (const [id, c] of room.clients) {
      if (c.sock.slow()) continue;  // skip slow clients instead of piling up
      safeSend(c.sock, JSON.stringify({ t: 'state', s: CF.snapshot(W, id), ev: events }));
    }
  }
  function leave(c) {
    const room = c.room; if (!room) return;
    room.clients.delete(c.pid);
    CF.removePlayer(room.world, c.pid);
    c.room = null;
    if (!room.clients.size) { rooms.delete(room.code); return; }
    if (room.host === c.pid) room.host = room.clients.keys().next().value;
    broadcast(room, lobbyInfo(room));
  }

  function connect(sock) { clients++; return { pid: 'p' + nextPid++, room: null, sock, closed: false }; }
  function close(c) { if (c.closed) return; c.closed = true; clients--; leave(c); }

  function message(c, raw) {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    const room = c.room, sock = c.sock;
    const reply = msg => safeSend(sock, JSON.stringify(msg));
    const err = msg => reply({ t: 'error', msg });
    switch (m.t) {
      case 'create': {
        if (room) return;
        const r = createRoom();
        CF.addPlayer(r.world, c.pid, m.name, m.char);
        r.clients.set(c.pid, c); r.host = c.pid; c.room = r;
        reply({ t: 'joined', code: r.code, you: c.pid });
        broadcast(r, lobbyInfo(r));
        break;
      }
      case 'join': {
        if (room) return;
        const r = rooms.get(String(m.code || '').toUpperCase().trim());
        if (!r) return err('No existe una sala con ese código.');
        if (r.world.phase !== 'lobby') return err('Esa partida ya empezó. Espera a que vuelvan al lobby.');
        if (!CF.addPlayer(r.world, c.pid, m.name, m.char)) return err(`La sala está llena (máximo ${CF.MAX_PLAYERS}).`);
        r.clients.set(c.pid, c); c.room = r;
        reply({ t: 'joined', code: r.code, you: c.pid });
        broadcast(r, lobbyInfo(r));
        break;
      }
      case 'char':
        if (room) { CF.setChar(room.world, c.pid, m.char); broadcast(room, lobbyInfo(room)); }
        break;
      case 'danger':
        if (room && room.host === c.pid) { CF.setDanger(room.world, m.d); broadcast(room, lobbyInfo(room)); }
        break;
      case 'start':
        if (room && room.host === c.pid && ['lobby', 'over', 'win'].includes(room.world.phase)) {
          CF.startRun(room.world); room.world.events = [];
          broadcast(room, lobbyInfo(room));
        }
        break;
      case 'lobby':
        if (room && room.host === c.pid && ['over', 'win'].includes(room.world.phase)) {
          room.world.phase = 'lobby';
          broadcast(room, lobbyInfo(room));
        }
        break;
      case 'input':
        if (room) CF.setInput(room.world, c.pid, m.mx, m.my, m.seq);
        break;
      case 'act':
        if (room && CF.act(room.world, c.pid, String(m.a), m.arg)) sendState(room);
        break;
      case 'leave':
        leave(c);
        break;
    }
  }

  // advance every room by one TICK
  function step() {
    for (const room of rooms.values()) {
      const W = room.world, before = W.phase;
      CF.step(W, TICK);
      if (++room.tick % SEND_EVERY === 0 || W.phase !== before) {
        if (W.phase !== 'lobby') sendState(room);
        if (W.phase !== before) broadcast(room, lobbyInfo(room));
      }
    }
  }

  // runs step() at a fixed rate; returns a stop function
  function loop(now) {
    let last = now(), acc = 0;
    const timer = setInterval(() => {
      const t = now();
      acc = Math.min(.25, acc + (t - last) / 1000); last = t;
      while (acc >= TICK) { acc -= TICK; step(); }
    }, 1000 * TICK / 2);
    return () => clearInterval(timer);
  }

  return { connect, message, close, step, loop, clientCount: () => clients };
}

module.exports = { createLobby, TICK };
