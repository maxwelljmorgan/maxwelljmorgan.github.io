/* AUSA 2026 floor-walk companion: search exhibitors, see their day / route stop / booth on the map,
   and read the email correspondence tied to each one. Data lives encrypted in data.enc. */
(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const DAY_TAG = { 1: 'Day 1 · Mon', 2: 'Day 2 · Tue' };

  let D = null;                 // decrypted data
  let EX = [];                  // exhibitors
  let DIR = [];                 // every exhibitor on the floor (directory), sorted by name
  let MAIL = {};                // emails by number
  const ROUTE = { 1: [], 2: [] }; // flat stops in walking order: {booth,name,kind,note,aisle,label,ex}
  const MUST_COUNT = { 1: 0, 2: 0 };
  let visited = new Set(LS.get('ausa-visited', []));
  const state = { view: 'search', chip: LS.get('ausa-chip', 'mine'), q: '', routeDay: LS.get('ausa-day', 1), mapDay: 1, mapLayer: 'route', mapZoom: null, focus: null, shown: 60 };
  if (state.chip === 'all') state.chip = 'mine';
  const FLOOR = { 1: 'Lower Level · Halls A-C', 2: 'Upper Level · Halls D-E' };

  /* ============================== unlock ============================== */
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  // The encrypted box is either inlined in the page (<script id="enc">) or fetched from data.enc.
  async function loadBox() {
    const inline = document.getElementById('enc');
    if (inline) return JSON.parse(inline.textContent);
    let res;
    try { res = await fetch('data.enc', { cache: 'no-cache' }); }
    catch { throw new Error('Could not download the data. Check your connection and try again.'); }
    if (!res.ok) throw new Error('Could not download the data (error ' + res.status + '). Try reloading the page.');
    return res.json();
  }
  async function decrypt(pass) {
    if (!window.crypto || !crypto.subtle) throw new Error('This browser cannot unlock the data. Open the link in Safari or Chrome (not an in-app browser) and make sure the phone is up to date.');
    const box = await loadBox();
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(box.salt), iterations: box.iter, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    let plain;
    try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(box.iv) }, key, b64(box.ct)); }
    catch { const e = new Error('Wrong passphrase. Check spelling and capital letters.'); e.wrong = true; throw e; }
    if (box.gz) {
      if (typeof DecompressionStream === 'undefined') throw new Error('This browser is too old to open the data. Update the phone, or open the link in Chrome.');
      const stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'));
      return JSON.parse(await new Response(stream).text());
    }
    return JSON.parse(new TextDecoder().decode(plain));
  }
  // Phone keyboards often capitalize the first letter or add a trailing space; try those variants too.
  async function decryptAny(pass) {
    const tries = [...new Set([pass, pass.trim(), pass.trim().toLowerCase()])].filter(Boolean);
    let err;
    for (const t of tries) {
      try { return [await decrypt(t), t]; }
      catch (e) { err = e; if (!e.wrong) throw e; }
    }
    throw err || new Error('Enter the passphrase.');
  }

  async function unlock(pass, remember) {
    const btn = $('#unlockBtn');
    btn.disabled = true; btn.textContent = 'Unlocking…'; $('#lockErr').textContent = '';
    try {
      const [data, used] = await decryptAny(pass);
      D = data;
      if (remember) LS.set('ausa-pass', used);
      init();
    } catch (e) {
      console.error(e);
      if (e.wrong) LS.del('ausa-pass');
      $('#lockErr').textContent = e.message || 'Could not unlock';
      $('#lock').classList.remove('hidden');
    } finally { btn.disabled = false; btn.textContent = 'Unlock'; }
  }
  $('#lockForm').addEventListener('submit', e => { e.preventDefault(); unlock($('#pass').value, $('#remember').checked); });

  /* ============================== model ============================== */
  function init() {
    EX = D.exhibitors.map((e, i) => Object.assign(e, { i, key: e.booth + '|' + e.name, day: e.route?.day ?? e.shares?.day ?? e.floorDay ?? null }));
    D.emails.forEach(m => { MAIL[m.n] = m; m.linked = []; });
    EX.forEach(e => [...e.emails, ...e.mentions].forEach(n => MAIL[n] && MAIL[n].linked.push(e.i)));
    for (const day of [1, 2]) {
      let stopNo = 0;
      for (const a of D.days[day].aisles) {
        const isStop = a.label !== 'if time';
        if (isStop) stopNo++;
        for (const s of a.stops) {
          const ex = EX.find(e => e.booth === s.booth && norm(e.name) === norm(s.name));
          s.ex = ex ? ex.i : null;
          ROUTE[day].push(Object.assign(s, { aisle: a.aisle, label: a.label, direction: a.direction, stopNo: isStop ? stopNo : null, after: stopNo }));
          if (s.kind === 'must') MUST_COUNT[day]++;
        }
      }
      D.days[day].stopCount = stopNo;
    }
    EX.forEach(e => { e.mine = e.visit || !!e.route || e.emails.length > 0; e.hay = norm([e.name, e.booth, e.contacts, e.firm, e.notes, e.lobbyist, e.area, e.route?.note].join(' ')); });
    D.emails.forEach(m => { m.hay = norm([m.subject, m.fromName, m.represents, m.takeaway, m.body, m.to, m.cc].join(' ')); });
    // Directory = AUSA's official 2026 exhibitor list (plus your few on-floor companies it omits), linked to your list by `ex`.
    const floorOf = b => /^\d+$/.test(b) ? (+b < 5000 ? 1 : +b < 9000 ? 2 : null) : (D.pins[b]?.[0] ?? null);
    DIR = D.directory.map(r => ({ name: r.name, booth: r.booth, day: floorOf(r.booth), ex: r.ex, note: r.loc, unlisted: !!r.unlisted }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    DIR.forEach((d, i) => { d.di = i; d.hay = norm(d.name + ' ' + d.booth); });

    $('#lock').classList.add('hidden');
    $('#app').classList.remove('hidden');
    buildChips();
    setView(state.view);
    // Offline cache; unavailable (and throws on access) inside sandboxed frames such as a shared artifact.
    try { navigator.serviceWorker?.register('sw.js').catch(() => {}); } catch { /* no offline cache here */ }
  }

  const isVisited = e => visited.has(e.key);
  function toggleVisited(e) {
    visited.has(e.key) ? visited.delete(e.key) : visited.add(e.key);
    LS.set('ausa-visited', [...visited]);
  }

  /* ============================== header / nav ============================== */
  const CHIPS = [
    ['mine', 'My list'], ['d1', 'Day 1 · Mon'], ['d2', 'Day 2 · Tue'], ['off', 'Off-floor & events'], ['mail', 'Has emails'], ['todo', 'Not yet visited'],
  ];
  function buildChips() {
    $('#chips').innerHTML = CHIPS.map(([k, l]) => `<button class="chip${state.chip === k ? ' on' : ''}" data-chip="${k}">${l}</button>`).join('');
  }
  $('#chips').addEventListener('click', e => {
    const b = e.target.closest('[data-chip]'); if (!b) return;
    state.chip = b.dataset.chip; LS.set('ausa-chip', state.chip); state.shown = 60;
    buildChips(); renderSearch(); window.scrollTo(0, 0);
  });
  document.querySelector('.tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view);
  });
  function setView(v) {
    state.view = v;
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
    document.querySelectorAll('.view').forEach(s => s.classList.toggle('hidden', s.id !== 'view-' + v));
    $('.search-wrap').classList.toggle('hidden', v === 'route' || v === 'map');
    $('#chips').classList.toggle('hidden', v !== 'search');
    $('#q').placeholder = v === 'mail' ? 'Search all 65 emails' : v === 'dir' ? `Any of ${DIR.length} exhibitors, or a booth number` : 'Search your companies, contacts, notes';
    ({ search: renderSearch, route: renderRoute, dir: renderDir, map: renderMap, mail: renderMail })[v]();
    window.scrollTo(0, 0);
  }
  let qTimer;
  $('#q').addEventListener('input', () => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      state.q = $('#q').value.trim(); state.shown = 60;
      $('#qClear').classList.toggle('hidden', !state.q);
      ({ mail: renderMail, dir: renderDir })[state.view]?.() ?? renderSearch();
    }, 90);
  });
  $('#q').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
  $('#qClear').addEventListener('click', () => { $('#q').value = ''; $('#q').dispatchEvent(new Event('input')); $('#q').focus(); });

  /* ============================== search ============================== */
  const tokens = q => norm(q).split(' ').filter(Boolean);
  function score(e, toks, raw) {
    if (!toks.length) return 1;
    if (!toks.every(t => e.hay.includes(t))) return 0;
    const n = norm(e.name), q = toks.join(' ');
    let s = 1;
    if (e.booth.toLowerCase() === raw.toLowerCase()) s += 200;
    if (n === q) s += 150; else if (n.startsWith(q)) s += 100; else if ((' ' + n).includes(' ' + q)) s += 60; else if (n.includes(q)) s += 40;
    else if (toks.every(t => n.includes(t))) s += 30;
    if (e.mine) s += 8;
    return s;
  }
  function chipFilter(e) {
    if (!e.mine) return false;   // the Search tab is your list only; everyone else lives in the Directory tab
    switch (state.chip) {
      case 'd1': return e.day === 1;
      case 'd2': return e.day === 2;
      case 'off': return !e.day;
      case 'mail': return e.emails.length + e.mentions.length > 0;
      case 'todo': return e.mine && !isVisited(e) && e.day;
      default: return true;
    }
  }
  function hlRegex(toks) {
    const t = toks.filter(x => x.length > 1).map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return t.length ? new RegExp('(' + t.join('|') + ')', 'gi') : null;
  }
  const hl = (s, re) => re ? esc(s).replace(re, '<mark>$1</mark>') : esc(s);

  function placeTags(e) {
    const t = [];
    if (e.day) t.push(`<span class="tag d${e.day}">${DAY_TAG[e.day]}</span>`);
    else t.push('<span class="tag">Off-floor</span>');
    if (e.route) {
      const pos = e.route.label === 'if time' ? `Aisle ${e.route.aisle}` : `Stop ${e.route.label}`;
      t.push(`<span class="tag ${e.route.kind}">${e.route.kind === 'must' ? 'Must-see' : 'If time'} · ${pos}</span>`);
    } else if (e.shares) t.push(`<span class="tag">At route booth ${e.booth}</span>`);
    const nm = e.emails.length + e.mentions.length;
    if (nm) t.push(`<span class="tag mail">✉ ${nm}</span>`);
    if (isVisited(e)) t.push('<span class="tag done">✓ Visited</span>');
    return t.join('');
  }
  function boothBox(e) {
    const off = !/^\d+$|^OD/.test(e.booth);
    const cls = e.route ? e.route.kind : '';
    return `<span class="booth ${cls}${off ? ' off' : ''}">${esc(off ? (e.booth === 'AUSAPavilion' ? 'AUSA Pav.' : e.booth) : e.booth)}</span>`;
  }
  function exRow(e, re) {
    const sub = e.route?.note || e.contacts || (e.area && e.area !== e.location ? e.area : e.location) || '';
    return `<button class="row${isVisited(e) ? ' visited' : ''}" data-ex="${e.i}">${boothBox(e)}<span class="row-main"><div class="row-name">${hl(e.name, re)}</div>${sub ? `<div class="row-sub">${hl(sub, re)}</div>` : ''}<div class="tags">${placeTags(e)}</div></span><span class="chev">›</span></button>`;
  }
  function routeOrder(e) {
    if (e.route || e.shares) {
      const st = ROUTE[e.day].findIndex(s => s.booth === e.booth);
      return e.day * 1000 + (st < 0 ? 999 : st);
    }
    if (e.day) return e.day * 1000 + 990;
    return 9000;
  }
  function snippet(body, toks) {
    const lower = body.toLowerCase();
    let at = -1;
    for (const t of toks) { at = lower.indexOf(t); if (at >= 0) break; }
    if (at < 0) return '';
    const s = Math.max(0, at - 50);
    return (s ? '…' : '') + body.slice(s, at + 110).replace(/\s+/g, ' ') + '…';
  }

  function renderSearch() {
    const el = $('#view-search');
    const raw = state.q, toks = tokens(raw), re = hlRegex(toks);
    let list = EX.filter(chipFilter);
    let html = '';
    if (!toks.length) {
      list.sort((a, b) => routeOrder(a) - routeOrder(b) || a.name.localeCompare(b.name));
      html += `<div class="meta">${list.length} companies on your list · tap one for booth, day, route stop and emails. Looking for someone else? Use <b>Directory</b>.</div>`;
      const groups = [
        ['Day 1 · Mon 12 Oct · Lower Level (Halls A-C), walking order', list.filter(e => e.day === 1)],
        ['Day 2 · Tue 13 Oct · Upper Level (Halls D-E), walking order', list.filter(e => e.day === 2)],
        ['Off the floor / events / no booth', list.filter(e => !e.day)],
      ];
      let budget = state.shown;
      for (const [h, g] of groups) {
        if (!g.length || budget <= 0) continue;
        const part = g.slice(0, budget); budget -= part.length;
        html += (h ? `<div class="group-h">${h} (${g.length})</div>` : '') + `<div class="list">${part.map(e => exRow(e, null)).join('')}</div>`;
      }
      if (budget <= 0 && list.length > state.shown) html += `<button class="more" data-more>Show more (${list.length - state.shown} left)</button>`;
      el.innerHTML = html || '<div class="empty">Nothing here.</div>';
      return;
    }
    const scored = list.map(e => [e, score(e, toks, raw)]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1] || a[0].name.localeCompare(b[0].name)).map(x => x[0]);
    const mails = D.emails.filter(m => toks.every(t => m.hay.includes(t)));
    if (scored.length) html += `<div class="group-h">On your list (${scored.length})</div><div class="list">${scored.slice(0, state.shown).map(e => exRow(e, re)).join('')}</div>`;
    if (scored.length > state.shown) html += `<button class="more" data-more>Show more</button>`;
    const dirHits = DIR.filter(d => !(d.ex != null && EX[d.ex].mine) && dirScore(d, toks, raw) > 0).length;
    if (dirHits) html += `<button class="more" data-goto-dir>${dirHits} other exhibitor${dirHits > 1 ? 's' : ''} match “${esc(raw)}” in the Directory ›</button>`;
    if (mails.length) {
      html += `<div class="group-h">Emails mentioning “${esc(raw)}” (${mails.length})</div><div class="list">` + mails.slice(0, 12).map(m =>
        `<button class="row" data-mail="${m.n}"><span class="booth off">#${m.n}</span><span class="row-main"><div class="row-name">${hl(m.subject, re)}</div><div class="row-sub">${esc(m.fromName)} · ${esc(m.represents)}</div><div class="snip">${hl(snippet(m.subject + ' ' + m.body, toks), re)}</div></span><span class="chev">›</span></button>`).join('') + '</div>';
      if (mails.length > 12) html += `<button class="more" data-goto-mail>See all ${mails.length} emails</button>`;
    }
    el.innerHTML = html || `<div class="empty">No matches for “${esc(raw)}” on your list or in the emails.</div>`;
  }

  document.addEventListener('click', e => {
    const t = e.target;
    const chk = t.closest('[data-check]');
    if (chk) {
      e.stopPropagation();
      toggleVisited(EX[+chk.dataset.check]);
      rerender(); return;
    }
    const ex = t.closest('[data-ex]'); if (ex) { openExhibitor(+ex.dataset.ex); return; }
    const ml = t.closest('[data-mail]'); if (ml) { openMail(+ml.dataset.mail); return; }
    if (t.closest('[data-more]')) { state.shown += 120; rerender(); return; }
    if (t.closest('[data-goto-mail]')) { setView('mail'); return; }
    if (t.closest('[data-goto-dir]')) { state.shown = 60; setView('dir'); return; }
    const dr = t.closest('[data-dir]'); if (dr) { openDir(+dr.dataset.dir); return; }
    const mp = t.closest('[data-map]');
    if (mp) { const [d, b, layer] = mp.dataset.map.split('|'); showOnMap(+d, b, layer); return; }
  });
  function rerender() {
    if (!$('#sheet').classList.contains('hidden') && stack.length) stack[stack.length - 1].render(true);
    ({ search: renderSearch, route: renderRoute, dir: renderDir, map: () => {}, mail: renderMail })[state.view]();
  }

  /* ============================== directory (any exhibitor) ============================== */
  function dirScore(d, toks, raw) {
    if (!toks.length) return 1;
    if (!toks.every(t => d.hay.includes(t))) return 0;
    const n = norm(d.name), q = toks.join(' ');
    let s = 1;
    if (d.booth.toLowerCase() === raw.toLowerCase()) s += 200;
    if (n === q) s += 150; else if (n.startsWith(q)) s += 100; else if ((' ' + n).includes(' ' + q)) s += 60; else if (n.includes(q)) s += 40;
    return s;
  }
  const boothText = b => b === 'AUSAPavilion' ? 'AUSA Pav.' : b;
  function dirRow(d, re) {
    const e = d.ex != null ? EX[d.ex] : null;
    const where = d.day ? FLOOR[d.day] : (d.note || 'No booth listed');
    const tags = [`<span class="tag">${esc(where)}</span>`];
    if (e && e.mine) tags.push('<span class="tag mine">★ On my list</span>');
    if (!locOf(d.booth)) tags.push('<span class="tag">Not on map</span>');
    const off = !/^\d+$|^OD/.test(d.booth);
    return `<button class="row" data-dir="${d.di}"><span class="booth${off ? ' off' : ''}">${esc(boothText(d.booth))}</span><span class="row-main"><div class="row-name">${hl(d.name, re)}</div><div class="tags">${tags.join('')}</div></span><span class="chev">›</span></button>`;
  }
  function renderDir() {
    const raw = state.q, toks = tokens(raw), re = hlRegex(toks);
    const list = toks.length
      ? DIR.map(d => [d, dirScore(d, toks, raw)]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1] || a[0].di - b[0].di).map(x => x[0])
      : DIR;
    let html = `<div class="meta">${toks.length ? `${list.length} of ${DIR.length} exhibitors match` : `All ${DIR.length} exhibitors on AUSA's official 2026 list, A-Z`}. Look up anyone and see their booth on the plain floor plan. This list is separate from your route and visit list.</div>`;
    if (list.length) html += `<div class="list">${list.slice(0, state.shown).map(d => dirRow(d, re)).join('')}</div>`;
    else html += `<div class="empty">No exhibitor matches “${esc(raw)}”.<br>Try part of the name or a booth number.</div>`;
    if (list.length > state.shown) html += `<button class="more" data-more>Show more (${list.length - state.shown} left)</button>`;
    $('#view-dir').innerHTML = html;
  }
  function openDir(di) {
    const d = DIR[di];
    pushSheet(d.name, () => renderDirDetail(d));
  }
  function renderDirDetail(d) {
    const e = d.ex != null ? EX[d.ex] : null;
    const L = locOf(d.booth);
    const others = DIR.filter(x => x.booth === d.booth && x !== d && /^\d+$|^OD/.test(d.booth));
    let html = `<div class="hero"><h2>${esc(d.name)}</h2>
      <div class="hero-grid"><div class="bigbooth"><small>Booth</small>${esc(boothText(d.booth))}</div>
      <div><div class="when">${d.day ? (d.day === 1 ? 'Lower Level' : 'Upper Level') : 'No floor booth'}</div><div class="when-sub">${d.day ? (d.day === 1 ? 'Halls A, B, C' : 'Halls D, E') + ' · open all three show days' : esc(d.note || '')}</div></div></div>`;
    if (e && e.mine) html += `<div class="callout"><b>★ On your list</b>Your route stop, notes and emails for this company are in My list.</div>`;
    if (d.unlisted) html += `<div class="callout"><b>Not on AUSA's official list</b>Your emails place this company in booth ${esc(d.booth)}.</div>`;
    if (!L && d.day) html += `<div class="callout">Booth ${esc(d.booth)} isn't labeled on the floor plan.</div>`;
    html += `<div class="actions">${L ? `<button class="btn primary" data-map="${L.day}|${esc(d.booth)}|plan">Show on floor plan</button>` : ''}${e && e.mine ? `<button class="btn" data-ex="${e.i}">Open in My list</button>` : ''}</div></div>`;
    if (L) html += minimap(L, d.booth, 'plan');
    if (others.length) html += `<div class="section"><h3>Also at booth ${esc(d.booth)} (${others.length})</h3><div class="list">${others.slice(0, 40).map(x => dirRow(x, null)).join('')}</div></div>`;
    $('#sheetBody').innerHTML = html;
    $('#sheetBody').scrollTop = 0;
  }
  function openDirBooth(b) {
    const list = DIR.filter(d => d.booth === b);
    if (!list.length) return;
    if (list.length === 1) return openDir(list[0].di);
    pushSheet('Booth ' + b, () => {
      $('#sheetBody').innerHTML = `<div class="meta">${list.length} exhibitors share booth ${esc(b)}</div><div class="list">${list.map(d => dirRow(d, null)).join('')}</div>`;
    });
  }

  /* ============================== route ============================== */
  function renderRoute() {
    const day = state.routeDay, d = D.days[day];
    const stops = ROUTE[day];
    const must = stops.filter(s => s.kind === 'must');
    const done = must.filter(s => s.ex != null && isVisited(EX[s.ex])).length;
    const next = stops.find(s => s.kind === 'must' && s.ex != null && !isVisited(EX[s.ex]));
    let html = `<div class="seg">${[1, 2].map(k => `<button data-rday="${k}" class="${k === day ? 'on' : ''}">${DAY_TAG[k]}</button>`).join('')}</div>
      <div class="day-head"><h2>${esc(d.title)}: ${esc(d.floor)}</h2><p>${esc(d.summary)}</p><p><b>Start:</b> ${esc(d.start)}</p>
      <div class="progress"><div style="width:${(100 * done / must.length).toFixed(1)}%"></div></div><p>${done} of ${must.length} must-see visited${next ? ` · next: <b>${esc(next.booth)} ${esc(next.name)}</b>` : ' · all done!'}</p>
      <div class="actions"><button class="btn" data-map="${day}||route">Open ${day === 1 ? 'Day 1' : 'Day 2'} map</button></div></div>
      <div class="group-h">Off the floor / timed</div><div class="list timed">${d.timed.map(t => `<div class="row"><span class="time">${esc(t.time)}</span><span class="row-main"><div class="row-name">${esc(t.what)}</div><div class="row-sub" style="white-space:normal">${esc(t.detail)}</div></span></div>`).join('')}</div>`;
    for (const a of d.aisles) {
      const iftime = a.label === 'if time';
      html += `<div class="aisle${iftime ? ' iftime' : ''}"><div class="aisle-h">${a.aisle === 'ODA1' ? 'LAST STOP' : 'Aisle ' + esc(a.aisle)} <small>${esc(a.label)}${a.direction ? ' · ' + esc(a.direction) : ''}</small></div><div class="list">`;
      for (const s of a.stops) {
        const e = s.ex != null ? EX[s.ex] : null;
        const v = e && isVisited(e);
        html += `<div class="row${v ? ' visited' : ''}${next && s === next ? ' cur' : ''}" ${e ? `data-ex="${e.i}"` : ''} role="button">
          <span class="booth ${s.kind}">${esc(s.booth)}</span>
          <span class="row-main"><div class="row-name">${esc(s.name)}</div>${s.note ? `<div class="row-sub">${esc(s.note)}</div>` : ''}${e && e.emails.length + e.mentions.length ? `<div class="tags"><span class="tag mail">✉ ${e.emails.length + e.mentions.length}</span></div>` : ''}</span>
          ${e ? `<button class="check${v ? ' on' : ''}" data-check="${e.i}" aria-label="Mark visited">${v ? '✓' : ''}</button>` : ''}</div>`;
      }
      html += '</div></div>';
    }
    html += `<p class="finish"><b>Finish:</b> ${esc(d.finish)}</p>`;
    $('#view-route').innerHTML = html;
  }
  $('#view-route').addEventListener('click', e => {
    const b = e.target.closest('[data-rday]');
    if (b) { state.routeDay = +b.dataset.rday; LS.set('ausa-day', state.routeDay); renderRoute(); window.scrollTo(0, 0); }
  });

  /* ============================== map ============================== */
  // Both layers share one geometry: the route maps are the plain floor plans with the walk drawn on.
  const MAPS = { 1: { route: 'map-day1.jpg', plan: 'plan-day1.jpg', ar: 4748 / 1874 }, 2: { route: 'map-day2.jpg', plan: 'plan-day2.jpg', ar: 4797 / 2437 } };
  // Where a booth is: {day, x, y, box?}, from the booth outline on the plan or else its printed number.
  function locOf(booth) {
    const b = D.boxes?.[booth], p = D.pins[booth];
    if (!b && !p) return null;
    const box = b ? b.slice(1) : null;
    return { day: b ? b[0] : p[0], x: p && (!b || p[0] === b[0]) ? p[1] : (box[0] + box[2]) / 2, y: p && (!b || p[0] === b[0]) ? p[2] : (box[1] + box[3]) / 2, box };
  }
  function boothAt(day, x, y, w, h) {
    let hit = null, area = Infinity;
    for (const [b, v] of Object.entries(D.boxes || {})) {
      if (v[0] !== day || x < v[1] || x > v[3] || y < v[2] || y > v[4]) continue;
      const a = (v[3] - v[1]) * (v[4] - v[2]);
      if (a < area) { area = a; hit = b; }
    }
    if (hit) return hit;
    let best = null, bd = Infinity;
    for (const [b, p] of Object.entries(D.pins)) {
      if (p[0] !== day) continue;
      const dd = Math.hypot((p[1] - x) * w, (p[2] - y) * h);
      if (dd < bd) { bd = dd; best = b; }
    }
    return bd < 40 ? best : null;
  }
  const marks = (L, pct) => (L.box ? `<span class="hlbox" style="left:${L.box[0] * 100}%;top:${L.box[1] * 100}%;width:${(L.box[2] - L.box[0]) * 100}%;height:${(L.box[3] - L.box[1]) * 100}%"></span>` : '')
    + `<span class="pulse" style="left:${pct ? L.x * 100 + '%' : '50%'};top:${pct ? L.y * 100 + '%' : '105px'}"></span><span class="pin" style="left:${pct ? L.x * 100 + '%' : '50%'};top:${pct ? L.y * 100 + '%' : '105px'}"></span>`;
  function minimap(L, booth, layer) {
    const m = MAPS[L.day], W = L.day === 1 ? 2600 : 1900, H = W / m.ar;
    const left = `calc(50% - ${L.x * W}px)`, top = 105 - L.y * H;
    const box = L.box ? `<span class="hlbox" style="left:calc(50% + ${(L.box[0] - L.x) * W}px);top:${105 + (L.box[1] - L.y) * H}px;width:${(L.box[2] - L.box[0]) * W}px;height:${(L.box[3] - L.box[1]) * H}px"></span>` : '';
    return `<div class="minimap" data-map="${L.day}|${esc(booth)}|${layer}"><img src="${m[layer]}" alt="" style="width:${W}px;left:${left};top:${top}px">
      ${box}<span class="pulse" style="left:50%;top:105px"></span><span class="pin" style="left:50%;top:105px"></span><button class="open">Open map ›</button></div>`;
  }
  function showOnMap(day, booth, layer) {
    closeSheet(true);
    state.mapDay = day; state.focus = booth || null; state.mapZoom = null;
    if (layer) state.mapLayer = layer;
    setView('map');
  }
  function renderMap() {
    const day = state.mapDay, m = MAPS[day], layer = state.mapLayer;
    const L0 = state.focus ? locOf(state.focus) : null;
    const pin = L0 && L0.day === day ? L0 : null;
    const who = state.focus ? (layer === 'plan' ? DIR : EX).filter(e => e.booth === state.focus).map(e => e.name) : [];
    $('#view-map').innerHTML = `<div class="seg">${[['route', 'My route'], ['plan', 'Floor plan (all booths)']].map(([k, l]) => `<button data-mlayer="${k}" class="${k === layer ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="map-tools"><div class="seg">${[1, 2].map(k => `<button data-mday="${k}" class="${k === day ? 'on' : ''}">${k === 1 ? 'Day 1 · A-C' : 'Day 2 · D-E'}</button>`).join('')}</div>
      <button class="zbtn" data-zoom="-1" aria-label="Zoom out">−</button><button class="zbtn" data-zoom="1" aria-label="Zoom in">+</button></div>
      <div class="mapbox" id="mapbox"><div class="mapinner" id="mapinner"><img src="${m[layer]}" alt="${layer === 'route' ? 'Floor plan with your route' : 'Floor plan'}" draggable="false">
      ${pin ? marks(pin, true) : ''}</div></div>
      <div class="map-cap">${pin ? `<b>Booth ${esc(state.focus)}</b>: ${esc(who.slice(0, 6).join(', '))}${who.length > 6 ? ` and ${who.length - 6} more` : ''}.` : state.focus ? `Booth ${esc(state.focus)} isn't labeled on this map.` : 'Pinch or use +/− to zoom. Tap a booth to see who is there.'} ${layer === 'route' ? 'Red pills are must-see stops, amber are if-time.' : ''}</div>`;
    const box = $('#mapbox');
    if (state.mapZoom == null) state.mapZoom = Math.max(1, Math.min(box.clientHeight / (box.clientWidth / m.ar), 3));
    if (pin) state.mapZoom = Math.max(state.mapZoom, day === 1 ? 4 : 3);
    applyZoom(state.mapZoom, pin ? { x: pin.x, y: pin.y } : { x: day === 1 ? 0.92 : 0.95, y: 0.6 });
  }
  function applyZoom(z, center) {
    const box = $('#mapbox'), inner = $('#mapinner'); if (!box) return;
    const m = MAPS[state.mapDay];
    z = Math.max(1, Math.min(z, 8)); state.mapZoom = z;
    const w = box.clientWidth * z, h = w / m.ar;
    inner.style.width = w + 'px'; inner.style.height = h + 'px';
    if (center) { box.scrollLeft = center.x * w - box.clientWidth / 2; box.scrollTop = center.y * h - box.clientHeight / 2; }
  }
  function zoomBy(f, px, py) {
    const box = $('#mapbox'); const inner = $('#mapinner');
    px ??= box.clientWidth / 2; py ??= box.clientHeight / 2;
    const w = inner.offsetWidth, h = inner.offsetHeight;
    const c = { x: (box.scrollLeft + px) / w, y: (box.scrollTop + py) / h };
    applyZoom(state.mapZoom * f);
    box.scrollLeft = c.x * inner.offsetWidth - px; box.scrollTop = c.y * inner.offsetHeight - py;
  }
  $('#view-map').addEventListener('click', e => {
    const d = e.target.closest('[data-mday]');
    if (d) { state.mapDay = +d.dataset.mday; state.focus = null; state.mapZoom = null; renderMap(); return; }
    const ly = e.target.closest('[data-mlayer]');
    if (ly) {
      const box = $('#mapbox'), inner = $('#mapinner');
      const c = { x: (box.scrollLeft + box.clientWidth / 2) / inner.offsetWidth, y: (box.scrollTop + box.clientHeight / 2) / inner.offsetHeight };
      state.mapLayer = ly.dataset.mlayer; const z = state.mapZoom; renderMap(); applyZoom(z, c); return;
    }
    const z = e.target.closest('[data-zoom]');
    if (z) { zoomBy(+z.dataset.zoom > 0 ? 1.5 : 1 / 1.5); return; }
    const inner = e.target.closest('#mapinner');
    if (inner && !pinchMoved) {
      const r = inner.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      const b = boothAt(state.mapDay, x, y, r.width, r.height);
      if (!b) return;
      if (state.mapLayer === 'plan') openDirBooth(b);
      else if (EX.some(ex => ex.booth === b)) openBooth(b);
      else openDirBooth(b);
    }
  });
  // two-finger pinch zoom inside the map box
  let pinch = null, pinchMoved = false;
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  $('#view-map').addEventListener('touchstart', e => {
    if (e.touches.length === 2 && e.target.closest('#mapbox')) {
      const box = $('#mapbox').getBoundingClientRect();
      pinch = { d: dist(e.touches), z: state.mapZoom, px: (e.touches[0].clientX + e.touches[1].clientX) / 2 - box.left, py: (e.touches[0].clientY + e.touches[1].clientY) / 2 - box.top };
      pinchMoved = true;
    } else pinchMoved = false;
  }, { passive: true });
  $('#view-map').addEventListener('touchmove', e => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const target = pinch.z * dist(e.touches) / pinch.d;
    zoomBy(target / state.mapZoom, pinch.px, pinch.py);
  }, { passive: false });
  $('#view-map').addEventListener('touchend', e => { if (e.touches.length < 2) pinch = null; }, { passive: true });

  /* ============================== emails tab ============================== */
  function mailCard(m, re, open) {
    const links = m.linked.map(i => EX[i]);
    return `<details class="mail"${open ? ' open' : ''}><summary><span class="mail-num">#${m.n}</span><div class="mail-subj">${hl(m.subject, re)}</div>
      <div class="mail-from">${esc(m.fromName)}${m.senderType ? ' · ' + esc(m.senderType) : ''}</div>${m.takeaway ? `<div class="mail-take">${hl(m.takeaway, re)}</div>` : ''}</summary>
      <div class="mail-hdr">From: ${esc(m.fromName)}${m.fromAddr ? ' &lt;' + esc(m.fromAddr) + '&gt;' : ''}<br>To: ${esc(m.to)}${m.cc ? '<br>CC: ' + esc(m.cc) : ''}${m.represents && m.represents !== 'n/a' ? '<br>Re: ' + esc(m.represents) : ''}</div>
      ${links.length ? `<div class="mail-links" style="padding-top:8px">${links.map(e => `<button class="linkchip" data-ex="${e.i}">${esc(e.booth)} · ${esc(e.name)}</button>`).join('')}</div>` : ''}
      <div class="mail-body">${linkify(hl(m.body, re))}</div></details>`;
  }
  function linkify(html) {
    return html
      .replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>')
      .replace(/(\+?1?[ .-]?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4})/g, m => `<a href="tel:${m.replace(/[^\d+]/g, '')}">${m}</a>`);
  }
  function renderMail() {
    const toks = tokens(state.q), re = hlRegex(toks);
    const list = D.emails.filter(m => toks.every(t => m.hay.includes(t)));
    $('#view-mail').innerHTML = `<div class="meta">${list.length} of ${D.emails.length} emails${toks.length ? ' match' : ''} · tap to read; company chips open the exhibitor</div>` +
      (list.map(m => mailCard(m, re, false)).join('') || '<div class="empty">No emails match.</div>');
  }

  /* ============================== detail sheet ============================== */
  const stack = [];
  let useHistory = true;
  function pushSheet(title, render) {
    stack.push({ title, render });
    try { history.pushState({ sheet: stack.length }, ''); useHistory = true; } catch { useHistory = false; }
    showTop();
  }
  function showTop() {
    const top = stack[stack.length - 1];
    $('#sheet').classList.remove('hidden');
    $('#sheetTitle').textContent = top.title;
    top.render(false);
  }
  function closeSheet(all) {
    if (!stack.length) return;
    const n = all ? stack.length : 1;
    if (useHistory) { try { history.go(-n); return; } catch { /* fall through */ } }
    stack.splice(stack.length - n, n);
    if (stack.length) showTop(); else { $('#sheet').classList.add('hidden'); rerender(); }
  }
  window.addEventListener('popstate', () => {
    const want = history.state?.sheet || 0;
    while (stack.length > want) stack.pop();
    if (stack.length) showTop(); else { $('#sheet').classList.add('hidden'); rerender(); }
  });
  $('#sheetBack').addEventListener('click', () => closeSheet(false));

  function nearestAisle(e) {
    if (!e.day || !/^\d+$/.test(e.booth)) return null;
    const aisle = Math.floor(+e.booth / 100) * 100;
    let best = null;
    for (const a of D.days[e.day].aisles) {
      if (a.label === 'if time' || !/^\d+$/.test(a.aisle)) continue;
      if (!best || Math.abs(+a.aisle - aisle) < Math.abs(+best.aisle - aisle)) best = a;
    }
    return { aisle, near: best };
  }
  function timedFor(e) {
    const key = norm(e.name).split(' ')[0];
    const out = [];
    for (const day of [1, 2]) for (const t of D.days[day].timed) {
      if (key.length > 2 && norm(t.what + ' ' + t.detail).split(' ').includes(key)) out.push({ day, ...t });
    }
    return out;
  }

  function openExhibitor(i) {
    const e = EX[i];
    pushSheet(e.name, () => renderExhibitor(e));
  }
  function renderExhibitor(e) {
    const re = hlRegex(tokens(state.q));
    const d = e.day ? D.days[e.day] : null;
    const r = e.route;
    const total = e.day ? D.days[e.day].stopCount : 0;
    let callout = '';
    if (r) {
      const stop = ROUTE[e.day].find(s => s.ex === e.i);
      const isStop = r.label !== 'if time';
      const n = stop ? (isStop ? stop.stopNo : stop.after) : 0;
      const where = r.aisle === 'ODA1' ? 'Concourse outside Hall E (last stop)' : `Aisle ${r.aisle}`;
      callout = `<div class="callout ${r.kind}"><b>${r.kind === 'must' ? 'Must-see' : 'If time'} · ${esc(where)}</b>
        ${isStop ? `Stop ${n} of ${total} on the ${e.day === 1 ? 'Day 1' : 'Day 2'} walk${r.direction && r.direction !== '1 stop' ? ` (${esc(r.direction)})` : ''}` : `Side trip after stop ${n} of ${total}`}
        ${r.note ? `<br>${esc(r.note)}` : ''}
        <div class="steps">${Array.from({ length: total }, (_, k) => `<i class="${k + 1 === n && isStop ? 'now' : k + 1 <= n ? 'past' : ''}"></i>`).join('')}</div></div>`;
    } else if (e.shares) {
      const host = ROUTE[e.day].find(s => s.booth === e.booth);
      callout = `<div class="callout"><b>Same booth as a route stop</b>Booth ${esc(e.booth)} is on your ${e.day === 1 ? 'Day 1' : 'Day 2'} walk (${host ? esc(host.name) + ', ' : ''}aisle ${esc(e.shares.aisle)}${e.shares.label !== 'if time' ? `, stop ${esc(e.shares.label)}` : ', if time'}).</div>`;
    } else if (e.day) {
      const na = nearestAisle(e);
      callout = `<div class="callout"><b>Not on your planned route</b>${na ? `Booth ${esc(e.booth)} is on aisle ${na.aisle}. ${na.near ? (+na.near.aisle === na.aisle ? `You already walk this aisle at stop ${esc(na.near.label)}.` : `Closest route aisle is ${na.near.aisle} (stop ${esc(na.near.label)}).`) : ''}` : ''}</div>`;
    } else {
      const tf = timedFor(e);
      callout = `<div class="callout"><b>No booth on the floor</b>${tf.length ? tf.map(t => `${DAY_TAG[t.day] ?? ''} · ${esc(t.time)}: ${esc(t.what)}. ${esc(t.detail)}`).join('<br>') : esc(e.location || e.area || 'See notes below.')}</div>`;
    }
    const pin = locOf(e.booth);
    const v = isVisited(e);
    const others = EX.filter(x => x.booth === e.booth && x.i !== e.i && /^\d+$|^OD/.test(e.booth));
    const kv = [
      ['Location', [e.location, e.area !== e.location ? e.area : ''].filter(Boolean).join(' · ')],
      ['Contacts', e.contacts], ['Consultant / firm', e.firm], ['Lobbyist tag', e.lobbyist], ['Notes from your emails', e.notes],
    ].filter(x => x[1]);
    const direct = e.emails.map(n => MAIL[n]).filter(Boolean), ment = e.mentions.map(n => MAIL[n]).filter(Boolean);
    let html = `<div class="hero"><h2>${hl(e.name, re)}</h2>
      <div class="hero-grid"><div class="bigbooth ${r ? r.kind : ''}"><small>Booth</small>${esc(e.booth === 'AUSAPavilion' ? 'AUSA Pav.' : e.booth)}</div>
      <div><div class="when">${d ? esc(d.title) : 'Off the floor'}</div><div class="when-sub">${d ? esc(d.floor) : esc(e.location || '')}</div><div class="tags">${placeTags(e)}</div></div></div>
      ${callout}
      <div class="actions">${e.day ? `<button class="btn ${v ? 'done' : 'primary'}" data-check="${e.i}">${v ? '✓ Visited' : 'Mark visited'}</button>` : ''}${pin ? `<button class="btn" data-map="${pin.day}|${esc(e.booth)}|route">Show on map</button>` : ''}</div></div>`;
    if (pin) html += minimap(pin, e.booth, 'route');
    if (kv.length) html += `<div class="section"><h3>Details</h3><dl class="kv">${kv.map(([k, val]) => `<div><dt>${k}</dt><dd>${hl(val, re)}</dd></div>`).join('')}</dl></div>`;
    if (others.length) html += `<div class="section"><h3>Also at booth ${esc(e.booth)} (${others.length})</h3><div class="list">${others.slice(0, 40).map(x => exRow(x, null)).join('')}</div></div>`;
    html += `<div class="section"><h3>Correspondence (${direct.length + ment.length})</h3>`;
    if (!direct.length && !ment.length) html += '<div class="empty" style="padding:16px">No emails about this company.</div>';
    const cre = hlRegex([...tokens(state.q)]);
    html += direct.map(m => mailCard(m, cre, direct.length === 1)).join('');
    if (ment.length) html += `<h3 style="margin-top:12px">Also mentioned in</h3>` + ment.map(m => mailCard(m, cre, false)).join('');
    html += '</div>';
    $('#sheetBody').innerHTML = html;
    $('#sheetBody').scrollTop = 0;
  }
  function openBooth(b) {
    const list = EX.filter(e => e.booth === b);
    if (list.length === 1) return openExhibitor(list[0].i);
    pushSheet('Booth ' + b, () => {
      $('#sheetBody').innerHTML = `<div class="meta">${list.length} exhibitors share booth ${esc(b)}</div><div class="list">${list.sort((a, c) => (c.mine - a.mine) || a.name.localeCompare(c.name)).map(e => exRow(e, null)).join('')}</div>`;
    });
  }
  function openMail(n) {
    const m = MAIL[n];
    pushSheet('Email #' + n, () => { $('#sheetBody').innerHTML = mailCard(m, hlRegex(tokens(state.q)), true); $('#sheetBody').scrollTop = 0; });
  }
  // the minimap (a div) also carries data-map; let the inner button and the box both open the full map
  $('#sheetBody').addEventListener('click', e => {
    const mm = e.target.closest('.minimap');
    if (mm) { const [d, b, layer] = mm.dataset.map.split('|'); showOnMap(+d, b, layer); e.stopPropagation(); }
  });

  /* ============================== boot ============================== */
  try { history.replaceState({ sheet: 0 }, ''); } catch { useHistory = false; }
  const saved = LS.get('ausa-pass', null);
  if (saved) { $('#lock').classList.add('hidden'); unlock(saved, true); }
})();
