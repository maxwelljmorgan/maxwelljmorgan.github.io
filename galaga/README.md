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
- **Power-ups** — red command craft and armoured gun platforms drop them, as
  do boss escorts. Losing a ship costs you whatever you were carrying.

## Power-ups

Weapons are exclusive — picking one up replaces the one you have. Everything
else stacks on top.

| | Power-up | Effect |
| --- | --- | --- |
| `II` | Twin laser | Two parallel bolts |
| `W` | Spread laser | Three bolts in a fan; good against divers |
| `L` | Hyper laser | Fires slower, but each bolt runs clean through a column |
| `R` | Rapid fire | Roughly double the fire rate |
| `S` | Barrier | Absorbs one hit |
| `V` | Wingmen | Two drones fly your flanks and fire with you |
| `B` | Smart bomb | Instant: clears every shot on screen and hits every raider at once |
| `T` | Time warp | Instant: raiders and their fire run at 40% for six seconds — you don't |
| `1` | Extra life | Rare |

Active effects show as badges in the HUD with their remaining seconds.

## Bosses

| Wave | Boss | Signature attacks |
| ---- | ---- | ----------------- |
| 4 | Sentinel | Aimed fans, strafing bursts, a tracking beam that locks on after it charges |
| 8 | Hive Queen | Radial bullet rings, bullet curtains, a tractor beam that drags you upward |
| 12 | Dreadnought | Bullet walls with a single gap, homing missiles, a sweeping laser |

Each boss has three phases; armour breaches at 60% and 30% health reset its
attack script and clear the screen of shots.

## Art direction

Everything is drawn procedurally with canvas paths — there are no image
assets. The look is an original take on the Star Fox visual language: a
white delta-wing fighter with blue wings, wingtip fins and twin engine
flares; green laser tracers; wingmen flying your flanks in squadron
colours; angular enemy craft ranked yellow / green / red; and bosses built
as war machines with an exposed weak-point core that beats faster as their
armour fails.

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
