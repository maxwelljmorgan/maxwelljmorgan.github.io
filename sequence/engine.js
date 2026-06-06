/* ============================================================================
   SEQUENCE — pure game engine. No DOM. Works in the browser (window.SEQ) and
   in Node (module.exports) so the rules can be unit-tested directly.
   ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SEQ = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // "T" = ten (compact); "BON" = free corner. Verified: every non-Jack card
  // appears exactly twice, four corners, 100 cells total.
  const LAYOUT = [
    ["BON","2S","3S","4S","5S","6S","7S","8S","9S","BON"],
    ["6C","5C","4C","3C","2C","AH","KH","QH","TH","TS"],
    ["7C","AS","2D","3D","4D","5D","6D","7D","9H","QS"],
    ["8C","KS","6C","5C","4C","3C","2C","8D","8H","KS"],
    ["9C","QS","7C","6H","5H","4H","AH","9D","7H","AS"],
    ["TC","TS","8C","7H","2H","3H","KH","TD","6H","2D"],
    ["QC","9S","9C","8H","9H","TH","QH","QD","5H","3D"],
    ["KC","8S","TC","QC","KC","AC","AD","KD","4H","4D"],
    ["AC","7S","6S","5S","4S","3S","2S","2H","3H","5D"],
    ["BON","AD","KD","QD","TD","9D","8D","7D","6D","BON"]
  ];
  const SIZE = 10;
  const HAND_SIZE = 7;

  const TWO_EYED = new Set(["JD", "JC"]); // wild PLACE
  const ONE_EYED = new Set(["JS", "JH"]); // wild REMOVE
  const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

  function normalizeBoardCode(code) {
    return code[0] === "T" ? "10" + code.slice(1) : code;
  }
  function isCorner(r, c) { return LAYOUT[r][c] === "BON"; }
  function suitOf(card) { return card.slice(-1); }
  function rankOf(card) { return card.slice(0, -1); }
  function isJack(card) { return rankOf(card) === "J"; }

  // Map each non-Jack card → its (two) board cells.
  const CARD_POSITIONS = {};
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    const code = LAYOUT[r][c];
    if (code === "BON") continue;
    const norm = normalizeBoardCode(code);
    (CARD_POSITIONS[norm] || (CARD_POSITIONS[norm] = [])).push([r, c]);
  }

  function buildDeck() {
    const ranks = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
    const suits = ["S","H","D","C"];
    const deck = [];
    for (let d = 0; d < 2; d++)
      for (const s of suits) for (const rk of ranks) deck.push(rk + s);
    return deck;
  }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function newGame() {
    const deck = shuffle(buildDeck());
    const hands = [[], []];
    for (let i = 0; i < HAND_SIZE; i++) { hands[0].push(deck.pop()); hands[1].push(deck.pop()); }
    return {
      chips: Array.from({ length: SIZE }, () => Array(SIZE).fill(null)),
      seq: Array.from({ length: SIZE }, () => Array(SIZE).fill(false)),
      hands, deck, discard: [],
      current: 0, winner: null, winningCells: null, lastMove: null
    };
  }

  function drawCard(g) {
    if (g.deck.length === 0) {
      if (g.discard.length === 0) return null;
      g.deck = shuffle(g.discard); g.discard = [];
    }
    return g.deck.pop();
  }

  function cellMatches(g, r, c, p) {
    if (r < 0 || c < 0 || r >= SIZE || c >= SIZE) return false;
    if (isCorner(r, c)) return true;        // corners are wild for everyone
    return g.chips[r][c] === p;
  }

  function findSequence(g, r, c, p) {
    for (const [dr, dc] of DIRS) {
      const run = [[r, c]];
      let rr = r - dr, cc = c - dc;
      while (cellMatches(g, rr, cc, p)) { run.unshift([rr, cc]); rr -= dr; cc -= dc; }
      rr = r + dr; cc = c + dc;
      while (cellMatches(g, rr, cc, p)) { run.push([rr, cc]); rr += dr; cc += dc; }
      if (run.length >= 5) {
        const idx = run.findIndex(([a, b]) => a === r && b === c);
        // window of 5 that contains the placed cell
        const start = Math.max(0, Math.min(idx, run.length - 5));
        return run.slice(start, start + 5);
      }
    }
    return null;
  }

  function isDeadCard(g, card) {
    if (isJack(card)) return false;
    const pos = CARD_POSITIONS[card] || [];
    return pos.length > 0 && pos.every(([r, c]) => g.chips[r][c] !== null);
  }

  function validTargets(g, card, p) {
    const out = [];
    if (TWO_EYED.has(card)) {
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++)
        if (!isCorner(r, c) && g.chips[r][c] === null) out.push({ r, c, kind: "place" });
    } else if (ONE_EYED.has(card)) {
      const opp = 1 - p;
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++)
        if (g.chips[r][c] === opp && !g.seq[r][c]) out.push({ r, c, kind: "remove" });
    } else {
      for (const pos of (CARD_POSITIONS[card] || []))
        if (g.chips[pos[0]][pos[1]] === null) out.push({ r: pos[0], c: pos[1], kind: "place" });
    }
    return out;
  }

  function applyMove(g, p, move) {
    if (g.winner !== null) return { ok: false, error: "Game is over." };
    if (g.current !== p) return { ok: false, error: "Not your turn." };
    const card = g.hands[p][move.cardIndex];
    if (card === undefined) return { ok: false, error: "Invalid card." };

    if (move.kind === "exchange") {
      if (!isDeadCard(g, card)) return { ok: false, error: "That card is not dead." };
      g.hands[p].splice(move.cardIndex, 1);
      g.discard.push(card);
      const drawn = drawCard(g);
      if (drawn) g.hands[p].push(drawn);
      g.lastMove = { player: p, type: "exchange", card };
      return { ok: true, keepTurn: true };
    }

    const legal = validTargets(g, card, p)
      .some(t => t.r === move.r && t.c === move.c && t.kind === move.kind);
    if (!legal) return { ok: false, error: "Illegal move." };

    if (move.kind === "remove") g.chips[move.r][move.c] = null;
    else g.chips[move.r][move.c] = p;

    g.hands[p].splice(move.cardIndex, 1);
    g.discard.push(card);

    if (move.kind === "place") {
      const win = findSequence(g, move.r, move.c, p);
      if (win) {
        for (const [r, c] of win) g.seq[r][c] = true;
        g.winner = p; g.winningCells = win;
      }
    }

    const drawn = drawCard(g);
    if (drawn) g.hands[p].push(drawn);

    g.lastMove = { player: p, type: move.kind, r: move.r, c: move.c, card };
    if (g.winner === null) g.current = 1 - p;
    return { ok: true };
  }

  function viewFor(g, p) {
    return {
      chips: g.chips.map(row => row.slice()),
      seq: g.seq.map(row => row.slice()),
      yourIndex: p,
      yourHand: g.hands[p].slice(),
      oppHandCount: g.hands[1 - p].length,
      deckCount: g.deck.length,
      current: g.current,
      winner: g.winner,
      winningCells: g.winningCells,
      lastMove: g.lastMove
    };
  }

  return {
    LAYOUT, SIZE, HAND_SIZE, TWO_EYED, ONE_EYED, CARD_POSITIONS,
    normalizeBoardCode, isCorner, suitOf, rankOf, isJack,
    buildDeck, shuffle, newGame, drawCard, cellMatches,
    findSequence, isDeadCard, validTargets, applyMove, viewFor
  };
});
