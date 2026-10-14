/* Camote Furioso — shared simulation.
 * Runs unchanged in the browser (solo mode, exposes window.CF) and in Node (authoritative co-op server).
 * The world is plain data: no DOM, no closures, so it can be stepped anywhere and snapshotted to JSON.
 * Visual feedback (damage numbers, bursts, explosions) is emitted as world.events for the renderer to consume.
 *
 * Balance follows Brotato's published numbers (brotato.wiki.spellsandguns.com): wave lengths, enemy HP/damage
 * per wave, Danger levels, elite/horde waves, material bag and drop falloff, shop prices/rerolls/tier odds,
 * level-up values per tier, regen/armor/i-frame formulas. Speeds are scaled to our 300 px/s player.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod; else root.CF = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  function weighted(list) { let s = 0; for (const [, w] of list) s += w; let r = Math.random() * s; for (const [k, w] of list) { if ((r -= w) <= 0) return k; } return list[0][0]; }
  const r1 = v => Math.round(v * 10) / 10;
  const r2 = v => Math.round(v * 100) / 100;

  const ARENA = { w: 1600, h: 1100 };
  const MAX_WAVES = 20;
  const MAX_PLAYERS = 4;

  /* ---------- Danger levels ---------- */
  const DANGERS = [
    { name: 'Peligro 0', desc: 'Para aprender. Sin élites.', mult: 0, specials: 0, bosses: 1 },
    { name: 'Peligro 1', desc: 'Más frutas y élites aún no. Para practicar.', mult: 0, specials: 0, bosses: 1 },
    { name: 'Peligro 2', desc: 'Una oleada de élite u horda.', mult: 0, specials: 1, bosses: 1 },
    { name: 'Peligro 3', desc: 'Enemigos +12% vida y daño. Una élite u horda.', mult: .12, specials: 1, bosses: 1 },
    { name: 'Peligro 4', desc: 'Enemigos +26%. Tres élites u hordas.', mult: .26, specials: 3, bosses: 1 },
    { name: 'Peligro 5', desc: 'Enemigos +40%. Tres élites y dos jefas al final.', mult: .40, specials: 3, bosses: 2 },
  ];
  const DEFAULT_DANGER = 3;

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

  // from: first wave it spawns in the normal pool; w: pool weight. spd is px/s (Brotato speed × 2/3).
  const EN = {
    bebe:        { name: 'Babosín', hp: 3, hpW: 2, spd: 165, spdVar: .2, dmg: 1, dmgW: .6, r: 15, mat: 1, color: '#7ad36b', ai: 'chase', from: 1, w: 10 },
    perseguidor: { name: 'Corretón', hp: 1, hpW: 1, spd: 250, dmg: 1, dmgW: .6, r: 12, mat: 1, color: '#b6e35a', ai: 'chase', from: 2, w: 3, group: [2, 4] },
    embestidor:  { name: 'Embestidor', hp: 4, hpW: 2.5, spd: 160, dmg: 1, dmgW: .85, r: 17, mat: 1, color: '#e0a341', ai: 'charge', from: 3, w: 3 },
    escupidor:   { name: 'Escupidor', hp: 8, hpW: 1, spd: 133, dmg: 1, dmgW: .6, pdmgW: .75, r: 17, mat: 1, color: '#d36bc8', ai: 'spit', from: 4, w: 3, crate: .1 },
    bombardero:  { name: 'Bombardero', hp: 6, hpW: 2, spd: 170, dmg: 3, dmgW: 1.2, r: 17, mat: 1, color: '#e8445a', ai: 'bomb', from: 6, w: 1.5 },
    bruto:       { name: 'Bruto', hp: 20, hpW: 11, spd: 200, dmg: 2, dmgW: .85, r: 27, mat: 3, color: '#6b8ed3', ai: 'charge', from: 8, w: 2 },
    mosca:       { name: 'Mosca', hp: 15, hpW: 4, spd: 233, dmg: 1, dmgW: .6, r: 14, mat: 1, color: '#3fc1c9', ai: 'orbit', from: 8, w: 2 },
    invocador:   { name: 'Invocador', hp: 20, hpW: 6, spd: 90, dmg: 1, dmgW: .5, r: 20, mat: 2, color: '#8a5cc7', ai: 'summon', from: 10, w: .7 },
    acelerador:  { name: 'Bólido', hp: 10, hpW: 24, spd: 100, spdMax: 400, dmg: 1, dmgW: 1.2, r: 20, mat: 3, color: '#c0392b', ai: 'pursue', from: 11, w: 1 },
    sanador:     { name: 'Sanadora', hp: 10, hpW: 8, spd: 200, dmg: 1, dmgW: .5, r: 17, mat: 2, color: '#ff8fc8', ai: 'healer', from: 12, w: .8 },
    tortuga:     { name: 'Tortuga', hp: 12, hpW: 6, spd: 120, dmg: 1, dmgW: 1, r: 26, mat: 1, color: '#6f8a5a', ai: 'chase', tough: .5, from: 13, w: 2 },
    potenciador: { name: 'Tamborilero', hp: 20, hpW: 3, spd: 100, dmg: 1, dmgW: .5, r: 18, mat: 2, color: '#ff9b3d', ai: 'buffer', from: 16, w: .6 },
    saqueador:   { name: 'Ratero', hp: 5, hpW: 30, spd: 240, dmg: 1, dmgW: .85, r: 16, mat: 8, color: '#f1d54a', ai: 'flee', special: true },
    arbol:       { name: 'Árbol frutal', hp: 10, hpW: 5, spd: 0, dmg: 0, r: 24, mat: 3, color: '#3fb3a0', ai: 'tree', special: true, neutral: true },
    elite:       { name: 'Gran Babosa', hp: 750, hpW: 75, spd: 100, dmg: 8, dmgW: .9, r: 44, mat: 30, color: '#e8445a', ai: 'boss', boss: true, special: true },
    jefe:        { name: 'Reina Babosa', hp: 25000, spd: 105, dmg: 30, pdmg: 23, r: 58, mat: 0, color: '#ff7a2f', ai: 'boss', boss: true, special: true },
  };
  // Level-up values per tier (I..IV), as in Brotato.
  const UPGRADE_VALUES = {
    maxHp: [3, 6, 9, 12], regen: [2, 3, 4, 5], lifesteal: [1, 2, 3, 4], dmg: [5, 8, 12, 16], melee: [2, 4, 6, 8], ranged: [1, 2, 3, 4],
    atkSpd: [5, 10, 15, 20], crit: [3, 5, 7, 9], range: [15, 30, 45, 60], armor: [1, 2, 3, 4], dodge: [3, 6, 9, 12], speed: [3, 6, 9, 12],
    luck: [5, 10, 15, 20], harvest: [5, 8, 10, 12]
  };
  const UPGRADES = Object.keys(UPGRADE_VALUES);

  /* ---------- World + players ---------- */
  function createWorld() {
    return {
      phase: 'lobby', wave: 0, waveTime: 0, waveDur: 0, time: 0, kills: 0, danger: DEFAULT_DANGER, specials: {},
      enemies: [], projs: [], eprojs: [], drops: [], markers: [], spawnT: 0, nextId: 1, bag: 0, horde: false,
      looterT: 0, treeT: 0, players: {}, order: [], events: [], hpScale: 1, spawnScale: 1
    };
  }
  const plist = W => W.order.map(id => W.players[id]).filter(Boolean);
  const alive = W => plist(W).filter(p => !p.dead);
  const st = (p, k) => p.stats[k];
  const maxHp = p => Math.max(1, Math.round(p.stats.maxHp));
  const xpNeed = l => (l + 3) * (l + 3);
  const dangerOf = W => DANGERS[W.danger] || DANGERS[DEFAULT_DANGER];

  function makeWeapon(id, tier) { return { id, tier, cd: rand(0, .3), anim: 0, animDur: .2, angle: 0, atkAngle: 0, x: 0, y: 0 }; }
  function freshPlayer(id, name, charId) {
    const ch = CHARS[charId] || CHARS.comun;
    const p = {
      id, name: String(name || 'Camote').slice(0, 16), char: CHARS[charId] ? charId : 'comun',
      x: ARENA.w / 2, y: ARENA.h / 2, r: 18, hp: 10, iframe: 0, flash: 0, regenAcc: 0, walk: 0, lx: 1, ly: 0, lsCd: 0,
      stats: { ...BASE_STATS }, weapons: [makeWeapon(ch.weapon, 1)], items: [], mats: 0, xp: 0, level: 1, pendingLevels: 0, crates: 0, legends: 0, kills: 0,
      dead: false, ready: false, stage: 'shop', lvOpts: null, shop: { slots: [null, null, null, null], rerollCost: 0, rerollInc: 1 }, notice: '',
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
  function setDanger(W, d) { d = +d; if (W.phase === 'lobby' || W.phase === 'over' || W.phase === 'win') { if (DANGERS[d]) W.danger = d; } }
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

  // Elite/horde schedule per Danger: 1st on 11|12 and 2nd on 14|15 (40% horde, 60% elite), 3rd on 17|18 always elite.
  function planSpecials(W) {
    const n = dangerOf(W).specials, out = {};
    const slots = [[11, 12, .4], [14, 15, .4], [17, 18, 0]];
    for (let i = 0; i < n; i++) { const [a, b, h] = slots[i]; out[Math.random() < .5 ? a : b] = Math.random() < h ? 'horde' : 'elite'; }
    return out;
  }
  function startRun(W) {
    for (const id of W.order) { const p = W.players[id]; W.players[id] = freshPlayer(id, p.name, p.char); }
    W.wave = 1; W.kills = 0; W.bag = 0; W.specials = planSpecials(W);
    startWave(W);
  }
  function startWave(W) {
    const n = W.order.length;
    W.hpScale = (1 + .6 * (n - 1)) * (1 + dangerOf(W).mult);
    W.dmgScale = 1 + dangerOf(W).mult;
    W.spawnScale = 1 + .5 * (n - 1);
    W.phase = 'wave';
    W.waveDur = W.wave === MAX_WAVES ? 90 : Math.min(60, 15 + 5 * W.wave);
    W.waveTime = W.waveDur;
    W.spawnT = .5; W.looterT = 25; W.treeT = 3;
    W.horde = W.specials[W.wave] === 'horde';
    W.enemies = []; W.projs = []; W.eprojs = []; W.drops = []; W.markers = [];
    plist(W).forEach((p, i) => {
      const a = i / Math.max(1, n) * TAU;
      p.x = ARENA.w / 2 + (n > 1 ? Math.cos(a) * 60 : 0); p.y = ARENA.h / 2 + (n > 1 ? Math.sin(a) * 60 : 0);
      p.hp = maxHp(p); p.dead = false; p.iframe = 1; p.ready = false; p.lvOpts = null; p.notice = '';
      p.input.mx = 0; p.input.my = 0;
    });
    if (W.specials[W.wave] === 'elite') { addMarker(W, 'elite', ...farPoint(W), 1.6); ev(W, { t: 'banner', s: '¡Oleada de élite!' }); }
    if (W.horde) ev(W, { t: 'banner', s: '¡Oleada de horda!' });
    if (W.wave === MAX_WAVES) { for (let i = 0; i < dangerOf(W).bosses; i++) addMarker(W, 'jefe', ...farPoint(W), 2); ev(W, { t: 'banner', s: '¡La Reina Babosa!' }); }
  }
  function nearestPlayer(W, x, y, maxD = Infinity) {
    let best = null, bd = maxD * maxD;
    for (const p of plist(W)) { if (p.dead) continue; const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; best = p; } }
    return best;
  }
  function minPlayerDist(W, x, y) { const p = nearestPlayer(W, x, y); return p ? Math.hypot(p.x - x, p.y - y) : Infinity; }
  function farPoint(W, minD = 420) {
    for (let i = 0; i < 30; i++) { const x = rand(80, ARENA.w - 80), y = rand(80, ARENA.h - 80); if (minPlayerDist(W, x, y) > minD) return [x, y]; }
    return [80, 80];
  }
  function addMarker(W, type, x, y, t = .9) { W.markers.push({ type, x: clamp(x, 40, ARENA.w - 40), y: clamp(y, 40, ARENA.h - 40), t, max: t }); }
  const enemyCap = W => 100 + 25 * (W.order.length - 1);
  const hostileCount = W => W.enemies.filter(e => !EN[e.type].neutral).length + W.markers.length;

  function spawnGroup(W) {
    const w = W.wave;
    if (hostileCount(W) >= enemyCap(W)) return;
    const pool = Object.entries(EN).filter(([, d]) => !d.special && d.from <= w).map(([k, d]) => [k, d.w + (k === 'bebe' ? 0 : w * .08)]);
    const type = weighted(pool);
    const d = EN[type];
    let n = d.group ? randi(d.group[0], d.group[1]) : 1 + Math.floor(W.wave / 3) + (Math.random() < .5 ? 1 : 0);
    n = Math.max(1, Math.round(n * W.spawnScale * (W.horde ? 1.6 : 1)));
    let cx = 0, cy = 0;
    for (let i = 0; i < 20; i++) { cx = rand(60, ARENA.w - 60); cy = rand(60, ARENA.h - 60); if (minPlayerDist(W, cx, cy) > 260) break; }
    for (let i = 0; i < n; i++) addMarker(W, i === 0 || Math.random() < .65 ? type : 'bebe', cx + rand(-70, 70), cy + rand(-70, 70), rand(.8, 1.1));
  }
  function spawnEnemy(W, type, x, y) {
    const d = EN[type], w = W.wave;
    let hp = (d.hp + (d.hpW || 0) * (w - 1)) * W.hpScale;
    if (type === 'elite' && w <= 12) hp *= .75;
    if (type === 'jefe' && dangerOf(W).bosses > 1) hp *= .75;
    if (d.neutral) hp = d.hp + d.hpW * (w - 1);
    const sp = d.spd * (1 + (d.spdVar ? rand(-d.spdVar, d.spdVar) : rand(-.06, .06)));
    W.enemies.push({
      id: W.nextId++, type, x, y, r: d.r, hp, maxHp: hp, tough: d.tough || 1, buffed: false,
      spd: sp, dmg: Math.max(d.dmg ? 1 : 0, Math.round((d.dmg + (d.dmgW || 0) * (w - 1)) * W.dmgScale)),
      pdmg: Math.round(((d.pdmg || d.dmg) + (d.pdmgW || d.dmgW || 0) * (w - 1)) * W.dmgScale),
      mat: d.mat, kx: 0, ky: 0, flash: 0, t: Math.random() * 10, life: 0,
      st: rand(1, 2.5), cd: rand(1.5, 3), state: 'walk', dx: 0, dy: 0, dead: false, boss: !!d.boss, orbitDir: Math.random() < .5 ? 1 : -1
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
  const weaponCooldown = (p, w) => Math.max(1 / 12, WEAPONS[w.id].cd[w.tier - 1] / Math.max(.25, 1 + st(p, 'atkSpd') / 100));
  function weaponRange(p, w) { const d = WEAPONS[w.id]; return Math.max(40, d.range + (d.kind === 'melee' ? st(p, 'range') * .5 : st(p, 'range'))); }

  const ev = (W, e) => { if (W.events.length < 400) W.events.push(e); };
  const txt = (W, x, y, s, c, z = 18) => ev(W, { t: 'txt', x: r1(x), y: r1(y), s, c, z });

  function dropChance(W) { const c = W.wave <= 4 ? 1 : Math.max(.5, 1 - .015 * (W.wave - 4)); return W.horde ? c * .65 : c; }
  function dropMaterial(W, x, y, extraSpeed) {
    let v = 1;
    if (W.bag > 0) { v++; W.bag--; }                       // the bag pays out gradually on later drops
    const mats = W.drops.filter(d => d.type === 'mat');
    if (mats.length >= 50) { pick(mats).v += v; return; }   // max 50 material drops on the ground
    const a = Math.random() * TAU, s = rand(40, 160) + (extraSpeed || 0);
    W.drops.push({ type: 'mat', v, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, mag: null });
  }

  function dealDamage(W, e, base, cc, cm, knock, dx, dy, owner, ranged) {
    if (e.dead) return;
    const crit = Math.random() < cc;
    const dmg = Math.max(1, Math.round(base * (crit ? cm : 1) * e.tough));
    e.hp -= dmg; e.flash = .09;
    const kr = e.boss ? .08 : e.type === 'bruto' || e.type === 'tortuga' ? .4 : EN[e.type].neutral ? 0 : 1;
    e.kx += dx * knock * 9 * kr; e.ky += dy * knock * 9 * kr;
    txt(W, e.x, e.y - e.r, String(dmg), crit ? '#ffd166' : '#ffffff', crit ? 24 : 17);
    if (owner && !owner.dead && st(owner, 'lifesteal') > 0 && owner.lsCd <= 0 && Math.random() < st(owner, 'lifesteal') / 100) { heal(W, owner, 1); owner.lsCd = .1; }
    // Flies spit back in a random direction when hit by ranged attacks
    if (ranged && e.type === 'mosca' && e.hp > 0 && Math.random() < .5) shootEnemy(W, e.x, e.y, Math.random() * TAU, 240, e.pdmg);
    if (e.hp <= 0) killEnemy(W, e, owner);
  }
  function killEnemy(W, e, owner) {
    e.dead = true; W.kills++; if (owner) owner.kills++;
    const d = EN[e.type];
    ev(W, { t: 'burst', x: r1(e.x), y: r1(e.y), c: d.color, n: e.boss ? 40 : 10, sp: e.boss ? 400 : 220 });
    const luckM = 1 + (owner ? Math.max(-50, st(owner, 'luck')) : 0) / 100;
    if (e.boss || d.special || Math.random() < dropChance(W)) for (let i = 0; i < e.mat; i++) dropMaterial(W, e.x, e.y, e.boss ? 120 : 0);
    if (e.type === 'elite') W.drops.push({ type: 'legend', x: e.x, y: e.y, vx: 0, vy: 0, mag: null });
    else if (e.type === 'saqueador') { W.drops.push({ type: 'crate', x: e.x + 12, y: e.y, vx: 0, vy: 0, mag: null }); W.drops.push({ type: 'fruit', x: e.x - 12, y: e.y, vx: 0, vy: 0, mag: null }); }
    else if (e.type === 'arbol') W.drops.push({ type: Math.random() < .2 * luckM ? 'crate' : 'fruit', x: e.x, y: e.y, vx: 0, vy: 0, mag: null });
    else {
      if (Math.random() < .02 * luckM) W.drops.push({ type: 'fruit', x: e.x, y: e.y, vx: 0, vy: 0, mag: null });
      if (Math.random() < (d.crate || .015) * luckM) W.drops.push({ type: 'crate', x: e.x + 10, y: e.y, vx: 0, vy: 0, mag: null });
    }
    if (e.boss) ev(W, { t: 'shake', v: 18 });
    if (e.type === 'jefe' && !W.enemies.some(o => o !== e && o.type === 'jefe' && !o.dead) && !W.markers.some(m => m.type === 'jefe')) W.waveTime = Math.min(W.waveTime, 1.2);
  }
  function blast(W, b) {
    ev(W, { t: 'ring', x: r1(b.x), y: r1(b.y), r: b.explode, c: '#ffb347' });
    const owner = W.players[b.owner];
    for (const e of W.enemies) {
      if (e.dead) continue;
      const dx = e.x - b.x, dy = e.y - b.y, d = Math.hypot(dx, dy) || 1;
      if (d < b.explode + e.r) dealDamage(W, e, b.dmg, b.cc, b.cm, b.knock, dx / d, dy / d, owner, true);
    }
  }
  function heal(W, p, n) { const m = maxHp(p); if (p.hp >= m) return; const h = Math.min(n, m - p.hp); p.hp += h; txt(W, p.x, p.y - 30, '+' + h, '#8fe36b', 17); }
  function hurtPlayer(W, p, d) {
    if (p.iframe > 0 || p.dead || d <= 0) return;
    if (Math.random() < clamp(st(p, 'dodge'), 0, 60) / 100) { txt(W, p.x, p.y - 30, 'Esquivado', '#9fe8ff', 15); p.iframe = .2; return; }
    const a = st(p, 'armor');
    const mult = a >= 0 ? 1 / (1 + a / 15) : (15 - 2 * a) / (15 - a);
    const dmg = Math.max(1, Math.round(Math.round(d) * mult));
    p.hp -= dmg; p.flash = .15;
    p.iframe = clamp(.4 * (dmg / maxHp(p)) / .15, .2, .4);    // Brotato i-frames: 0.2–0.4 s by % of max HP lost
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
  const regenPerSec = R => R >= 1 ? (1 + (R - 1) / 2.25) / 5 : 0;  // Brotato: 5/(1+(R-1)/2.25) s per HP

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
      const spd = 300 * Math.max(0, 1 + st(p, 'speed') / 100);
      p.x = clamp(p.x + mx * spd * dt, p.r, ARENA.w - p.r);
      p.y = clamp(p.y + my * spd * dt, p.r, ARENA.h - p.r);
      if (ml > .1) { p.walk += dt * 12; p.lx = mx; p.ly = my; }
      const rps = regenPerSec(st(p, 'regen'));
      if (rps > 0 && p.hp < maxHp(p)) { p.regenAcc += rps * dt; while (p.regenAcc >= 1) { p.regenAcc--; heal(W, p, 1); } }
    }

    // regular spawns get denser every wave; horde waves spawn far faster
    W.spawnT -= dt;
    if (W.spawnT <= 0 && W.waveTime > 1.5) {
      spawnGroup(W);
      W.spawnT = Math.max(.4, 2.3 - W.wave * .095) * rand(.8, 1.2) * (W.horde ? .6 : 1);
    }
    // looters: from wave 3, a roll at 25 s into the wave and every 15 s after
    if (W.wave >= 3) {
      W.looterT -= dt;
      if (W.looterT <= 0) {
        W.looterT = 15;
        const luck = Math.max(0, ...alive(W).map(p => st(p, 'luck')));
        if (Math.random() < .12 * (1 + luck / 100)) { addMarker(W, 'saqueador', ...farPoint(W, 300), 1); ev(W, { t: 'banner', s: '¡Un ratero con botín!' }); }
      }
    }
    // fruit trees: a roll every 10 s
    W.treeT -= dt;
    if (W.treeT <= 0) {
      W.treeT = 10;
      const trees = W.enemies.filter(e => e.type === 'arbol').length;
      if (trees < 4 && Math.random() < .5) addMarker(W, 'arbol', ...farPoint(W, 200), 1.2);
    }
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
          dealDamage(W, e, b.dmg, b.cc, b.cm, b.knock, b.vx / l, b.vy / l, owner, true);
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
        if (dist < p.r + 8) { d.dead = true; collect(W, p, d); continue; }
      } else { d.vx *= Math.max(0, 1 - 6 * dt); d.vy *= Math.max(0, 1 - 6 * dt); }
      d.x = clamp(d.x + d.vx * dt, 8, ARENA.w - 8); d.y = clamp(d.y + d.vy * dt, 8, ARENA.h - 8);
    }
    W.drops = W.drops.filter(d => !d.dead);
  }
  function collect(W, p, d) {
    if (d.type === 'mat') { p.mats += d.v; gainXp(W, p, d.v); }
    else if (d.type === 'fruit') heal(W, p, 3);
    else if (d.type === 'crate') { p.crates++; heal(W, p, 3); txt(W, p.x, p.y - 40, '¡Caja!', '#ffd166', 18); }
    else if (d.type === 'legend') { p.legends++; heal(W, p, 100); txt(W, p.x, p.y - 40, '¡Caja legendaria!', '#ff5d5d', 20); }
  }

  function updateEnemies(W, dt) {
    const es = W.enemies;
    for (const e of es) {
      e.t += dt; e.life += dt; e.flash = Math.max(0, e.flash - dt);
      const d = EN[e.type];
      if (d.ai === 'tree') continue;
      const p = nearestPlayer(W, e.x, e.y);
      if (!p) break;
      const dx = p.x - e.x, dy = p.y - e.y, dist = Math.hypot(dx, dy) || 1, ux = dx / dist, uy = dy / dist;
      let mvx = 0, mvy = 0, sp = e.spd;
      const ai = d.ai;
      if (ai === 'chase') { mvx = ux; mvy = uy; }
      else if (ai === 'spit') {
        if (dist > 300) { mvx = ux; mvy = uy; } else if (dist < 220) { mvx = -ux; mvy = -uy; } else { mvx = -uy * .5; mvy = ux * .5; }
        e.st -= dt; if (e.st <= 0 && dist < 560) { e.st = rand(2, 2.8); shootEnemy(W, e.x, e.y, Math.atan2(dy, dx), 300, e.pdmg); }
      } else if (ai === 'charge') {
        // walks toward you and dashes every 2.5–3.5 s
        e.cd -= dt;
        if (e.state === 'walk') { mvx = ux; mvy = uy; sp = e.spd * .6; if (dist < 380 && e.cd <= 0) { e.state = 'aim'; e.st = .55; } }
        else if (e.state === 'aim') { e.st -= dt; e.dx = ux; e.dy = uy; if (e.st <= 0) { e.state = 'dash'; e.st = .45; } }
        else { mvx = e.dx; mvy = e.dy; sp = e.spd * 3.6; e.st -= dt; if (e.st <= 0) { e.state = 'walk'; e.cd = rand(2.5, 3.5); } }
      } else if (ai === 'orbit') {
        // circles the player, drifting in and out
        const want = 210 + Math.sin(e.t * .8 + e.id) * 50;
        const radial = clamp((dist - want) / 80, -1, 1);
        mvx = ux * radial - uy * e.orbitDir; mvy = uy * radial + ux * e.orbitDir;
        const l = Math.hypot(mvx, mvy) || 1; mvx /= l; mvy /= l;
      } else if (ai === 'pursue') {
        mvx = ux; mvy = uy;
        e.spd = Math.min(d.spdMax, e.spd + 75 * dt); sp = e.spd;
      } else if (ai === 'boss') {
        mvx = ux; mvy = uy;
        e.st -= dt;
        if (e.st <= 0) { const big = e.type === 'jefe'; e.st = big ? 2.4 : 3.2; const n = big ? 18 : 12, off = Math.random() * TAU; for (let i = 0; i < n; i++) shootEnemy(W, e.x, e.y, off + i / n * TAU, big ? 260 : 230, big ? e.pdmg : Math.ceil(e.dmg * .7)); }
        e.cd -= dt;
        if (e.cd <= 0) { e.cd = e.type === 'jefe' ? 5 : 7; for (let i = 0; i < 4; i++) addMarker(W, e.type === 'jefe' ? 'perseguidor' : 'bebe', e.x + rand(-140, 140), e.y + rand(-140, 140)); }
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
      } else if (ai === 'healer') {
        // keeps its distance and heals nearby enemies by 15% of their max HP every 2 s
        if (dist < 300) { mvx = -ux; mvy = -uy; } else if (dist > 420) { mvx = ux * .5; mvy = uy * .5; }
        e.cd -= dt;
        if (e.cd <= 0) {
          e.cd = 2; let any = false;
          for (const o of es) if (o !== e && !o.dead && !EN[o.type].neutral && o.hp < o.maxHp && Math.hypot(o.x - e.x, o.y - e.y) < 180) { o.hp = Math.min(o.maxHp, o.hp + o.maxHp * .15); any = true; }
          if (any) ev(W, { t: 'ring', x: r1(e.x), y: r1(e.y), r: 180, c: '#7be08f', soft: 1 });
        }
      } else if (ai === 'buffer') {
        // flees and buffs one enemy every 3 s: +150% HP, +25% damage, +50% speed
        if (dist < 380) { mvx = -ux; mvy = -uy; }
        e.cd -= dt;
        if (e.cd <= 0) {
          e.cd = 3;
          let best = null, bd = 300 * 300;
          for (const o of es) { if (o === e || o.dead || o.buffed || o.boss || EN[o.type].neutral) continue; const dd = (o.x - e.x) ** 2 + (o.y - e.y) ** 2; if (dd < bd) { bd = dd; best = o; } }
          if (best) {
            best.buffed = true; best.maxHp *= 2.5; best.hp *= 2.5; best.dmg = Math.round(best.dmg * 1.25); best.pdmg = Math.round(best.pdmg * 1.25); best.spd *= 1.5;
            ev(W, { t: 'ring', x: r1(best.x), y: r1(best.y), r: 50, c: '#ff4d5e', soft: 1 });
          }
        }
      } else if (ai === 'flee') {
        // runs from the nearest player and escapes after 10 s
        mvx = -ux; mvy = -uy;
        const edge = 80;
        if (e.x < edge || e.x > ARENA.w - edge) mvx += (e.x < edge ? 1 : -1) * .8;
        if (e.y < edge || e.y > ARENA.h - edge) mvy += (e.y < edge ? 1 : -1) * .8;
        mvx += Math.sin(e.t * 2 + e.id) * .5; mvy += Math.cos(e.t * 2.3 + e.id) * .5;
        const l = Math.hypot(mvx, mvy) || 1; mvx /= l; mvy /= l;
        if (e.life > 10) { e.dead = true; txt(W, e.x, e.y - 20, '¡Se escapó!', '#f1d54a', 18); continue; }
      }
      e.x += (mvx * sp + e.kx) * dt; e.y += (mvy * sp + e.ky) * dt;
      const k = Math.max(0, 1 - 9 * dt); e.kx *= k; e.ky *= k;
      e.x = clamp(e.x, e.r, ARENA.w - e.r); e.y = clamp(e.y, e.r, ARENA.h - e.r);
      if (e.dmg > 0) for (const q of plist(W)) {
        if (q.dead) continue;
        const rr = e.r + q.r - 4;
        if ((q.x - e.x) ** 2 + (q.y - e.y) ** 2 < rr * rr) hurtPlayer(W, q, e.dmg);
      }
      if (W.phase !== 'wave') return;
    }
    // separation (trees are rooted)
    for (let i = 0; i < es.length; i++) {
      const a = es[i];
      for (let j = i + 1; j < es.length; j++) {
        const b = es[j], dx = b.x - a.x, dy = b.y - a.y, rr = a.r + b.r;
        if (dx > rr || dx < -rr || dy > rr || dy < -rr) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 < rr * rr && d2 > .01) {
          const d = Math.sqrt(d2), push = (rr - d) / 2, nx = dx / d, ny = dy / d;
          const wa = a.boss ? .1 : a.type === 'arbol' ? 0 : 1, wb = b.boss ? .1 : b.type === 'arbol' ? 0 : 1;
          const fa = wa + wb ? 2 * wa / (wa + wb) : 0, fb = wa + wb ? 2 * wb / (wa + wb) : 0;
          a.x -= nx * push * fa; a.y -= ny * push * fa; b.x += nx * push * fb; b.y += ny * push * fb;
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
      // hostile enemies first; trees only when nothing else is in range
      let best = null, bd = range * range, tree = null, td = range * range;
      for (const e of W.enemies) {
        if (e.dead) continue;
        const dd = (e.x - w.x) ** 2 + (e.y - w.y) ** 2 - e.r * e.r;
        if (EN[e.type].neutral) { if (dd < td) { td = dd; tree = e; } }
        else if (dd < bd) { bd = dd; best = e; }
      }
      best = best || tree;
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
        if (hit) dealDamage(W, e, dmg, cc, d.critMul, d.knock, dx, dy, p, false);
      }
    }
  }

  /* ---------- Between waves ---------- */
  function endWave(W) {
    const ps = plist(W);
    let i = 0;
    for (const d of W.drops) {
      if (d.type === 'mat') W.bag += d.v;                       // uncollected materials go to the bag
      else if (d.type === 'crate' || d.type === 'legend') { const p = ps[i++ % ps.length]; if (d.type === 'crate') p.crates++; else p.legends++; }
    }
    W.drops = []; W.enemies = []; W.projs = []; W.eprojs = []; W.markers = [];
    for (const p of ps) {
      const h = Math.round(st(p, 'harvest'));
      if (h > 0) { p.mats += h; gainXp(W, p, h); p.stats.harvest = Math.ceil(p.stats.harvest * 1.05); }
    }
    if (W.wave >= MAX_WAVES) { gameOver(W, true); return; }
    W.phase = 'intermission';
    for (const p of ps) {
      p.dead = false; p.hp = maxHp(p); p.ready = false; p.input.mx = p.input.my = 0;
      p.shop.rerollInc = Math.max(1, Math.floor(.4 * W.wave));
      p.shop.rerollCost = Math.floor(.75 * W.wave) + p.shop.rerollInc;
      if (p.pendingLevels > 0) openLevelUp(W, p); else openShop(W, p);
    }
  }
  function gameOver(W, won) { W.phase = won ? 'win' : 'over'; }

  // Brotato tier odds: T2 from wave 2 (+6%/wave, max 60%), T3 from 4 (+2%, max 25%), T4 from 8 (+0.23%, max 8%), × (1 + luck).
  function tierChances(W, p) {
    const w = W.wave, l = 1 + Math.max(-50, st(p, 'luck')) / 100;
    const c = (min, per, max) => w >= min ? Math.min(max, per * (w - min + 1)) * l : 0;
    return { t4: c(8, .0023, .08), t3: c(4, .02, .25), t2: c(2, .06, .6) };
  }
  function rollTier(W, p, minTier = 1) {
    const { t4, t3, t2 } = tierChances(W, p), r = Math.random();
    const t = r < t4 ? 4 : r < t4 + t3 ? 3 : r < t4 + t3 + t2 ? 2 : 1;
    return Math.max(t, minTier);
  }
  const priceOf = (W, b) => Math.max(1, Math.floor(b + W.wave + .1 * b * W.wave));
  const weaponPrice = (W, id, tier) => priceOf(W, WEAPONS[id].price * WEAPON_TIER_MULT[tier - 1]);
  function rollOffer(W, p, kind) {
    const tier = rollTier(W, p);
    if (!kind) kind = Math.random() < (p.weapons.length < 6 ? .35 : .2) ? 'w' : 'i';
    if (kind === 'w') { const id = pick(Object.keys(WEAPONS)); return { kind: 'w', id, tier, price: weaponPrice(W, id, tier) }; }
    const it = pick(ITEMS.filter(i => i.tier === tier));
    return { kind: 'i', id: it.id, tier, price: priceOf(W, it.price) };
  }
  // Guaranteed level-up tiers: II at level 5, III at 10/15/20, IV at 25 and every 5 after.
  function minLevelTier(level) { if (level >= 25 && level % 5 === 0) return 4; if (level === 10 || level === 15 || level === 20) return 3; if (level === 5) return 2; return 1; }
  function openLevelUp(W, p) {
    p.stage = 'level';
    const lvl = p.level - p.pendingLevels + 1;
    const pool = UPGRADES.slice().sort(() => Math.random() - .5).slice(0, 4);
    const minT = minLevelTier(lvl);
    p.lvOpts = pool.map(k => { const t = rollTier(W, p, minT); return { k, v: UPGRADE_VALUES[k][t - 1], tier: t }; });
  }
  function openCrateItem(W, p, minTier) {
    const t = Math.min(4, Math.max(minTier, rollTier(W, p) + (Math.random() < .3 ? 1 : 0)));
    const it = pick(ITEMS.filter(i => i.tier === t));
    for (const k in it.fx) p.stats[k] += it.fx[k];
    p.items.push(it.id);
    return it.name;
  }
  function openShop(W, p) {
    p.stage = 'shop'; p.lvOpts = null;
    const notes = [];
    while (p.legends > 0) { p.legends--; notes.push(openCrateItem(W, p, 4)); }
    while (p.crates > 0) { p.crates--; notes.push(openCrateItem(W, p, 1)); }
    p.notice = notes.length ? `Abriste ${notes.length === 1 ? 'una caja' : notes.length + ' cajas'}: ${notes.join(', ')}.` : '';
    rerollSlots(W, p);
  }
  function rerollSlots(W, p) {
    // waves 1–2 guarantee 2 weapons + 2 items; waves 3–5 at least one weapon
    const free = p.shop.slots.map((s, i) => (s && s.locked && !s.sold) ? -1 : i).filter(i => i >= 0);
    const kinds = free.map(() => null);
    if (W.wave <= 2) kinds.forEach((_, j) => { kinds[j] = j < 2 ? 'w' : 'i'; });
    else if (W.wave <= 5 && kinds.length) kinds[0] = 'w';
    kinds.sort(() => Math.random() - .5);
    free.forEach((i, j) => { p.shop.slots[i] = { offer: rollOffer(W, p, kinds[j]), locked: false, sold: false }; });
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
      p.mats -= p.shop.rerollCost; p.shop.rerollCost += p.shop.rerollInc;
      rerollSlots(W, p);
      return true;
    }
    if (a === 'sell') {
      if (p.weapons.length <= 1 || !p.weapons[i]) return false;
      const w = p.weapons[i]; p.mats += Math.max(1, Math.floor(weaponPrice(W, w.id, w.tier) * .25)); p.weapons.splice(i, 1);
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
      ph: W.phase, w: W.wave, wt: r1(W.waveTime), k: W.kills, dg: W.danger, hd: W.horde ? 1 : 0, bag: W.bag,
      e: W.enemies.map(e => [e.id, e.type, r1(e.x), r1(e.y), Math.ceil(e.hp), Math.ceil(e.maxHp), e.state === 'aim' || e.state === 'fuse' ? 1 : 0, e.flash > 0 ? 1 : 0, e.buffed ? 1 : 0]),
      b: W.projs.map(b => [r1(b.x), r1(b.y), Math.round(b.vx), Math.round(b.vy), b.kind, b.color, r2(b.d / b.maxD)]),
      q: W.eprojs.map(b => [r1(b.x), r1(b.y), Math.round(b.vx), Math.round(b.vy)]),
      d: W.drops.map(d => [d.type, r1(d.x), r1(d.y), d.v || 1]),
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
    TAU, ARENA, MAX_WAVES, MAX_PLAYERS, DANGERS, DEFAULT_DANGER, STAT_INFO, BASE_STATS, WEAPONS, WEAPON_LEN, WEAPON_TIER_MULT, ITEMS, ITEM_BY_ID, CHARS, EN, UPGRADES,
    createWorld, addPlayer, removePlayer, setChar, setDanger, setInput, startRun, step, act, snapshot,
    weaponPrice, xpNeed, maxHp, canTake, clamp, rand
  };
});
