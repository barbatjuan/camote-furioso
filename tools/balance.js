// Headless balance check: a simple bot plays full runs and reports the wave reached.
// Usage: node tools/balance.js [runsPerDanger=6] [players=1]
'use strict';
const CF = require('../shared/game.js');
const RUNS = +process.argv[2] || 6, PLAYERS = +process.argv[3] || 1;
const PICK = ['maxHp', 'dmg', 'atkSpd', 'armor', 'regen', 'ranged', 'melee', 'lifesteal', 'speed', 'dodge'];

function botInput(W, p) {
  // flee from nearby enemies and bullets, drift toward materials and the arena center
  let fx = 0, fy = 0;
  for (const e of W.enemies) {
    if (CF.EN[e.type].neutral) continue;
    const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
    if (d < 320) { const w = ((320 - d) / 320) ** 2 * 3 * (e.boss ? 3 : 1); fx += dx / d * w; fy += dy / d * w; }
  }
  const m = 160, A = CF.ARENA;  // stay out of corners
  if (p.x < m) fx += (m - p.x) / m * 2; if (p.x > A.w - m) fx -= (p.x - (A.w - m)) / m * 2;
  if (p.y < m) fy += (m - p.y) / m * 2; if (p.y > A.h - m) fy -= (p.y - (A.h - m)) / m * 2;
  for (const b of W.eprojs) { const dx = p.x - b.x, dy = p.y - b.y, d = Math.hypot(dx, dy) || 1; if (d < 140) { fx += dx / d * 1.5; fy += dy / d * 1.5; } }
  let best = null, bd = 1e9;
  for (const d of W.drops) { const dd = (d.x - p.x) ** 2 + (d.y - p.y) ** 2; if (dd < bd) { bd = dd; best = d; } }
  if (best && bd < 300 * 300) { const d = Math.sqrt(bd) || 1; fx += (best.x - p.x) / d * .6; fy += (best.y - p.y) / d * .6; }
  fx += (CF.ARENA.w / 2 - p.x) / 1500; fy += (CF.ARENA.h / 2 - p.y) / 1500;
  return [fx, fy];
}
function botShop(W, id) {
  const p = W.players[id];
  while (p.stage === 'level') {
    const opts = p.lvOpts; let bi = 0, bs = -1;
    opts.forEach((o, i) => { const s = (PICK.length - Math.max(0, PICK.indexOf(o.k))) * o.tier; if (s > bs) { bs = s; bi = i; } });
    CF.act(W, id, 'lvpick', bi);
  }
  for (let guard = 0; guard < 6; guard++) {
    let bought = false;
    p.shop.slots.forEach((sl, i) => {
      if (sl.sold || sl.offer.price > p.mats) return;
      const o = sl.offer;
      const want = o.kind === 'w' ? (p.weapons.length < 6 || p.weapons.some(w => w.id === o.id && w.tier === o.tier)) : true;
      if (want && CF.act(W, id, 'buy', i)) bought = true;
    });
    p.weapons.forEach((_, i) => CF.act(W, id, 'combine', i));
    if (!bought && p.mats > p.shop.rerollCost + 30) CF.act(W, id, 'reroll'); else if (!bought) break;
  }
  CF.act(W, id, 'ready');
}
function run(danger) {
  const W = CF.createWorld(); W.danger = danger;
  const chars = ['comun', 'bravo', 'tirador', 'granjero'];
  for (let i = 0; i < PLAYERS; i++) CF.addPlayer(W, 'p' + i, 'Bot' + i, chars[(Math.random() * 4) | 0]);
  CF.startRun(W);
  let maxEnemies = 0;
  for (let t = 0; t < 30 * 60 * 40 && !['over', 'win'].includes(W.phase); t++) {
    if (W.phase === 'wave') {
      for (const id of W.order) { const p = W.players[id]; if (!p.dead) CF.setInput(W, id, ...botInput(W, p)); }
      CF.step(W, 1 / 30); W.events = [];
      maxEnemies = Math.max(maxEnemies, W.enemies.length);
    } else if (W.phase === 'intermission') for (const id of W.order) if (!W.players[id].ready) botShop(W, id);
  }
  const p = W.players.p0;
  return { wave: W.wave, won: W.phase === 'win', level: p.level, weapons: p.weapons.map(w => w.id[0] + w.tier).join(''), maxEnemies };
}
for (const d of [0, 2, 3, 5]) {
  const res = Array.from({ length: RUNS }, () => run(d));
  const waves = res.map(r => r.won ? 'W' : r.wave);
  console.log(`Peligro ${d}: oleadas ${waves.join(' ')} | media ${(res.reduce((a, r) => a + r.wave, 0) / RUNS).toFixed(1)} | ganadas ${res.filter(r => r.won).length}/${RUNS} | max enemigos ${Math.max(...res.map(r => r.maxEnemies))}`);
}
