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

  // =========================================================
  //  Shading kit
  //  Everything is drawn as if lit by one key light from the
  //  upper left, so hulls read as solid volumes rather than
  //  flat silhouettes.
  // =========================================================

  const LIGHT = { x: -0.5, y: -0.86 };   // unit-ish vector toward the key light

  /** Lighten (amt > 0) or darken (amt < 0) a #rrggbb colour. */
  function tint(hex, amt, alpha) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (amt > 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
    else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
    r = Math.round(clamp(r, 0, 255));
    g = Math.round(clamp(g, 0, 255));
    b = Math.round(clamp(b, 0, 255));
    return alpha == null
      ? 'rgb(' + r + ',' + g + ',' + b + ')'
      : 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  /** A lit-to-shadow ramp across a box, aligned to the key light. */
  function bodyGradient(c, base, half, hi, lo) {
    const g = c.createLinearGradient(LIGHT.x * half, LIGHT.y * half,
                                     -LIGHT.x * half, -LIGHT.y * half);
    g.addColorStop(0, tint(base, hi == null ? 0.45 : hi));
    g.addColorStop(0.45, base);
    g.addColorStop(1, tint(base, lo == null ? -0.55 : lo));
    return g;
  }

  /** A round highlight offset toward the light, for domes and spheres. */
  function domeGradient(c, base, r) {
    const g = c.createRadialGradient(LIGHT.x * r * 0.45, LIGHT.y * r * 0.45, r * 0.06,
                                     0, 0, r);
    g.addColorStop(0, tint(base, 0.7));
    g.addColorStop(0.35, tint(base, 0.2));
    g.addColorStop(1, tint(base, -0.55));
    return g;
  }

  /**
   * Sprite cache. Each sprite is rendered once into an offscreen canvas at
   * SS times its on-screen size, then blitted. Drawing the expensive shading
   * once buys detail that would be far too slow to redraw every frame, and
   * the supersample keeps the edges clean when it is scaled down.
   */
  const Sprites = {
    store: {},
    SS: 3,

    get(key, w, h, draw) {
      let sp = this.store[key];
      if (sp) return sp;
      const ss = this.SS;
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.ceil(w * ss));
      cv.height = Math.max(1, Math.ceil(h * ss));
      const c = cv.getContext('2d');
      c.scale(ss, ss);
      c.translate(w / 2, h / 2);
      c.lineJoin = 'round';
      c.lineCap = 'round';
      draw(c);
      sp = { cv: cv, w: w, h: h };
      this.store[key] = sp;
      return sp;
    },

    blit(ctx, sp) { ctx.drawImage(sp.cv, -sp.w / 2, -sp.h / 2, sp.w, sp.h); },

    clear() { this.store = {}; }
  };
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
    const prevS = S;
    S = clamp(Math.min(W / DESIGN_W, H / DESIGN_H), 0.72, 1.5);
    if (S !== prevS) Sprites.clear();

    player.y = clamp(player.y, playerMinY(), playerMaxY());
    player.ty = player.y;
    player.x = clamp(player.x, 18 * S, W - 18 * S);
    player.tx = player.x;
    player.r = 12 * S;
    buildStars();
  }

  /**
   * A rescued fighter docks alongside, so the ship becomes a pair that
   * straddles the aim point. Everything that touches the ship — firing,
   * drawing, collisions, pickups — works through these offsets.
   */
  const shipOffsets = () => (player.dual ? [-9 * S, 9 * S] : [0]);

  function shipHit(x, y, r) {
    for (const ox of shipOffsets()) {
      if (hypot(x - (player.x + ox), y - player.y) < r) return true;
    }
    return false;
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
    combo(mult) { this.tone(520 + mult * 90, 0.08, 'square', 0.045); },
    crit() { this.tone(1100, 0.06, 'square', 0.05, 620); },
    levelUp() {
      [440, 587, 740, 880].forEach((f, i) => setTimeout(() => this.tone(f, 0.13, 'triangle', 0.06), i * 90));
    }
  };

  /**
   * Short vibration patterns for the events worth feeling in the hand.
   * A no-op on desktop, and on anything that refuses the API.
   */
  const Haptics = {
    on: true,
    // Safari has never shipped the Vibration API, and Firefox dropped it, so
    // plenty of phones land here with nothing to buzz.
    supported: typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function',
    buzz(pattern) {
      if (!this.on || !this.supported) return;
      try { navigator.vibrate(pattern); } catch (e) { /* refused by the browser */ }
    },
    glanced() { this.buzz(35); },   // a knock that cost you something short of the ship
    shipLost() { this.buzz([90, 50, 140]); },
    bomb() { this.buzz([25, 25, 70]); },
    powerup() { this.buzz(18); },
    waveClear() { this.buzz([20, 45, 20]); },
    bossDown() { this.buzz([60, 40, 60, 40, 120]); }
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
    sound: Store.get('sound', true),
    haptics: Store.get('haptics', true)
  };
  Sound.on = settings.sound;
  Haptics.on = settings.haptics;

  const records = {
    best: Store.get('best', 0),
    bestWave: Store.get('bestWave', 1),
    scrap: Store.get('scrap', 0),
    perks: Store.get('perks', {})
  };

  /**
   * Scrap is the only thing that survives a run. It buys permanent perks in
   * the hangar, so a bad run still moves the next one forward.
   */
  const PERKS = [
    { id: 'reserve',   name: 'Reserve Bay',     cap: 3, costs: [40, 100, 200],
      blurb: 'Start every run with an extra ship.' },
    { id: 'munitions', name: 'Munitions Store', cap: 2, costs: [60, 150],
      blurb: 'Start every run with a smart bomb in the rack.' },
    { id: 'dice',      name: 'Requisition',     cap: 2, costs: [50, 120],
      blurb: 'Start every run with an extra refit reroll.' },
    { id: 'headstart', name: 'Shakedown Run',   cap: 1, costs: [180],
      blurb: 'Take an extra loadout pick before wave 1.' },
    { id: 'salvright', name: 'Salvage Rights',  cap: 2, costs: [80, 180],
      blurb: 'Earn 25% more scrap from every run.' }
  ];

  const perkLevel = (id) => records.perks[id] || 0;

  /**
   * Scrap leans on how deep a run got rather than on how much score it farmed
   * in the shallows, and each boss cleared pays a one-time bounty on top.
   */
  function scrapEarned() {
    const cleared = G.wave - 1;                  // waves actually finished
    let base = Math.floor(G.score / 500) + cleared * 8;
    if (cleared >= 4) base += 40;                // the Sentinel
    if (cleared >= 8) base += 80;                // the Hive Queen
    base += 150 * (G.loop - 1);                  // every Dreadnought after that
    return Math.max(1, Math.round(base * (1 + 0.25 * perkLevel('salvright'))));
  }

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
    upgrades: {},               // permanent picks, id -> level
    taken: [],                  // pick order, for the end-of-run recap
    picks: 0,                   // refit picks still owed
    rerolls: 1,
    combo: 0,                   // kills chained inside the combo window
    comboTimer: 0,
    lastMult: 1,
    captive: null,              // your ship, in enemy hands
    bonus: null,                // challenging-stage scoring
    killcam: null,              // post-mortem beat naming what hit you
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
    weapon: 'single',   // single | twin | spread | pierce — one at a time
    weaponTime: 0,
    rapid: 0,
    wingmen: 0,
    drones: [],
    bombs: 0,                   // smart bombs held, spent on demand
    dual: false,                // flying as a recovered pair
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

  const TAP_SLOP = 12;        // px of travel still counted as a tap
  const TAP_TIME = 450;       // ms held before it stops being a tap

  function overBombButton(clientX, clientY) {
    const btn = el('bombBtn');
    if (btn.classList.contains('hidden')) return false;
    const r = btn.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (G.state !== 'play' && G.state !== 'intro' && G.state !== 'clear' &&
        G.state !== 'bonus') return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const p = pointerPos(e);
    drag = {
      id: e.pointerId, px: p.x, py: p.y, sx: player.tx, sy: player.ty,
      onBomb: overBombButton(e.clientX, e.clientY),
      moved: 0, t0: performance.now()
    };
    input.firing = true;
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault();
    const p = pointerPos(e);
    drag.moved = Math.max(drag.moved, hypot(p.x - drag.px, p.y - drag.py));
    player.tx = clamp(drag.sx + (p.x - drag.px), 16 * S, W - 16 * S);
    player.ty = clamp(drag.sy + (p.y - drag.py) * 0.9, playerMinY(), playerMaxY());
  });

  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    // A short, still press that began on the bomb button spends a bomb;
    // anything longer or further was the player flying, so leave it alone.
    if (drag.onBomb && drag.moved < TAP_SLOP && performance.now() - drag.t0 < TAP_TIME) {
      useBomb();
    }
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
      case 'KeyR': if (G.state === 'upgrade') rerollOffer(); break;
      case 'Digit1': case 'Digit2': case 'Digit3':
        if (G.state === 'upgrade') takeUpgrade(Number(e.code.slice(5)) - 1);
        break;
      case 'KeyB': useBomb(); break;
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
    commander: { hp: 2, pts: 180, r: 13, color: '#ff7a4d', dark: '#7d2a10', wing: '#d84f22', glow: '#ffc9a8', speed: 1.08, aim: 0.55, drop: 0.15 },
    turret:    { hp: 3, pts: 140, r: 12, color: '#9aa6bd', dark: '#2b3548', wing: '#5d6c88', glow: '#ff5a2b', speed: 0.85, aim: 0.9, static: true, drop: 0.08 }
  };

  // The 12-wave campaign. After wave 12 it loops with tougher numbers.
  const WAVES = [
    { name: 'First Contact', rows: ['grunt', 'grunt'], cols: 8, dive: [2.6, 3.6], divers: 1, bspd: 1.00, snipe: 0 },
    { name: 'Swarm', rows: ['wasp', 'grunt', 'grunt'], cols: 8, dive: [2.2, 3.2], divers: 1, bspd: 1.02, snipe: 7.0 },
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

  /**
   * Challenging stages: a breather between waves where nothing shoots back
   * and nothing can hit you. Raiders fly a set piece and you try to clear
   * the lot for a perfect bonus.
   */
  const BONUS_PATTERNS = [
    // Twin loops entering from both top corners.
    function twinLoops(side) {
      const cx = W / 2;
      return [
        { x: cx + side * W * 0.45, y: -60 * S },
        { x: cx + side * W * 0.42, y: H * 0.22 },
        { x: cx + side * W * 0.10, y: H * 0.36 },
        { x: cx - side * W * 0.16, y: H * 0.28 },
        { x: cx - side * W * 0.10, y: H * 0.14 },
        { x: cx + side * W * 0.18, y: H * 0.20 },
        { x: cx + side * W * 0.30, y: H * 0.45 },
        { x: cx - side * W * 0.30, y: H * 0.62 },
        { x: cx - side * W * 0.40, y: H + 80 * S }
      ];
    },
    // A single file snaking down the screen.
    function serpentine(side) {
      const cx = W / 2;
      const pts = [{ x: cx + side * W * 0.38, y: -60 * S }];
      for (let i = 0; i < 5; i++) {
        pts.push({ x: cx + side * (i % 2 ? 1 : -1) * W * 0.34, y: H * (0.14 + i * 0.15) });
      }
      pts.push({ x: cx - side * W * 0.20, y: H + 80 * S });
      return pts;
    },
    // Two streams crossing through the middle.
    function crossing(side) {
      const cx = W / 2;
      return [
        { x: cx + side * W * 0.5, y: -60 * S },
        { x: cx + side * W * 0.34, y: H * 0.2 },
        { x: cx, y: H * 0.4 },
        { x: cx - side * W * 0.34, y: H * 0.6 },
        { x: cx - side * W * 0.46, y: H + 80 * S }
      ];
    }
  ];

  const isBonusWave = (w) => w >= 3 && (w - 3) % 4 === 0;

  function startBonus() {
    G.enemies.length = 0;
    G.spawnQueue.length = 0;
    G.eBullets.length = 0;
    G.boss = null;

    const make = BONUS_PATTERNS[Math.floor(Math.random() * BONUS_PATTERNS.length)];
    const types = ['grunt', 'wasp', 'commander'];
    let total = 0;
    for (const side of [-1, 1]) {
      const path = makePath(make(side), 14);
      for (let i = 0; i < 8; i++) {
        G.spawnQueue.push({
          delay: i * 0.28 + (side < 0 ? 0 : 0.14),
          type: types[i % types.length],
          row: 0, col: 0, bonusPath: path
        });
        total++;
      }
    }
    G.bonus = { killed: 0, total: total, timer: 16 };
    announce('CHALLENGING STAGE', 'they do not shoot back');
    Sound.levelUp();
    G.state = 'bonus';
  }

  function endBonus() {
    const perfect = G.bonus.killed >= G.bonus.total;
    const bonus = perfect ? 5000 * G.loop : G.bonus.killed * 100 * G.loop;
    addScore(bonus);
    announce(perfect ? 'PERFECT!' : G.bonus.killed + ' / ' + G.bonus.total,
             '+' + bonus.toLocaleString());
    if (perfect) { Sound.levelUp(); Haptics.waveClear(); }
    G.bonus = null;
    G.enemies.length = 0;
    G.spawnQueue.length = 0;
    G.waveClearTimer = 2.2;
    G.state = 'clear';
    G.afterClear = advanceWave;
  }

  function buildWave(def) {
    G.enemies.length = 0;
    G.spawnQueue.length = 0;
    G.cols = def.cols;
    G.rowCount = def.rows.length;

    // A few raiders per wave are elites: triple health and score, and they
    // always leave a power-up behind. Every wave carries at least one, so the
    // opening waves still teach pickups even though the random rolls are rare.
    const total = def.rows.length * def.cols;
    const eliteCount = Math.min(4, 1 + Math.floor(G.wave / 4) + (G.loop - 1));
    const eliteSlots = {};
    let placed = 0;
    for (let guard = 0; placed < eliteCount && guard < 200; guard++) {
      const k = randInt(0, total - 1);
      if (!eliteSlots[k]) { eliteSlots[k] = true; placed++; }   // distinct slots only
    }

    const styles = ['loop', 'top', 'side'];
    for (let r = 0; r < def.rows.length; r++) {
      const style = styles[r % styles.length];
      for (let c = 0; c < def.cols; c++) {
        G.spawnQueue.push({
          delay: r * 1.05 + c * 0.12,
          type: def.rows[r],
          row: r,
          col: c,
          elite: !!eliteSlots[r * def.cols + c],
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
      if (s.elite) { e.elite = true; e.hp = e.def.hp * 3; }
      if (s.bonusPath) {
        // Challenging-stage raiders: harmless, and they just fly the set piece.
        e.bonus = true;
        e.hp = 1;
        e.path = s.bonusPath;
        e.d = 0;
        e.speed = 230 * S;
        e.mode = 'path';
        e.onArrive = 'gone';
        e.x = e.path.pts[0].x;
        e.y = e.path.pts[0].y;
        G.enemies.push(e);
        continue;
      }
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

  /** Climb back to formation from wherever the craft currently is. */
  function retreatPath(e) {
    const slot = slotPos(e.row, e.col);
    return makePath([
      { x: e.x, y: e.y },
      { x: (e.x + slot.x) / 2, y: (e.y + slot.y) / 2 - H * 0.08 },
      { x: slot.x, y: slot.y }
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

  /** Conditions for a commander to try for a capture rather than a dive. */
  function wantsCapture(e) {
    return e.type === 'commander' && !G.captive && !player.dual &&
           player.alive && G.lives > 1 && Math.random() < 0.35;
  }

  /** A commander drops into a hover above the ship and opens a tractor beam. */
  function startCapture(e) {
    const tx = clamp(player.x, 40 * S, W - 40 * S);
    e.mode = 'path';
    e.path = makePath([
      { x: e.x, y: e.y },
      { x: (e.x + tx) / 2, y: H * 0.2 },
      { x: tx, y: H * 0.34 }
    ], 12);
    e.d = 0;
    e.speed = 210 * S * loopMul();
    e.onArrive = 'hover';
    e.capturing = true;
    e.inFormation = false;
    Sound.warn();
  }

  function startDive(e) {
    if (e.def.static || e.mode !== 'formation') return;
    if (wantsCapture(e)) { startCapture(e); return; }
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

      if (e.mode === 'hover') {
        e.hoverT -= dt;
        // The beam reaches straight down; stray into it and you are taken.
        if (player.alive && player.invuln <= 0 && !G.captive &&
            player.y > e.y && Math.abs(player.x - e.x) < CAPTURE_HALF_W * S) {
          capturePlayer(e);
        }
        if (e.hoverT <= 0) {
          e.capturing = false;
          e.path = retreatPath(e);
          e.d = 0;
          e.speed = 320 * S * loopMul();
          e.mode = 'path';
          e.onArrive = 'formation';
        }
        continue;
      }

      if (e.mode === 'path') {
        e.d += e.speed * dt;
        const p = pathAt(e.path, e.d);
        e.x = p.x;
        e.y = p.y;
        e.angle = p.a - Math.PI / 2;

        // Diving enemies take pot shots at the player.
        if (!e.bonus && (e.onArrive === 'return' || e.onArrive === 'gone') && e.y < H * 0.86) {
          e.fireTimer -= dt;
          if (e.fireTimer <= 0) {
            e.fireTimer = rand(0.5, 1.3) / e.def.aim / enemyFireMul();
            enemyShoot(e, bulletMul, true);
          }
        }

        if (e.d >= e.path.len) {
          if (e.onArrive === 'hover') {
            e.mode = 'hover';
            e.hoverT = 1.7;
          } else if (e.onArrive === 'gone') {
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
          const n = Math.min(randInt(1, (def.divers || 1) + upLevel('swarm')), ready.length);
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
          G.snipeTimer = def.snipe / loopMul() / enemyFireMul();
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
    const hot = upLevel('overclock') && comboMult() >= 6 ? 1.3 : 1;
    player.cool = (player.rapid > 0 ? 0.085 : 0.185) * (w === 'pierce' ? 1.5 : 1)
                  / (1 + 0.12 * upLevel('autoloader'))
                  / hot / (upLevel('overheat') ? 1.3 : 1);
    const y = player.y - 13 * S;

    for (const ox of shipOffsets()) {
      const px = player.x + ox;
      if (w === 'twin') {
        bolt(px - 7 * S, y, 0, -speed);
        bolt(px + 7 * S, y, 0, -speed);
      } else if (w === 'spread') {
        for (const a of [-0.28, 0, 0.28]) {
          bolt(px, y, Math.sin(a) * speed, -Math.cos(a) * speed);
        }
      } else if (w === 'pierce') {
        G.pBullets.push({
          x: px, y: y, vx: 0, vy: -speed * 1.15,
          r: 5.5 * S, pierce: true, hit: []
        });
      } else {
        bolt(px, y, 0, -speed);
      }
      if (upLevel('twinmount')) {
        bolt(px - 14 * S, y + 6 * S, 0, -speed, 2.8 * S);
        bolt(px + 14 * S, y + 6 * S, 0, -speed, 2.8 * S);
      }
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
    G.eBullets.push({ x: e.x, y: e.y + 10 * S, vx: vx, vy: vy, r: 4 * S, color: '#ff8c42',
                      kind: 'plain', src: 'raider', life: 6 });
    Sound.enemyShoot();
  }

  function bossBullet(x, y, angle, speed, opts) {
    const o = opts || {};
    G.eBullets.push({
      x: x, y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: (o.r || 5) * S,
      src: 'boss',
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
    { kind: 'twin',    weight: 16, label: 'TWIN LASER',   color: '#8dff5a', glyph: 'II', weapon: true },
    { kind: 'spread',  weight: 14, label: 'SPREAD LASER', color: '#4da6ff', glyph: 'W',  weapon: true },
    { kind: 'pierce',  weight: 11, label: 'HYPER LASER',  color: '#cfe8ff', glyph: 'L',  weapon: true },
    { kind: 'rapid',   weight: 18, label: 'RAPID FIRE',   color: '#ffc94d', glyph: 'R' },
    { kind: 'wingmen', weight: 16, label: 'WINGMEN',      color: '#ff9f68', glyph: 'V' },
    { kind: 'bomb',    weight: 9,  label: 'SMART BOMB',   color: '#ff5a2b', glyph: 'B' },
    { kind: 'warp',    weight: 8,  label: 'TIME WARP',    color: '#a78bfa', glyph: 'T' },
    { kind: 'life',    weight: 5,  label: 'EXTRA LIFE',   color: '#ffd166', glyph: '1' }
  ];

  // Power-up durations run longer with a Coolant Loop aboard.
  const puTime = (secs) => secs * (1 + 0.5 * upLevel('coolant'));

  function dropPowerup(x, y) {
    // A weapon pickup overwrites the one you are holding, so while a weapon
    // still has real time left on it the draw skips weapons entirely and
    // hands out something that stacks instead.
    const armed = player.weapon !== 'single' && player.weaponTime > 5;
    let total = 0;
    for (const p of POWERUPS) {
      if (armed && p.weapon) continue;
      total += p.weight;
    }
    let roll = Math.random() * total;
    let chosen = null;
    for (const p of POWERUPS) {
      if (armed && p.weapon) continue;
      roll -= p.weight;
      if (roll <= 0) { chosen = p; break; }
      chosen = p;
    }
    G.powerups.push({ x: x, y: y, vy: 95 * S, def: chosen, t: 0, r: 12 * S });
  }

  function updatePowerups(dt) {
    for (let i = G.powerups.length - 1; i >= 0; i--) {
      const p = G.powerups[i];
      p.t += dt;
      p.y += p.vy * dt;
      p.x += Math.sin(p.t * 2.6) * 22 * S * dt;
      if (upLevel('tractor') && player.alive) {
        const dx = player.x - p.x, dy = player.y - p.y;
        const d = hypot(dx, dy);
        if (d < 190 * S && d > 1) {
          const pull = 260 * S * dt;
          p.x += (dx / d) * pull;
          p.y += (dy / d) * pull;
        }
      }
      if (p.y > H + 30) { G.powerups.splice(i, 1); continue; }
      if (player.alive && shipHit(p.x, p.y, p.r + player.r)) {
        G.powerups.splice(i, 1);
        applyPowerup(p.def);
      }
    }
  }

  function applyPowerup(def) {
    Sound.powerup();
    Haptics.powerup();
    switch (def.kind) {
      case 'twin': setWeapon('twin', puTime(15)); break;
      case 'spread': setWeapon('spread', puTime(15)); break;
      case 'pierce': setWeapon('pierce', puTime(12)); break;
      case 'rapid': player.rapid = puTime(12); break;
      case 'wingmen': launchWingmen(puTime(16)); break;
      case 'warp': G.slow = puTime(6); Sound.tone(760, 0.5, 'sine', 0.06, 180); break;
      case 'bomb': player.bombs = Math.min(bombCap(), player.bombs + 1); updateBombs(); break;
      case 'life': G.lives++; updateLives(); break;
    }
    floatText(player.x, player.y - 26 * S, def.label, def.color);
    refreshChip();
  }

  /** Spends one held bomb, if there is one and the ship is flying. */
  function useBomb() {
    if (player.bombs <= 0 || !player.alive || G.state !== 'play') return;
    player.bombs--;
    updateBombs();
    detonateBomb();
  }

  function updateBombs() {
    const btn = el('bombBtn');
    el('bombCount').textContent = player.bombs;
    btn.classList.toggle('hidden', player.bombs <= 0 || G.state === 'menu' ||
                                   G.state === 'over' || G.state === 'paused' ||
                                   G.state === 'upgrade');
  }

  /** Clears the screen: every shot gone, every raider hit at once. */
  function detonateBomb() {
    G.eBullets.length = 0;
    G.flash = 0.4;
    G.shock = { x: player.x, y: player.y, t: 0 };
    Haptics.bomb();
    G.shake = 20;
    Sound.bigKill();
    for (let i = G.enemies.length - 1; i >= 0; i--) {
      const e = G.enemies[i];
      explode(e.x, e.y, e.def.color, 16, 1.2);
      bumpCombo();
      addScore(Math.round(e.def.pts * comboMult()));
      G.enemies.splice(i, 1);
    }
    if (G.boss) damageBoss(10);
  }

  // =========================================================
  // 10. Bosses
  // =========================================================

  const BOSS_DEFS = {
    sentinel: {
      name: 'SENTINEL', hp: 90, r: 44, coreAt: { x: 0, y: -0.02, r: 0.30 }, color: '#8496b5', plate: '#465873', glow: '#cfe0ff', core: '#ff3b1f', shot: '#ff8c42',
      pools: [
        ['spread', 'aimed', 'escort'],
        ['spread', 'aimed', 'beam', 'escort'],
        ['beam', 'aimed', 'spread', 'spread']
      ]
    },
    queen: {
      name: 'HIVE QUEEN', hp: 140, r: 48, coreAt: { x: 0, y: 0, r: 0.40 }, color: '#7d6bb8', plate: '#3c3168', glow: '#d9ccff', core: '#7dff4d', shot: '#b06bff',
      pools: [
        ['radial', 'escort', 'aimed'],
        ['radial', 'tractor', 'wall', 'escort'],
        ['radial', 'tractor', 'wall', 'aimed', 'escort']
      ]
    },
    dread: {
      name: 'DREADNOUGHT', hp: 214, r: 54, coreAt: { x: 0, y: -0.06, r: 0.26 }, color: '#75808f', plate: '#3a424f', glow: '#ffd9a8', core: '#ff8c1f', shot: '#ff6b35',
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
      t: 0, flash: 0, coreFlash: 0, entering: true,
      act: { name: 'idle', t: 0, dur: 1.6, step: 0 },
      lastAction: '',
      beam: null,
      phase: 1,
      dying: 0
    };
    el('bossName').textContent = d.name;
    el('bossBarFill').style.width = '100%';
    el('bossBarWrap').classList.remove('hidden');
    G.escortTimer = 13;
  }

  function bossPhase(b) {
    const f = b.hp / b.maxHp;
    return f > 0.6 ? 1 : f > 0.3 ? 2 : 3;
  }

  function bossRest(b) { return [1.5, 0.7, 0.5][b.phase - 1]; }

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
    if (b.coreFlash > 0) b.coreFlash -= dt;
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
          const n = b.phase === 1 ? 3 : 3 + b.phase;
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
        if (t >= a.step * (b.phase === 1 ? 0.26 : 0.16)) {
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

  /** The exposed core: a small, moving target that takes double damage. */
  function bossCoreHit(b, x, y, pad) {
    const c = b.def.coreAt;
    return hypot(x - (b.x + c.x * b.r), y - (b.y + c.y * b.r)) < c.r * b.r + (pad || 0);
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
    Haptics.bossDown();
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
    player.weapon = 'single';
    player.weaponTime = 0;
    player.rapid = 0;
    player.wingmen = 0;
    player.drones = [];
    player.dual = false;
    player.cool = 0;
    G.eBullets.length = 0;
    refreshChip();
  }

  function hitPlayer(cause) {
    if (!player.alive || player.invuln > 0) return;
    // The recovered fighter takes the hit first: you drop back to one hull.
    if (player.dual) {
      player.dual = false;
      player.invuln = 1.2;
      explode(player.x + 9 * S, player.y, '#9fd8ff', 20, 1.1);
      floatText(player.x, player.y - 26 * S, 'WINGMAN DOWN', '#ff8548');
      G.shake = 8;
      Sound.hit();
      Haptics.glanced();
      breakCombo();
      return;
    }
    player.alive = false;
    player.deadTimer = 1.6;
    // Hold a short slow-motion beat naming the culprit, so a death teaches
    // something instead of just costing a ship.
    if (cause) G.killcam = { label: cause.label, x: cause.x, y: cause.y, t: 1.15 };
    breakCombo();
    G.lives--;
    updateLives();
    explode(player.x, player.y, '#9fd8ff', 34, 1.6);
    G.shake = 14;
    Sound.playerDie();
    Haptics.shipLost();
    refreshChip();
    if (upLevel('vengeance')) detonateBomb();
  }

  function killEnemy(index) {
    const e = G.enemies[index];
    if (e.hasCaptive) freeCaptive();
    const diving = e.mode === 'path' && (e.onArrive === 'return' || e.onArrive === 'gone');
    if (e.bonus && G.bonus) G.bonus.killed++;
    bumpCombo();
    const mult = comboMult();
    const pts = Math.round(e.def.pts * (diving ? 2 : 1) * (e.elite ? 3 : 1)
                           * (1 + 0.2 * (G.loop - 1)) * mult
                           * (1 + 0.15 * upLevel('bounty') + 0.6 * upLevel('bloodmoney')));
    addScore(pts);
    explode(e.x, e.y, e.def.color, diving ? 20 : 14, diving ? 1.2 : 1);
    if (diving || mult > 1) {
      floatText(e.x, e.y, String(pts) + (mult > 1 ? ' \u00d7' + mult : ''), mult > 1 ? '#8dff5a' : '#ffc94d');
    }
    if (e.elite || (e.def.drop && Math.random() < e.def.drop * dropMul())) {
      dropPowerup(e.x, e.y);
    }
    Sound.kill();
    G.enemies.splice(index, 1);
  }

  /**
   * Refit cards. Upgrades are pure gains; pacts trade a real drawback for a
   * bigger payoff. Rarity weights the draw, and anything at its cap drops out
   * of the pool. Cards are offered after a boss falls, not every wave, so a
   * refit is a reward for clearing one rather than routine housekeeping.
   */
  const RARITY = {
    common: { label: 'Common', weight: 58 },
    rare:   { label: 'Rare',   weight: 30 },
    epic:   { label: 'Epic',   weight: 18 },
    pact:   { label: 'Pact',   weight: 14 }
  };

  const UPGRADES = [
    { id: 'spare',      name: 'Spare Ship',       cap: 3, rarity: 'common', blurb: 'One more ship in reserve, right now.' },
    { id: 'bounty',     name: 'Bounty Contract',  cap: 3, rarity: 'common', blurb: 'Kills are worth 15% more.' },
    { id: 'chain',      name: 'Chain Extender',   cap: 3, rarity: 'common', blurb: 'Combo window lasts 0.7s longer.' },
    { id: 'salvage',    name: 'Salvage Crew',     cap: 3, rarity: 'common', blurb: 'Raiders drop power-ups far more often.' },
    { id: 'autoloader', name: 'Autoloader',       cap: 4, rarity: 'rare',   blurb: 'Fire 12% faster.' },
    { id: 'bombrack',   name: 'Bomb Rack',        cap: 2, rarity: 'rare',   blurb: 'Carry one more bomb, and take one now.' },
    { id: 'coolant',    name: 'Coolant Loop',     cap: 2, rarity: 'rare',   blurb: 'Power-ups you pick up last 50% longer.' },
    { id: 'tractor',    name: 'Tractor Rig',      cap: 1, rarity: 'rare',   blurb: 'Power-ups drift toward your ship.' },
    { id: 'optics',     name: 'Targeting Optics', cap: 2, rarity: 'epic',   blurb: 'Boss core hits do +1 damage.' },
    { id: 'overdrive',  name: 'Overdrive',        cap: 2, rarity: 'epic',   blurb: 'Combo multiplier caps 2 steps higher.' },
    { id: 'escort',     name: 'Escort Contract',  cap: 1, rarity: 'epic',   blurb: 'Start every wave with wingmen.' },
    { id: 'twinmount',  name: 'Twin Mount',       cap: 1, rarity: 'epic',   blurb: 'Outboard cannons add two bolts to every shot.' },
    { id: 'overclock',  name: 'Overclock',        cap: 1, rarity: 'epic',   blurb: 'At \u00d76 combo or better, fire 30% faster.' },
    { id: 'vengeance',  name: 'Vengeance',        cap: 1, rarity: 'epic',   blurb: 'Losing a ship sets off a smart bomb.' }
  ];

  const PACTS = [
    { id: 'bloodmoney', name: 'Blood Money', cap: 1, rarity: 'pact',
      blurb: 'Kills are worth 60% more.', cost: 'Raiders fire 30% faster.' },
    { id: 'overheat',   name: 'Overheat',    cap: 1, rarity: 'pact',
      blurb: 'Fire 30% faster.', cost: 'Your combo window is 40% shorter.' },
    { id: 'glasshull',  name: 'Glass Hull',  cap: 1, rarity: 'pact',
      blurb: 'Take an extra refit pick right now.', cost: 'Lose a ship, permanently.' },
    { id: 'swarm',      name: 'Swarm Pact',  cap: 1, rarity: 'pact',
      blurb: 'Power-up drops are doubled.', cost: 'One more raider dives at a time.' }
  ];

  const CARDS = UPGRADES.concat(PACTS);
  const cardById = (id) => CARDS.find((c) => c.id === id);

  const ROMAN = ['', 'I', 'II', 'III', 'IV'];
  const upLevel = (id) => G.upgrades[id] || 0;

  // Kills chain while the window keeps being refreshed; the multiplier climbs
  // a step every five kills and resets the moment you are hit or go quiet.
  const COMBO_WINDOW = 2.6;
  const COMBO_MAX = 8;

  // Pacts bend these numbers against you as well as for you.
  const enemyFireMul = () => 1 + 0.3 * upLevel('bloodmoney');
  const dropMul = () => (1 + 0.6 * upLevel('salvage')) * (upLevel('swarm') ? 2 : 1);
  const comboWindow = () =>
    (COMBO_WINDOW + 0.7 * upLevel('chain')) * (upLevel('overheat') ? 0.6 : 1);
  const comboCap = () => COMBO_MAX + 2 * upLevel('overdrive');
  const comboMult = () => Math.min(comboCap(), 1 + Math.floor(G.combo / 5));
  const bombCap = () => 3 + upLevel('bombrack');

  function bumpCombo() {
    G.combo++;
    G.comboTimer = comboWindow();
    const m = comboMult();
    if (m > G.lastMult) {
      G.lastMult = m;
      Sound.combo(m);
      const chip = el('hudMult');
      chip.style.animation = 'none';
      void chip.offsetWidth;
      chip.style.animation = '';
    }
  }

  function breakCombo() {
    G.combo = 0;
    G.comboTimer = 0;
    G.lastMult = 1;
  }

  function updateComboHud() {
    const wrap = el('comboWrap');
    const on = G.combo > 0 && comboMult() > 1;
    wrap.classList.toggle('hidden', !on);
    if (!on) return;
    el('hudMult').textContent = '\u00d7' + comboMult();
    el('comboFill').style.width = (100 * clamp(G.comboTimer / comboWindow(), 0, 1)) + '%';
  }

  const CAPTURE_HALF_W = 26;      // half-width of the tractor beam, in design px

  /** The commander takes the ship: you lose it, and it joins the formation. */
  function capturePlayer(e) {
    G.captive = { captor: e, state: 'held', x: e.x, y: e.y + 26 * S };
    e.hasCaptive = true;
    e.capturing = false;
    e.hoverT = 0;
    e.path = retreatPath(e);
    e.d = 0;
    e.speed = 300 * S * loopMul();
    e.mode = 'path';
    e.onArrive = 'formation';

    player.alive = false;
    player.deadTimer = 1.6;
    player.dual = false;
    breakCombo();
    G.lives--;
    updateLives();
    explode(player.x, player.y, '#ffd166', 26, 1.3);
    G.shake = 12;
    G.killcam = { label: 'a capture beam', x: e.x, y: e.y, t: 1.15 };
    announce('SHIP CAPTURED', 'destroy the captor to get it back', true);
    Sound.playerDie();
    Haptics.shipLost();
    refreshChip();
  }

  /** Captor destroyed: the fighter breaks free and flies home to dock. */
  function freeCaptive() {
    if (!G.captive) return;
    G.captive.state = 'freeing';
    G.captive.captor = null;
    announce('FIGHTER FREED', 'bring it home', false);
    Sound.powerup();
  }

  function updateCaptive(dt) {
    const c = G.captive;
    if (!c) return;
    if (c.state === 'held') {
      const e = c.captor;
      if (!e || G.enemies.indexOf(e) < 0) { freeCaptive(); return; }
      c.x = e.x;
      c.y = e.y + 26 * S;
      return;
    }
    // Freeing: home in on the ship and dock with it.
    const tx = player.x, ty = player.y;
    const a = Math.atan2(ty - c.y, tx - c.x);
    const sp = 300 * S * dt;
    c.x += Math.cos(a) * sp;
    c.y += Math.sin(a) * sp;
    if (player.alive && hypot(tx - c.x, ty - c.y) < 22 * S) {
      G.captive = null;
      player.dual = true;
      floatText(player.x, player.y - 30 * S, 'DUAL FIGHTER', '#8dff5a');
      announce('DUAL FIGHTER', 'twin hulls, twin guns');
      Sound.levelUp();
      Haptics.powerup();
    }
  }

  const RAIDER_NAME = {
    grunt: 'a raider', wasp: 'an interceptor',
    commander: 'a command craft', turret: 'a gun platform'
  };

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
        const crit = bossCoreHit(boss, b.x, b.y, b.r);
        damageBoss(crit ? 2 + upLevel('optics') : 1);
        if (crit) {
          boss.coreFlash = 0.12;
          explode(b.x, b.y, '#ffffff', 10, 0.9);
          Sound.crit();
        } else {
          explode(b.x, b.y, boss.def.glow, 5, 0.6);
          Sound.hit();
        }
      }

      if (spent) G.pBullets.splice(i, 1);
    }

    if (!player.alive || player.invuln > 0) return;

    // Enemy shots
    for (let i = G.eBullets.length - 1; i >= 0; i--) {
      const b = G.eBullets[i];
      if (shipHit(b.x, b.y, b.r + player.r * 0.8)) {
        const label = b.kind === 'missile' ? 'a homing missile'
                    : b.src === 'boss' ? 'boss fire' : 'raider fire';
        G.eBullets.splice(i, 1);
        hitPlayer({ label: label, x: b.x, y: b.y });
        return;
      }
    }

    // Ramming raiders
    for (let i = G.enemies.length - 1; i >= 0; i--) {
      const e = G.enemies[i];
      if (e.bonus) continue;                      // challenging stages are safe
      if (shipHit(e.x, e.y, e.def.r * S + player.r * 0.8)) {
        explode(e.x, e.y, e.def.color, 16, 1.1);
        const label = 'ramming ' + (RAIDER_NAME[e.type] || 'a raider');
        G.enemies.splice(i, 1);
        hitPlayer({ label: label, x: e.x, y: e.y });
        return;
      }
    }

    // Boss body and beam
    if (G.boss) {
      const b = G.boss;
      if (bossHit(b, player.x, player.y, player.r * 0.7)) {
        hitPlayer({ label: 'colliding with the ' + b.name.toLowerCase(), x: b.x, y: b.y });
        return;
      }
      if (b.beam && b.beam.active && rayDist(player.x, player.y, b.x, b.y, b.beam.ang) < b.beam.w * 0.5 + player.r * 0.5) {
        hitPlayer({ label: 'the beam', x: player.x, y: player.y });
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

    // A spare ship on the run-up to every boss (waves 3, 7, 11, ...).
    if (G.wave >= 3 && (G.wave - 3) % 4 === 0) {
      G.lives++;
      updateLives();
      floatText(player.x, player.y - 34 * S, 'EXTRA SHIP', '#ffd166');
      Sound.powerup();
    }

    // Nobody should meet a boss on their last ship because the run-up went
    // badly. Reserves are topped up to three, and never reduced.
    if (def.boss && G.lives < 3) {
      G.lives = 3;
      updateLives();
      floatText(player.x, player.y - 34 * S, 'RESERVES RESTOCKED', '#5cd6ff');
      Sound.powerup();
    }

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
    if (upLevel('escort') && player.alive && player.wingmen <= 0) launchWingmen(10);
    if (def.boss) spawnBoss(def.boss);
    else buildWave(def);
    G.state = 'play';
  }

  function waveComplete() {
    const bonus = 400 * G.wave + 600 * (G.loop - 1);
    addScore(bonus);
    announce('WAVE CLEAR', '+' + bonus.toLocaleString() + ' bonus');
    Sound.levelUp();
    Haptics.waveClear();
    G.waveClearTimer = 2.0;
    G.state = 'clear';
  }

  /** Weighted draw of n distinct cards from whatever is not yet capped. */
  function drawOffer(n, noPacts) {
    const eligible = CARDS.filter((c) => upLevel(c.id) < c.cap &&
                                         !(noPacts && c.rarity === 'pact'));
    const taken = [];
    while (taken.length < n) {
      const avail = eligible.filter((c) => taken.indexOf(c) < 0);
      if (!avail.length) break;
      let total = 0;
      for (const c of avail) total += RARITY[c.rarity].weight;
      let roll = Math.random() * total;
      let chosen = avail[0];
      for (const c of avail) {
        roll -= RARITY[c.rarity].weight;
        if (roll <= 0) { chosen = c; break; }
      }
      taken.push(chosen);
    }
    return taken;
  }

  function renderOffer() {
    el('upgradeTitle').textContent = G.refitTitle;
    el('upgradeSub').textContent = G.refitSub;
    el('upgradePicks').textContent = G.picks > 1
      ? G.picks + ' picks left' : 'Pick one';
    const rr = el('rerollBtn');
    rr.textContent = 'Reroll (' + G.rerolls + ')';
    rr.disabled = G.rerolls <= 0;

    el('upgradeCards').innerHTML = G.offer.map((c, i) => {
      const lvl = upLevel(c.id);
      const tier = c.cap > 1 ? '<span class="up-tier">' + ROMAN[lvl + 1] + '</span>' : '';
      const owned = lvl > 0 ? '<span class="up-owned">have ' + ROMAN[lvl] + '</span>' : '';
      const cost = c.cost ? '<span class="up-cost">' + c.cost + '</span>' : '';
      return '<button class="up-card up-' + c.rarity + '" data-i="' + i + '">' +
             '<span class="up-key">' + (i + 1) + '</span>' +
             '<span class="up-rarity">' + RARITY[c.rarity].label + '</span>' +
             '<span class="up-name">' + c.name + tier + '</span>' +
             '<span class="up-blurb">' + c.blurb + '</span>' + cost + owned +
             '</button>';
    }).join('');

    for (const btn of el('upgradeCards').querySelectorAll('.up-card')) {
      btn.addEventListener('click', () => takeUpgrade(Number(btn.dataset.i)));
    }
  }

  /**
   * Opens the refit. `then` is what to run once every pick is spent, so the
   * same screen serves a boss reward and the run-opening free pick.
   */
  function offerUpgrade(picks, then, opts) {
    const o = opts || {};
    G.refitNext = then || advanceWave;
    G.refitTitle = o.title || 'Refit';
    G.refitSub = o.sub || 'Picks last the rest of the run.';
    G.noPacts = !!o.noPacts;
    // A run that just lost its last ship goes to the game-over screen instead.
    if (!player.alive && G.lives <= 0) { G.refitNext(); return; }
    G.picks = picks;
    G.offer = drawOffer(3, G.noPacts);
    if (!G.offer.length) { G.refitNext(); return; }

    renderOffer();
    hideAnnounce();
    G.state = 'upgrade';
    updateBombs();
    showScreen('upgrade');
  }

  function rerollOffer() {
    if (G.state !== 'upgrade' || G.rerolls <= 0) return;
    G.rerolls--;
    G.offer = drawOffer(3, G.noPacts);
    Sound.powerup();
    renderOffer();
  }

  function takeUpgrade(index) {
    if (G.state !== 'upgrade' || !G.offer || !G.offer[index]) return;
    const c = G.offer[index];
    G.upgrades[c.id] = upLevel(c.id) + 1;
    G.taken.push(c.id);

    // Cards that pay out, or charge, the moment they are taken.
    if (c.id === 'spare') { G.lives++; updateLives(); }
    if (c.id === 'bombrack') { player.bombs = Math.min(bombCap(), player.bombs + 1); updateBombs(); }
    if (c.id === 'glasshull') {
      G.picks++;                       // the extra pick this pact buys
      if (G.lives > 1) { G.lives--; updateLives(); }
    }

    G.picks--;
    Sound.levelUp();

    if (G.picks > 0) {
      G.offer = drawOffer(3, G.noPacts);
      if (G.offer.length) { renderOffer(); return; }
    }
    G.offer = null;
    showScreen(null);
    updateBombs();
    G.refitNext();
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
   * The player ship, painted once per weapon tint: a machined hull with a
   * lit spine, shadowed flanks, chromed cannons and a glass canopy.
   */
  function paintShip(c, tintColor, scale) {
    const u = S * scale;
    c.fillStyle = 'rgba(0,0,0,.3)';
    c.beginPath();
    c.ellipse(2 * u, 4 * u, 15 * u, 12 * u, 0, 0, Math.PI * 2);
    c.fill();

    // Wings
    const wg = c.createLinearGradient(-14 * u, -2 * u, 8 * u, 12 * u);
    wg.addColorStop(0, '#8fd0ff');
    wg.addColorStop(0.45, '#4da6ff');
    wg.addColorStop(1, '#1a4f8f');
    c.fillStyle = wg;
    c.beginPath();
    c.moveTo(-3.5 * u, -2 * u); c.lineTo(-15 * u, 8 * u);
    c.lineTo(-15 * u, 12 * u);  c.lineTo(-3.5 * u, 9 * u);
    c.closePath();
    c.moveTo(3.5 * u, -2 * u);  c.lineTo(15 * u, 8 * u);
    c.lineTo(15 * u, 12 * u);   c.lineTo(3.5 * u, 9 * u);
    c.closePath();
    c.fill();

    // Lit leading edges
    c.strokeStyle = 'rgba(190,230,255,.85)';
    c.lineWidth = 1.2 * u;
    c.beginPath();
    c.moveTo(-3.5 * u, -2 * u); c.lineTo(-15 * u, 8 * u);
    c.moveTo(3.5 * u, -2 * u);  c.lineTo(15 * u, 8 * u);
    c.stroke();

    // Vertical fins
    c.fillStyle = '#2f7fd4';
    c.beginPath();
    c.moveTo(-15 * u, 8 * u); c.lineTo(-17 * u, 0); c.lineTo(-13.5 * u, 6 * u);
    c.closePath();
    c.moveTo(15 * u, 8 * u);  c.lineTo(17 * u, 0);  c.lineTo(13.5 * u, 6 * u);
    c.closePath();
    c.fill();

    // Chromed wing cannons
    const bg = c.createLinearGradient(-11 * u, 0, -8.6 * u, 0);
    bg.addColorStop(0, '#7d8ea6'); bg.addColorStop(0.4, '#f2f7ff'); bg.addColorStop(1, '#5d6c88');
    c.fillStyle = bg;
    c.fillRect(-11 * u, 2 * u, 2.4 * u, 8 * u);
    c.fillRect(8.6 * u, 2 * u, 2.4 * u, 8 * u);

    // Fuselage
    const hg = c.createLinearGradient(-6 * u, -10 * u, 7 * u, 10 * u);
    hg.addColorStop(0, '#ffffff');
    hg.addColorStop(0.42, '#dbe6f5');
    hg.addColorStop(1, '#69809e');
    c.fillStyle = hg;
    c.beginPath();
    c.moveTo(0, -17 * u);   c.lineTo(4.6 * u, -4 * u);
    c.lineTo(5.4 * u, 10 * u); c.lineTo(-5.4 * u, 10 * u);
    c.lineTo(-4.6 * u, -4 * u);
    c.closePath();
    c.fill();

    // Spine highlight and shadowed right flank
    c.fillStyle = 'rgba(255,255,255,.75)';
    c.beginPath();
    c.moveTo(0, -16 * u); c.lineTo(-1.7 * u, -4 * u);
    c.lineTo(-1.7 * u, 9 * u); c.lineTo(0, 9 * u);
    c.closePath(); c.fill();
    c.fillStyle = 'rgba(20,40,70,.25)';
    c.beginPath();
    c.moveTo(1.4 * u, -13 * u); c.lineTo(4.6 * u, -4 * u);
    c.lineTo(5.4 * u, 10 * u);  c.lineTo(1.4 * u, 10 * u);
    c.closePath(); c.fill();

    // Hull stripes, tinted by the equipped weapon
    c.fillStyle = tintColor;
    c.fillRect(-4.9 * u, 3 * u, 3 * u, 5 * u);
    c.fillRect(1.9 * u, 3 * u, 3 * u, 5 * u);

    // Glass canopy with a specular streak
    const cg = c.createLinearGradient(-3 * u, -10 * u, 3 * u, 1 * u);
    cg.addColorStop(0, '#cfeaff');
    cg.addColorStop(0.35, '#2b7fd4');
    cg.addColorStop(1, '#08203c');
    c.fillStyle = cg;
    c.beginPath(); c.ellipse(0, -5 * u, 2.9 * u, 5.6 * u, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(255,255,255,.8)';
    c.beginPath(); c.ellipse(-0.9 * u, -7 * u, 0.85 * u, 2.2 * u, 0, 0, Math.PI * 2); c.fill();

    // Engine nozzles
    for (const sx of [-4.5, 4.5]) {
      const ng = c.createRadialGradient(sx * u, 10 * u, 0, sx * u, 10 * u, 2.6 * u);
      ng.addColorStop(0, '#0a1526'); ng.addColorStop(1, '#4a5f7d');
      c.fillStyle = ng;
      c.beginPath(); c.ellipse(sx * u, 10 * u, 2.6 * u, 1.8 * u, 0, 0, Math.PI * 2); c.fill();
    }
  }

  const WEAPON_TINT = { twin: '#8dff5a', spread: '#4da6ff', pierce: '#cfe8ff', single: '#ff6b35' };

  function drawPlayer() {
    ctx.save();
    ctx.translate(player.x, player.y);
    const blink = player.invuln > 0 && Math.floor(G.time * 16) % 2 === 0;

    if (!blink) {
      // Twin engine flares, drawn live so they flicker
      const f = (5 + Math.sin(G.time * 40) * 2) * S;
      ctx.globalCompositeOperation = 'lighter';
      for (const ox of shipOffsets()) {
        for (const sx of [-4.5, 4.5]) {
          const ex = ox + sx * S;
          const fg = ctx.createRadialGradient(ex, 12 * S, 0, ex, 12 * S, 4 * S + f);
          const hot = player.rapid > 0 ? '255,201,77' : '120,215,255';
          fg.addColorStop(0, 'rgba(255,255,255,.95)');
          fg.addColorStop(0.35, 'rgba(' + hot + ',.8)');
          fg.addColorStop(1, 'rgba(' + hot + ',0)');
          ctx.fillStyle = fg;
          ctx.beginPath();
          ctx.ellipse(ex, 12 * S + f * 0.4, 3.2 * S, 3.4 * S + f, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalCompositeOperation = 'source-over';

      const tintColor = WEAPON_TINT[player.weapon] || WEAPON_TINT.single;
      const sp = Sprites.get('ship:' + player.weapon, 46 * S, 46 * S,
                             (c) => paintShip(c, tintColor, 1));
      for (const ox of shipOffsets()) {
        ctx.save();
        ctx.translate(ox, 0);
        Sprites.blit(ctx, sp);
        ctx.restore();
      }
    }

    ctx.restore();
  }

  /** Wingmen fly the same airframe, smaller and in squadron colours. */
  const WINGMAN_TINT = ['#4fb87a', '#ffc94d'];

  function drawDrones() {
    if (player.wingmen <= 0 || !player.alive) return;
    // They blink out over the last two seconds so the loss isn't a surprise.
    if (player.wingmen < 2 && Math.floor(G.time * 10) % 2 === 0) return;

    player.drones.forEach((d, i) => {
      const col = WINGMAN_TINT[i % WINGMAN_TINT.length];
      ctx.save();
      ctx.translate(d.x, d.y);

      ctx.globalCompositeOperation = 'lighter';
      const f = (3 + Math.sin(G.time * 34) * 1.5) * S;
      const fg = ctx.createRadialGradient(0, 8 * S, 0, 0, 8 * S, 3 * S + f);
      fg.addColorStop(0, 'rgba(255,255,255,.85)');
      fg.addColorStop(0.4, 'rgba(120,215,255,.65)');
      fg.addColorStop(1, 'rgba(120,215,255,0)');
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.ellipse(0, 8 * S + f * 0.4, 2.2 * S, 2.4 * S + f, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';

      Sprites.blit(ctx, Sprites.get('drone:' + i, 30 * S, 30 * S,
                                    (c) => paintShip(c, col, 0.62)));
      ctx.restore();
    });
  }

  const FLAP_FRAMES = 4;

  function paintRaider(c, d, type, flap) {
    const r = d.r * S;
    const hull = bodyGradient(c, d.color, r);
    const wing = bodyGradient(c, d.wing, r * 1.4, 0.35, -0.6);
    const edge = tint(d.color, 0.75);

    // Contact shadow underneath, so the craft sits in the scene.
    c.fillStyle = 'rgba(0,0,0,.34)';
    c.beginPath();
    c.ellipse(r * 0.16, r * 0.3, r * 0.95, r * 0.72, 0, 0, Math.PI * 2);
    c.fill();

    if (type === 'turret') {
      c.fillStyle = tint(d.dark, -0.35);
      c.beginPath();
      c.moveTo(-r * 1.15, -r * 0.35); c.lineTo(-r * 0.55, -r * 0.95);
      c.lineTo(r * 0.55, -r * 0.95);  c.lineTo(r * 1.15, -r * 0.35);
      c.lineTo(r * 0.8, r * 0.7);     c.lineTo(-r * 0.8, r * 0.7);
      c.closePath(); c.fill();

      c.fillStyle = hull;
      c.beginPath();
      c.moveTo(-r * 0.85, -r * 0.3); c.lineTo(-r * 0.42, -r * 0.72);
      c.lineTo(r * 0.42, -r * 0.72); c.lineTo(r * 0.85, -r * 0.3);
      c.lineTo(r * 0.6, r * 0.5);    c.lineTo(-r * 0.6, r * 0.5);
      c.closePath(); c.fill();

      // Lit top-left facets
      c.strokeStyle = edge;
      c.lineWidth = 1.3 * S;
      c.beginPath();
      c.moveTo(-r * 0.85, -r * 0.3); c.lineTo(-r * 0.42, -r * 0.72); c.lineTo(r * 0.42, -r * 0.72);
      c.stroke();

      c.fillStyle = tint(d.dark, -0.5);
      c.fillRect(-r * 0.22, r * 0.4, r * 0.44, r * 0.85);
      c.fillStyle = 'rgba(255,255,255,.16)';
      c.fillRect(-r * 0.22, r * 0.4, r * 0.14, r * 0.85);

      const eye = c.createRadialGradient(0, -r * 0.1, 0, 0, -r * 0.1, r * 0.34);
      eye.addColorStop(0, '#ffffff');
      eye.addColorStop(0.4, d.glow);
      eye.addColorStop(1, tint(d.glow, -0.6, 0));
      c.fillStyle = eye;
      c.beginPath(); c.arc(0, -r * 0.1, r * 0.34, 0, Math.PI * 2); c.fill();

    } else if (type === 'commander') {
      c.fillStyle = wing;
      c.beginPath();
      c.moveTo(-r * 0.45, r * 0.30); c.lineTo(-r * 1.62, -r * (0.28 + flap));
      c.lineTo(-r * 1.34, -r * 0.68); c.lineTo(-r * 0.42, -r * 0.55);
      c.closePath();
      c.moveTo(r * 0.45, r * 0.30);  c.lineTo(r * 1.62, -r * (0.28 - flap));
      c.lineTo(r * 1.34, -r * 0.68); c.lineTo(r * 0.42, -r * 0.55);
      c.closePath(); c.fill();

      c.strokeStyle = tint(d.wing, 0.6);
      c.lineWidth = 1.2 * S;
      c.beginPath();
      c.moveTo(-r * 0.45, r * 0.30); c.lineTo(-r * 1.62, -r * (0.28 + flap));
      c.moveTo(r * 0.45, r * 0.30);  c.lineTo(r * 1.62, -r * (0.28 - flap));
      c.stroke();

      c.fillStyle = tint(d.dark, -0.4);
      c.fillRect(-r * 1.5, -r * 0.5, r * 0.22, r * 0.6);
      c.fillRect(r * 1.28, -r * 0.5, r * 0.22, r * 0.6);

      c.fillStyle = hull;
      c.beginPath();
      c.moveTo(0, r * 1.05);         c.lineTo(-r * 0.7, r * 0.2);
      c.lineTo(-r * 0.45, -r * 0.85); c.lineTo(r * 0.45, -r * 0.85);
      c.lineTo(r * 0.7, r * 0.2);
      c.closePath(); c.fill();

      // Spine highlight and shadowed flank
      c.fillStyle = tint(d.color, 0.5, 0.55);
      c.beginPath();
      c.moveTo(0, r * 1.0); c.lineTo(-r * 0.2, r * 0.1); c.lineTo(-r * 0.16, -r * 0.8);
      c.lineTo(0, -r * 0.84); c.closePath(); c.fill();
      c.fillStyle = 'rgba(0,0,0,.28)';
      c.beginPath();
      c.moveTo(r * 0.16, r * 0.9); c.lineTo(r * 0.7, r * 0.18);
      c.lineTo(r * 0.45, -r * 0.84); c.lineTo(r * 0.16, -r * 0.8);
      c.closePath(); c.fill();

      c.fillStyle = tint(d.dark, -0.3);
      c.fillRect(-r * 0.5, -r * 0.15, r, r * 0.16);

      const cn = c.createLinearGradient(-r * 0.3, r * 0.05, r * 0.3, r * 0.7);
      cn.addColorStop(0, '#9fd8ff'); cn.addColorStop(0.4, '#20304a'); cn.addColorStop(1, '#0b1220');
      c.fillStyle = cn;
      c.beginPath(); c.ellipse(0, r * 0.35, r * 0.3, r * 0.42, 0, 0, Math.PI * 2); c.fill();

      for (const sx of [-0.3, 0.3]) {
        const gl = c.createRadialGradient(sx * r, -r * 0.86, 0, sx * r, -r * 0.86, r * 0.26);
        gl.addColorStop(0, tint(d.glow, 0.5, 0.9));
        gl.addColorStop(0.4, tint(d.glow, 0, 0.5));
        gl.addColorStop(1, tint(d.glow, 0, 0));
        c.fillStyle = gl;
        c.beginPath(); c.arc(sx * r, -r * 0.86, r * 0.26, 0, Math.PI * 2); c.fill();
      }

    } else {
      const sweep = type === 'wasp' ? 1.55 : 1.25;
      c.fillStyle = wing;
      c.beginPath();
      c.moveTo(-r * 0.38, r * 0.25); c.lineTo(-r * sweep, -r * (0.22 + flap));
      c.lineTo(-r * sweep * 0.84, -r * 0.6); c.lineTo(-r * 0.36, -r * 0.5);
      c.closePath();
      c.moveTo(r * 0.38, r * 0.25);  c.lineTo(r * sweep, -r * (0.22 - flap));
      c.lineTo(r * sweep * 0.84, -r * 0.6); c.lineTo(r * 0.36, -r * 0.5);
      c.closePath(); c.fill();

      c.strokeStyle = tint(d.wing, 0.55);
      c.lineWidth = 1.1 * S;
      c.beginPath();
      c.moveTo(-r * 0.38, r * 0.25); c.lineTo(-r * sweep, -r * (0.22 + flap));
      c.moveTo(r * 0.38, r * 0.25);  c.lineTo(r * sweep, -r * (0.22 - flap));
      c.stroke();

      c.fillStyle = hull;
      c.beginPath();
      c.moveTo(0, r * 1.0);          c.lineTo(-r * 0.55, r * 0.15);
      c.lineTo(-r * 0.38, -r * 0.8); c.lineTo(r * 0.38, -r * 0.8);
      c.lineTo(r * 0.55, r * 0.15);
      c.closePath(); c.fill();

      c.fillStyle = tint(d.color, 0.55, 0.5);
      c.beginPath();
      c.moveTo(0, r * 0.95); c.lineTo(-r * 0.17, r * 0.1); c.lineTo(-r * 0.14, -r * 0.76);
      c.lineTo(0, -r * 0.79); c.closePath(); c.fill();
      c.fillStyle = 'rgba(0,0,0,.3)';
      c.beginPath();
      c.moveTo(r * 0.13, r * 0.86); c.lineTo(r * 0.55, r * 0.13);
      c.lineTo(r * 0.38, -r * 0.79); c.lineTo(r * 0.13, -r * 0.76);
      c.closePath(); c.fill();

      c.fillStyle = tint(d.dark, -0.25);
      c.fillRect(-r * 0.42, -r * 0.05, r * 0.84, r * 0.14);

      const cn = c.createLinearGradient(-r * 0.24, r * 0.05, r * 0.24, r * 0.6);
      cn.addColorStop(0, '#9fd8ff'); cn.addColorStop(0.4, '#20304a'); cn.addColorStop(1, '#0b1220');
      c.fillStyle = cn;
      c.beginPath(); c.ellipse(0, r * 0.35, r * 0.24, r * 0.34, 0, 0, Math.PI * 2); c.fill();

      const gl = c.createRadialGradient(0, -r * 0.8, 0, 0, -r * 0.8, r * 0.3);
      gl.addColorStop(0, tint(d.glow, 0.5, 0.9));
      gl.addColorStop(0.4, tint(d.glow, 0, 0.5));
      gl.addColorStop(1, tint(d.glow, 0, 0));
      c.fillStyle = gl;
      c.beginPath(); c.arc(0, -r * 0.8, r * 0.3, 0, Math.PI * 2); c.fill();
    }

    // Rim light along the shadowed edge — the cue that sells curvature.
    c.globalCompositeOperation = 'lighter';
    c.strokeStyle = 'rgba(150,190,255,.22)';
    c.lineWidth = 1.1 * S;
    c.beginPath();
    c.arc(0, 0, r * 0.92, Math.PI * 0.1, Math.PI * 0.9);
    c.stroke();
    c.globalCompositeOperation = 'source-over';
  }

  function raiderSprite(e) {
    const frame = Math.floor((e.t * 1.6) % FLAP_FRAMES);
    const flap = Math.sin((frame / FLAP_FRAMES) * Math.PI * 2) * 0.16;
    const box = e.def.r * S * 4;
    return Sprites.get('raider:' + e.type + ':' + frame, box, box,
                       (c) => paintRaider(c, e.def, e.type, flap));
  }

  /** The capture beam: a gold cone reaching down from a hovering commander. */
  function drawCaptureBeam(e) {
    const half = CAPTURE_HALF_W * S;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(0, 0, 0, H - e.y);
    g.addColorStop(0, 'rgba(255,201,77,.42)');
    g.addColorStop(1, 'rgba(255,201,77,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-half * 0.45, 0);
    ctx.lineTo(half * 0.45, 0);
    ctx.lineTo(half, H - e.y);
    ctx.lineTo(-half, H - e.y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,232,170,.55)';
    ctx.lineWidth = 1.6 * S;
    for (let i = 0; i < 4; i++) {
      const y = ((G.time * 200 * S + i * 70 * S) % (H - e.y));
      const w = half * (0.45 + 0.55 * (y / Math.max(1, H - e.y)));
      ctx.beginPath();
      ctx.moveTo(-w, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Your ship in enemy hands, or on its way home. */
  function drawCaptive() {
    const c = G.captive;
    if (!c) return;
    ctx.save();
    ctx.translate(c.x, c.y);
    if (c.state === 'held') {
      ctx.rotate(Math.PI);                       // held nose-up under the captor
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,201,77,.28)';
      ctx.beginPath();
      ctx.arc(0, 0, 20 * S, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.scale(0.85, 0.85);
    Sprites.blit(ctx, Sprites.get('ship:captive', 46 * S, 46 * S,
                                  (c2) => paintShip(c2, '#ffc94d', 1)));
    ctx.restore();
  }

  function drawEnemy(e) {
    const r = e.def.r * S;
    if (e.capturing && e.mode === 'hover') drawCaptureBeam(e);
    ctx.save();
    ctx.translate(e.x, e.y);

    if (e.elite) {
      // Elite marker: a steady ring with four rotating corner ticks.
      ctx.globalCompositeOperation = 'lighter';
      const pulse = 0.35 + 0.2 * Math.sin(e.t * 5);
      ctx.strokeStyle = 'rgba(255,201,77,' + pulse + ')';
      ctx.lineWidth = 1.2 * S;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,220,140,' + (pulse + 0.35) + ')';
      ctx.lineWidth = 2.2 * S;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = e.t * 0.9 + i * (Math.PI / 2);
        ctx.arc(0, 0, r * 1.3, a - 0.22, a + 0.22);
        ctx.moveTo(0, 0);
      }
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }

    ctx.rotate(e.angle);
    const sp = raiderSprite(e);
    Sprites.blit(ctx, sp);
    if (e.flash > 0) {
      // Re-blitting additively flares the whole hull without flattening it.
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.85;
      Sprites.blit(ctx, sp);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }

  /**
   * Boss hulls are painted once into a sprite — panelled metal with lit
   * upper facets, occluded seams and a specular sweep. Only the weak-point
   * core and the damage flare are drawn live, because they animate.
   */
  function paintBoss(c, def, kind) {
    const r = def.r * S;
    const hull = bodyGradient(c, def.color, r * 1.2, 0.5, -0.5);
    const plate = bodyGradient(c, def.plate, r, 0.35, -0.6);
    const lit = tint(def.color, 0.8);

    c.fillStyle = 'rgba(0,0,0,.35)';
    c.beginPath();
    c.ellipse(r * 0.14, r * 0.24, r * 1.45, r * 0.95, 0, 0, Math.PI * 2);
    c.fill();

    if (kind === 'sentinel') {
      c.fillStyle = plate;
      c.beginPath();
      c.moveTo(-r * 0.35, -r * 0.55); c.lineTo(-r * 1.65, r * 0.05);
      c.lineTo(-r * 1.42, r * 0.62);  c.lineTo(-r * 0.3, r * 0.5);
      c.closePath();
      c.moveTo(r * 0.35, -r * 0.55);  c.lineTo(r * 1.65, r * 0.05);
      c.lineTo(r * 1.42, r * 0.62);   c.lineTo(r * 0.3, r * 0.5);
      c.closePath(); c.fill();

      c.strokeStyle = tint(def.plate, 0.55);
      c.lineWidth = 1.4 * S;
      c.beginPath();
      c.moveTo(-r * 0.35, -r * 0.55); c.lineTo(-r * 1.65, r * 0.05);
      c.moveTo(r * 0.35, -r * 0.55);  c.lineTo(r * 1.65, r * 0.05);
      c.stroke();

      const chrome = c.createLinearGradient(0, r * 0.1, 0, r * 0.8);
      chrome.addColorStop(0, '#f2f7ff'); chrome.addColorStop(0.5, '#8d9bb2'); chrome.addColorStop(1, '#3c485c');
      c.fillStyle = chrome;
      c.fillRect(-r * 1.5, r * 0.1, r * 0.2, r * 0.7);
      c.fillRect(r * 1.3, r * 0.1, r * 0.2, r * 0.7);

      c.fillStyle = hull;
      c.beginPath();
      c.moveTo(0, r * 1.05);        c.lineTo(-r * 0.66, r * 0.32);
      c.lineTo(-r * 0.5, -r * 0.7); c.lineTo(0, -r * 0.98);
      c.lineTo(r * 0.5, -r * 0.7);  c.lineTo(r * 0.66, r * 0.32);
      c.closePath(); c.fill();

      c.fillStyle = 'rgba(255,255,255,.3)';
      c.beginPath();
      c.moveTo(0, r * 1.0); c.lineTo(-r * 0.2, r * 0.3);
      c.lineTo(-r * 0.16, -r * 0.66); c.lineTo(0, -r * 0.94);
      c.closePath(); c.fill();
      c.fillStyle = 'rgba(0,0,0,.3)';
      c.beginPath();
      c.moveTo(r * 0.1, r * 0.95); c.lineTo(r * 0.66, r * 0.3);
      c.lineTo(r * 0.5, -r * 0.68); c.lineTo(r * 0.1, -r * 0.92);
      c.closePath(); c.fill();

      c.fillStyle = plate;
      c.fillRect(-r * 0.48, -r * 0.44, r * 0.96, r * 0.1);
      c.fillRect(-r * 0.4, r * 0.52, r * 0.8, r * 0.1);
      c.strokeStyle = 'rgba(255,255,255,.25)';
      c.lineWidth = 1 * S;
      c.strokeRect(-r * 0.48, -r * 0.44, r * 0.96, r * 0.1);

      c.fillStyle = '#141c2b';
      c.beginPath(); c.ellipse(0, -r * 0.02, r * 0.36, r * 0.26, 0, 0, Math.PI * 2); c.fill();
      c.strokeStyle = lit;
      c.lineWidth = 1.2 * S;
      c.stroke();

    } else if (kind === 'queen') {
      c.strokeStyle = plate;
      c.lineWidth = 5 * S;
      for (let i = -3; i <= 3; i++) {
        if (!i) continue;
        const k = i / 3;
        c.beginPath();
        c.moveTo(k * r * 0.5, r * 0.2);
        c.quadraticCurveTo(k * r * 1.4, r * 0.5, k * r * 1.1, r * 1.06);
        c.stroke();
      }

      c.fillStyle = plate;
      c.beginPath(); c.ellipse(0, 0, r * 1.32, r * 1.0, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = domeGradient(c, def.color, r * 1.1);
      c.beginPath(); c.ellipse(0, -r * 0.06, r * 1.12, r * 0.8, 0, 0, Math.PI * 2); c.fill();

      c.strokeStyle = 'rgba(12,8,28,.45)';
      c.lineWidth = 2.5 * S;
      for (let i = 1; i <= 3; i++) {
        c.beginPath();
        c.ellipse(0, -r * 0.06, r * 1.12 * i / 4, r * 0.8 * i / 4, 0, 0, Math.PI * 2);
        c.stroke();
      }
      c.strokeStyle = 'rgba(255,255,255,.16)';
      c.lineWidth = 1.2 * S;
      for (let i = 1; i <= 3; i++) {
        c.beginPath();
        c.ellipse(0, -r * 0.09, r * 1.12 * i / 4, r * 0.8 * i / 4, 0, Math.PI * 1.05, Math.PI * 1.9);
        c.stroke();
      }

      for (let i = 0; i < 7; i++) {
        const a = i * (Math.PI * 2 / 7) + 0.4;
        c.save();
        c.translate(Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.58 - r * 0.06);
        c.fillStyle = domeGradient(c, '#c9b6ee', r * 0.13);
        c.beginPath(); c.arc(0, 0, r * 0.13, 0, Math.PI * 2); c.fill();
        c.restore();
      }

      c.fillStyle = '#150c26';
      c.beginPath(); c.arc(0, 0, r * 0.5, 0, Math.PI * 2); c.fill();

    } else {
      c.fillStyle = plate;
      c.beginPath();
      c.moveTo(-r * 1.12, -r * 0.82); c.lineTo(r * 1.12, -r * 0.82);
      c.lineTo(r * 1.6, -r * 0.02);   c.lineTo(r * 1.16, r * 0.82);
      c.lineTo(-r * 1.16, r * 0.82);  c.lineTo(-r * 1.6, -r * 0.02);
      c.closePath(); c.fill();

      c.fillStyle = hull;
      c.beginPath();
      c.moveTo(-r * 0.98, -r * 0.66); c.lineTo(r * 0.98, -r * 0.66);
      c.lineTo(r * 1.38, -r * 0.02);  c.lineTo(r * 1.0, r * 0.64);
      c.lineTo(-r * 1.0, r * 0.64);   c.lineTo(-r * 1.38, -r * 0.02);
      c.closePath(); c.fill();

      // Lit upper deck, shadowed lower hull
      c.fillStyle = 'rgba(255,255,255,.22)';
      c.beginPath();
      c.moveTo(-r * 0.98, -r * 0.66); c.lineTo(r * 0.98, -r * 0.66);
      c.lineTo(r * 1.38, -r * 0.02);  c.lineTo(-r * 1.38, -r * 0.02);
      c.closePath(); c.fill();
      c.fillStyle = 'rgba(0,0,0,.28)';
      c.beginPath();
      c.moveTo(-r * 1.38, r * 0.06); c.lineTo(r * 1.38, r * 0.06);
      c.lineTo(r * 1.0, r * 0.64);   c.lineTo(-r * 1.0, r * 0.64);
      c.closePath(); c.fill();

      c.strokeStyle = 'rgba(10,14,22,.55)';
      c.lineWidth = 2 * S;
      for (let i = -1; i <= 1; i++) {
        c.beginPath();
        c.moveTo(i * r * 0.55, -r * 0.6); c.lineTo(i * r * 0.55, r * 0.58);
        c.stroke();
      }
      c.strokeStyle = 'rgba(255,255,255,.14)';
      c.lineWidth = 1 * S;
      for (let i = -1; i <= 1; i++) {
        c.beginPath();
        c.moveTo(i * r * 0.55 + 1.6 * S, -r * 0.6); c.lineTo(i * r * 0.55 + 1.6 * S, r * 0.58);
        c.stroke();
      }

      const bridge = c.createLinearGradient(0, -r * 1.02, 0, -r * 0.66);
      bridge.addColorStop(0, '#ffffff'); bridge.addColorStop(1, '#8f9db0');
      c.fillStyle = bridge;
      c.beginPath();
      c.moveTo(-r * 0.55, -r * 0.66); c.lineTo(r * 0.55, -r * 0.66);
      c.lineTo(r * 0.34, -r * 1.02);  c.lineTo(-r * 0.34, -r * 1.02);
      c.closePath(); c.fill();

      c.fillStyle = plate;
      c.fillRect(-r * 1.16, r * 0.5, r * 0.28, r * 0.5);
      c.fillRect(r * 0.88, r * 0.5, r * 0.28, r * 0.5);
      c.fillStyle = '#1a1206';
      c.beginPath(); c.arc(0, -r * 0.06, r * 0.31, 0, Math.PI * 2); c.fill();
    }
  }

  function drawBoss(b) {
    const r = b.r;
    const PI2 = Math.PI * 2;
    const charging = !!(b.beam && !b.beam.active && !b.beam.tractor);
    // The core beats faster the closer the machine is to breaking apart.
    const beat = 0.72 + 0.28 * Math.sin(b.t * (4 + b.phase * 2.4));
    const coreRing = b.coreFlash > 0 ? b.coreFlash / 0.12 : 0;
    const cd = b.def.coreAt;

    ctx.save();
    ctx.translate(b.x, b.y);

    const halo = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, r * 2);
    halo.addColorStop(0, 'rgba(255,255,255,.09)');
    halo.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(0, 0, r * 2, 0, PI2); ctx.fill();

    const box = r * 4;
    Sprites.blit(ctx, Sprites.get('boss:' + b.kind, box, box,
                                  (c) => paintBoss(c, b.def, b.kind)));

    // Engine glow, live so it flickers
    if (b.kind === 'sentinel') {
      ctx.globalCompositeOperation = 'lighter';
      for (const sx of [-0.42, 0.42]) {
        const g = ctx.createRadialGradient(sx * r, -r * 0.95, 0, sx * r, -r * 0.95, r * 0.3);
        g.addColorStop(0, 'rgba(190,225,255,.8)');
        g.addColorStop(1, 'rgba(120,190,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(sx * r, -r * 0.95, r * 0.2, r * (0.18 + 0.05 * Math.sin(b.t * 14)), 0, 0, PI2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    // Weak-point core
    const coreCol = charging ? '#fff3a8'
                  : (b.kind === 'queen' && b.act.name === 'tractor') ? '#eaffdc'
                  : b.def.core;
    const cr = cd.r * r;
    ctx.globalCompositeOperation = 'lighter';
    const bloom = ctx.createRadialGradient(cd.x * r, cd.y * r, cr * 0.5, cd.x * r, cd.y * r, cr * 2.6);
    bloom.addColorStop(0, tint(coreCol, 0.1, 0.5 * beat));
    bloom.addColorStop(1, tint(coreCol, 0, 0));
    ctx.fillStyle = bloom;
    ctx.beginPath(); ctx.arc(cd.x * r, cd.y * r, cr * 2.6, 0, PI2); ctx.fill();

    const cg = ctx.createRadialGradient(cd.x * r - cr * 0.25, cd.y * r - cr * 0.3, 0,
                                        cd.x * r, cd.y * r, cr);
    cg.addColorStop(0, '#ffffff');
    cg.addColorStop(0.3, tint(coreCol, 0.45, beat));
    cg.addColorStop(0.75, tint(coreCol, 0, beat * 0.8));
    cg.addColorStop(1, tint(coreCol, -0.3, 0));
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.arc(cd.x * r, cd.y * r, cr, 0, PI2); ctx.fill();

    if (coreRing > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,' + coreRing + ')';
      ctx.lineWidth = 2.5 * S;
      ctx.beginPath();
      ctx.arc(cd.x * r, cd.y * r, cr * (1 + (1 - coreRing) * 0.9), 0, PI2);
      ctx.stroke();
    }

    if (b.flash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,.22)';
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.35, r * 1.0, 0, 0, PI2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
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

  /** A bolt sprite: hot core, coloured body, soft bloom around it. */
  function boltSprite(key, color, rw, rh) {
    const w = rw * 6, h = rh * 3.2;
    return Sprites.get(key, w, h, (c) => {
      const bloom = c.createRadialGradient(0, 0, 0, 0, 0, rw * 2.6);
      bloom.addColorStop(0, tint(color, 0.2, 0.55));
      bloom.addColorStop(1, tint(color, 0, 0));
      c.fillStyle = bloom;
      c.beginPath(); c.ellipse(0, 0, rw * 2.6, rh * 1.5, 0, 0, Math.PI * 2); c.fill();

      const body = c.createLinearGradient(-rw, 0, rw, 0);
      body.addColorStop(0, tint(color, -0.25));
      body.addColorStop(0.4, tint(color, 0.35));
      body.addColorStop(1, tint(color, -0.35));
      c.fillStyle = body;
      c.beginPath(); c.ellipse(0, 0, rw, rh, 0, 0, Math.PI * 2); c.fill();

      c.fillStyle = 'rgba(255,255,255,.95)';
      c.beginPath(); c.ellipse(-rw * 0.15, -rh * 0.1, rw * 0.4, rh * 0.66, 0, 0, Math.PI * 2); c.fill();
    });
  }

  /** An enemy plasma ball, lit from the upper left like any other sphere. */
  function orbSprite(key, color, rad) {
    const box = rad * 5;
    return Sprites.get(key, box, box, (c) => {
      const bloom = c.createRadialGradient(0, 0, rad * 0.5, 0, 0, rad * 2.3);
      bloom.addColorStop(0, tint(color, 0, 0.5));
      bloom.addColorStop(1, tint(color, 0, 0));
      c.fillStyle = bloom;
      c.beginPath(); c.arc(0, 0, rad * 2.3, 0, Math.PI * 2); c.fill();

      c.fillStyle = domeGradient(c, color, rad);
      c.beginPath(); c.arc(0, 0, rad, 0, Math.PI * 2); c.fill();

      c.fillStyle = 'rgba(255,255,255,.9)';
      c.beginPath();
      c.arc(LIGHT.x * rad * 0.4, LIGHT.y * rad * 0.4, rad * 0.3, 0, Math.PI * 2);
      c.fill();
    });
  }

  function missileSprite(r) {
    return Sprites.get('missile:' + Math.round(r * 10), r * 6, r * 7, (c) => {
      c.fillStyle = '#ff6b35';
      c.beginPath();
      c.moveTo(-r * 0.45, -r * 0.5); c.lineTo(-r * 1.15, -r * 1.15);
      c.lineTo(-r * 0.45, -r * 1.0); c.closePath();
      c.moveTo(r * 0.45, -r * 0.5);  c.lineTo(r * 1.15, -r * 1.15);
      c.lineTo(r * 0.45, -r * 1.0);  c.closePath();
      c.fill();
      const bg = c.createLinearGradient(-r * 0.5, 0, r * 0.5, 0);
      bg.addColorStop(0, '#8d99ab'); bg.addColorStop(0.35, '#ffffff'); bg.addColorStop(1, '#6a778c');
      c.fillStyle = bg;
      c.beginPath();
      c.moveTo(0, r * 1.7);    c.lineTo(r * 0.5, r * 0.4);
      c.lineTo(r * 0.5, -r);   c.lineTo(-r * 0.5, -r);
      c.lineTo(-r * 0.5, r * 0.4);
      c.closePath(); c.fill();
      c.fillStyle = '#ff3b1f';
      c.fillRect(-r * 0.5, r * 0.1, r, r * 0.35);
    });
  }

  function drawBullets() {
    for (const b of G.pBullets) {
      const sp = b.pierce
        ? boltSprite('bolt:lance:' + Math.round(b.r * 10), '#bfe4ff', b.r * 1.1, b.r * 4.6)
        : boltSprite('bolt:laser:' + Math.round(b.r * 10), '#8dff5a', b.r * 1.1, b.r * 3.1);
      ctx.save();
      ctx.translate(b.x, b.y);
      if (b.vx) ctx.rotate(Math.atan2(b.vy, b.vx) + Math.PI / 2);
      Sprites.blit(ctx, sp);
      ctx.restore();
    }

    for (const b of G.eBullets) {
      ctx.save();
      ctx.translate(b.x, b.y);
      if (b.kind === 'missile') {
        ctx.rotate(Math.atan2(b.vy, b.vx) - Math.PI / 2);
        ctx.globalCompositeOperation = 'lighter';
        const flare = b.r * (2.2 + Math.random() * 0.9);
        const fg = ctx.createLinearGradient(0, -b.r * 0.8, 0, -flare);
        fg.addColorStop(0, 'rgba(255,240,190,.95)');
        fg.addColorStop(1, 'rgba(255,120,40,0)');
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.moveTo(-b.r * 0.5, -b.r * 0.8);
        ctx.lineTo(0, -flare);
        ctx.lineTo(b.r * 0.5, -b.r * 0.8);
        ctx.closePath();
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        Sprites.blit(ctx, missileSprite(b.r));
      } else {
        Sprites.blit(ctx, orbSprite('orb:' + b.color + ':' + Math.round(b.r * 10), b.color, b.r * 1.2));
      }
      ctx.restore();
    }
  }

  function drawPowerups() {
    for (const p of G.powerups) {
      const wob = Math.sin(p.t * 5) * 2 * S;
      // The ring turns edge-on and back, catching the light as it spins.
      const spin = Math.max(0.2, Math.abs(Math.cos(p.t * 2.2)));
      ctx.save();
      ctx.translate(p.x, p.y + wob);

      ctx.globalCompositeOperation = 'lighter';
      const halo = ctx.createRadialGradient(0, 0, 4 * S, 0, 0, 17 * S);
      halo.addColorStop(0, tint(p.def.color, 0, 0.28));
      halo.addColorStop(1, tint(p.def.color, 0, 0));
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(0, 0, 17 * S, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';

      ctx.save();
      ctx.scale(spin, 1);
      const band = ctx.createLinearGradient(-11 * S, -11 * S, 11 * S, 11 * S);
      band.addColorStop(0, tint(p.def.color, 0.75));
      band.addColorStop(0.45, p.def.color);
      band.addColorStop(1, tint(p.def.color, -0.55));
      ctx.strokeStyle = band;
      ctx.lineWidth = 3.4 * S;
      ctx.beginPath(); ctx.arc(0, 0, 11 * S, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.6)';
      ctx.lineWidth = 1 * S;
      ctx.beginPath(); ctx.arc(0, 0, 12.4 * S, Math.PI * 1.05, Math.PI * 1.75); ctx.stroke();
      ctx.restore();

      if (spin > 0.55) {
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold ' + Math.round(11 * S) + 'px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = (spin - 0.55) * 2.2;
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

  /** Names the culprit and rings it, over a dimmed field. */
  function drawKillcam() {
    const k = G.killcam;
    const fade = clamp(k.t / 0.25, 0, 1);          // ease out at the end
    const grow = clamp(1 - k.t / 1.15, 0, 1);

    ctx.save();
    ctx.globalAlpha = 0.5 * fade;
    ctx.fillStyle = '#03040c';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;

    // Target ring on whatever landed the hit.
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(255,90,43,' + (0.85 * fade) + ')';
    ctx.lineWidth = 2.2 * S;
    const rr = (16 + grow * 16) * S;
    ctx.beginPath();
    ctx.arc(k.x, k.y, rr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 3 * S;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = i * (Math.PI / 2) + Math.PI / 4;
      ctx.arc(k.x, k.y, rr, a - 0.18, a + 0.18);
      ctx.moveTo(k.x, k.y);
    }
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';

    // Caption, kept clear of the ring and fitted inside the screen: long
    // labels are shrunk to fit, then centred as near the culprit as the
    // edges allow.
    const ty = k.y < H * 0.6 ? k.y + rr + 26 * S : k.y - rr - 20 * S;
    const label = k.label.toUpperCase();
    const margin = 12 * S;
    const maxW = W - margin * 2;

    ctx.globalAlpha = fade;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    let size = 17 * S;
    ctx.font = '800 ' + Math.round(size) + 'px -apple-system, sans-serif';
    let lw = ctx.measureText(label).width;
    if (lw > maxW) {
      size = Math.max(9 * S, size * maxW / lw);
      ctx.font = '800 ' + Math.round(size) + 'px -apple-system, sans-serif';
      lw = ctx.measureText(label).width;
    }
    const lx = clamp(k.x, margin + lw / 2, W - margin - lw / 2);

    ctx.font = '700 ' + Math.round(10 * S) + 'px -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(180,196,224,.9)';
    ctx.fillText('DESTROYED BY', lx, ty - 13 * S);

    ctx.font = '800 ' + Math.round(size) + 'px -apple-system, sans-serif';
    ctx.lineWidth = 3.5 * S;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(3,5,14,.85)';
    ctx.strokeText(label, lx, ty + 6 * S);
    ctx.fillStyle = '#ff8548';
    ctx.fillText(label, lx, ty + 6 * S);
    ctx.globalAlpha = 1;
    ctx.restore();
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
    drawCaptive();
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
    if (G.killcam) drawKillcam();
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

    // The post-mortem beat runs on real time while the field crawls.
    if (G.killcam) {
      G.killcam.t -= dt;
      if (G.killcam.t <= 0) G.killcam = null;
    }
    const gdt = G.killcam ? dt * 0.16 : dt;

    // Time warp slows the raiders and their shots — never the player.
    if (G.slow > 0) G.slow = Math.max(0, G.slow - gdt);
    const edt = G.slow > 0 ? gdt * 0.4 : gdt;

    updateStars(gdt, G.state === 'menu' ? 1.8 : (G.slow > 0 ? 0.4 : 1));
    updateEffects(gdt);

    if (G.state === 'menu' || G.state === 'over' || G.state === 'paused' ||
        G.state === 'upgrade') return;

    if (G.comboTimer > 0) {
      G.comboTimer -= gdt;
      if (G.comboTimer <= 0) breakCombo();
    }
    updateComboHud();

    updatePlayer(gdt);
    updateCaptive(edt);
    updateBullets(gdt, edt);
    updatePowerups(gdt);

    if (G.state === 'intro') {
      G.introTimer -= gdt;
      if (G.introTimer <= 0) beginWaveCombat();
      return;
    }

    if (G.state === 'clear') {
      updateEnemies(edt);
      G.waveClearTimer -= gdt;
      if (G.waveClearTimer <= 0) {
        hideAnnounce();
        const next = G.afterClear;
        G.afterClear = null;
        if (next) next();
        // The refit is the boss reward; ordinary waves roll straight on, and
        // the wave before each boss hands off to a challenging stage.
        else if (waveDef().boss) offerUpgrade(2, advanceWave);
        else if (isBonusWave(G.wave)) startBonus();
        else advanceWave();
      }
      return;
    }

    if (G.state === 'bonus') {
      updateSpawnQueue(edt);
      updateEnemies(edt);
      collisions();
      refreshChip();
      G.bonus.timer -= gdt;
      if ((G.enemies.length === 0 && G.spawnQueue.length === 0) || G.bonus.timer <= 0) endBonus();
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
        G.waveClearTimer -= gdt;
        if (G.waveClearTimer <= 0) waveComplete();
      }
    } else if (G.enemies.length === 0 && G.spawnQueue.length === 0) {
      G.waveClearTimer -= gdt;
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

  const SCREENS = ['menu', 'howto', 'paused', 'gameover', 'upgrade', 'hangar'];

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
    G.lives = 3 + perkLevel('reserve');
    G.rerolls = 1 + perkLevel('dice');
    G.taken = [];
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
    G.upgrades = {};
    G.offer = null;
    G.taken = [];
    breakCombo();

    player.alive = true;
    player.x = player.tx = W / 2;
    player.y = player.ty = playerMaxY();
    player.invuln = 1.6;
    player.weapon = 'single';
    player.weaponTime = 0;
    player.rapid = 0;
    player.wingmen = 0;
    player.drones = [];
    player.bombs = perkLevel('munitions');
    player.dual = false;
    player.cool = 0;
    G.slow = 0;
    G.flash = 0;
    G.shock = null;
    G.killcam = null;
    G.bonus = null;
    G.afterClear = null;
    G.captive = null;

    el('hudScore').textContent = '0';
    el('hudWave').textContent = G.wave;   // the loadout screen sits over the HUD
    el('hudBest').textContent = records.best.toLocaleString();
    updateBombs();
    updateLives();
    refreshChip();
    updateComboHud();
    el('hud').classList.remove('hidden');
    showScreen(null);
    // Every run opens with a loadout pick, so the build layer is visible
    // from the first wave rather than gated behind the first boss.
    offerUpgrade(2 + perkLevel('headstart'), startWave, {
      title: 'Launch Loadout',
      sub: 'Choose your opening upgrades. They last the whole run.',
      noPacts: true          // pacts are a mid-run gamble, not a first choice
    });
  }

  /** Renders the run's cards as chips into `target`; hides it when empty. */
  function renderBuild(target) {
    if (!G.taken || !G.taken.length) { target.classList.add('hidden'); return; }
    const counts = {};
    for (const id of G.taken) counts[id] = (counts[id] || 0) + 1;
    target.innerHTML = Object.keys(counts).map((id) => {
      const c = cardById(id);
      return '<span class="build-chip build-' + c.rarity + '">' + c.name +
             (counts[id] > 1 ? ' ' + ROMAN[counts[id]] : '') + '</span>';
    }).join('');
    target.classList.remove('hidden');
  }

  function pauseGame() {
    if (G.state !== 'play' && G.state !== 'intro' && G.state !== 'clear' &&
        G.state !== 'bonus') return;
    G.pausedFrom = G.state;
    G.state = 'paused';
    input.firing = false;
    drag = null;
    updateBombs();
    renderBuild(el('pauseBuildChips'));
    el('pauseBuild').classList.toggle('hidden', !(G.taken && G.taken.length));
    showScreen('paused');
  }

  function resumeGame() {
    if (G.state !== 'paused') return;
    G.state = G.pausedFrom || 'play';
    updateBombs();
    showScreen(null);
  }

  function quitToMenu() {
    G.state = 'menu';
    G.offer = null;
    G.boss = null;
    G.enemies.length = 0;
    G.spawnQueue.length = 0;
    G.eBullets.length = 0;
    G.pBullets.length = 0;
    G.powerups.length = 0;
    el('hud').classList.add('hidden');
    el('bossBarWrap').classList.add('hidden');
    updateBombs();
    hideAnnounce();
    saveRecords();
    refreshMenuStats();
    showScreen('menu');
  }

  function gameOver() {
    G.state = 'over';
    G.boss = null;
    breakCombo();
    updateComboHud();
    updateBombs();
    el('bossBarWrap').classList.add('hidden');
    hideAnnounce();
    saveRecords();
    el('finalScore').textContent = G.score.toLocaleString();
    el('finalSub').textContent = 'Wave ' + G.wave + (G.loop > 1 ? ' · Loop ' + G.loop : '');
    const earned = G.practice ? 0 : scrapEarned();
    if (earned) {
      records.scrap += earned;
      Store.set('scrap', records.scrap);
    }
    el('scrapEarned').textContent = '+' + earned + ' scrap';
    el('scrapEarned').classList.toggle('hidden', !earned);

    renderBuild(el('runBuild'));

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

  function renderHangar() {
    el('hangarScrap').textContent = records.scrap.toLocaleString();
    el('hangarList').innerHTML = PERKS.map((p) => {
      const lvl = perkLevel(p.id);
      const maxed = lvl >= p.cap;
      const cost = maxed ? 0 : p.costs[lvl];
      const afford = !maxed && records.scrap >= cost;
      const tier = p.cap > 1 ? '<span class="up-tier">' + ROMAN[Math.min(lvl + 1, p.cap)] + '</span>' : '';
      return '<div class="perk' + (maxed ? ' perk-maxed' : '') + '">' +
             '<div class="perk-text">' +
             '<span class="perk-name">' + p.name + (maxed ? '' : tier) + '</span>' +
             '<span class="perk-blurb">' + p.blurb + '</span>' +
             (lvl ? '<span class="up-owned">owned ' + ROMAN[lvl] + '</span>' : '') +
             '</div>' +
             (maxed
               ? '<span class="perk-buy perk-done">MAX</span>'
               : '<button class="perk-buy" data-id="' + p.id + '"' + (afford ? '' : ' disabled') + '>' +
                 cost + '</button>') +
             '</div>';
    }).join('');

    for (const btn of el('hangarList').querySelectorAll('.perk-buy[data-id]')) {
      btn.addEventListener('click', () => buyPerk(btn.dataset.id));
    }
  }

  function buyPerk(id) {
    const p = PERKS.find((x) => x.id === id);
    const lvl = perkLevel(id);
    if (!p || lvl >= p.cap) return;
    const cost = p.costs[lvl];
    if (records.scrap < cost) return;
    records.scrap -= cost;
    records.perks[id] = lvl + 1;
    Store.set('scrap', records.scrap);
    Store.set('perks', records.perks);
    Sound.powerup();
    renderHangar();
    refreshMenuStats();
  }

  function refreshMenuStats() {
    el('menuScrap').textContent = records.scrap.toLocaleString();
    el('menuBest').textContent = records.best.toLocaleString();
    el('menuWave').textContent = records.bestWave;
  }

  // =========================================================
  // 16. UI wiring
  // =========================================================

  /**
   * `available` lets a toggle report that the device cannot do the thing at
   * all, rather than claiming to be ON while doing nothing.
   */
  function bindToggle(id, key, label, onChange, available) {
    const btn = el(id);
    const usable = available ? available() : true;
    const paint = () => {
      if (!usable) {
        btn.dataset.on = 'false';
        btn.disabled = true;
        btn.textContent = label + ': N/A';
        btn.title = 'This browser has no vibration support';
        return;
      }
      btn.dataset.on = String(settings[key]);
      btn.textContent = label + ': ' + (settings[key] ? 'ON' : 'OFF');
    };
    btn.addEventListener('click', () => {
      if (!usable) return;
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
  el('btnHangar').addEventListener('click', () => { renderHangar(); showScreen('hangar'); });
  el('btnHangarBack').addEventListener('click', () => showScreen('menu'));
  el('rerollBtn').addEventListener('click', rerollOffer);
  el('btnHowBack').addEventListener('click', () => showScreen('menu'));

  togglePainters.push(bindToggle('btnAuto', 'autoFire', 'Auto-fire'));
  togglePainters.push(bindToggle('btnAuto2', 'autoFire', 'Auto-fire'));
  togglePainters.push(bindToggle('btnSound', 'sound', 'Sound', () => { Sound.on = settings.sound; if (settings.sound) Sound.init(); }));
  togglePainters.push(bindToggle('btnSound2', 'sound', 'Sound', () => { Sound.on = settings.sound; if (settings.sound) Sound.init(); }));
  togglePainters.push(bindToggle('btnHaptics', 'haptics', 'Rumble',
    () => { Haptics.on = settings.haptics; Haptics.buzz(20); }, () => Haptics.supported));
  togglePainters.push(bindToggle('btnHaptics2', 'haptics', 'Rumble',
    () => { Haptics.on = settings.haptics; Haptics.buzz(20); }, () => Haptics.supported));

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
  updateBombs();
  showScreen('menu');
  requestAnimationFrame(frame);
})();
