// Cloudflare entry point: static files come from Workers Assets (dist/, built by tools/build-cf.js);
// WebSocket connections on /ws go to one Durable Object that runs every room (server/rooms.js).
import CF from '../shared/game.js';
import { createLobby } from '../server/rooms.js';

export class Lobby {
  constructor(state, env) {
    this.lobby = createLobby(CF);
    this.stop = null;
  }
  async fetch(req) {
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const c = this.lobby.connect({ send: s => server.send(s), open: () => server.readyState === 1, slow: () => false });
    server.addEventListener('message', e => { if (typeof e.data === 'string' && e.data.length <= 4096) this.lobby.message(c, e.data); });
    const bye = () => {
      this.lobby.close(c);
      if (!this.lobby.clientCount() && this.stop) { this.stop(); this.stop = null; }  // let the object sleep when nobody plays
    };
    server.addEventListener('close', bye);
    server.addEventListener('error', bye);
    if (!this.stop) this.stop = this.lobby.loop(() => Date.now());
    return new Response(null, { status: 101, webSocket: client });
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Se esperaba WebSocket', { status: 426 });
      return env.LOBBY.get(env.LOBBY.idFromName('global')).fetch(req);
    }
    if (url.pathname === '/health') return new Response('ok');
    return env.ASSETS.fetch(req);
  }
};
