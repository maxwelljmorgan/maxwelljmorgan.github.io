# Sequence

A complete, mobile-first, fully playable implementation of the board game **Sequence**.

Open `index.html` (or visit `/sequence/` on the deployed site). No build step, no server to run.

## Modes
- **Pass & Play** — two players share one device. A "Pass to Player X" screen hides the
  hand between turns.
- **Online** — Player 1 taps *Create Online Game* to get a 6-character room code; Player 2
  enters it (or opens the shared `?room=CODE` link). State syncs in real time over
  **WebRTC (PeerJS)** — no backend to deploy. Disconnects show a reconnect prompt.

## How it plays
- 10×10 board, standard layout (every non-Jack card appears twice; four ★ free corners).
- Two 52-card decks shuffled together; 7 cards dealt to each player; draw after every turn.
- Tap a card to **highlight** every legal space, then tap a glowing space to drop a chip.
- **Two-eyed Jacks** (♦ ♣) are wild — place anywhere empty.
- **One-eyed Jacks** (♠ ♥) remove an opponent chip (not one locked in a finished sequence).
- **Dead cards** (both board spaces occupied) can be tapped to swap for a fresh card.
- First to **5 in a row** (horizontal, vertical, or diagonal; corners count as wild) wins.

## Files
- `index.html` — markup and screens
- `sequence.css` — mobile-first styling (board scales to the viewport)
- `engine.js` — pure, DOM-free game rules (`window.SEQ`); unit-tested
- `sequence.js` — UI rendering, input, and the online (PeerJS) networking layer
