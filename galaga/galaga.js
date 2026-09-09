/* ============================================================
   GALAXY RAIDER
   A Galaga-style arcade shooter built for phones: touch to fly,
   12 hand-tuned waves, three bosses, and an endless loop after.
   ============================================================ */
(function () {
  'use strict';

  // =========================================================
  // 1. Setup — canvas, sizing, helpers
  // =========================================================

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const el = (id) => document.getElementById(id);

  const DESIGN_W = 400;          // sprite sizes are authored against this width
  const DESIGN_H = 700;
  let W = 0, H = 0, S = 1, DPR = 1;

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const hypot = Math.hypot;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width));
    H = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    // Short screens (landscape phones) scale down so the field still fits.
    S = clamp(Math.min(W / DESIGN_W, H / DESIGN_H), 0.72, 1.5);

    player.y = clamp(player.y, playerMinY(), playerMaxY());
    player.ty = player.y;
    player.x = clamp(player.x, 18 * S, W - 18 * S);
    player.tx = player.x;
    player.r = 12 * S;
    buildStars();
  }

  // The ship flies in a band along the bottom, well clear of the formation.
  const playerMaxY = () => H - 64 * S;
  const playerMinY = () => Math.max(H * 0.5, H - 300 * S);

  /**
   * Formation geometry, recomputed on demand: the grid always sits under the
   * HUD and above the player's band, however tall the screen is.
   */
  function layout() {
    const rows = Math.max(2, G.rowCount || 4);
    const top = clamp(H * 0.16, 104, Math.max(104, 150 * S));
    const bottom = playerMinY() - 34 * S;
    return { top: top, rowH: clamp((bottom - top) / (rows - 1), 20 * S, 34 * S) };
  }

  // =========================================================
  // 2. Sound — small WebAudio synth, no assets to download
  // =========================================================

  const Sound = {
    ctx: null,
    on: true,
    noise: null,

    init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      // One reusable buffer of white noise powers every explosion.
      const len = Math.floor(this.ctx.sampleRate * 0.7);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      this.noise = buf;
    },

    tone(freq, dur, type, vol, slideTo) {
      if (!this.on || !this.ctx) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type || 'square';
      osc.frequency.setValueAtTime(freq, t);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(vol == null ? 0.08 : vol, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    },

    burst(dur, vol, filterFreq) {
      if (!this.on || !this.ctx || !this.noise) return;
      const t = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      const filt = this.ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.setValueAtTime(filterFreq || 1400, t);
      filt.frequency.exponentialRampToValueAtTime(180, t + dur);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(filt).connect(gain).connect(this.ctx.destination);
      src.start(t);
      src.stop(t + dur);
    },

    shoot() { this.tone(760, 0.07, 'square', 0.035, 300); },
    enemyShoot() { this.tone(300, 0.09, 'sawtooth', 0.025, 150); },
    hit() { this.tone(200, 0.05, 'square', 0.04, 90); },
    kill() { this.burst(0.22, 0.11, 1600); },
    bigKill() { this.burst(0.7, 0.2, 900); this.tone(90, 0.5, 'sawtooth', 0.06, 35); },
    playerDie() { this.burst(0.6, 0.18, 1100); this.tone(220, 0.6, 'sawtooth', 0.08, 40); },
    powerup() { this.tone(520, 0.09, 'triangle', 0.07); setTimeout(() => this.tone(780, 0.14, 'triangle', 0.07), 90); },
    warn() { this.tone(180, 0.3, 'sawtooth', 0.06, 320); },
    charge() { this.tone(120, 0.9, 'sawtooth', 0.05, 900); },
    levelUp() {
      [440, 587, 740, 880].forEach((f, i) => setTimeout(() => this.tone(f, 0.13, 'triangle', 0.06), i * 90));
    }
  };

  // =========================================================
  // 3. Saved settings and records
  // =========================================================

  const Store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem('galaxyRaider.' + key);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('galaxyRaider.' + key, JSON.stringify(value)); } catch (e) { /* private mode */ }
    }
  };

  const settings = {
    autoFire: Store.get('autoFire', true),
    sound: Store.get('sound', true)
  };
  Sound.on = settings.sound;

  const records = {
    best: Store.get('best', 0),
    bestWave: Store.get('bestWave', 1)
  };

  // =========================================================
  // 4. Path following — enemies fly smooth Catmull-Rom curves
  // =========================================================

  function catmull(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return {
      x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
      y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
    };
  }

  /** Turns a list of waypoints into an arc-length indexed polyline. */
  function makePath(waypoints, samplesPerSegment) {
    const w = [waypoints[0]].concat(waypoints, [waypoints[waypoints.length - 1]]);
    const per = samplesPerSegment || 14;
    const pts = [];
    for (let i = 0; i + 3 < w.length; i++) {
      for (let j = 0; j < per; j++) pts.push(catmull(w[i], w[i + 1], w[i + 2], w[i + 3], j / per));
    }
    pts.push({ x: waypoints[waypoints.length - 1].x, y: waypoints[waypoints.length - 1].y });

    const cum = [0];
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
      len += hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      cum.push(len);
    }
    return { pts: pts, cum: cum, len: len || 1 };
  }

  /** Position + heading at a distance along the path. */
  function pathAt(path, d) {
    const cum = path.cum, pts = path.pts;
    if (d <= 0) return { x: pts[0].x, y: pts[0].y, a: Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x) };
    if (d >= path.len) {
      const n = pts.length - 1;
      return { x: pts[n].x, y: pts[n].y, a: Math.atan2(pts[n].y - pts[n - 1].y, pts[n].x - pts[n - 1].x) };
    }
    let lo = 0, hi = cum.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= d) lo = mid; else hi = mid;
    }
    const seg = cum[hi] - cum[lo] || 1;
    const t = (d - cum[lo]) / seg;
    const dx = pts[hi].x - pts[lo].x, dy = pts[hi].y - pts[lo].y;
    return { x: pts[lo].x + dx * t, y: pts[lo].y + dy * t, a: Math.atan2(dy, dx) };
  }

  // =========================================================
  // 5. Game state
  // =========================================================

  const G = {
    state: 'menu',              // menu | intro | play | paused | over
    time: 0,
    score: 0,
    wave: 1,
    loop: 1,                    // campaign repetitions, drives difficulty
    lives: 3,
    nextExtraLife: 20000,
    enemies: [],
    spawnQueue: [],
    pBullets: [],
    eBullets: [],
    powerups: [],
    parts: [],
    texts: [],
    stars: [],
    boss: null,
    sway: 0,
    diveTimer: 3,
    snipeTimer: 4,
    escortTimer: 6,
    waveClearTimer: 0,
    shake: 0,
    shock: null,                // smart-bomb blast wave
    slow: 0,                    // time-warp timer
    flash: 0,                   // smart-bomb screen flash
    announceTimer: 0
  };

  const player = {
    x: 0, y: 0, tx: 0, ty: 0,
    r: 12,
    alive: true,
    cool: 0,
    invuln: 0,
    shield: false,
    weapon: 'single',   // single | twin | spread | pierce — one at a time
    weaponTime: 0,
    rapid: 0,
    wingmen: 0,
    drones: [],
    deadTimer: 0,
    thrust: 0
  };

  /** Arms a weapon mode, replacing whatever was equipped. */
  function setWeapon(kind, seconds) {
    player.weapon = kind;
    player.weaponTime = seconds;
  }

  function launchWingmen(seconds) {
    player.wingmen = seconds;
    player.drones = [-1, 1].map((side) => ({
      side: side,
      x: player.x + side * 26 * S,
      y: player.y + 8 * S
    }));
  }

  // =========================================================
  // 6. Input — drag to fly, tap or auto to fire
  // =========================================================

  const input = { firing: false, left: false, right: false, up: false, down: false };
  let drag = null;

  function pointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (G.state !== 'play' && G.state !== 'intro' && G.state !== 'clear') return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const p = pointerPos(e);
    drag = { id: e.pointerId, px: p.x, py: p.y, sx: player.tx, sy: player.ty };
    input.firing = true;
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault();
    const p = pointerPos(e);
    player.tx = clamp(drag.sx + (p.x - drag.px), 16 * S, W - 16 * S);
    player.ty = clamp(drag.sy + (p.y - drag.py) * 0.9, playerMinY(), playerMaxY());
  });

  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    drag = null;
    input.firing = false;
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    switch (e.code) {
      case 'ArrowLeft': case 'KeyA': input.left = true; break;
      case 'ArrowRight': case 'KeyD': input.right = true; break;
      case 'ArrowUp': case 'KeyW': input.up = true; break;
      case 'ArrowDown': case 'KeyS': input.down = true; break;
      case 'Space': input.firing = true; e.preventDefault(); break;
      case 'KeyP': case 'Escape':
        if (G.state === 'play') pauseGame();
        else if (G.state === 'paused') resumeGame();
        break;
      case 'Enter':
        if (G.state === 'menu') startGame();
        else if (G.state === 'over') startGame();
        break;
    }
  });

  window.addEventListener('keyup', (e) => {
    switch (e.code) {
      case 'ArrowLeft': case 'KeyA': input.left = false; break;
      case 'ArrowRight': case 'KeyD': input.right = false; break;
      case 'ArrowUp': case 'KeyW': input.up = false; break;
      case 'ArrowDown': case 'KeyS': input.down = false; break;
      case 'Space': input.firing = false; break;
    }
  });

  // =========================================================
  // 7. Starfield
  // =========================================================

  function buildStars() {
    G.stars = [];
    const count = Math.round((W * H) / 5200);
    for (let i = 0; i < count; i++) {
      const layer = randInt(0, 2);
      G.stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        layer: layer,
        speed: (18 + layer * 34) * S,
        size: (0.6 + layer * 0.55) * S,
        alpha: 0.25 + layer * 0.28
      });
    }
  }

  function updateStars(dt, boost) {
    for (const s of G.stars) {
      s.y += s.speed * dt * boost;
      if (s.y > H) { s.y = -2; s.x = Math.random() * W; }
    }
  }

  function drawStars() {
    for (const s of G.stars) {
      ctx.globalAlpha = s.alpha;
      ctx.fillStyle = s.layer === 2 ? '#cfe6ff' : '#8fa6d8';
      ctx.fillRect(s.x, s.y, s.size, s.size * 2.2);
    }
    ctx.globalAlpha = 1;
  }

  // =========================================================
  // 8. Enemies — types, formation, entry flights and dives
  // =========================================================

  const TYPES = {
    grunt:     { hp: 1, pts: 60,  r: 11, color: '#ffcf4d', dark: '#7a5a0e', wing: '#d9a327', glow: '#fff0a8', speed: 1.00, aim: 0.30 },
    wasp:      { hp: 1, pts: 90,  r: 11, color: '#8fd858', dark: '#2c5c1c', wing: '#5da832', glow: '#d8ff9e', speed: 1.20, aim: 0.45 },
    commander: { hp: 2, pts: 180, r: 13, color: '#ff7a4d', dark: '#7d2a10', wing: '#d84f22', glow: '#ffc9a8', speed: 1.08, aim: 0.55, drop: 0.42 },
    turret:    { hp: 3, pts: 140, r: 12, color: '#9aa6bd', dark: '#2b3548', wing: '#5d6c88', glow: '#ff5a2b', speed: 0.85, aim: 0.9, static: true, drop: 0.2 }
  };

  // The 12-wave campaign. After wave 12 it loops with tougher numbers.
  const WAVES = [
    { name: 'First Contact', rows: ['grunt', 'grunt'], cols: 8, dive: [2.6, 3.6], divers: 1, bspd: 1.00, snipe: 0 },
    { name: 'Swarm', rows: ['wasp', 'grunt', 'grunt'], cols: 8, dive: [2.2, 3.2], divers: 1, bspd: 1.02, snipe: 0 },
    { name: 'Gold Command', rows: ['commander', 'wasp', 'grunt', 'grunt'], cols: 8, dive: [2.0, 2.9], divers: 2, bspd: 1.05, snipe: 5.5 },
    { name: 'The Sentinel', boss: 'sentinel' },
    { name: 'Crossfire', rows: ['wasp', 'wasp', 'grunt', 'grunt'], cols: 9, dive: [1.8, 2.6], divers: 2, bspd: 1.08, snipe: 4.5 },
    { name: 'Gun Platforms', rows: ['turret', 'commander', 'wasp', 'grunt'], cols: 9, dive: [1.7, 2.5], divers: 2, bspd: 1.10, snipe: 4.0 },
    { name: 'Hornets', rows: ['wasp', 'wasp', 'commander', 'wasp', 'grunt'], cols: 9, dive: [1.5, 2.2], divers: 2, bspd: 1.13, snipe: 3.6 },
    { name: 'The Hive Queen', boss: 'queen' },
    { name: 'Iron Curtain', rows: ['turret', 'turret', 'wasp', 'commander', 'grunt'], cols: 9, dive: [1.4, 2.1], divers: 3, bspd: 1.16, snipe: 3.2 },
    { name: 'Blitz', rows: ['wasp', 'wasp', 'wasp', 'commander', 'grunt'], cols: 10, dive: [1.2, 1.9], divers: 3, bspd: 1.20, snipe: 3.0 },
    { name: 'Last Stand', rows: ['commander', 'turret', 'wasp', 'wasp', 'grunt'], cols: 10, dive: [1.1, 1.7], divers: 3, bspd: 1.24, snipe: 2.6 },
    { name: 'The Dreadnought', boss: 'dread' }
  ];

  const waveDef = () => WAVES[(G.wave - 1) % WAVES.length];
  /** Every campaign loop makes enemies quicker, deadlier and tougher. */
  const loopMul = () => 1 + 0.16 * (G.loop - 1);

  const colWidth = () => Math.min(W / (G.cols + 1.35), 48 * S);
  const gridWidth = () => colWidth() * (G.cols - 1);
  const swayAmp = () => Math.max(4, (W - gridWidth()) / 2 - 14 * S);

  function slotPos(row, col) {
    const L = layout();
    return {
      x: W / 2 - gridWidth() / 2 + col * colWidth() + G.sway,
      y: L.top + row * L.rowH + Math.sin(G.time * 1.6 + row * 0.6) * 2 * S
    };
  }

  let enemySeq = 0;

  function makeEnemy(type, row, col) {
    const def = TYPES[type];
    return {
      id: ++enemySeq,
      type: type, def: def, row: row, col: col,
      x: 0, y: 0, angle: 0, ox: 0, oy: 0,
      mode: 'path', path: null, d: 0, speed: 0,
      hp: def.hp, t: Math.random() * 6, flash: 0,
      fireTimer: rand(0.4, 1.4), inFormation: false
    };
  }

  // --- Entry flight paths --------------------------------------------------
  function entryPath(style, side, slot) {
    const cx = W / 2;
    let wp;
    if (style === 'loop') {
      wp = [
        { x: cx + side * W * 0.62, y: H * 1.06 },
        { x: cx + side * W * 0.40, y: H * 0.74 },
        { x: cx + side * W * 0.10, y: H * 0.58 },
        { x: cx - side * W * 0.20, y: H * 0.46 },
        { x: cx - side * W * 0.26, y: H * 0.30 },
        { x: cx - side * W * 0.04, y: H * 0.22 },
        { x: cx + side * W * 0.20, y: H * 0.30 },
        slot
      ];
    } else if (style === 'top') {
      wp = [
        { x: cx + side * W * 0.34, y: -H * 0.12 },
        { x: cx + side * W * 0.30, y: H * 0.16 },
        { x: cx + side * W * 0.06, y: H * 0.33 },
        { x: cx - side * W * 0.20, y: H * 0.26 },
        { x: cx - side * W * 0.10, y: H * 0.10 },
        slot
      ];
    } else { // 'side' — a fast sweep in from the flank
      wp = [
        { x: cx + side * W * 0.85, y: H * 0.30 },
        { x: cx + side * W * 0.42, y: H * 0.40 },
        { x: cx - side * W * 0.10, y: H * 0.34 },
        { x: cx - side * W * 0.28, y: H * 0.20 },
        slot
      ];
    }
    return makePath(wp, 12);
  }

  function buildWave(def) {
    G.enemies.length = 0;
    G.spawnQueue.length = 0;
    G.cols = def.cols;
    G.rowCount = def.rows.length;

    const styles = ['loop', 'top', 'side'];
    for (let r = 0; r < def.rows.length; r++) {
      const style = styles[r % styles.length];
      for (let c = 0; c < def.cols; c++) {
        G.spawnQueue.push({
          delay: r * 1.05 + c * 0.12,
          type: def.rows[r],
          row: r,
          col: c,
          style: style,
          side: c % 2 === 0 ? -1 : 1
        });
      }
    }
    G.diveTimer = rand(2.4, 3.4);
    G.snipeTimer = def.snipe || 0;
  }

  function updateSpawnQueue(dt) {
    for (let i = G.spawnQueue.length - 1; i >= 0; i--) {
      const s = G.spawnQueue[i];
      s.delay -= dt;
      if (s.delay > 0) continue;
      G.spawnQueue.splice(i, 1);
      const e = makeEnemy(s.type, s.row, s.col);
      const slot = slotPos(s.row, s.col);
      e.path = entryPath(s.style, s.side, { x: slot.x, y: slot.y });
      e.d = 0;
      e.speed = 300 * S * e.def.speed * loopMul();
      e.mode = 'path';
      e.onArrive = 'formation';
      e.x = e.path.pts[0].x;
      e.y = e.path.pts[0].y;
      G.enemies.push(e);
    }
  }

  // --- Dives ---------------------------------------------------------------
  function divePath(e) {
    const aimX = clamp(player.x + rand(-40, 40) * S, 24 * S, W - 24 * S);
    const away = e.x < aimX ? -1 : 1;
    return makePath([
      { x: e.x, y: e.y },
      { x: e.x + away * W * 0.12, y: e.y + H * 0.09 },
      { x: aimX - away * W * 0.14, y: H * 0.42 },
      { x: aimX, y: H * 0.62 },
      { x: aimX - away * W * 0.20, y: H * 0.80 },
      { x: aimX - away * W * 0.08, y: H + 90 * S }
    ], 12);
  }

  function returnPath(e) {
    const slot = slotPos(e.row, e.col);
    const startX = clamp(slot.x + rand(-0.16, 0.16) * W, 20 * S, W - 20 * S);
    return makePath([
      { x: startX, y: -70 * S },
      { x: startX + (slot.x - startX) * 0.4, y: H * 0.12 },
      { x: slot.x, y: slot.y }
    ], 12);
  }

  function startDive(e) {
    if (e.def.static || e.mode !== 'formation') return;
    e.mode = 'path';
    e.path = divePath(e);
    e.d = 0;
    e.speed = (250 + 55 * Math.min(G.wave, 8)) * S * e.def.speed * 0.55 * loopMul();
    e.onArrive = 'return';
    e.inFormation = false;
    e.fireTimer = rand(0.25, 0.6);
  }

  function updateEnemies(dt) {
    const def = waveDef();
    G.sway = Math.sin(G.time * 0.45) * swayAmp() * 0.6;
    const bulletMul = (def.bspd || 1.1) * loopMul();

    for (let i = G.enemies.length - 1; i >= 0; i--) {
      const e = G.enemies[i];
      e.t += dt;
      if (e.flash > 0) e.flash -= dt;

      if (e.mode === 'path') {
        e.d += e.speed * dt;
        const p = pathAt(e.path, e.d);
        e.x = p.x;
        e.y = p.y;
        e.angle = p.a - Math.PI / 2;

        // Diving enemies take pot shots at the player.
        if ((e.onArrive === 'return' || e.onArrive === 'gone') && e.y < H * 0.86) {
          e.fireTimer -= dt;
          if (e.fireTimer <= 0) {
            e.fireTimer = rand(0.5, 1.3) / e.def.aim;
            enemyShoot(e, bulletMul, true);
          }
        }

        if (e.d >= e.path.len) {
          if (e.onArrive === 'gone') {
            G.enemies.splice(i, 1);
          } else if (e.onArrive === 'formation') {
            const slot = slotPos(e.row, e.col);
            e.ox = e.x - slot.x;
            e.oy = e.y - slot.y;
            e.mode = 'formation';
            e.inFormation = true;
          } else {
            // Dived off the bottom — swing back around from the top.
            e.path = returnPath(e);
            e.d = 0;
            e.speed = 320 * S * loopMul();
            e.onArrive = 'formation';
          }
        }
      } else {
        const slot = slotPos(e.row, e.col);
        const decay = Math.exp(-dt * 5);
        e.ox *= decay;
        e.oy *= decay;
        e.x = slot.x + e.ox;
        e.y = slot.y + e.oy;
        e.angle = 0;
      }
    }

    // Send fresh divers at the player.
    if (def.rows && G.spawnQueue.length === 0) {
      G.diveTimer -= dt;
      if (G.diveTimer <= 0) {
        const ready = G.enemies.filter((e) => e.mode === 'formation' && !e.def.static);
        if (ready.length) {
          // Prefer the bottom rows, the way the arcade original peels them off.
          ready.sort((a, b) => b.row - a.row || Math.random() - 0.5);
          const n = Math.min(randInt(1, def.divers || 1), ready.length);
          for (let k = 0; k < n; k++) {
            const target = ready[Math.min(k, ready.length - 1)];
            setTimeout(() => { if (G.state === 'play' && G.enemies.indexOf(target) >= 0) startDive(target); }, k * 160);
          }
        }
        const range = def.dive || [2, 3];
        G.diveTimer = rand(range[0], range[1]) / loopMul();
      }

      // Formation snipers plink downwards from later waves on.
      if (def.snipe) {
        G.snipeTimer -= dt;
        if (G.snipeTimer <= 0) {
          G.snipeTimer = def.snipe / loopMul();
          const shooters = G.enemies.filter((e) => e.mode === 'formation');
          if (shooters.length) enemyShoot(pick(shooters), bulletMul, Math.random() < 0.4);
        }
      }
    }
  }

  // =========================================================
  // 9. Projectiles and power-ups
  // =========================================================

  function bolt(x, y, vx, vy, r) {
    G.pBullets.push({ x: x, y: y, vx: vx, vy: vy, r: r || 3.2 * S });
  }

  function playerShoot() {
    if (player.cool > 0) return;
    const speed = 720 * S;
    const w = player.weapon;
    // The lance hits harder and passes through, so it fires slower.
    player.cool = (player.rapid > 0 ? 0.085 : 0.185) * (w === 'pierce' ? 1.5 : 1);
    const y = player.y - 13 * S;

    if (w === 'twin') {
      bolt(player.x - 7 * S, y, 0, -speed);
      bolt(player.x + 7 * S, y, 0, -speed);
    } else if (w === 'spread') {
      for (const a of [-0.28, 0, 0.28]) {
        bolt(player.x, y, Math.sin(a) * speed, -Math.cos(a) * speed);
      }
    } else if (w === 'pierce') {
      G.pBullets.push({
        x: player.x, y: y, vx: 0, vy: -speed * 1.15,
        r: 5.5 * S, pierce: true, hit: []
      });
    } else {
      bolt(player.x, y, 0, -speed);
    }

    if (player.wingmen > 0) {
      for (const d of player.drones) bolt(d.x, d.y - 8 * S, 0, -speed * 0.94, 2.6 * S);
    }
    Sound.shoot();
  }

  function enemyShoot(e, mul, aimed) {
    const speed = 215 * S * (mul || 1);
    let vx = 0, vy = speed;
    if (aimed) {
      const a = Math.atan2(player.y - e.y, player.x - e.x);
      vx = Math.cos(a) * speed;
      vy = Math.sin(a) * speed;
    }
    // All incoming fire is the same hot orange: green is yours, orange is theirs.
    G.eBullets.push({ x: e.x, y: e.y + 10 * S, vx: vx, vy: vy, r: 4 * S, color: '#ff8c42', kind: 'plain', life: 6 });
    Sound.enemyShoot();
  }

  function bossBullet(x, y, angle, speed, opts) {
    const o = opts || {};
    G.eBullets.push({
      x: x, y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: (o.r || 5) * S,
      color: o.color || '#ff8c42',
      kind: o.kind || 'plain',
      turn: o.turn || 0,
      life: o.life || 8
    });
  }

  /** `dt` drives the player's shots; `edt` is the raiders' clock (time warp). */
  function updateBullets(dt, edt) {
    for (let i = G.pBullets.length - 1; i >= 0; i--) {
      const b = G.pBullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.y < -20 || b.x < -30 || b.x > W + 30) G.pBullets.splice(i, 1);
    }

    for (let i = G.eBullets.length - 1; i >= 0; i--) {
      const b = G.eBullets[i];
      b.life -= edt;
      if (b.kind === 'missile' && player.alive) {
        // Missiles steer toward the player, but only so fast.
        const want = Math.atan2(player.y - b.y, player.x - b.x);
        let cur = Math.atan2(b.vy, b.vx);
        let diff = want - cur;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        cur += clamp(diff, -b.turn * edt, b.turn * edt);
        const sp = hypot(b.vx, b.vy);
        b.vx = Math.cos(cur) * sp;
        b.vy = Math.sin(cur) * sp;
      }
      b.x += b.vx * edt;
      b.y += b.vy * edt;
      if (b.life <= 0 || b.y > H + 30 || b.y < -60 || b.x < -40 || b.x > W + 40) {
        if (b.kind === 'missile' && b.life <= 0) explode(b.x, b.y, '#ff9f68', 10, 0.8);
        G.eBullets.splice(i, 1);
      }
    }
  }

  // Weapons replace each other; the rest stack on top of whatever is equipped.
  const POWERUPS = [
    { kind: 'twin',    weight: 18, label: 'TWIN LASER',  color: '#8dff5a', glyph: 'II' },
    { kind: 'spread',  weight: 16, label: 'SPREAD LASER', color: '#4da6ff', glyph: 'W' },
    { kind: 'pierce',  weight: 12, label: 'HYPER LASER',  color: '#cfe8ff', glyph: 'L' },
    { kind: 'rapid',   weight: 16, label: 'RAPID FIRE',   color: '#ffc94d', glyph: 'R' },
    { kind: 'shield',  weight: 15, label: 'BARRIER',      color: '#5cd6ff', glyph: 'S' },
    { kind: 'wingmen', weight: 11, label: 'WINGMEN',      color: '#ff9f68', glyph: 'V' },
    { kind: 'bomb',    weight: 7,  label: 'SMART BOMB',   color: '#ff5a2b', glyph: 'B' },
    { kind: 'warp',    weight: 7,  label: 'TIME WARP',    color: '#a78bfa', glyph: 'T' },
    { kind: 'life',    weight: 4,  label: 'EXTRA LIFE',   color: '#ffd166', glyph: '1' }
  ];

  function dropPowerup(x, y) {
    let total = 0;
    for (const p of POWERUPS) total += p.weight;
    let roll = Math.random() * total;
    let chosen = POWERUPS[0];
    for (const p of POWERUPS) {
      roll -= p.weight;
      if (roll <= 0) { chosen = p; break; }
    }
    G.powerups.push({ x: x, y: y, vy: 95 * S, def: chosen, t: 0, r: 12 * S });
  }

  function updatePowerups(dt) {
    for (let i = G.powerups.length - 1; i >= 0; i--) {
      const p = G.powerups[i];
      p.t += dt;
      p.y += p.vy * dt;
      p.x += Math.sin(p.t * 2.6) * 22 * S * dt;
      if (p.y > H + 30) { G.powerups.splice(i, 1); continue; }
      if (player.alive && hypot(p.x - player.x, p.y - player.y) < p.r + player.r) {
        G.powerups.splice(i, 1);
        applyPowerup(p.def);
      }
    }
  }

  function applyPowerup(def) {
    Sound.powerup();
    switch (def.kind) {
      case 'twin': setWeapon('twin', 15); break;
      case 'spread': setWeapon('spread', 15); break;
      case 'pierce': setWeapon('pierce', 12); break;
      case 'rapid': player.rapid = 12; break;
      case 'shield': player.shield = true; break;
      case 'wingmen': launchWingmen(16); break;
      case 'warp': G.slow = 6; Sound.tone(760, 0.5, 'sine', 0.06, 180); break;
      case 'bomb': detonateBomb(); break;
      case 'life': G.lives++; updateLives(); break;
    }
    floatText(player.x, player.y - 26 * S, def.label, def.color);
    refreshChip();
  }

  /** Clears the screen: every shot gone, every raider hit at once. */
  function detonateBomb() {
    G.eBullets.length = 0;
    G.flash = 0.4;
    G.shock = { x: player.x, y: player.y, t: 0 };
    G.shake = 20;
    Sound.bigKill();
    for (let i = G.enemies.length - 1; i >= 0; i--) {
      const e = G.enemies[i];
      explode(e.x, e.y, e.def.color, 16, 1.2);
      addScore(e.def.pts);
      G.enemies.splice(i, 1);
    }
    if (G.boss) damageBoss(10);
  }

  // =========================================================
  // 10. Bosses
  // =========================================================

  const BOSS_DEFS = {
    sentinel: {
      name: 'SENTINEL', hp: 78, r: 44, color: '#8496b5', plate: '#465873', glow: '#cfe0ff', core: '#ff3b1f', shot: '#ff8c42',
      pools: [
        ['spread', 'aimed', 'escort'],
        ['spread', 'aimed', 'beam', 'escort'],
        ['beam', 'aimed', 'spread', 'spread']
      ]
    },
    queen: {
      name: 'HIVE QUEEN', hp: 122, r: 48, color: '#7d6bb8', plate: '#3c3168', glow: '#d9ccff', core: '#7dff4d', shot: '#b06bff',
      pools: [
        ['radial', 'escort', 'aimed'],
        ['radial', 'tractor', 'wall', 'escort'],
        ['radial', 'tractor', 'wall', 'aimed', 'escort']
      ]
    },
    dread: {
      name: 'DREADNOUGHT', hp: 186, r: 54, color: '#75808f', plate: '#3a424f', glow: '#ffd9a8', core: '#ff8c1f', shot: '#ff6b35',
      pools: [
        ['wall', 'missiles', 'aimed'],
        ['wall', 'missiles', 'sweep', 'escort'],
        ['sweep', 'wall', 'missiles', 'radial', 'aimed']
      ]
    }
  };

  const ACT_DUR = {
    idle: 0.9, spread: 2.4, radial: 2.6, aimed: 1.7, wall: 3.0,
    beam: 2.7, sweep: 3.4, escort: 0.6, tractor: 3.0, missiles: 1.8
  };

  function spawnBoss(kind) {
    const d = BOSS_DEFS[kind];
    const maxHp = Math.round(d.hp * (1 + 0.42 * (G.loop - 1)));
    G.boss = {
      kind: kind, def: d, name: d.name,
      hp: maxHp, maxHp: maxHp,
      r: d.r * S,
      x: W / 2, y: -d.r * S * 1.6,
      homeY: clamp(H * 0.27, 140 * S, 224 * S),
      t: 0, flash: 0, entering: true,
      act: { name: 'idle', t: 0, dur: 1.6, step: 0 },
      lastAction: '',
      beam: null,
      phase: 1,
      dying: 0
    };
    el('bossName').textContent = d.name;
    el('bossBarFill').style.width = '100%';
    el('bossBarWrap').classList.remove('hidden');
    G.escortTimer = 7;
  }

  function bossPhase(b) {
    const f = b.hp / b.maxHp;
    return f > 0.6 ? 1 : f > 0.3 ? 2 : 3;
  }

  function bossRest(b) { return [0.95, 0.7, 0.5][b.phase - 1]; }

  function bossChooseAction(b) {
    const pool = b.def.pools[b.phase - 1];
    let name = pick(pool);
    if (name === b.lastAction && pool.length > 1) name = pick(pool);
    b.lastAction = name;
    b.act = { name: name, t: 0, dur: ACT_DUR[name], step: 0 };
    if (name === 'beam' || name === 'sweep') Sound.charge();
    if (name === 'escort') spawnEscorts(b);
    if (name === 'missiles') b.act.fired = 0;
  }

  function spawnEscorts(b) {
    const n = 2 + b.phase + (G.loop > 1 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const startX = W / 2 + side * rand(W * 0.15, W * 0.42);
      const e = makeEnemy(Math.random() < 0.35 ? 'commander' : 'wasp', 0, 0);
      e.escort = true;
      e.hp = 1;
      e.path = makePath([
        { x: startX, y: -60 * S - i * 30 * S },
        { x: startX + side * W * 0.10, y: H * 0.24 },
        { x: clamp(player.x - side * W * 0.14, 20 * S, W - 20 * S), y: H * 0.52 },
        { x: clamp(player.x, 20 * S, W - 20 * S), y: H * 0.74 },
        { x: clamp(player.x + side * W * 0.24, 20 * S, W - 20 * S), y: H + 90 * S }
      ], 12);
      e.d = 0;
      e.speed = 235 * S * loopMul();
      e.mode = 'path';
      e.onArrive = 'gone';
      e.x = e.path.pts[0].x;
      e.y = e.path.pts[0].y;
      G.enemies.push(e);
    }
  }

  function updateBoss(dt) {
    const b = G.boss;
    if (!b) return;
    b.t += dt;
    if (b.flash > 0) b.flash -= dt;
    b.phase = bossPhase(b);

    // Slide into position before opening fire.
    if (b.entering) {
      b.y += (b.homeY - b.y) * Math.min(1, dt * 2.2);
      if (Math.abs(b.y - b.homeY) < 2) { b.entering = false; b.act = { name: 'idle', t: 0, dur: 0.6, step: 0 }; }
      return;
    }

    const amp = Math.max(10, W / 2 - b.r * 1.45 - 8 * S);
    if (b.kind === 'sentinel') {
      b.x = W / 2 + Math.sin(b.t * (0.75 + b.phase * 0.16)) * amp;
      b.y = b.homeY + Math.sin(b.t * 1.5) * 7 * S;
    } else if (b.kind === 'queen') {
      b.x = W / 2 + Math.sin(b.t * (0.62 + b.phase * 0.14)) * amp;
      b.y = b.homeY + Math.sin(b.t * (1.24 + b.phase * 0.28)) * 26 * S;
    } else {
      b.x = W / 2 + Math.sin(b.t * (0.5 + b.phase * 0.12)) * amp * 0.92;
      b.y = b.homeY + Math.sin(b.t * 0.9) * 14 * S;
    }

    b.act.t += dt;
    runBossAction(b, dt);

    if (b.act.t >= b.act.dur) {
      b.beam = null;
      if (b.act.name === 'idle') bossChooseAction(b);
      else b.act = { name: 'idle', t: 0, dur: bossRest(b), step: 0 };
    }

    // A trickle of escorts keeps the pressure up between scripted attacks.
    G.escortTimer -= dt;
    if (G.escortTimer <= 0) {
      G.escortTimer = Math.max(5, 11 - b.phase * 1.6) / loopMul();
      if (G.enemies.length < 7) spawnEscorts(b);
    }
  }

  function runBossAction(b, dt) {
    const a = b.act;
    const t = a.t;
    const aimAngle = () => Math.atan2(player.y - b.y, player.x - b.x);
    const speedMul = (0.95 + b.phase * 0.1) * loopMul();

    switch (a.name) {
      case 'spread': {
        // Fans of bullets, every beat.
        if (t >= a.step * 0.6) {
          a.step++;
          const base = aimAngle();
          const n = 3 + b.phase;
          for (let i = 0; i < n; i++) {
            const off = (i - (n - 1) / 2) * 0.22;
            bossBullet(b.x, b.y + b.r * 0.6, base + off, 230 * S * speedMul, { color: b.def.shot });
          }
          Sound.enemyShoot();
        }
        break;
      }
      case 'radial': {
        if (t >= a.step * 0.72) {
          a.step++;
          const n = 10 + b.phase * 3;
          const spin = a.step * 0.18;
          for (let i = 0; i < n; i++) {
            bossBullet(b.x, b.y, (i / n) * Math.PI * 2 + spin, 175 * S * speedMul, { r: 4.5, color: b.def.shot });
          }
          Sound.enemyShoot();
        }
        break;
      }
      case 'aimed': {
        if (t >= a.step * 0.16) {
          a.step++;
          bossBullet(b.x + rand(-1, 1) * b.r * 0.5, b.y + b.r * 0.5, aimAngle(), 340 * S * speedMul, { r: 4, color: '#fff0a8' });
        }
        break;
      }
      case 'wall': {
        // A curtain of bullets with one gap to thread.
        if (t >= a.step * 1.0) {
          a.step++;
          const slots = 9;
          const gap = randInt(0, slots - 1);
          for (let i = 0; i < slots; i++) {
            if (i === gap || i === gap + 1) continue;
            const x = (i + 0.5) * (W / slots);
            bossBullet(x, b.y + b.r * 0.4, Math.PI / 2, 200 * S * speedMul, { r: 5, color: b.def.shot });
          }
          Sound.enemyShoot();
        }
        break;
      }
      case 'missiles': {
        if (t >= a.step * 0.42 && a.step < 3 + b.phase) {
          a.step++;
          const side = a.step % 2 === 0 ? -1 : 1;
          bossBullet(b.x + side * b.r * 0.7, b.y + b.r * 0.4, Math.PI / 2 + side * 0.5, 175 * S * speedMul, {
            kind: 'missile', turn: 1.5 + 0.25 * b.phase, r: 5, color: '#ff9f68', life: 6
          });
          Sound.enemyShoot();
        }
        break;
      }
      case 'beam': {
        const charge = 1.05;
        if (t < charge) {
          // Track the player while charging, then lock on when it fires.
          b.beam = { charge: t / charge, active: false, ang: Math.PI / 2 + (player.x - b.x) / H * 0.9, w: 15 * S };
        } else {
          if (!b.beam || !b.beam.active) Sound.tone(140, 0.4, 'sawtooth', 0.07);
          b.beam = { charge: 1, active: true, ang: b.beam ? b.beam.ang : Math.PI / 2, w: 15 * S };
          G.shake = Math.max(G.shake, 3);
        }
        break;
      }
      case 'sweep': {
        const charge = 1.2;
        const dur = a.dur - charge;
        if (t < charge) {
          b.beam = { charge: t / charge, active: false, ang: Math.PI / 2 - 0.72, w: 13 * S };
        } else {
          const k = clamp((t - charge) / dur, 0, 1);
          const dir = a.dir || (a.dir = Math.random() < 0.5 ? 1 : -1);
          b.beam = { charge: 1, active: true, ang: Math.PI / 2 + dir * (-0.72 + 1.44 * k), w: 13 * S };
          G.shake = Math.max(G.shake, 3);
        }
        break;
      }
      case 'tractor': {
        // The Queen drags the player upward while spitting slow orbs.
        b.beam = { charge: 1, active: false, tractor: true, ang: Math.PI / 2, w: 40 * S };
        if (player.alive) {
          const pull = 130 * S * dt;
          player.ty = clamp(player.ty - pull, playerMinY(), playerMaxY());
          player.tx += clamp(b.x - player.tx, -pull, pull);
        }
        if (t >= a.step * 0.5) {
          a.step++;
          bossBullet(b.x + rand(-b.r, b.r), b.y + b.r * 0.5, Math.PI / 2 + rand(-0.4, 0.4), 130 * S * speedMul, { r: 6, color: '#d9a8ff' });
        }
        break;
      }
      default:
        b.beam = null;
    }
  }

  /** Bosses are wider than they are tall, so test against an ellipse. */
  function bossHit(b, x, y, pad) {
    const dx = (x - b.x) / (b.r * 1.3 + (pad || 0));
    const dy = (y - b.y) / (b.r * 0.95 + (pad || 0));
    return dx * dx + dy * dy <= 1;
  }

  /** Distance from a point to a ray, used for beam hits. */
  function rayDist(px, py, ox, oy, ang) {
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const t = (px - ox) * dx + (py - oy) * dy;
    if (t < 0) return Infinity;
    return hypot(px - (ox + dx * t), py - (oy + dy * t));
  }

  function damageBoss(amount) {
    const b = G.boss;
    if (!b || b.dying) return;
    const before = b.phase;
    b.hp -= amount;
    b.flash = 0.09;
    if (b.hp <= 0) {
      b.hp = 0;
      killBoss();
    } else if (bossPhase(b) !== before) {
      // Phase change resets the attack script and clears the field a little.
      b.act = { name: 'idle', t: 0, dur: 0.7, step: 0 };
      b.beam = null;
      G.eBullets.length = 0;
      floatText(b.x, b.y, 'ARMOR BREACH', '#ffd166');
      Sound.warn();
      G.shake = 10;
    }
    el('bossBarFill').style.width = (100 * b.hp / b.maxHp).toFixed(1) + '%';
  }

  function killBoss() {
    const b = G.boss;
    addScore(2500 * G.loop + 500 * G.wave);
    for (let i = 0; i < 26; i++) {
      setTimeout(() => {
        if (!G.bossWreck || G.state === 'menu' || G.state === 'over') return;
        explode(G.bossWreck.x + rand(-1, 1) * b.r, G.bossWreck.y + rand(-1, 1) * b.r * 0.7, i % 2 ? '#ffd166' : b.def.color, 12, 1.5);
        G.shake = 12;
        if (i % 4 === 0) Sound.bigKill();
      }, i * 60);
    }
    G.bossWreck = { x: b.x, y: b.y, r: b.r, def: b.def, t: 0 };
    G.boss = null;
    G.eBullets.length = 0;
    // Escorts still on screen go up with the mothership.
    for (const e of G.enemies) { explode(e.x, e.y, e.def.color, 10, 1); addScore(e.def.pts); }
    G.enemies.length = 0;
    G.spawnQueue.length = 0;
    G.bossDefeated = true;
    G.waveClearTimer = 2.4;
    el('bossBarWrap').classList.add('hidden');
  }

  // =========================================================
  // 11. Player, effects and collisions
  // =========================================================

  function explode(x, y, color, count, scale) {
    const n = count || 14;
    const sc = scale || 1;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(40, 240) * S * sc;
      G.parts.push({
        x: x, y: y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rand(0.35, 0.8), max: 0.8,
        size: rand(1.6, 4.2) * S * sc,
        color: Math.random() < 0.3 ? '#ffffff' : color
      });
    }
  }

  function floatText(x, y, text, color) {
    // Stack labels that land together instead of overprinting them.
    for (const t of G.texts) {
      if (Math.abs(t.y - y) < 16 * S && Math.abs(t.x - x) < 90 * S) y = t.y - 17 * S;
    }
    G.texts.push({ x: x, y: y, text: text, color: color || '#fff', life: 1.1 });
  }

  function updateEffects(dt) {
    for (let i = G.parts.length - 1; i >= 0; i--) {
      const p = G.parts[i];
      p.life -= dt;
      if (p.life <= 0) { G.parts.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.94;
      p.vy = p.vy * 0.94 + 40 * S * dt;
    }
    for (let i = G.texts.length - 1; i >= 0; i--) {
      const t = G.texts[i];
      t.life -= dt;
      t.y -= 26 * S * dt;
      if (t.life <= 0) G.texts.splice(i, 1);
    }
    if (G.shake > 0) G.shake = Math.max(0, G.shake - dt * 26);
    if (G.flash > 0) G.flash = Math.max(0, G.flash - dt);
    if (G.shock) {
      G.shock.t += dt;
      if (G.shock.t > 0.75) G.shock = null;
    }
  }

  function updatePlayer(dt) {
    if (!player.alive) {
      player.deadTimer -= dt;
      if (player.deadTimer <= 0) {
        if (G.lives > 0) respawn();
        else gameOver();
      }
      return;
    }

    const kspd = 340 * S * dt;
    if (input.left) player.tx -= kspd;
    if (input.right) player.tx += kspd;
    if (input.up) player.ty -= kspd;
    if (input.down) player.ty += kspd;
    player.tx = clamp(player.tx, 16 * S, W - 16 * S);
    player.ty = clamp(player.ty, playerMinY(), playerMaxY());

    const k = Math.min(1, dt * 16);
    player.x += (player.tx - player.x) * k;
    player.y += (player.ty - player.y) * k;

    player.cool -= dt;
    if (player.invuln > 0) player.invuln -= dt;
    if (player.rapid > 0) player.rapid -= dt;
    if (player.weaponTime > 0) {
      player.weaponTime -= dt;
      if (player.weaponTime <= 0) player.weapon = 'single';
    }
    if (player.wingmen > 0) {
      player.wingmen -= dt;
      if (player.wingmen <= 0) {
        for (const d of player.drones) explode(d.x, d.y, '#ff9f68', 10, 0.8);
        player.drones = [];
      } else {
        // Drones trail the ship rather than sticking to it rigidly.
        const k = Math.min(1, dt * 9);
        for (const d of player.drones) {
          d.x += (player.x + d.side * 26 * S - d.x) * k;
          d.y += (player.y + 8 * S - d.y) * k;
        }
      }
    }

    if (settings.autoFire || input.firing) playerShoot();

    // Engine exhaust
    player.thrust += dt;
    if (player.thrust > 0.03) {
      player.thrust = 0;
      G.parts.push({
        x: player.x + rand(-3, 3) * S, y: player.y + 13 * S,
        vx: rand(-14, 14) * S, vy: rand(90, 170) * S,
        life: 0.22, max: 0.3, size: rand(1.4, 2.6) * S,
        color: player.rapid > 0 ? '#ffc94d' : '#5cc8ff'
      });
    }
  }

  function respawn() {
    player.alive = true;
    player.x = player.tx = W / 2;
    player.y = player.ty = playerMaxY();
    player.invuln = 2.2;
    player.shield = false;
    player.weapon = 'single';
    player.weaponTime = 0;
    player.rapid = 0;
    player.wingmen = 0;
    player.drones = [];
    player.cool = 0;
    G.eBullets.length = 0;
    refreshChip();
  }

  function hitPlayer() {
    if (!player.alive || player.invuln > 0) return;
    if (player.shield) {
      player.shield = false;
      player.invuln = 1.1;
      explode(player.x, player.y, '#5cd6ff', 16, 1);
      floatText(player.x, player.y - 24 * S, 'BARRIER DOWN', '#5cd6ff');
      Sound.hit();
      refreshChip();
      return;
    }
    player.alive = false;
    player.deadTimer = 1.6;
    G.lives--;
    updateLives();
    explode(player.x, player.y, '#9fd8ff', 34, 1.6);
    G.shake = 14;
    Sound.playerDie();
    refreshChip();
  }

  function killEnemy(index) {
    const e = G.enemies[index];
    const diving = e.mode === 'path' && (e.onArrive === 'return' || e.onArrive === 'gone');
    const pts = Math.round(e.def.pts * (diving ? 2 : 1) * (1 + 0.2 * (G.loop - 1)));
    addScore(pts);
    explode(e.x, e.y, e.def.color, diving ? 20 : 14, diving ? 1.2 : 1);
    if (diving) floatText(e.x, e.y, String(pts), '#ffd166');
    if (e.def.drop && Math.random() < e.def.drop) dropPowerup(e.x, e.y);
    Sound.kill();
    G.enemies.splice(index, 1);
  }

  const BOSS_HIT_ID = -1;      // stands in for the boss in a pierce hit list

  function collisions() {
    // Player shots
    for (let i = G.pBullets.length - 1; i >= 0; i--) {
      const b = G.pBullets[i];
      let spent = false;

      for (let j = G.enemies.length - 1; j >= 0; j--) {
        const e = G.enemies[j];
        if (hypot(b.x - e.x, b.y - e.y) >= e.def.r * S + b.r) continue;
        if (b.pierce) {
          if (b.hit.indexOf(e.id) >= 0) continue;   // already skewered this one
          b.hit.push(e.id);
        } else {
          spent = true;
        }
        e.hp--;
        e.flash = 0.09;
        if (e.hp <= 0) killEnemy(j);
        else { Sound.hit(); explode(b.x, b.y, e.def.color, 4, 0.5); }
        if (spent) break;
      }

      if (!spent && G.boss && bossHit(G.boss, b.x, b.y, b.r) &&
          !(b.pierce && b.hit.indexOf(BOSS_HIT_ID) >= 0)) {
        // Hold the reference: the killing blow clears G.boss.
        const boss = G.boss;
        if (b.pierce) b.hit.push(BOSS_HIT_ID); else spent = true;
        damageBoss(1);
        explode(b.x, b.y, boss.def.glow, 5, 0.6);
        Sound.hit();
      }

      if (spent) G.pBullets.splice(i, 1);
    }

    if (!player.alive || player.invuln > 0) return;

    // Enemy shots
    for (let i = G.eBullets.length - 1; i >= 0; i--) {
      const b = G.eBullets[i];
      if (hypot(b.x - player.x, b.y - player.y) < b.r + player.r * 0.8) {
        G.eBullets.splice(i, 1);
        hitPlayer();
        return;
      }
    }

    // Ramming raiders
    for (let i = G.enemies.length - 1; i >= 0; i--) {
      const e = G.enemies[i];
      if (hypot(e.x - player.x, e.y - player.y) < e.def.r * S + player.r * 0.8) {
        explode(e.x, e.y, e.def.color, 16, 1.1);
        G.enemies.splice(i, 1);
        hitPlayer();
        return;
      }
    }

    // Boss body and beam
    if (G.boss) {
      const b = G.boss;
      if (bossHit(b, player.x, player.y, player.r * 0.7)) { hitPlayer(); return; }
      if (b.beam && b.beam.active && rayDist(player.x, player.y, b.x, b.y, b.beam.ang) < b.beam.w * 0.5 + player.r * 0.5) {
        hitPlayer();
      }
    }
  }

  // =========================================================
  // 12. Score, lives and wave flow
  // =========================================================

  function addScore(n) {
    G.score += n;
    if (G.practice) { el('hudScore').textContent = G.score.toLocaleString(); return; }
    el('hudScore').textContent = G.score.toLocaleString();
    if (G.score >= G.nextExtraLife) {
      G.nextExtraLife += 40000;
      G.lives++;
      updateLives();
      floatText(player.x, player.y - 34 * S, 'EXTRA SHIP', '#f72585');
      Sound.powerup();
    }
    if (G.score > records.best) {
      records.best = G.score;
      el('hudBest').textContent = records.best.toLocaleString();
    }
  }

  const LIFE_ICON =
    '<svg class="life-icon" viewBox="0 0 20 20" aria-hidden="true">' +
    '<path d="M10 1 L17 16 L10 12.5 L3 16 Z" fill="#7bdff2" stroke="#e8ecff" stroke-width="1.2" stroke-linejoin="round"/></svg>';

  function updateLives() {
    const n = Math.max(0, G.lives);
    el('hudLives').innerHTML = LIFE_ICON.repeat(Math.min(n, 6)) +
      (n > 6 ? '<span style="font-size:11px;margin-left:4px">x' + n + '</span>' : '');
  }

  const badgeOf = (kind) => POWERUPS.find((p) => p.kind === kind);

  function refreshChip() {
    const active = [];
    if (player.weapon !== 'single') active.push([player.weapon, Math.ceil(player.weaponTime)]);
    if (player.rapid > 0) active.push(['rapid', Math.ceil(player.rapid)]);
    if (player.wingmen > 0) active.push(['wingmen', Math.ceil(player.wingmen)]);
    if (G.slow > 0) active.push(['warp', Math.ceil(G.slow)]);
    if (player.shield) active.push(['shield', 0]);

    const key = active.map((a) => a[0] + a[1]).join(',');
    const chip = el('hudPowerup');
    if (key === chip.dataset.key) return;
    chip.dataset.key = key;
    chip.innerHTML = active.map(([kind, secs]) => {
      const def = badgeOf(kind);
      return '<span class="pw" style="color:' + def.color + ';border-color:' + def.color + '">' +
             '<b>' + def.glyph + '</b>' + (secs ? secs : '') + '</span>';
    }).join('');
    chip.classList.toggle('hidden', active.length === 0);
  }
  function announce(main, sub, danger) {
    const a = el('announce');
    el('announceMain').textContent = main;
    el('announceSub').textContent = sub || '';
    a.classList.toggle('danger', !!danger);
    a.classList.remove('hidden');
    // Restart the CSS entrance animation.
    const m = el('announceMain');
    m.style.animation = 'none';
    void m.offsetWidth;
    m.style.animation = '';
  }

  function hideAnnounce() { el('announce').classList.add('hidden'); }

  function startWave() {
    const def = waveDef();
    G.bossDefeated = false;
    G.bossWreck = null;
    G.enemies.length = 0;
    G.spawnQueue.length = 0;
    G.eBullets.length = 0;
    G.pBullets.length = 0;
    G.powerups.length = 0;
    G.boss = null;
    el('bossBarWrap').classList.add('hidden');
    el('hudWave').textContent = G.wave;
    if (!G.practice && G.wave > records.bestWave) {
      records.bestWave = G.wave;
      Store.set('bestWave', G.wave);
    }

    const sub = def.name + (G.loop > 1 ? ' · Loop ' + G.loop : '');
    if (def.boss) {
      announce('WARNING', sub, true);
      Sound.warn();
      G.introTimer = 2.6;
    } else {
      announce('WAVE ' + G.wave, sub, false);
      Sound.levelUp();
      G.introTimer = 1.9;
    }
    G.state = 'intro';
  }

  function beginWaveCombat() {
    const def = waveDef();
    hideAnnounce();
    G.waveClearTimer = 0.9;
    if (def.boss) spawnBoss(def.boss);
    else buildWave(def);
    G.state = 'play';
  }

  function waveComplete() {
    const bonus = 400 * G.wave + 600 * (G.loop - 1);
    addScore(bonus);
    announce('WAVE CLEAR', '+' + bonus.toLocaleString() + ' bonus');
    Sound.levelUp();
    G.waveClearTimer = 2.0;
    G.state = 'clear';
  }

  function advanceWave() {
    G.wave++;
    if ((G.wave - 1) % WAVES.length === 0) G.loop++;
    startWave();
  }

  // =========================================================
  // 13. Drawing
  // =========================================================

  /**
   * The player ship: a delta-wing interceptor with vertical wingtip fins,
   * twin engine flares and a bubble canopy — Arwing-shaped.
   */
  function drawPlayer() {
    ctx.save();
    ctx.translate(player.x, player.y);
    const blink = player.invuln > 0 && Math.floor(G.time * 16) % 2 === 0;

    if (!blink) {
      // Twin engine flares
      const f = (5 + Math.sin(G.time * 40) * 2) * S;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = player.rapid > 0 ? 'rgba(255,201,77,.8)' : 'rgba(92,200,255,.8)';
      for (const sx of [-4.5, 4.5]) {
        ctx.beginPath();
        ctx.ellipse(sx * S, 11 * S + f * 0.5, 2.6 * S, 3.4 * S + f, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

      // Wings, swept back and down from the fuselage
      ctx.fillStyle = '#4da6ff';
      ctx.beginPath();
      ctx.moveTo(-3.5 * S, -2 * S);
      ctx.lineTo(-15 * S, 8 * S);
      ctx.lineTo(-15 * S, 12 * S);
      ctx.lineTo(-3.5 * S, 9 * S);
      ctx.closePath();
      ctx.moveTo(3.5 * S, -2 * S);
      ctx.lineTo(15 * S, 8 * S);
      ctx.lineTo(15 * S, 12 * S);
      ctx.lineTo(3.5 * S, 9 * S);
      ctx.closePath();
      ctx.fill();

      // Vertical wingtip fins
      ctx.fillStyle = '#2f7fd4';
      ctx.beginPath();
      ctx.moveTo(-15 * S, 8 * S);
      ctx.lineTo(-17 * S, 0 * S);
      ctx.lineTo(-13.5 * S, 6 * S);
      ctx.closePath();
      ctx.moveTo(15 * S, 8 * S);
      ctx.lineTo(17 * S, 0 * S);
      ctx.lineTo(13.5 * S, 6 * S);
      ctx.closePath();
      ctx.fill();

      // Wing-root laser cannons
      ctx.fillStyle = '#cdd8e8';
      ctx.fillRect(-11 * S, 2 * S, 2.4 * S, 8 * S);
      ctx.fillRect(8.6 * S, 2 * S, 2.4 * S, 8 * S);

      // Fuselage
      ctx.fillStyle = '#eaf1fb';
      ctx.beginPath();
      ctx.moveTo(0, -17 * S);
      ctx.lineTo(4.6 * S, -4 * S);
      ctx.lineTo(5.4 * S, 10 * S);
      ctx.lineTo(-5.4 * S, 10 * S);
      ctx.lineTo(-4.6 * S, -4 * S);
      ctx.closePath();
      ctx.fill();

      // Hull stripes — tinted by the weapon you are carrying
      const WEAPON_TINT = { twin: '#8dff5a', spread: '#4da6ff', pierce: '#cfe8ff' };
      ctx.fillStyle = WEAPON_TINT[player.weapon] || '#ff6b35';
      ctx.fillRect(-4.9 * S, 3 * S, 3 * S, 5 * S);
      ctx.fillRect(1.9 * S, 3 * S, 3 * S, 5 * S);

      // Canopy
      ctx.fillStyle = '#1d5c9e';
      ctx.beginPath();
      ctx.ellipse(0, -5 * S, 2.9 * S, 5.6 * S, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(190,225,255,.75)';
      ctx.beginPath();
      ctx.ellipse(-0.8 * S, -6.5 * S, 1.1 * S, 2.6 * S, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Barrier: a faceted energy shell rather than a plain ring
    if (player.shield) {
      ctx.globalCompositeOperation = 'lighter';
      const a = 0.45 + 0.2 * Math.sin(G.time * 7);
      ctx.strokeStyle = 'rgba(92,214,255,' + a + ')';
      ctx.lineWidth = 1.8 * S;
      ctx.beginPath();
      for (let i = 0; i <= 8; i++) {
        const th = (i / 8) * Math.PI * 2 + G.time * 0.6;
        const rr = 21 * S;
        ctx.lineTo(Math.cos(th) * rr, Math.sin(th) * rr * 0.92);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = 'rgba(92,214,255,.07)';
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }

  /** Wingmen fly the same airframe in their own squadron colours. */
  const WINGMAN_COLORS = [
    { hull: '#dbe6f5', wing: '#3f7fd6', trim: '#ff6b35' },
    { hull: '#dbe6f5', wing: '#4fb87a', trim: '#ffc94d' }
  ];

  function drawDrones() {
    if (player.wingmen <= 0 || !player.alive) return;
    // They blink out over the last two seconds so the loss isn't a surprise.
    if (player.wingmen < 2 && Math.floor(G.time * 10) % 2 === 0) return;

    player.drones.forEach((d, i) => {
      const c = WINGMAN_COLORS[i % WINGMAN_COLORS.length];
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.scale(0.62, 0.62);

      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(92,200,255,.7)';
      ctx.beginPath();
      ctx.ellipse(0, 12 * S, 3 * S, (5 + Math.sin(G.time * 34) * 2) * S, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';

      ctx.fillStyle = c.wing;
      ctx.beginPath();
      ctx.moveTo(-3.5 * S, -2 * S);
      ctx.lineTo(-15 * S, 9 * S);
      ctx.lineTo(-3.5 * S, 9 * S);
      ctx.closePath();
      ctx.moveTo(3.5 * S, -2 * S);
      ctx.lineTo(15 * S, 9 * S);
      ctx.lineTo(3.5 * S, 9 * S);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = c.hull;
      ctx.beginPath();
      ctx.moveTo(0, -16 * S);
      ctx.lineTo(4.6 * S, -3 * S);
      ctx.lineTo(5 * S, 10 * S);
      ctx.lineTo(-5 * S, 10 * S);
      ctx.lineTo(-4.6 * S, -3 * S);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = c.trim;
      ctx.fillRect(-4.4 * S, 3 * S, 2.6 * S, 5 * S);
      ctx.fillRect(1.8 * S, 3 * S, 2.6 * S, 5 * S);
      ctx.fillStyle = '#1d5c9e';
      ctx.beginPath();
      ctx.ellipse(0, -5 * S, 2.6 * S, 5 * S, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  /**
   * Raiders are angular Venom-style craft: a hard-edged hull, swept forward
   * wings and a lit engine core, coloured by rank.
   */
  function drawEnemy(e) {
    const d = e.def;
    const r = d.r * S;
    const flap = Math.sin(e.t * 6) * 0.12;
    const hull = e.flash > 0 ? '#ffffff' : d.color;
    const wing = e.flash > 0 ? '#ffffff' : d.wing;

    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.angle);
    ctx.lineJoin = 'round';

    if (e.type === 'turret') {
      // A gun platform: armour plate, barrel, and a hot targeting eye.
      ctx.fillStyle = d.dark;
      ctx.beginPath();
      ctx.moveTo(-r * 1.15, -r * 0.35);
      ctx.lineTo(-r * 0.55, -r * 0.95);
      ctx.lineTo(r * 0.55, -r * 0.95);
      ctx.lineTo(r * 1.15, -r * 0.35);
      ctx.lineTo(r * 0.8, r * 0.7);
      ctx.lineTo(-r * 0.8, r * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = hull;
      ctx.beginPath();
      ctx.moveTo(-r * 0.85, -r * 0.3);
      ctx.lineTo(-r * 0.42, -r * 0.72);
      ctx.lineTo(r * 0.42, -r * 0.72);
      ctx.lineTo(r * 0.85, -r * 0.3);
      ctx.lineTo(r * 0.6, r * 0.5);
      ctx.lineTo(-r * 0.6, r * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = d.dark;
      ctx.fillRect(-r * 0.22, r * 0.4, r * 0.44, r * 0.85);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = d.glow;
      ctx.beginPath();
      ctx.arc(0, -r * 0.1, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';

    } else if (e.type === 'commander') {
      // Elite command craft: forward-swept wings and a canopy ridge.
      ctx.fillStyle = wing;
      ctx.beginPath();
      ctx.moveTo(-r * 0.45, r * 0.30);
      ctx.lineTo(-r * 1.62, -r * (0.28 + flap));
      ctx.lineTo(-r * 1.34, -r * 0.68);
      ctx.lineTo(-r * 0.42, -r * 0.55);
      ctx.closePath();
      ctx.moveTo(r * 0.45, r * 0.30);
      ctx.lineTo(r * 1.62, -r * (0.28 - flap));
      ctx.lineTo(r * 1.34, -r * 0.68);
      ctx.lineTo(r * 0.42, -r * 0.55);
      ctx.closePath();
      ctx.fill();
      // Wingtip weapon pods
      ctx.fillStyle = d.dark;
      ctx.fillRect(-r * 1.5, -r * 0.5, r * 0.22, r * 0.6);
      ctx.fillRect(r * 1.28, -r * 0.5, r * 0.22, r * 0.6);
      ctx.fillStyle = hull;
      ctx.beginPath();
      ctx.moveTo(0, r * 1.05);
      ctx.lineTo(-r * 0.7, r * 0.2);
      ctx.lineTo(-r * 0.45, -r * 0.85);
      ctx.lineTo(r * 0.45, -r * 0.85);
      ctx.lineTo(r * 0.7, r * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = d.dark;
      ctx.fillRect(-r * 0.5, -r * 0.15, r, r * 0.16);
      ctx.fillStyle = '#20304a';
      ctx.beginPath();
      ctx.ellipse(0, r * 0.35, r * 0.3, r * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = d.glow;
      for (const sx of [-0.32, 0.32]) {
        ctx.beginPath();
        ctx.ellipse(sx * r, -r * 0.88, r * 0.15, r * 0.22, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

    } else {
      // Grunt and knight share an airframe; the knight's wings sweep harder.
      const sweep = e.type === 'wasp' ? 1.55 : 1.25;
      ctx.fillStyle = wing;
      ctx.beginPath();
      ctx.moveTo(-r * 0.38, r * 0.25);
      ctx.lineTo(-r * sweep, -r * (0.22 + flap));
      ctx.lineTo(-r * sweep * 0.84, -r * 0.6);
      ctx.lineTo(-r * 0.36, -r * 0.5);
      ctx.closePath();
      ctx.moveTo(r * 0.38, r * 0.25);
      ctx.lineTo(r * sweep, -r * (0.22 - flap));
      ctx.lineTo(r * sweep * 0.84, -r * 0.6);
      ctx.lineTo(r * 0.36, -r * 0.5);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = hull;
      ctx.beginPath();
      ctx.moveTo(0, r * 1.0);
      ctx.lineTo(-r * 0.55, r * 0.15);
      ctx.lineTo(-r * 0.38, -r * 0.8);
      ctx.lineTo(r * 0.38, -r * 0.8);
      ctx.lineTo(r * 0.55, r * 0.15);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = d.dark;
      ctx.fillRect(-r * 0.42, -r * 0.05, r * 0.84, r * 0.14);
      ctx.fillStyle = '#20304a';
      ctx.beginPath();
      ctx.ellipse(0, r * 0.35, r * 0.24, r * 0.34, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = d.glow;
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.82, r * 0.24, r * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }

  /**
   * Bosses are war machines with an exposed weak-point core that pulses
   * brighter as their armour fails.
   */
  function drawBoss(b) {
    const r = b.r;
    const PI2 = Math.PI * 2;
    const c = b.def.color;
    const plate = b.def.plate;
    const charging = !!(b.beam && !b.beam.active && !b.beam.tractor);
    // The core beats faster the closer the machine is to breaking apart.
    const beat = 0.72 + 0.28 * Math.sin(b.t * (4 + b.phase * 2.4));

    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.lineJoin = 'round';

    const halo = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, r * 2);
    halo.addColorStop(0, 'rgba(255,255,255,.09)');
    halo.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, r * 2, 0, PI2);
    ctx.fill();

    if (b.kind === 'sentinel') {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(120,190,255,.35)';
      for (const sx of [-0.42, 0.42]) {
        ctx.beginPath();
        ctx.ellipse(sx * r, -r * 0.95, r * 0.17, r * (0.16 + 0.05 * Math.sin(b.t * 14)), 0, 0, PI2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

      // Swept wing pylons
      ctx.fillStyle = plate;
      ctx.beginPath();
      ctx.moveTo(-r * 0.35, -r * 0.55);
      ctx.lineTo(-r * 1.65, r * 0.05);
      ctx.lineTo(-r * 1.42, r * 0.62);
      ctx.lineTo(-r * 0.3, r * 0.5);
      ctx.closePath();
      ctx.moveTo(r * 0.35, -r * 0.55);
      ctx.lineTo(r * 1.65, r * 0.05);
      ctx.lineTo(r * 1.42, r * 0.62);
      ctx.lineTo(r * 0.3, r * 0.5);
      ctx.closePath();
      ctx.fill();
      // Wingtip cannons
      ctx.fillStyle = '#cdd8e8';
      ctx.fillRect(-r * 1.5, r * 0.1, r * 0.2, r * 0.7);
      ctx.fillRect(r * 1.3, r * 0.1, r * 0.2, r * 0.7);

      // Hull
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(0, r * 1.05);
      ctx.lineTo(-r * 0.66, r * 0.32);
      ctx.lineTo(-r * 0.5, -r * 0.7);
      ctx.lineTo(0, -r * 0.98);
      ctx.lineTo(r * 0.5, -r * 0.7);
      ctx.lineTo(r * 0.66, r * 0.32);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(10,18,32,.5)';
      ctx.lineWidth = 2 * S;
      ctx.stroke();
      ctx.fillStyle = plate;
      ctx.fillRect(-r * 0.48, -r * 0.44, r * 0.96, r * 0.1);
      ctx.fillRect(-r * 0.4, r * 0.52, r * 0.8, r * 0.1);

      // Weak point
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = charging ? '#fff3a8' : b.def.core;
      ctx.globalAlpha = beat;
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.02, r * 0.32, r * 0.22, 0, 0, PI2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.02, r * 0.12, r * 0.09, 0, 0, PI2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';

    } else if (b.kind === 'queen') {
      // Legs / manipulator arms
      ctx.strokeStyle = plate;
      ctx.lineWidth = 5 * S;
      ctx.lineCap = 'round';
      for (let i = -3; i <= 3; i++) {
        if (!i) continue;
        const k = i / 3;
        ctx.beginPath();
        ctx.moveTo(k * r * 0.5, r * 0.2);
        ctx.quadraticCurveTo(k * r * 1.4, r * 0.5, k * r * 1.1, r * (1.0 + 0.12 * Math.sin(b.t * 4 + i)));
        ctx.stroke();
      }

      ctx.fillStyle = plate;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.32, r * 1.0, 0, 0, PI2);
      ctx.fill();
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.06, r * 1.12, r * 0.8, 0, 0, PI2);
      ctx.fill();

      // Segmented carapace plating
      ctx.strokeStyle = 'rgba(12,8,28,.4)';
      ctx.lineWidth = 2.5 * S;
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath();
        ctx.ellipse(0, -r * 0.06, r * 1.12 * i / 4, r * 0.8 * i / 4, 0, 0, PI2);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,.16)';
      for (let i = 0; i < 5; i++) {
        const a = i * 1.256 + b.t * 0.35;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.5 - r * 0.06, r * 0.11, 0, PI2);
        ctx.fill();
      }

      // Iris core
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = beat;
      ctx.fillStyle = b.act.name === 'tractor' ? '#eaffdc' : b.def.core;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3 + b.t * 0.6;
        ctx.lineTo(Math.cos(a) * r * 0.44, Math.sin(a) * r * 0.44);
      }
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.15, 0, PI2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';

    } else {
      // Dreadnought: an armoured capital ship
      ctx.fillStyle = plate;
      ctx.beginPath();
      ctx.moveTo(-r * 1.12, -r * 0.82);
      ctx.lineTo(r * 1.12, -r * 0.82);
      ctx.lineTo(r * 1.6, -r * 0.02);
      ctx.lineTo(r * 1.16, r * 0.82);
      ctx.lineTo(-r * 1.16, r * 0.82);
      ctx.lineTo(-r * 1.6, -r * 0.02);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(-r * 0.98, -r * 0.66);
      ctx.lineTo(r * 0.98, -r * 0.66);
      ctx.lineTo(r * 1.38, -r * 0.02);
      ctx.lineTo(r * 1.0, r * 0.64);
      ctx.lineTo(-r * 1.0, r * 0.64);
      ctx.lineTo(-r * 1.38, -r * 0.02);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = 'rgba(10,14,22,.45)';
      ctx.lineWidth = 2 * S;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(i * r * 0.55, -r * 0.6);
        ctx.lineTo(i * r * 0.55, r * 0.58);
        ctx.stroke();
      }

      // Bridge tower
      ctx.fillStyle = '#b9c6d8';
      ctx.beginPath();
      ctx.moveTo(-r * 0.55, -r * 0.66);
      ctx.lineTo(r * 0.55, -r * 0.66);
      ctx.lineTo(r * 0.34, -r * 1.02);
      ctx.lineTo(-r * 0.34, -r * 1.02);
      ctx.closePath();
      ctx.fill();

      // Wing turrets and chin cannon
      ctx.fillStyle = plate;
      ctx.fillRect(-r * 1.16, r * 0.5, r * 0.28, r * 0.5);
      ctx.fillRect(r * 0.88, r * 0.5, r * 0.28, r * 0.5);
      ctx.fillStyle = (charging || (b.beam && b.beam.active)) ? '#fff3a8' : '#4a5462';
      ctx.fillRect(-r * 0.24, r * 0.55, r * 0.48, r * 0.6);

      // Reactor core
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = beat;
      ctx.fillStyle = b.def.core;
      ctx.beginPath();
      ctx.arc(0, -r * 0.06, r * 0.26, 0, PI2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.beginPath();
      ctx.arc(0, -r * 0.06, r * 0.1, 0, PI2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    // A hit lights the whole hull for a frame or two.
    if (b.flash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,255,255,.24)';
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.35, r * 1.0, 0, 0, PI2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();

    if (b.beam) drawBeam(b);
  }

  function drawBeam(b) {
    const beam = b.beam;
    const L = H * 1.5;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(beam.ang - Math.PI / 2);

    if (beam.tractor) {
      ctx.globalCompositeOperation = 'lighter';
      const grd = ctx.createLinearGradient(0, 0, 0, H);
      grd.addColorStop(0, 'rgba(180,92,255,.34)');
      grd.addColorStop(1, 'rgba(180,92,255,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(-beam.w * 0.5, 0);
      ctx.lineTo(beam.w * 0.5, 0);
      ctx.lineTo(beam.w * 2.4, H);
      ctx.lineTo(-beam.w * 2.4, H);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(240,214,255,.5)';
      ctx.lineWidth = 2 * S;
      for (let i = 0; i < 5; i++) {
        const y = ((G.time * 220 * S + i * 90 * S) % H);
        const halfW = beam.w * (0.5 + 1.9 * (y / H));
        ctx.beginPath();
        ctx.moveTo(-halfW, y);
        ctx.lineTo(halfW, y);
        ctx.stroke();
      }
    } else if (!beam.active) {
      const w = (2 + beam.charge * 5) * S;
      ctx.globalAlpha = 0.4 + 0.45 * Math.abs(Math.sin(G.time * 24));
      ctx.fillStyle = '#ff5d8f';
      ctx.fillRect(-w / 2, 0, w, L);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,240,168,' + (0.35 + 0.5 * beam.charge) + ')';
      ctx.beginPath();
      ctx.arc(0, 0, (6 + 16 * beam.charge) * S, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.globalCompositeOperation = 'lighter';
      const grd = ctx.createLinearGradient(-beam.w, 0, beam.w, 0);
      grd.addColorStop(0, 'rgba(255,60,140,0)');
      grd.addColorStop(0.5, 'rgba(255,120,180,.85)');
      grd.addColorStop(1, 'rgba(255,60,140,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(-beam.w, 0, beam.w * 2, L);
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      ctx.fillRect(-beam.w * 0.22, 0, beam.w * 0.44, L);
    }
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function drawBullets() {
    ctx.globalCompositeOperation = 'lighter';
    for (const b of G.pBullets) {
      if (b.pierce) {
        // Hyper laser: a long blue-white lance with a bright leading head.
        ctx.fillStyle = 'rgba(120,190,255,.5)';
        ctx.beginPath();
        ctx.ellipse(b.x, b.y, b.r * 1.1, b.r * 5.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#eaf6ff';
        ctx.beginPath();
        ctx.ellipse(b.x, b.y, b.r * 0.45, b.r * 4.0, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(b.x, b.y - b.r * 3.4, b.r * 0.62, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      // Standard laser: green tracer bolt.
      ctx.fillStyle = 'rgba(141,255,90,.42)';
      ctx.beginPath();
      ctx.ellipse(b.x, b.y, b.r * 1.15, b.r * 3.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#d8ffc2';
      ctx.beginPath();
      ctx.ellipse(b.x, b.y, b.r * 0.5, b.r * 2.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const b of G.eBullets) {
      if (b.kind === 'missile') {
        // A finned missile riding a bright exhaust plume.
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(Math.atan2(b.vy, b.vx) - Math.PI / 2);

        const flare = b.r * (2.2 + Math.random() * 0.9);
        ctx.fillStyle = 'rgba(255,190,90,.9)';
        ctx.beginPath();
        ctx.moveTo(-b.r * 0.5, -b.r * 0.8);
        ctx.lineTo(0, -flare);
        ctx.lineTo(b.r * 0.5, -b.r * 0.8);
        ctx.closePath();
        ctx.fill();

        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#ff6b35';
        ctx.beginPath();
        ctx.moveTo(-b.r * 0.45, -b.r * 0.5);
        ctx.lineTo(-b.r * 1.15, -b.r * 1.15);
        ctx.lineTo(-b.r * 0.45, -b.r * 1.0);
        ctx.closePath();
        ctx.moveTo(b.r * 0.45, -b.r * 0.5);
        ctx.lineTo(b.r * 1.15, -b.r * 1.15);
        ctx.lineTo(b.r * 0.45, -b.r * 1.0);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#dde6f2';
        ctx.beginPath();
        ctx.moveTo(0, b.r * 1.7);
        ctx.lineTo(b.r * 0.5, b.r * 0.4);
        ctx.lineTo(b.r * 0.5, -b.r * 1.0);
        ctx.lineTo(-b.r * 0.5, -b.r * 1.0);
        ctx.lineTo(-b.r * 0.5, b.r * 0.4);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ff3b1f';
        ctx.fillRect(-b.r * 0.5, b.r * 0.1, b.r, b.r * 0.35);
        ctx.restore();
        ctx.globalCompositeOperation = 'lighter';
      } else {
        ctx.fillStyle = b.color;
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r * 1.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function drawPowerups() {
    for (const p of G.powerups) {
      const wob = Math.sin(p.t * 5) * 2 * S;
      // The ring turns edge-on and back, catching the light as it falls.
      const spin = Math.abs(Math.cos(p.t * 2.2));
      ctx.save();
      ctx.translate(p.x, p.y + wob);

      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = p.def.color;
      ctx.globalAlpha = 0.22;
      ctx.beginPath();
      ctx.arc(0, 0, 15 * S, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      ctx.strokeStyle = p.def.color;
      ctx.lineWidth = 3 * S;
      ctx.beginPath();
      ctx.ellipse(0, 0, 11 * S * Math.max(0.22, spin), 11 * S, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.6)';
      ctx.lineWidth = 1 * S;
      ctx.beginPath();
      ctx.ellipse(0, 0, 11 * S * Math.max(0.22, spin), 11 * S, 0, 0, Math.PI * 2);
      ctx.stroke();

      if (spin > 0.5) {
        ctx.fillStyle = p.def.color;
        ctx.font = 'bold ' + Math.round(11 * S) + 'px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = (spin - 0.5) * 2;
        ctx.fillText(p.def.glyph, 0, 0.5 * S);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
  }

  function drawParticles() {
    ctx.globalCompositeOperation = 'lighter';
    for (const p of G.parts) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawTexts() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold ' + Math.round(12 * S) + 'px -apple-system, sans-serif';
    ctx.lineWidth = 3 * S;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(3,5,14,.75)';
    for (const t of G.texts) {
      ctx.globalAlpha = clamp(t.life, 0, 1);
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (G.shake > 0) {
      ctx.translate(rand(-1, 1) * G.shake * 0.5 * S, rand(-1, 1) * G.shake * 0.5 * S);
    }
    drawStars();
    drawPowerups();
    for (const e of G.enemies) drawEnemy(e);
    if (G.boss) drawBoss(G.boss);
    if (G.state !== 'menu' && G.state !== 'over' && player.alive) {
      drawDrones();
      drawPlayer();
    }
    drawBullets();
    drawParticles();
    drawTexts();
    ctx.restore();

    // Time warp washes the field in cold light; the bomb blows it out white.
    if (G.slow > 0) {
      ctx.fillStyle = 'rgba(129,140,248,' + (0.10 + 0.03 * Math.sin(G.time * 6)) + ')';
      ctx.fillRect(0, 0, W, H);
    }
    if (G.flash > 0) {
      ctx.globalAlpha = clamp(G.flash / 0.4, 0, 1) * 0.7;
      ctx.fillStyle = '#dff0ff';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    if (G.shock) {
      // Bomb blast: a blue-white sphere that swells and thins as it goes.
      const k = G.shock.t / 0.75;
      const rad = k * Math.max(W, H) * 0.8;
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(G.shock.x, G.shock.y, rad * 0.55, G.shock.x, G.shock.y, rad);
      g.addColorStop(0, 'rgba(120,190,255,0)');
      g.addColorStop(0.75, 'rgba(160,220,255,' + (0.5 * (1 - k)) + ')');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(G.shock.x, G.shock.y, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(230,245,255,' + (0.8 * (1 - k)) + ')';
      ctx.lineWidth = 3 * S;
      ctx.beginPath();
      ctx.arc(G.shock.x, G.shock.y, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  // =========================================================
  // 14. Update pump
  // =========================================================

  function update(dt) {
    G.time += dt;
    // Time warp slows the raiders and their shots — never the player.
    if (G.slow > 0) G.slow = Math.max(0, G.slow - dt);
    const edt = G.slow > 0 ? dt * 0.4 : dt;

    updateStars(dt, G.state === 'menu' ? 1.8 : (G.slow > 0 ? 0.4 : 1));
    updateEffects(dt);

    if (G.state === 'menu' || G.state === 'over' || G.state === 'paused') return;

    updatePlayer(dt);
    updateBullets(dt, edt);
    updatePowerups(dt);

    if (G.state === 'intro') {
      G.introTimer -= dt;
      if (G.introTimer <= 0) beginWaveCombat();
      return;
    }

    if (G.state === 'clear') {
      updateEnemies(edt);
      G.waveClearTimer -= dt;
      if (G.waveClearTimer <= 0) { hideAnnounce(); advanceWave(); }
      return;
    }

    // --- state 'play' ---
    updateSpawnQueue(edt);
    updateEnemies(edt);
    updateBoss(edt);
    collisions();
    refreshChip();

    const def = waveDef();
    if (def.boss) {
      if (G.bossDefeated) {
        G.waveClearTimer -= dt;
        if (G.waveClearTimer <= 0) waveComplete();
      }
    } else if (G.enemies.length === 0 && G.spawnQueue.length === 0) {
      G.waveClearTimer -= dt;
      if (G.waveClearTimer <= 0) waveComplete();
    }
  }

  let lastTs = 0;
  function frame(ts) {
    requestAnimationFrame(frame);
    const now = ts / 1000;
    let dt = lastTs ? now - lastTs : 1 / 60;
    lastTs = now;
    update(Math.min(dt, 1 / 30));
    render();
  }

  // =========================================================
  // 15. Screens and run control
  // =========================================================

  const SCREENS = ['menu', 'howto', 'paused', 'gameover'];

  function showScreen(id) {
    for (const s of SCREENS) el(s).classList.toggle('active', s === id);
  }

  /** ?wave=N jumps straight to a wave — handy for trying a boss fight. */
  function requestedStartWave() {
    const m = /[?&]wave=(\d+)/.exec(location.search);
    return m ? clamp(parseInt(m[1], 10), 1, 96) : 1;
  }

  function startGame() {
    Sound.init();
    const start = requestedStartWave();
    G.practice = start > 1;
    G.score = 0;
    G.wave = start;
    G.loop = 1 + Math.floor((start - 1) / WAVES.length);
    G.lives = 3;
    G.nextExtraLife = 20000;
    G.startBest = records.best;
    G.enemies.length = 0;
    G.spawnQueue.length = 0;
    G.pBullets.length = 0;
    G.eBullets.length = 0;
    G.powerups.length = 0;
    G.parts.length = 0;
    G.texts.length = 0;
    G.boss = null;
    G.shake = 0;
    G.waveClearTimer = 0.9;

    player.alive = true;
    player.x = player.tx = W / 2;
    player.y = player.ty = playerMaxY();
    player.invuln = 1.6;
    player.shield = false;
    player.weapon = 'single';
    player.weaponTime = 0;
    player.rapid = 0;
    player.wingmen = 0;
    player.drones = [];
    player.cool = 0;
    G.slow = 0;
    G.flash = 0;
    G.shock = null;

    el('hudScore').textContent = '0';
    el('hudBest').textContent = records.best.toLocaleString();
    updateLives();
    refreshChip();
    el('hud').classList.remove('hidden');
    showScreen(null);
    startWave();
  }

  function pauseGame() {
    if (G.state !== 'play' && G.state !== 'intro' && G.state !== 'clear') return;
    G.pausedFrom = G.state;
    G.state = 'paused';
    input.firing = false;
    drag = null;
    showScreen('paused');
  }

  function resumeGame() {
    if (G.state !== 'paused') return;
    G.state = G.pausedFrom || 'play';
    showScreen(null);
  }

  function quitToMenu() {
    G.state = 'menu';
    G.boss = null;
    G.enemies.length = 0;
    G.spawnQueue.length = 0;
    G.eBullets.length = 0;
    G.pBullets.length = 0;
    G.powerups.length = 0;
    el('hud').classList.add('hidden');
    el('bossBarWrap').classList.add('hidden');
    hideAnnounce();
    saveRecords();
    refreshMenuStats();
    showScreen('menu');
  }

  function gameOver() {
    G.state = 'over';
    G.boss = null;
    el('bossBarWrap').classList.add('hidden');
    hideAnnounce();
    saveRecords();
    el('finalScore').textContent = G.score.toLocaleString();
    el('finalSub').textContent = 'Wave ' + G.wave + (G.loop > 1 ? ' · Loop ' + G.loop : '');
    el('overTitle').textContent = 'Game Over';
    el('newBest').classList.toggle('hidden', !(G.score > (G.startBest || 0)));
    refreshMenuStats();
    showScreen('gameover');
  }

  function saveRecords() {
    if (G.practice) return;
    Store.set('best', records.best);
    Store.set('bestWave', records.bestWave);
  }

  function refreshMenuStats() {
    el('menuBest').textContent = records.best.toLocaleString();
    el('menuWave').textContent = records.bestWave;
  }

  // =========================================================
  // 16. UI wiring
  // =========================================================

  function bindToggle(id, key, label, onChange) {
    const btn = el(id);
    const paint = () => {
      btn.dataset.on = String(settings[key]);
      btn.textContent = label + ': ' + (settings[key] ? 'ON' : 'OFF');
    };
    btn.addEventListener('click', () => {
      settings[key] = !settings[key];
      Store.set(key, settings[key]);
      if (onChange) onChange();
      paintToggles();
    });
    paint();
    return paint;
  }

  const togglePainters = [];
  function paintToggles() { for (const p of togglePainters) p(); }

  el('btnPlay').addEventListener('click', startGame);
  el('btnAgain').addEventListener('click', startGame);
  el('btnMenu').addEventListener('click', quitToMenu);
  el('btnQuit').addEventListener('click', quitToMenu);
  el('btnResume').addEventListener('click', resumeGame);
  el('pauseBtn').addEventListener('click', pauseGame);
  el('btnHow').addEventListener('click', () => showScreen('howto'));
  el('btnHowBack').addEventListener('click', () => showScreen('menu'));

  togglePainters.push(bindToggle('btnAuto', 'autoFire', 'Auto-fire'));
  togglePainters.push(bindToggle('btnAuto2', 'autoFire', 'Auto-fire'));
  togglePainters.push(bindToggle('btnSound', 'sound', 'Sound', () => { Sound.on = settings.sound; if (settings.sound) Sound.init(); }));
  togglePainters.push(bindToggle('btnSound2', 'sound', 'Sound', () => { Sound.on = settings.sound; if (settings.sound) Sound.init(); }));

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseGame();
  });

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 120));

  // Stop iOS from bouncing or zooming the page under the canvas.
  document.addEventListener('touchmove', (e) => {
    if (e.target && e.target.closest && e.target.closest('.scroll')) return;
    if (e.cancelable) e.preventDefault();
  }, { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  // =========================================================
  // 17. Boot
  // =========================================================

  player.x = player.tx = 0;
  player.y = player.ty = 0;
  G.cols = 8;
  resize();
  player.x = player.tx = W / 2;
  player.y = player.ty = playerMaxY();
  player.r = 12 * S;
  refreshMenuStats();
  showScreen('menu');
  requestAnimationFrame(frame);
})();
