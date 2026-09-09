# Galaxy Raider

A Galaga-style arcade shooter built for phones. No build step, no
dependencies — open `index.html` and play.

## Playing

- **Move** — drag anywhere on the screen. The ship moves relative to where
  your finger started, so it never hides under your thumb.
- **Shoot** — auto-fire is on by default. Turn it off in the menu to
  tap-to-fire. On a desktop: arrow keys / WASD, `Space` to fire, `P` or
  `Esc` to pause.
- **Waves** — 12 hand-tuned waves. Clear every raider to advance; diving
  raiders score double. Waves 4, 8 and 12 are boss fights, and after wave
  12 the campaign loops with faster, tougher, higher-HP raiders.
- **Power-ups** — gold commanders and boss escorts drop twin cannon, rapid
  fire, shields, and the occasional extra ship.

## Bosses

| Wave | Boss | Signature attacks |
| ---- | ---- | ----------------- |
| 4 | Sentinel | Aimed fans, strafing bursts, a tracking beam that locks on after it charges |
| 8 | Hive Queen | Radial bullet rings, bullet curtains, a tractor beam that drags you upward |
| 12 | Dreadnought | Bullet walls with a single gap, homing missiles, a sweeping laser |

Each boss has three phases; armour breaches at 60% and 30% health reset its
attack script and clear the screen of shots.

## Files

| File | Purpose |
| ---- | ------- |
| `index.html` | Canvas, HUD and the menu / pause / game-over screens |
| `galaga.css` | Layout and screen styling, safe-area aware |
| `galaga.js` | The whole game: paths, waves, bosses, rendering, audio |
| `manifest.json`, `icon.svg` | Add-to-home-screen support |

Scores and settings live in `localStorage`; sound effects are synthesised
with the Web Audio API, so there are no assets to download.

`?wave=N` starts a run at that wave — handy for trying a boss fight.
Practice runs like that are excluded from the saved records.
