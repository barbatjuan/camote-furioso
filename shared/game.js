/* Camote Furioso — shared simulation.
 * Runs unchanged in the browser (solo mode, exposes window.CF) and in Node (authoritative co-op server).
 * The world is plain data: no DOM, no closures, so it can be stepped anywhere and snapshotted to JSON.
 * Visual feedback (damage numbers, bursts, explosions) is emitted as world.events for the renderer to consume.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod; else root.CF = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  function weighted(list) { let s = 0; for (const [, w] of list) s += w; let r = Math.random() * s; for (const [k, w] of list) { if ((r -= w) <= 0) return k; } return list[0][0]; }
  const r1 = v => Math.round(v * 10) / 10;
  const r2 = v => Math.round(v * 100) / 100;

  const ARENA = { w: 1600, h: 1100 };
  const MAX_WAVES = 20;
  const MAX_PLAYERS = 4;

  /* ---------- Data ---------- */
  const STAT_INFO = {
    maxHp: ['HP máx', ''], regen: ['Regeneración', ''], lifesteal: ['Robo de vida', '%'], dmg: ['Daño', '%'],
    melee: ['Daño cuerpo a cuerpo', ''], ranged: ['Daño a distancia', ''], atkSpd: ['Vel. de ataque', '%'],
    crit: ['Crítico', '%'], range: ['Alcance', ''], armor: ['Armadura', ''], dodge: ['Esquivar', '%'],
    speed: ['Velocidad', '%'], luck: ['Suerte', ''], harvest: ['Cosecha', ''], pickup: ['Rango de recogida', '']
  };
  const BASE_STATS = { maxHp: 10, regen: 0, lifesteal: 0, dmg: 0, melee: 0, ranged: 0, atkSpd: 0, crit: 0, range: 0, armor: 0, dodge: 0, speed: 0, luck: 0, harvest: 0, pickup: 0 };

  const WEAPONS = {
    pistola:    { name: 'Pistola', kind: 'ranged', dmg: [12, 20, 30, 50], cd: [1.2, 1.12, 1.03, .87], range: 400, scale: { ranged: 1 }, speed: 950, pierce: [0, 0, 1, 1], crit: .05, critMul: 2, knock: 20, price: 16, color: '#ffd166' },
    metralleta: { name: 'Metralleta', kind: 'ranged', dmg: [3, 4, 5, 8], cd: [.18, .17, .15, .13], range: 330, scale: { ranged: .5 }, speed: 900, spread: .18, crit: .01, critMul: 2, knock: 3, price: 30, color: '#ffe08a' },
    escopeta:   { name: 'Escopeta', kind: 'ranged', dmg: [4, 6, 9, 13], pellets: [4, 5, 6, 7], cd: [1.35, 1.28, 1.18, 1.05], range: 300, scale: { ranged: .75 }, speed: 820, spread: .55, pierce: [1, 1, 1, 2], crit: .03, critMul: 1.75, knock: 25, price: 24, color: '#ffb36b' },
    laser:      { name: 'Rayo láser', kind: 'ranged', dmg: [18, 30, 48, 80], cd: [2, 1.85, 1.7, 1.5], range: 480, scale: { ranged: 1.5 }, speed: 1500, pierce: [3, 4, 5, 6], crit: .03, critMul: 2, knock: 5, price: 32, color: '#6fe3ff', beam: true },
    cuchillo:   { name: 'Cuchillo', kind: 'melee', style: 'thrust', dmg: [7, 11, 17, 28], cd: [.85, .8, .74, .65], range: 140, scale: { melee: .8 }, crit: .2, critMul: 2.5, knock: 10, price: 14, color: '#dfe6ee' },
    palo:       { name: 'Palo', kind: 'melee', style: 'sweep', dmg: [10, 16, 25, 42], cd: [1.15, 1.08, 1, .9], range: 150, scale: { melee: 1 }, crit: .03, critMul: 2, knock: 55, price: 12, color: '#b07a45' },
    ballesta:   { name: 'Ballesta', kind: 'ranged', dmg: [15, 25, 40, 65], cd: [1.4, 1.3, 1.2, 1.05], range: 450, scale: { ranged: 1 }, speed: 1100, pierce: [2, 3, 4, 5], crit: .1, critMul: 2, knock: 15, price: 22, color: '#e8d9b0', bolt: true },
    lanzallamas:{ name: 'Lanzallamas', kind: 'ranged', dmg: [2, 3, 4, 6], cd: [.12, .11, .1, .09], range: 200, scale: { ranged: .35 }, speed: 430, spread: .4, pierce: [9, 9, 9, 9], crit: 0, critMul: 1, knock: 0, price: 35, color: '#ff8a3d', flame: true },
    espada:     { name: 'Espada', kind: 'melee', style: 'sweep', dmg: [14, 22, 34, 55], cd: [1, .95, .88, .8], range: 165, scale: { melee: 1.2 }, crit: .08, critMul: 2, knock: 30, price: 30, color: '#dfe6ee' },
    lanza:      { name: 'Lanza', kind: 'melee', style: 'thrust', dmg: [12, 19, 30, 48], cd: [1.1, 1.05, .98, .9], range: 225, scale: { melee: 1 }, crit: .06, critMul: 2, knock: 25, price: 24, color: '#c9d2da' },
    bazuca:     { name: 'Bazuca', kind: 'ranged', dmg: [20, 32, 50, 80], cd: [2.4, 2.25, 2.1, 1.9], range: 420, scale: { ranged: 1 }, speed: 600, explode: [70, 80, 90, 110], crit: .03, critMul: 2, knock: 40, price: 40, color: '#ff5d3d', rocket: true },
    varita:     { name: 'Varita', kind: 'ranged', dmg: [8, 13, 20, 32], cd: [.9, .85, .78, .7], range: 380, scale: { ranged: .6 }, speed: 520, crit: .05, critMul: 2, knock: 8, price: 26, color: '#c77dff', homing: true },
  };
  // Sprite length in world units for each weapon (sprites are horizontal, pointing right).
  const WEAPON_LEN = { pistola: 30, metralleta: 40, escopeta: 50, laser: 38, cuchillo: 36, palo: 46, ballesta: 46, lanzallamas: 46, espada: 54, lanza: 70, bazuca: 54, varita: 40 };
  const WEAPON_TIER_MULT = [1, 2, 3.6, 6.5];

  const ITEMS = [
    { id: 'taco', name: 'Taco de proteína', tier: 1, price: 16, fx: { maxHp: 3 } },
    { id: 'calcetin', name: 'Calcetines veloces', tier: 1, price: 15, fx: { speed: 5 } },
    { id: 'gafas', name: 'Gafas de sol', tier: 1, price: 18, fx: { crit: 3 } },
    { id: 'guante', name: 'Guante de boxeo', tier: 1, price: 16, fx: { melee: 3 } },
    { id: 'mira', name: 'Mira de juguete', tier: 1, price: 16, fx: { ranged: 2 } },
    { id: 'cebolla', name: 'Cebolla curativa', tier: 1, price: 15, fx: { regen: 2 } },
    { id: 'piedra', name: 'Piedra de afilar', tier: 1, price: 18, fx: { dmg: 5 } },
    { id: 'panuelo', name: 'Pañuelo ligero', tier: 1, price: 15, fx: { dodge: 3 } },
    { id: 'casco', name: 'Casco de lata', tier: 1, price: 17, fx: { armor: 1 } },
    { id: 'trebol', name: 'Trébol de tres hojas', tier: 1, price: 14, fx: { luck: 6 } },
    { id: 'regadera', name: 'Regadera', tier: 1, price: 16, fx: { harvest: 6 } },
    { id: 'colmillo', name: 'Colmillo', tier: 1, price: 18, fx: { lifesteal: 2 } },
    { id: 'cafe', name: 'Café doble', tier: 2, price: 38, fx: { atkSpd: 12, maxHp: -2 } },
    { id: 'mancuerna', name: 'Mancuerna', tier: 2, price: 36, fx: { melee: 6, atkSpd: -4 } },
    { id: 'catalejo', name: 'Catalejo', tier: 2, price: 35, fx: { range: 50, ranged: 2, speed: -3 } },
    { id: 'corcho', name: 'Escudo de corcho', tier: 2, price: 40, fx: { armor: 3, speed: -3 } },
    { id: 'bateria', name: 'Batería', tier: 2, price: 42, fx: { dmg: 8, atkSpd: 4 } },
    { id: 'botiquin', name: 'Botiquín', tier: 2, price: 38, fx: { regen: 5 } },
    { id: 'iman', name: 'Imán de nevera', tier: 2, price: 30, fx: { pickup: 70, luck: 3 } },
    { id: 'alcancia', name: 'Alcancía', tier: 2, price: 34, fx: { harvest: 12, dmg: -3 } },
    { id: 'pluma', name: 'Pluma de ganso', tier: 2, price: 36, fx: { dodge: 6, maxHp: -1 } },
    { id: 'corazon', name: 'Corazón de piedra', tier: 3, price: 75, fx: { maxHp: 10, armor: 2, speed: -5 } },
    { id: 'polvora', name: 'Pólvora', tier: 3, price: 80, fx: { dmg: 15, ranged: 4, dodge: -4 } },
    { id: 'furia', name: 'Puño de furia', tier: 3, price: 78, fx: { atkSpd: 20, melee: 4, armor: -2 } },
    { id: 'raiz', name: 'Raíz antigua', tier: 3, price: 72, fx: { regen: 7, maxHp: 6 } },
    { id: 'vampiro', name: 'Diente de vampiro', tier: 3, price: 82, fx: { lifesteal: 5, crit: 4 } },
    { id: 'corona', name: 'Corona de papa', tier: 4, price: 140, fx: { dmg: 15, atkSpd: 15, luck: 10 } },
    { id: 'cascara', name: 'Armadura de cáscara', tier: 4, price: 130, fx: { armor: 6, maxHp: 12, atkSpd: -8 } },
    { id: 'ojo', name: 'Tercer ojo', tier: 4, price: 135, fx: { crit: 10, range: 60, ranged: 5 } },
    { id: 'tornado', name: 'Zapatillas tornado', tier: 4, price: 120, fx: { speed: 15, dodge: 8, maxHp: -3 } },
  ];
  const ITEM_BY_ID = Object.fromEntries(ITEMS.map(i => [i.id, i]));

  const CHARS = {
    comun:    { name: 'Camote Común', desc: 'Sin trucos. Buen punto de partida.', weapon: 'pistola', fx: {}, skin: '#b4533f', acc: 'none' },
    bravo:    { name: 'Camote Bravo', desc: 'Pega de cerca y se mueve rápido.', weapon: 'cuchillo', fx: { melee: 3, speed: 6, ranged: -3 }, skin: '#c4402c', acc: 'band' },
    tirador:  { name: 'Camote Tirador', desc: 'Dispara de lejos, pero es frágil.', weapon: 'pistola', fx: { ranged: 3, range: 60, maxHp: -3 }, skin: '#8f4a6a', acc: 'goggles' },
    granjero: { name: 'Camote Granjero', desc: 'Cosecha más materiales cada oleada.', weapon: 'palo', fx: { harvest: 15, luck: 10, dmg: -10 }, skin: '#c27b3e', acc: 'hat' },
  };

  const EN = {
    bebe:       { name: 'Babosín', hp: 3, hpW: 2, spd: 150, spdW: 2.5, dmg: 1, dmgW: .6, r: 15, mat: 1, color: '#7ad36b', ai: 'chase' },
    escupidor:  { name: 'Escupidor', hp: 8, hpW: 2.5, spd: 110, dmg: 1, dmgW: .85, r: 17, mat: 2, color: '#d36bc8', ai: 'spit' },
    embestidor: { name: 'Embestidor', hp: 9, hpW: 3, spd: 120, dmg: 2, dmgW: .8, r: 17, mat: 2, color: '#e0a341', ai: 'charge' },
    bruto:      { name: 'Bruto', hp: 25, hpW: 11, spd: 85, dmg: 3, dmgW: 1, r: 27, mat: 4, color: '#6b8ed3', ai: 'chase' },
    mosca:      { name: 'Mosca', hp: 2, hpW: 1.2, spd: 225, dmg: 1, dmgW: .5, r: 13, mat: 1, color: '#3fc1c9', ai: 'fly' },
    bombardero: { name: 'Bombardero', hp: 6, hpW: 2, spd: 170, dmg: 3, dmgW: 1.2, r: 17, mat: 2, color: '#e8445a', ai: 'bomb' },
    invocador:  { name: 'Invocador', hp: 20, hpW: 6, spd: 90, dmg: 1, dmgW: .5, r: 20, mat: 5, color: '#8a5cc7', ai: 'summon' },
    tortuga:    { name: 'Tortuga', hp: 30, hpW: 14, spd: 60, dmg: 3, dmgW: 1, r: 26, mat: 4, color: '#6f8a5a', ai: 'chase', tough: .5 },
    elite:      { name: 'Gran Babosa', hp: 900, spd: 100, dmg: 6, r: 44, mat: 40, color: '#e8445a', ai: 'boss', boss: true },
    jefe:       { name: 'Reina Babosa', hp: 5200, spd: 105, dmg: 12, r: 58, mat: 0, color: '#ff7a2f', ai: 'boss', boss: true },
  };
  const UPGRADES = [['maxHp', 3], ['regen', 2], ['lifesteal', 1], ['dmg', 5], ['melee', 2], ['ranged', 1], ['atkSpd', 5], ['crit', 3], ['range', 15], ['armor', 1], ['dodge', 3], ['speed', 3], ['luck', 5], ['harvest', 5]];

  /* ---------- World + players ---------- */
  function createWorld() {
    return {
      phase: 'lobby', wave: 0, waveTime: 0, waveDur: 0, time: 0, kills: 0,
      enemies: [], projs: [], eprojs: [], drops: [], markers: [], spawnT: 0, nextId: 1,
      players: {}, order: [], events: [], hpScale: 1, spawnScale: 1
    };
  }
  const plist = W => W.order.map(id => W.players[id]).filter(Boolean);
  const alive = W => plist(W).filter(p => !p.dead);
  const st = (p, k) => p.stats[k];
  const maxHp = p => Math.max(1, Math.round(p.stats.maxHp));
  const xpNeed = l => (l + 3) * (l + 3);

  function makeWeapon(id, tier) { return { id, tier, cd: rand(0, .3), anim: 0, animDur: .2, angle: 0, atkAngle: 0, x: 0, y: 0 }; }
  function freshPlayer(id, name, charId) {
    const ch = CHARS[charId] || CHARS.comun;
    const p = {
      id, name: String(name || 'Camote').slice(0, 16), char: CHARS[charId] ? charId : 'comun',
      x: ARENA.w / 2, y: ARENA.h / 2, r: 18, hp: 10, iframe: 0, flash: 0, regenAcc: 0, walk: 0, lx: 1, ly: 0, lsCd: 0,
      stats: { ...BASE_STATS }, weapons: [makeWeapon(ch.weapon, 1)], items: [], mats: 0, xp: 0, level: 1, pendingLevels: 0, crates: 0, kills: 0,
      dead: false, ready: false, stage: 'shop', lvOpts: null, shop: { slots: [null, null, null, null], rerollCost: 0 }, notice: '',
      input: { mx: 0, my: 0, seq: 0 }
    };
    for (const k in ch.fx) p.stats[k] += ch.fx[k];
    p.hp = maxHp(p);
    return p;
  }
  function addPlayer(W, id, name, charId) {
    if (W.order.length >= MAX_PLAYERS) return null;
    const p = freshPlayer(id, name, charId);
    W.players[id] = p; W.order.push(id);
    return p;
  }
  function setChar(W, id, charId) {
    const p = W.players[id]; if (!p || W.phase !== 'lobby' || !CHARS[charId]) return;
    W.players[id] = freshPlayer(id, p.name, charId);
  }
  function removePlayer(W, id) {
    delete W.players[id];
    W.order = W.order.filter(x => x !== id);
    if (!W.order.length) return;
    if (W.phase === 'wave' && !alive(W).length) gameOver(W, false);
    if (W.phase === 'intermission') checkAllReady(W);
  }
  function setInput(W, id, mx, my, seq) {
    const p = W.players[id]; if (!p) return;
    mx = +mx || 0; my = +my || 0;
    const l = Math.hypot(mx, my); if (l > 1) { mx /= l; my /= l; }
    p.input.mx = mx; p.input.my = my;
    if (seq != null) p.input.seq = +seq || 0;
  }

  function startRun(W) {
    for (const id of W.order) { const p = W.players[id]; W.players[id] = freshPlayer(id, p.name, p.char); }
    W.wave = 1; W.kills = 0;
    startWave(W);
  }
  function startWave(W) {
    const n = W.order.length;
    W.hpScale = 1 + .6 * (n - 1);
    W.spawnScale = 1 + .5 * (n - 1);
    W.phase = 'wave';
    W.waveDur = W.wave === MAX_WAVES ? 90 : Math.min(60, 15 + 5 * W.wave);
    W.waveTime = W.waveDur;
    W.spawnT = .6;
    W.enemies = []; W.projs = []; W.eprojs = []; W.drops = []; W.markers = [];
    plist(W).forEach((p, i) => {
      const a = i / Math.max(1, n) * TAU;
      p.x = ARENA.w / 2 + (n > 1 ? Math.cos(a) * 60 : 0); p.y = ARENA.h / 2 + (n > 1 ? Math.sin(a) * 60 : 0);
      p.hp = maxHp(p); p.dead = false; p.iframe = 1; p.ready = false; p.lvOpts = null; p.notice = '';
      p.input.mx = 0; p.input.my = 0;
    });
    if (W.wave === 10) addMarker(W, 'elite', ...farPoint(W), 1.6);
    if (W.wave === MAX_WAVES) addMarker(W, 'jefe', ...farPoint(W), 2);
  }
  function nearestPlayer(W, x, y, maxD = Infinity) {
    let best = null, bd = maxD * maxD;
    for (const p of plist(W)) { if (p.dead) continue; const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; best = p; } }
    return best;
  }
  function minPlayerDist(W, x, y) { const p = nearestPlayer(W, x, y); return p ? Math.hypot(p.x - x, p.y - y) : Infinity; }
  function farPoint(W) {
    for (let i = 0; i < 30; i++) { const x = rand(80, ARENA.w - 80), y = rand(80, ARENA.h - 80); if (minPlayerDist(W, x, y) > 420) return [x, y]; }
    return [80, 80];
  }
  function addMarker(W, type, x, y, t = .9) { W.markers.push({ type, x: clamp(x, 40, ARENA.w - 40), y: clamp(y, 40, ARENA.h - 40), t, max: t }); }

  function spawnGroup(W) {
    const w = W.wave;
    if (W.enemies.length + W.markers.length > 170 + 40 * (W.order.length - 1)) return;
    const pool = [['bebe', 10]];
    if (w >= 2) pool.push(['escupidor', 2 + w * .3]);
    if (w >= 3) pool.push(['mosca', 3 + w * .3]);
    if (w >= 4) pool.push(['embestidor', 2 + w * .25]);
    if (w >= 5) pool.push(['bombardero', 1.5 + w * .2]);
    if (w >= 6) pool.push(['bruto', 1 + w * .2]);
    if (w >= 7) pool.push(['invocador', .6 + w * .08]);
    if (w >= 8) pool.push(['tortuga', .8 + w * .15]);
    const type = weighted(pool);
    const n = Math.round((1 + Math.floor(w / 2.5) + (Math.random() < .5 ? 1 : 0)) * W.spawnScale);
    let cx = 0, cy = 0;
    for (let i = 0; i < 20; i++) { cx = rand(60, ARENA.w - 60); cy = rand(60, ARENA.h - 60); if (minPlayerDist(W, cx, cy) > 260) break; }
    for (let i = 0; i < n; i++) addMarker(W, i === 0 || Math.random() < .6 ? type : 'bebe', cx + rand(-70, 70), cy + rand(-70, 70), rand(.8, 1.1));
  }
  function spawnEnemy(W, type, x, y) {
    const d = EN[type], w = W.wave;
    const hp = (d.boss ? d.hp : d.hp + d.hpW * (w - 1)) * W.hpScale;
    W.enemies.push({
      id: W.nextId++, type, x, y, r: d.r, hp, maxHp: hp, tough: d.tough || 1,
      spd: Math.min(d.spd + (d.spdW || 0) * w, 230) * rand(.92, 1.08),
      dmg: Math.round(d.dmg + (d.dmgW || 0) * (w - 1)), mat: d.mat, kx: 0, ky: 0, flash: 0, t: Math.random() * 10,
      st: rand(1, 2.5), cd: rand(1, 2.5), state: 'walk', dx: 0, dy: 0, dead: false, boss: !!d.boss
    });
  }

  /* ---------- Combat ---------- */
  function weaponDamage(p, w) {
    const d = WEAPONS[w.id];
    let dmg = d.dmg[w.tier - 1];
    for (const k in d.scale) dmg += st(p, k) * d.scale[k];
    dmg *= 1 + st(p, 'dmg') / 100;
    return Math.max(1, dmg);
  }
  const weaponCooldown = (p, w) => WEAPONS[w.id].cd[w.tier - 1] / Math.max(.25, 1 + st(p, 'atkSpd') / 100);
  function weaponRange(p, w) { const d = WEAPONS[w.id]; return Math.max(40, d.range + (d.kind === 'melee' ? st(p, 'range') * .5 : st(p, 'range'))); }

  const ev = (W, e) => { if (W.events.length < 400) W.events.push(e); };
  const txt = (W, x, y, s, c, z = 18) => ev(W, { t: 'txt', x: r1(x), y: r1(y), s, c, z });

  function dealDamage(W, e, base, cc, cm, knock, dx, dy, owner) {
    if (e.dead) return;
    const crit = Math.random() < cc;
    const dmg = Math.max(1, Math.round(base * (crit ? cm : 1) * e.tough));
    e.hp -= dmg; e.flash = .09;
    const kr = e.boss ? .08 : e.type === 'bruto' ? .4 : 1;
    e.kx += dx * knock * 9 * kr; e.ky += dy * knock * 9 * kr;
    txt(W, e.x, e.y - e.r, String(dmg), crit ? '#ffd166' : '#ffffff', crit ? 24 : 17);
    if (owner && !owner.dead && st(owner, 'lifesteal') > 0 && owner.lsCd <= 0 && Math.random() < st(owner, 'lifesteal') / 100) { heal(W, owner, 1); owner.lsCd = .1; }
    if (e.hp <= 0) killEnemy(W, e, owner);
  }
  function killEnemy(W, e, owner) {
    e.dead = true; W.kills++; if (owner) owner.kills++;
    ev(W, { t: 'burst', x: r1(e.x), y: r1(e.y), c: EN[e.type].color, n: e.boss ? 40 : 10, sp: e.boss ? 400 : 220 });
    for (let i = 0; i < e.mat; i++) { const a = Math.random() * TAU, s = rand(40, 160) + (e.boss ? 120 : 0); W.drops.push({ type: 'mat', x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, mag: null }); }
    const luckM = 1 + (owner ? st(owner, 'luck') : 0) / 100;
    if (Math.random() < .03 * luckM) W.drops.push({ type: 'fruit', x: e.x, y: e.y, vx: 0, vy: 0, mag: null });
    if (Math.random() < Math.min(.04, .008 * luckM) || e.type === 'elite') W.drops.push({ type: 'crate', x: e.x + 10, y: e.y, vx: 0, vy: 0, mag: null });
    if (e.boss) ev(W, { t: 'shake', v: 18 });
    if (e.type === 'jefe') W.waveTime = Math.min(W.waveTime, 1.2);
  }
  function blast(W, b) {
    ev(W, { t: 'ring', x: r1(b.x), y: r1(b.y), r: b.explode, c: '#ffb347' });
    const owner = W.players[b.owner];
    for (const e of W.enemies) {
      if (e.dead) continue;
      const dx = e.x - b.x, dy = e.y - b.y, d = Math.hypot(dx, dy) || 1;
      if (d < b.explode + e.r) dealDamage(W, e, b.dmg, b.cc, b.cm, b.knock, dx / d, dy / d, owner);
    }
  }
  function heal(W, p, n) { const m = maxHp(p); if (p.hp >= m) return; const h = Math.min(n, m - p.hp); p.hp += h; txt(W, p.x, p.y - 30, '+' + h, '#8fe36b', 17); }
  function hurtPlayer(W, p, d) {
    if (p.iframe > 0 || p.dead) return;
    if (Math.random() < clamp(st(p, 'dodge'), 0, 60) / 100) { txt(W, p.x, p.y - 30, 'Esquivado', '#9fe8ff', 15); p.iframe = .25; return; }
    const a = st(p, 'armor');
    const mult = a >= 0 ? 1 / (1 + a / 15) : 1 + (-a) / 15;
    const dmg = Math.max(1, Math.round(d * mult));
    p.hp -= dmg; p.iframe = .4; p.flash = .15;
    ev(W, { t: 'shake', v: 7, pid: p.id });
    txt(W, p.x, p.y - 30, '-' + dmg, '#ef4a5f', 20);
    if (p.hp <= 0) {
      p.hp = 0; p.dead = true;
      ev(W, { t: 'burst', x: r1(p.x), y: r1(p.y), c: '#ff8a3d', n: 24, sp: 300 });
      txt(W, p.x, p.y - 40, p.name + ' cayó', '#ff8a3d', 20);
      if (!alive(W).length) gameOver(W, false);
    }
  }
  function shootEnemy(W, x, y, a, s, dmg) { W.eprojs.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, dmg, r: 8, life: 5 }); }
  function gainXp(W, p, n) {
    p.xp += n;
    while (p.xp >= xpNeed(p.level)) {
      p.xp -= xpNeed(p.level); p.level++; p.pendingLevels++;
      p.stats.maxHp += 1; if (!p.dead) p.hp += 1;
      txt(W, p.x, p.y - 50, '¡Nivel ' + p.level + '!', '#6fd0ff', 22);
    }
  }

  /* ---------- Step ---------- */
  function step(W, dt) {
    if (W.phase !== 'wave') return;
    W.time += dt;
    W.waveTime -= dt;
    if (W.waveTime <= 0) { endWave(W); return; }

    for (const p of plist(W)) {
      p.iframe = Math.max(0, p.iframe - dt); p.flash = Math.max(0, p.flash - dt); p.lsCd -= dt;
      if (p.dead) continue;
      const { mx, my } = p.input, ml = Math.hypot(mx, my);
      const spd = 300 * Math.max(.3, 1 + st(p, 'speed') / 100);
      p.x = clamp(p.x + mx * spd * dt, p.r, ARENA.w - p.r);
      p.y = clamp(p.y + my * spd * dt, p.r, ARENA.h - p.r);
      if (ml > .1) { p.walk += dt * 12; p.lx = mx; p.ly = my; }
      if (st(p, 'regen') > 0 && p.hp < maxHp(p)) { p.regenAcc += st(p, 'regen') * .11 * dt; while (p.regenAcc >= 1) { p.regenAcc--; heal(W, p, 1); } }
    }

    W.spawnT -= dt;
    if (W.spawnT <= 0 && W.waveTime > 1.5) { spawnGroup(W); W.spawnT = Math.max(.55, 2.2 - W.wave * .08) * rand(.8, 1.2); }
    for (const m of W.markers) { m.t -= dt; if (m.t <= 0) spawnEnemy(W, m.type, m.x, m.y); }
    W.markers = W.markers.filter(m => m.t > 0);

    updateEnemies(W, dt);
    if (W.phase !== 'wave') return;
    for (const p of plist(W)) if (!p.dead) updateWeapons(W, p, dt);

    // player projectiles
    for (const b of W.projs) {
      if (b.homing) {
        let tgt = null, bd = 400 * 400;
        for (const e of W.enemies) { if (e.dead || b.hit.includes(e.id)) continue; const dd = (e.x - b.x) ** 2 + (e.y - b.y) ** 2; if (dd < bd) { bd = dd; tgt = e; } }
        if (tgt) {
          const sp = Math.hypot(b.vx, b.vy), cur = Math.atan2(b.vy, b.vx);
          let da = Math.atan2(tgt.y - b.y, tgt.x - b.x) - cur; da = ((da + Math.PI) % TAU + TAU) % TAU - Math.PI;
          const na = cur + clamp(da, -6 * dt, 6 * dt); b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp;
        }
      }
      b.x += b.vx * dt; b.y += b.vy * dt; b.d += Math.hypot(b.vx, b.vy) * dt;
      if (b.d > b.maxD) { b.dead = true; if (b.explode) blast(W, b); continue; }
      const owner = W.players[b.owner];
      for (const e of W.enemies) {
        if (e.dead || b.hit.includes(e.id)) continue;
        const rr = e.r + b.r;
        if ((e.x - b.x) ** 2 + (e.y - b.y) ** 2 < rr * rr) {
          if (b.explode) { b.dead = true; blast(W, b); break; }
          b.hit.push(e.id);
          const l = Math.hypot(b.vx, b.vy);
          dealDamage(W, e, b.dmg, b.cc, b.cm, b.knock, b.vx / l, b.vy / l, owner);
          if (--b.pierce < 0) { b.dead = true; break; }
        }
      }
    }
    W.projs = W.projs.filter(b => !b.dead);

    // enemy projectiles
    for (const b of W.eprojs) {
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.life <= 0 || b.x < -20 || b.y < -20 || b.x > ARENA.w + 20 || b.y > ARENA.h + 20) { b.dead = true; continue; }
      for (const p of plist(W)) {
        if (p.dead) continue;
        if ((p.x - b.x) ** 2 + (p.y - b.y) ** 2 < (p.r + b.r - 4) ** 2) { hurtPlayer(W, p, b.dmg); b.dead = true; break; }
      }
    }
    W.eprojs = W.eprojs.filter(b => !b.dead);
    W.enemies = W.enemies.filter(e => !e.dead);

    // drops: magnet to the nearest living player whose pickup range reaches it
    for (const d of W.drops) {
      let p = d.mag ? W.players[d.mag] : null;
      if (!p || p.dead) {
        d.mag = null; p = null;
        for (const q of plist(W)) {
          if (q.dead) continue;
          const pr = 80 + st(q, 'pickup');
          if ((q.x - d.x) ** 2 + (q.y - d.y) ** 2 < pr * pr) { p = q; d.mag = q.id; break; }
        }
      }
      if (p) {
        const dx = p.x - d.x, dy = p.y - d.y, dist = Math.hypot(dx, dy) || 1;
        d.vx = dx / dist * 700; d.vy = dy / dist * 700;
        if (dist < p.r + 8) {
          d.dead = true;
          if (d.type === 'mat') { p.mats++; gainXp(W, p, 1); }
          else if (d.type === 'fruit') heal(W, p, 3);
          else { p.crates++; txt(W, p.x, p.y - 40, '¡Caja!', '#ffd166', 18); }
          continue;
        }
      } else { d.vx *= Math.max(0, 1 - 6 * dt); d.vy *= Math.max(0, 1 - 6 * dt); }
      d.x = clamp(d.x + d.vx * dt, 8, ARENA.w - 8); d.y = clamp(d.y + d.vy * dt, 8, ARENA.h - 8);
    }
    W.drops = W.drops.filter(d => !d.dead);
    if (W.drops.length > 500) {
      const extra = W.drops.filter(d => d.type === 'mat').slice(0, W.drops.length - 500);
      const ps = alive(W); extra.forEach((d, i) => { d.dead = true; const p = ps[i % ps.length]; if (p) { p.mats++; gainXp(W, p, 1); } });
      W.drops = W.drops.filter(d => !d.dead);
    }
  }

  function updateEnemies(W, dt) {
    const es = W.enemies;
    for (const e of es) {
      e.t += dt; e.flash = Math.max(0, e.flash - dt);
      const p = nearestPlayer(W, e.x, e.y);
      if (!p) break;
      const dx = p.x - e.x, dy = p.y - e.y, dist = Math.hypot(dx, dy) || 1, ux = dx / dist, uy = dy / dist;
      let mvx = 0, mvy = 0, sp = e.spd;
      const ai = EN[e.type].ai;
      if (ai === 'chase') { mvx = ux; mvy = uy; }
      else if (ai === 'spit') {
        if (dist > 300) { mvx = ux; mvy = uy; } else if (dist < 220) { mvx = -ux; mvy = -uy; } else { mvx = -uy * .5; mvy = ux * .5; }
        e.st -= dt; if (e.st <= 0 && dist < 560) { e.st = rand(2.2, 3); shootEnemy(W, e.x, e.y, Math.atan2(dy, dx), 280, e.dmg); }
      } else if (ai === 'charge') {
        e.cd -= dt;
        if (e.state === 'walk') { mvx = ux; mvy = uy; if (dist < 330 && e.cd <= 0) { e.state = 'aim'; e.st = .6; } }
        else if (e.state === 'aim') { e.st -= dt; e.dx = ux; e.dy = uy; if (e.st <= 0) { e.state = 'dash'; e.st = .45; } }
        else { mvx = e.dx; mvy = e.dy; sp = e.spd * 5.5; e.st -= dt; if (e.st <= 0) { e.state = 'walk'; e.cd = rand(2, 3); } }
      } else if (ai === 'boss') {
        mvx = ux; mvy = uy;
        e.st -= dt;
        if (e.st <= 0) { const big = e.type === 'jefe'; e.st = big ? 2.6 : 3.4; const n = big ? 16 : 10, off = Math.random() * TAU; for (let i = 0; i < n; i++) shootEnemy(W, e.x, e.y, off + i / n * TAU, 230, Math.ceil(e.dmg * .6)); }
        e.cd -= dt;
        if (e.cd <= 0) { e.cd = e.type === 'jefe' ? 6 : 8; for (let i = 0; i < 4; i++) addMarker(W, 'bebe', e.x + rand(-140, 140), e.y + rand(-140, 140)); }
      } else if (ai === 'fly') {
        const wig = Math.sin(e.t * 6 + e.id) * .9;
        mvx = ux - uy * wig; mvy = uy + ux * wig;
      } else if (ai === 'bomb') {
        if (e.state === 'walk') { mvx = ux; mvy = uy; if (dist < e.r + p.r + 50) { e.state = 'fuse'; e.st = .7; } }
        else {
          e.st -= dt;
          if (e.st <= 0) {
            e.dead = true; W.kills++;
            ev(W, { t: 'ring', x: r1(e.x), y: r1(e.y), r: 95, c: '#ff6b3d' });
            for (const q of plist(W)) if (!q.dead && Math.hypot(q.x - e.x, q.y - e.y) < 95 + q.r) hurtPlayer(W, q, e.dmg);
            if (W.phase !== 'wave') return;
            continue;
          }
        }
      } else if (ai === 'summon') {
        if (dist > 420) { mvx = ux; mvy = uy; } else if (dist < 340) { mvx = -ux; mvy = -uy; }
        e.cd -= dt;
        if (e.cd <= 0 && dist < 650) { e.cd = rand(3.5, 4.5); for (let i = 0; i < 3; i++) addMarker(W, 'bebe', e.x + rand(-90, 90), e.y + rand(-90, 90), .7); }
      }
      e.x += (mvx * sp + e.kx) * dt; e.y += (mvy * sp + e.ky) * dt;
      const k = Math.max(0, 1 - 9 * dt); e.kx *= k; e.ky *= k;
      e.x = clamp(e.x, e.r, ARENA.w - e.r); e.y = clamp(e.y, e.r, ARENA.h - e.r);
      for (const q of plist(W)) {
        if (q.dead) continue;
        const rr = e.r + q.r - 4;
        if ((q.x - e.x) ** 2 + (q.y - e.y) ** 2 < rr * rr) hurtPlayer(W, q, e.dmg);
      }
      if (W.phase !== 'wave') return;
    }
    // separation
    for (let i = 0; i < es.length; i++) {
      const a = es[i];
      for (let j = i + 1; j < es.length; j++) {
        const b = es[j], dx = b.x - a.x, dy = b.y - a.y, rr = a.r + b.r;
        if (dx > rr || dx < -rr || dy > rr || dy < -rr) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 < rr * rr && d2 > .01) {
          const d = Math.sqrt(d2), push = (rr - d) / 2, nx = dx / d, ny = dy / d;
          const wa = a.boss ? .1 : 1, wb = b.boss ? .1 : 1;
          a.x -= nx * push * wa; a.y -= ny * push * wa; b.x += nx * push * wb; b.y += ny * push * wb;
        }
      }
    }
  }

  function updateWeapons(W, p, dt) {
    const n = p.weapons.length;
    p.weapons.forEach((w, i) => {
      const d = WEAPONS[w.id];
      const a = -Math.PI / 2 + i / n * TAU;
      const rad = n === 1 ? 26 : 36;
      w.x = p.x + Math.cos(a) * rad; w.y = p.y + Math.sin(a) * rad * .85;
      const range = weaponRange(p, w);
      let best = null, bd = range * range;
      for (const e of W.enemies) {
        if (e.dead) continue;
        const dd = (e.x - w.x) ** 2 + (e.y - w.y) ** 2 - e.r * e.r;
        if (dd < bd) { bd = dd; best = e; }
      }
      w.cd -= dt; if (w.anim > 0) w.anim -= dt;
      if (best) w.angle = Math.atan2(best.y - w.y, best.x - w.x);
      if (best && w.cd <= 0) { fireWeapon(W, p, w, d, best, range); w.cd = weaponCooldown(p, w); }
    });
  }
  function fireWeapon(W, p, w, d, t, range) {
    const ang = Math.atan2(t.y - w.y, t.x - w.x);
    const dmg = weaponDamage(p, w);
    const cc = d.crit + st(p, 'crit') / 100;
    if (d.kind === 'ranged') {
      const pel = d.pellets ? d.pellets[w.tier - 1] : 1;
      for (let k = 0; k < pel; k++) {
        const a = ang + (pel > 1 ? (k / (pel - 1) - .5) * d.spread : (d.spread ? rand(-d.spread / 2, d.spread / 2) : 0));
        W.projs.push({
          owner: p.id, x: w.x + Math.cos(a) * 16, y: w.y + Math.sin(a) * 16, vx: Math.cos(a) * d.speed, vy: Math.sin(a) * d.speed,
          dmg, cc, cm: d.critMul, knock: d.knock, pierce: d.pierce ? d.pierce[w.tier - 1] : 0, maxD: range + 40, d: 0, hit: [],
          kind: d.beam ? 'beam' : d.flame ? 'flame' : d.rocket ? 'rocket' : d.bolt ? 'bolt' : d.homing ? 'orb' : 'bullet',
          color: d.color, explode: d.explode ? d.explode[w.tier - 1] : 0, homing: !!d.homing, r: d.beam ? 7 : d.flame ? 10 : d.rocket ? 8 : 5
        });
      }
      w.anim = .08; w.animDur = .08;
    } else {
      w.atkAngle = ang; w.anim = .22; w.animDur = .22;
      const dx = Math.cos(ang), dy = Math.sin(ang);
      for (const e of W.enemies) {
        if (e.dead) continue;
        const ex = e.x - w.x, ey = e.y - w.y;
        let hit = false;
        if (d.style === 'thrust') {
          const along = ex * dx + ey * dy, perp = Math.abs(ex * dy - ey * dx);
          hit = along > -e.r && along < range + e.r && perp < e.r + 18;
        } else {
          const dist = Math.hypot(ex, ey);
          let da = Math.abs(Math.atan2(ey, ex) - ang); if (da > Math.PI) da = TAU - da;
          hit = dist < range + e.r && (da < 1.1 || dist < e.r + 20);
        }
        if (hit) dealDamage(W, e, dmg, cc, d.critMul, d.knock, dx, dy, p);
      }
    }
  }

  /* ---------- Between waves ---------- */
  function endWave(W) {
    const ps = plist(W);
    let i = 0;
    for (const d of W.drops) {
      const p = ps[i++ % ps.length];
      if (d.type === 'mat') { p.mats++; gainXp(W, p, 1); } else if (d.type === 'crate') p.crates++;
    }
    W.drops = []; W.enemies = []; W.projs = []; W.eprojs = []; W.markers = [];
    for (const p of ps) {
      const h = Math.round(st(p, 'harvest'));
      if (h > 0) { p.mats += h; gainXp(W, p, h); p.stats.harvest *= 1.05; }
    }
    if (W.wave >= MAX_WAVES) { gameOver(W, true); return; }
    W.phase = 'intermission';
    for (const p of ps) {
      p.dead = false; p.hp = maxHp(p); p.ready = false; p.input.mx = p.input.my = 0;
      if (p.pendingLevels > 0) openLevelUp(W, p); else openShop(W, p);
    }
  }
  function gameOver(W, won) { W.phase = won ? 'win' : 'over'; }

  function rollTier(W, p) {
    const w = W.wave, l = 1 + Math.max(-50, st(p, 'luck')) / 100;
    const p4 = w >= 8 ? Math.min(.08, (w - 7) * .01) * l : 0;
    const p3 = w >= 4 ? Math.min(.25, (w - 3) * .025) * l : 0;
    const p2 = w >= 2 ? Math.min(.45, (w - 1) * .06) * l : 0;
    const r = Math.random();
    return r < p4 ? 4 : r < p4 + p3 ? 3 : r < p4 + p3 + p2 ? 2 : 1;
  }
  const priceOf = (W, b) => Math.round(b * (1 + (W.wave - 1) * .1));
  const weaponPrice = (W, id, tier) => priceOf(W, WEAPONS[id].price * WEAPON_TIER_MULT[tier - 1]);
  function rollOffer(W, p) {
    const tier = rollTier(W, p);
    if (Math.random() < (p.weapons.length < 6 ? .35 : .2)) { const id = pick(Object.keys(WEAPONS)); return { kind: 'w', id, tier, price: weaponPrice(W, id, tier) }; }
    const it = pick(ITEMS.filter(i => i.tier === tier));
    return { kind: 'i', id: it.id, tier, price: priceOf(W, it.price) };
  }
  function openLevelUp(W, p) {
    p.stage = 'level';
    const pool = UPGRADES.slice().sort(() => Math.random() - .5).slice(0, 4);
    p.lvOpts = pool.map(([k, v]) => { const t = rollTier(W, p); return { k, v: v * t, tier: t }; });
  }
  function openShop(W, p) {
    p.stage = 'shop'; p.lvOpts = null;
    const notes = [];
    while (p.crates > 0) {
      p.crates--;
      const t = Math.min(4, rollTier(W, p) + (Math.random() < .3 ? 1 : 0));
      const it = pick(ITEMS.filter(i => i.tier === t));
      for (const k in it.fx) p.stats[k] += it.fx[k];
      p.items.push(it.id); notes.push(it.name);
    }
    p.notice = notes.length ? `Abriste ${notes.length === 1 ? 'una caja' : notes.length + ' cajas'}: ${notes.join(', ')}.` : '';
    p.shop.slots = p.shop.slots.map(s => (s && s.locked && !s.sold) ? s : { offer: rollOffer(W, p), locked: false, sold: false });
    p.shop.rerollCost = W.wave + 1;
  }
  function canTake(p, o) {
    if (o.kind !== 'w') return true;
    return p.weapons.length < 6 || (o.tier < 4 && p.weapons.some(w => w.id === o.id && w.tier === o.tier));
  }
  function checkAllReady(W) {
    const ps = plist(W);
    if (W.phase === 'intermission' && ps.length && ps.every(p => p.ready)) { W.wave++; startWave(W); }
  }

  // Player actions between waves. Returns true when something changed.
  function act(W, pid, a, arg) {
    const p = W.players[pid];
    if (!p || W.phase !== 'intermission') return false;
    const i = +arg;
    if (a === 'lvpick') {
      if (p.stage !== 'level' || !p.lvOpts || !p.lvOpts[i]) return false;
      const o = p.lvOpts[i]; p.stats[o.k] += o.v; if (o.k === 'maxHp') p.hp += o.v;
      p.pendingLevels--;
      if (p.pendingLevels > 0) openLevelUp(W, p); else openShop(W, p);
      return true;
    }
    if (p.stage !== 'shop') return false;
    if (a === 'ready') { p.ready = !p.ready; checkAllReady(W); return true; }
    if (p.ready) return false;
    if (a === 'buy') {
      const sl = p.shop.slots[i]; if (!sl) return false;
      const o = sl.offer;
      if (sl.sold || p.mats < o.price || !canTake(p, o)) return false;
      p.mats -= o.price; sl.sold = true; sl.locked = false;
      if (o.kind === 'w') {
        if (p.weapons.length < 6) p.weapons.push(makeWeapon(o.id, o.tier));
        else { const w = p.weapons.find(w => w.id === o.id && w.tier === o.tier); w.tier++; }
      } else { const it = ITEM_BY_ID[o.id]; for (const k in it.fx) p.stats[k] += it.fx[k]; p.items.push(o.id); }
      return true;
    }
    if (a === 'lock') { const sl = p.shop.slots[i]; if (!sl || sl.sold) return false; sl.locked = !sl.locked; return true; }
    if (a === 'reroll') {
      if (p.mats < p.shop.rerollCost) return false;
      p.mats -= p.shop.rerollCost; p.shop.rerollCost += Math.max(1, Math.floor(W.wave / 2));
      p.shop.slots = p.shop.slots.map(s => (s.locked && !s.sold) ? s : { offer: rollOffer(W, p), locked: false, sold: false });
      return true;
    }
    if (a === 'sell') {
      if (p.weapons.length <= 1 || !p.weapons[i]) return false;
      const w = p.weapons[i]; p.mats += Math.round(weaponPrice(W, w.id, w.tier) * .3); p.weapons.splice(i, 1);
      return true;
    }
    if (a === 'combine') {
      const w = p.weapons[i]; if (!w || w.tier >= 4) return false;
      const j = p.weapons.findIndex((o, k) => k !== i && o.id === w.id && o.tier === w.tier);
      if (j < 0) return false; w.tier++; p.weapons.splice(j, 1);
      return true;
    }
    return false;
  }

  /* ---------- Snapshot (what clients render) ---------- */
  // Compact public state for everyone + full private state (stats, shop, level options) for `forId`.
  function snapshot(W, forId) {
    return {
      ph: W.phase, w: W.wave, wt: r1(W.waveTime), k: W.kills,
      e: W.enemies.map(e => [e.id, e.type, r1(e.x), r1(e.y), Math.ceil(e.hp), Math.ceil(e.maxHp), e.state === 'aim' || e.state === 'fuse' ? 1 : 0, e.flash > 0 ? 1 : 0]),
      b: W.projs.map(b => [r1(b.x), r1(b.y), Math.round(b.vx), Math.round(b.vy), b.kind, b.color, r2(b.d / b.maxD)]),
      q: W.eprojs.map(b => [r1(b.x), r1(b.y), Math.round(b.vx), Math.round(b.vy)]),
      d: W.drops.map(d => [d.type, r1(d.x), r1(d.y)]),
      m: W.markers.map(m => [m.type, r1(m.x), r1(m.y), r2(m.t / m.max)]),
      p: plist(W).map(p => {
        const o = {
          id: p.id, n: p.name, c: p.char, x: r1(p.x), y: r1(p.y), hp: p.hp, mh: maxHp(p), lx: r2(p.lx), wk: r2(p.walk),
          fl: p.flash > 0 ? 1 : 0, iv: p.iframe > 0 ? 1 : 0, dead: p.dead ? 1 : 0, lv: p.level, xp: p.xp, xn: xpNeed(p.level),
          mats: p.mats, rd: p.ready ? 1 : 0, sg: p.stage, kills: p.kills, nw: p.weapons.length, sq: p.input.seq || 0,
          wp: p.weapons.map(w => [w.id, w.tier, r1(w.x - p.x), r1(w.y - p.y), r2(w.angle), r2(w.anim), w.animDur, r2(w.atkAngle)])
        };
        if (p.id === forId) {
          o.me = { stats: p.stats, items: p.items, shop: p.shop, lvOpts: p.lvOpts, pending: p.pendingLevels, notice: p.notice, weapons: p.weapons.map(w => ({ id: w.id, tier: w.tier })) };
        }
        return o;
      })
    };
  }

  return {
    TAU, ARENA, MAX_WAVES, MAX_PLAYERS, STAT_INFO, BASE_STATS, WEAPONS, WEAPON_LEN, WEAPON_TIER_MULT, ITEMS, ITEM_BY_ID, CHARS, EN, UPGRADES,
    createWorld, addPlayer, removePlayer, setChar, setInput, startRun, step, act, snapshot,
    weaponPrice, xpNeed, maxHp, canTake, clamp, rand
  };
});
