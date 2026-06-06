/* ============================================================================
   SEQUENCE — UI + networking layer. Game rules live in engine.js (window.SEQ).
   Two modes: Pass & Play (local) and Online (WebRTC via PeerJS, no backend).
   ========================================================================== */
(() => {
  'use strict';

  const SEQ = window.SEQ;
  const {
    LAYOUT, SIZE, TWO_EYED, ONE_EYED, CARD_POSITIONS,
    normalizeBoardCode, isCorner, suitOf, rankOf, isJack,
    newGame, applyMove, viewFor, validTargets
  } = SEQ;

  /* ---------------------- DISPLAY HELPERS ---------------------- */
  const SUIT_SYMBOL = { S: "♠", H: "♥", D: "♦", C: "♣" };
  const RED_SUITS = new Set(["H", "D"]);
  const isRedSuit = s => RED_SUITS.has(s);

  const PLAYERS = [
    { name: "Player 1", color: "#2563eb", cls: "p0" }, // blue
    { name: "Player 2", color: "#dc2626", cls: "p1" }  // red
  ];

  /* ---------------------- DOM REFERENCES ---------------------- */
  const $ = sel => document.querySelector(sel);
  const screens = {
    menu: $("#screen-menu"),
    create: $("#screen-create"),
    join: $("#screen-join"),
    game: $("#screen-game"),
  };
  const boardEl = $("#board");
  const handEl = $("#hand");
  const turnBanner = $("#turn-banner");
  const deckCountEl = $("#deck-count");
  const oppInfoEl = $("#opp-info");
  const youInfoEl = $("#you-info");
  const hintEl = $("#hint");
  const passOverlay = $("#pass-overlay");
  const passText = $("#pass-text");
  const winOverlay = $("#win-overlay");
  const winText = $("#win-text");
  const netOverlay = $("#net-overlay");
  const netText = $("#net-text");

  function showScreen(name) {
    for (const k in screens) screens[k].classList.toggle("active", k === name);
  }

  /* ---------------------- SESSION STATE ---------------------- */
  const App = {
    mode: null,        // 'local' | 'online'
    game: null,        // authoritative engine state (local mode & online host)
    role: null,        // 'host' | 'guest'
    myIndex: 0,        // which player index this device controls
    view: null,        // current render view
    selectedCard: null,
    targets: [],
    peer: null,
    conn: null,
    roomCode: null,
  };

  /* ---------------------- BUILD BOARD DOM ---------------------- */
  const cellEls = [];
  function buildBoardDOM() {
    boardEl.innerHTML = "";
    cellEls.length = 0;
    for (let r = 0; r < SIZE; r++) {
      const rowArr = [];
      for (let c = 0; c < SIZE; c++) {
        const cell = document.createElement("div");
        cell.className = "cell";
        if (isCorner(r, c)) {
          cell.classList.add("corner");
          cell.innerHTML = `<span class="corner-star">★</span>`;
        } else {
          const code = normalizeBoardCode(LAYOUT[r][c]);
          const red = isRedSuit(suitOf(code));
          cell.innerHTML =
            `<span class="cell-label ${red ? "red" : "black"}">` +
              `<span class="cl-rank">${rankOf(code)}</span>` +
              `<span class="cl-suit">${SUIT_SYMBOL[suitOf(code)]}</span>` +
            `</span><span class="chip"></span>`;
        }
        cell.addEventListener("click", () => onCellTap(r, c));
        boardEl.appendChild(cell);
        rowArr.push(cell);
      }
      cellEls.push(rowArr);
    }
  }

  /* ---------------------- RENDERING ---------------------- */
  function render() {
    const v = App.view;
    if (!v) return;

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = cellEls[r][c];
        if (isCorner(r, c)) continue;
        const chip = cell.querySelector(".chip");
        const owner = v.chips[r][c];
        cell.classList.toggle("filled", owner !== null);
        chip.className = "chip";
        if (owner !== null) chip.classList.add(PLAYERS[owner].cls);
        cell.classList.toggle("in-seq", !!v.seq[r][c]);
        cell.classList.remove("valid", "removable", "last");
      }
    }

    for (const t of App.targets) {
      cellEls[t.r][t.c].classList.add(t.kind === "remove" ? "removable" : "valid");
    }

    if (v.lastMove && (v.lastMove.type === "place" || v.lastMove.type === "remove")) {
      const cell = cellEls[v.lastMove.r] && cellEls[v.lastMove.r][v.lastMove.c];
      if (cell) cell.classList.add("last");
    }

    const isMyTurn = v.current === v.yourIndex;
    const me = PLAYERS[v.yourIndex];
    const opp = PLAYERS[1 - v.yourIndex];
    deckCountEl.textContent = v.deckCount;
    oppInfoEl.innerHTML =
      `<span class="dot" style="background:${opp.color}"></span>` +
      `${labelFor(1 - v.yourIndex)} · ${v.oppHandCount}🂠`;
    youInfoEl.innerHTML =
      `<span class="dot" style="background:${me.color}"></span>` +
      `${labelFor(v.yourIndex)}${App.mode === "online" ? " (you)" : ""} · ${v.yourHand.length}🂠`;

    if (v.winner !== null) {
      turnBanner.textContent = "Game over";
      turnBanner.style.background = PLAYERS[v.winner].color;
    } else {
      turnBanner.textContent = isMyTurn && App.mode === "online" ? "Your turn"
        : `${labelFor(v.current)}'s turn`;
      turnBanner.style.background = PLAYERS[v.current].color;
    }

    renderHand();
    renderHint();
  }

  function labelFor(index) {
    if (App.mode === "online") return index === App.myIndex ? "You" : "Opponent";
    return PLAYERS[index].name;
  }

  function renderHand() {
    const v = App.view;
    handEl.innerHTML = "";
    const isMyTurn = v.current === v.yourIndex && v.winner === null;
    v.yourHand.forEach((card, i) => {
      const el = document.createElement("button");
      el.className = "card";
      const suit = suitOf(card);
      el.classList.add(isRedSuit(suit) ? "red" : "black");
      let badge = "";
      if (TWO_EYED.has(card)) { el.classList.add("jack-place"); badge = `<span class="jbadge">WILD +</span>`; }
      if (ONE_EYED.has(card)) { el.classList.add("jack-remove"); badge = `<span class="jbadge">WILD −</span>`; }

      const isDead = !isJack(card) &&
        (CARD_POSITIONS[card] || []).every(([r, c]) => v.chips[r][c] !== null) &&
        (CARD_POSITIONS[card] || []).length > 0;
      if (isDead) el.classList.add("dead");

      el.innerHTML =
        `<span class="card-rank">${rankOf(card)}</span>` +
        `<span class="card-suit">${SUIT_SYMBOL[suit]}</span>` +
        badge + (isDead ? `<span class="dead-tag">DEAD ↻</span>` : "");

      if (App.selectedCard === i) el.classList.add("selected");
      el.disabled = !isMyTurn;
      el.addEventListener("click", () => onCardTap(i, isDead));
      handEl.appendChild(el);
    });
  }

  function renderHint() {
    const v = App.view;
    if (v.winner !== null) { hintEl.textContent = ""; return; }
    if (v.current !== v.yourIndex) {
      hintEl.textContent = App.mode === "online" ? "Waiting for opponent…" : "";
      return;
    }
    if (App.selectedCard === null) {
      hintEl.textContent = "Tap a card to see where you can play it.";
      return;
    }
    const card = v.yourHand[App.selectedCard];
    if (TWO_EYED.has(card)) hintEl.textContent = "Wild Jack: tap any empty space.";
    else if (ONE_EYED.has(card)) hintEl.textContent = "Anti-wild Jack: tap an opponent chip to remove.";
    else if (App.targets.length === 0) hintEl.textContent = "No open space — tap the card to swap it (dead card).";
    else hintEl.textContent = "Tap a glowing space to place your chip.";
  }

  /* ---------------------- INPUT HANDLERS ---------------------- */
  function onCardTap(i, isDead) {
    const v = App.view;
    if (!v || v.winner !== null || v.current !== v.yourIndex) return;

    if (isDead) { doMove({ kind: "exchange", cardIndex: i }); return; }

    if (App.selectedCard === i) {
      App.selectedCard = null;
      App.targets = [];
    } else {
      App.selectedCard = i;
      App.targets = computeTargets(v.yourHand[i], v);
    }
    render();
  }

  // Targets are derived purely from the view's board, so guests highlight too.
  function computeTargets(card, v) {
    return validTargets(v, card, v.yourIndex);
  }

  function onCellTap(r, c) {
    const v = App.view;
    if (!v || v.winner !== null || v.current !== v.yourIndex || App.selectedCard === null) return;
    const t = App.targets.find(t => t.r === r && t.c === c);
    if (!t) return;
    doMove({ kind: t.kind, cardIndex: App.selectedCard, r, c });
  }

  // Route the move: authoritative (local engine / online host) or guest→host.
  function doMove(move) {
    if (App.mode === "local" || App.role === "host") {
      const actor = App.mode === "local" ? App.game.current : 0;
      const res = applyMove(App.game, actor, move);
      if (!res.ok) { flashHint(res.error); return; }
      App.selectedCard = null;
      App.targets = [];
      afterAuthoritativeMove(res);
    } else {
      send({ t: "move", move });
      App.selectedCard = null;
      App.targets = [];
    }
  }

  function afterAuthoritativeMove(res) {
    const g = App.game;

    if (App.mode === "online" && App.role === "host") {
      sendStateToGuest();
      App.view = viewFor(g, 0);
      render();
      checkWin();
      return;
    }

    // LOCAL mode
    if (g.winner !== null) {
      App.view = viewFor(g, g.winner);
      render();
      checkWin();
      return;
    }
    if (res.keepTurn) {                 // dead-card swap: same player continues
      App.view = viewFor(g, g.current);
      render();
      return;
    }
    // Turn passed — hide hand behind the "pass device" screen.
    App.view = viewFor(g, g.current);
    render();
    showPassScreen(g.current);
  }

  function flashHint(msg) {
    hintEl.textContent = msg;
    hintEl.classList.add("flash");
    setTimeout(() => hintEl.classList.remove("flash"), 700);
  }

  /* ---------------------- PASS-AND-PLAY OVERLAY ---------------------- */
  function showPassScreen(nextPlayer) {
    passText.innerHTML =
      `<span class="dot big" style="background:${PLAYERS[nextPlayer].color}"></span>` +
      `Pass to <b>${PLAYERS[nextPlayer].name}</b>`;
    passOverlay.classList.add("active");
  }
  $("#pass-ready").addEventListener("click", () => {
    passOverlay.classList.remove("active");
    App.selectedCard = null; App.targets = [];
    App.view = viewFor(App.game, App.game.current);
    render();
  });

  /* ---------------------- WIN SCREEN ---------------------- */
  function checkWin() {
    const v = App.view;
    if (!v || v.winner === null) return;
    let msg;
    if (App.mode === "online") msg = v.winner === App.myIndex ? "🎉 You win!" : "Opponent wins";
    else msg = `🎉 ${PLAYERS[v.winner].name} wins!`;
    winText.innerHTML =
      `<span class="dot big" style="background:${PLAYERS[v.winner].color}"></span>${msg}`;
    winOverlay.classList.add("active");
  }
  $("#win-again").addEventListener("click", () => {
    winOverlay.classList.remove("active");
    if (App.mode === "local") startLocal();
    else if (App.role === "host") {
      App.game = newGame();
      App.view = viewFor(App.game, 0);
      App.selectedCard = null; App.targets = [];
      sendStateToGuest();
      render();
    } else flashHint("Waiting for host to start a new game…");
  });
  $("#win-menu").addEventListener("click", () => {
    winOverlay.classList.remove("active");
    teardownNet();
    showScreen("menu");
  });

  /* ---------------------- LOCAL START ---------------------- */
  function startLocal() {
    App.mode = "local";
    App.role = null;
    App.game = newGame();
    App.selectedCard = null; App.targets = [];
    App.view = viewFor(App.game, App.game.current);
    showScreen("game");
    render();
  }

  /* ---------------------- ONLINE (PeerJS) ---------------------- */
  const PEER_PREFIX = "seqgame-v1-";
  function randomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
    let s = "";
    for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  // Load PeerJS from a vendored copy if present, otherwise fall back across CDNs.
  function ensurePeerLib() {
    const sources = [
      "peerjs.min.js", // vendored (optional)
      "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js",
      "https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js"
    ];
    return new Promise((resolve, reject) => {
      if (window.Peer) return resolve();
      let i = 0;
      const tryNext = () => {
        if (window.Peer) return resolve();
        if (i >= sources.length) return reject(new Error("Could not load networking library (offline?)."));
        const s = document.createElement("script");
        s.src = sources[i++];
        s.onload = () => (window.Peer ? resolve() : tryNext());
        s.onerror = tryNext;
        document.head.appendChild(s);
      };
      tryNext();
    });
  }

  async function hostGame() {
    showScreen("create");
    $("#create-status").textContent = "Connecting…";
    $("#room-code").textContent = "······";
    try { await ensurePeerLib(); }
    catch (e) { $("#create-status").textContent = e.message; return; }

    App.mode = "online"; App.role = "host"; App.myIndex = 0;
    createHostPeer();
  }

  function createHostPeer() {
    App.roomCode = randomCode();
    if (App.peer) { try { App.peer.destroy(); } catch (_) {} }
    App.peer = new Peer(PEER_PREFIX + App.roomCode);
    App.peer.on("open", () => {
      $("#room-code").textContent = App.roomCode;
      $("#create-status").textContent = "Waiting for Player 2 to join…";
    });
    App.peer.on("connection", (conn) => { App.conn = conn; wireConn(conn, true); });
    App.peer.on("error", (err) => {
      if (err.type === "unavailable-id") createHostPeer(); // code clash → retry
      else $("#create-status").textContent = "Network error: " + err.type;
    });
  }

  async function joinGame(code) {
    showScreen("game");
    netText.textContent = "Connecting to room " + code + "…";
    $("#net-retry").style.display = "none";
    netOverlay.classList.add("active");
    try { await ensurePeerLib(); }
    catch (e) { netText.textContent = e.message; $("#net-retry").style.display = "inline-block"; return; }

    App.mode = "online"; App.role = "guest"; App.myIndex = 1; App.roomCode = code;
    if (App.peer) { try { App.peer.destroy(); } catch (_) {} }
    App.peer = new Peer();
    App.peer.on("open", () => {
      const conn = App.peer.connect(PEER_PREFIX + code, { reliable: true });
      App.conn = conn;
      wireConn(conn, false);
    });
    App.peer.on("error", (err) => {
      netText.innerHTML = "Could not connect (" + err.type + ").<br>Check the code and try again.";
      $("#net-retry").style.display = "inline-block";
    });
  }

  function wireConn(conn, isHost) {
    conn.on("open", () => {
      if (isHost) {
        App.game = newGame();
        App.selectedCard = null; App.targets = [];
        App.view = viewFor(App.game, 0);
        showScreen("game");
        netOverlay.classList.remove("active");
        render();
        send({ t: "state", view: viewFor(App.game, 1) });
      } else {
        netOverlay.classList.remove("active");
        netText.textContent = "";
        $("#net-retry").style.display = "none";
      }
    });
    conn.on("data", (msg) => onNetMessage(msg, isHost));
    conn.on("close", onDisconnect);
    conn.on("error", onDisconnect);
  }

  function onNetMessage(msg, isHost) {
    if (!msg || typeof msg !== "object") return;
    if (isHost) {
      if (msg.t === "move") {
        const res = applyMove(App.game, 1, msg.move); // guest is player 1
        if (!res.ok) { send({ t: "reject", error: res.error }); return; }
        sendStateToGuest();
        App.view = viewFor(App.game, 0);
        render();
        checkWin();
      } else if (msg.t === "hello") {
        send({ t: "state", view: viewFor(App.game, 1) }); // resync after reconnect
      }
    } else {
      if (msg.t === "state") {
        App.view = msg.view;
        if (App.selectedCard !== null && App.view.yourHand[App.selectedCard]) {
          App.targets = computeTargets(App.view.yourHand[App.selectedCard], App.view);
        } else {
          App.selectedCard = null; App.targets = [];
        }
        render();
        checkWin();
      } else if (msg.t === "reject") {
        App.selectedCard = null; App.targets = [];
        flashHint(msg.error || "Move rejected.");
        render();
      }
    }
  }

  function sendStateToGuest() { send({ t: "state", view: viewFor(App.game, 1) }); }
  function send(obj) { try { if (App.conn && App.conn.open) App.conn.send(obj); } catch (_) {} }

  function onDisconnect() {
    if (App.mode !== "online") return;
    netText.innerHTML = "Connection lost.<br>Trying to reconnect…";
    netOverlay.classList.add("active");
    $("#net-retry").style.display = "inline-block";
    if (App.role === "guest" && App.peer && !App.peer.destroyed) {
      setTimeout(() => {
        if (!App.conn || !App.conn.open) {
          try {
            const conn = App.peer.connect(PEER_PREFIX + App.roomCode, { reliable: true });
            App.conn = conn;
            conn.on("open", () => send({ t: "hello" }));
            wireConn(conn, false);
          } catch (_) {}
        }
      }, 1500);
    }
  }

  function teardownNet() {
    try { if (App.conn) App.conn.close(); } catch (_) {}
    try { if (App.peer) App.peer.destroy(); } catch (_) {}
    App.conn = null; App.peer = null;
    App.mode = null; App.role = null;
    netOverlay.classList.remove("active");
  }

  /* ---------------------- MENU WIRING ---------------------- */
  $("#btn-local").addEventListener("click", startLocal);
  $("#btn-create").addEventListener("click", hostGame);
  $("#btn-join").addEventListener("click", () => showScreen("join"));
  $("#btn-rules").addEventListener("click", () => $("#rules").classList.add("active"));
  $("#rules-close").addEventListener("click", () => $("#rules").classList.remove("active"));
  $("#create-back").addEventListener("click", () => { teardownNet(); showScreen("menu"); });
  $("#join-back").addEventListener("click", () => showScreen("menu"));

  $("#copy-code").addEventListener("click", async () => {
    const url = location.origin + location.pathname + "?room=" + App.roomCode;
    try {
      await navigator.clipboard.writeText(url);
      $("#copy-code").textContent = "Link copied!";
      setTimeout(() => ($("#copy-code").textContent = "Copy invite link"), 1500);
    } catch (_) {
      $("#copy-code").textContent = "Code: " + App.roomCode;
    }
  });

  const codeInput = $("#code-input");
  codeInput.addEventListener("input", () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  });
  $("#join-go").addEventListener("click", () => {
    const code = codeInput.value.trim().toUpperCase();
    if (code.length !== 6) { $("#join-error").textContent = "Enter the 6-character code."; return; }
    $("#join-error").textContent = "";
    joinGame(code);
  });
  $("#net-retry").addEventListener("click", () => { if (App.role === "guest" && App.roomCode) joinGame(App.roomCode); });
  $("#net-menu").addEventListener("click", () => { teardownNet(); showScreen("menu"); });
  $("#game-menu").addEventListener("click", () => {
    if (confirm("Leave the current game and return to the menu?")) { teardownNet(); showScreen("menu"); }
  });

  /* ---------------------- BOOT ---------------------- */
  buildBoardDOM();
  const params = new URLSearchParams(location.search);
  const roomParam = (params.get("room") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  if (roomParam.length === 6) { showScreen("join"); codeInput.value = roomParam; }
  else showScreen("menu");
})();
