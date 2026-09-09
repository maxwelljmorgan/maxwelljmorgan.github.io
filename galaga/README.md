# Galaxy Raider

A Galaga-style arcade shooter built for phones. No build step, no
dependencies — open `index.html` and play.

## Playing

- **Move** — drag anywhere on the screen. The ship moves relative to where
  your finger started, so it never hides under your thumb.
- **Shoot** — auto-fire is on by default. Turn it off in the menu to
  tap-to-fire. On a desktop: arrow keys / WASD, `Space` to fire, `P` or
  `Esc` to pause.
- **Combo** — kills chain while the bar under your score is draining. Every
  five kills adds a multiplier, up to ×8. Going quiet drops it, and so does
  getting hit.
- **Waves** — 12 hand-tuned waves. Clear every raider to advance; diving
  raiders score double. Waves 4, 8 and 12 are boss fights, and after wave
  12 the campaign loops with faster, tougher, higher-HP raiders.
- **Refit** — beating a boss earns two picks from three cards. They stack,
  last the whole run, and drop out of the pool once maxed, so no two runs
  build the same way. Tap a card or press 1-3; `R` spends a reroll.
- **Elites** — raiders ringed in gold take triple damage to kill, are worth
  triple score, and always drop a power-up.
- **Power-ups** — red command craft and armoured gun platforms drop them, as
  do boss escorts. Losing a ship costs you whatever you were carrying.

## Refit

Three cards are drawn after each boss falls, weighted by rarity, from
whatever is not yet capped. You take two of them. Rerolls redraw the three;
you start each run with one.

### Upgrades

| Upgrade | Rarity | Effect | Max |
| --- | --- | --- | --- |
| Spare Ship | Common | One more ship, right now | III |
| Bounty Contract | Common | Kills are worth 15% more | III |
| Chain Extender | Common | Combo window lasts 0.7s longer | III |
| Salvage Crew | Common | Raiders drop power-ups far more often | III |
| Autoloader | Rare | Fire 12% faster | IV |
| Bomb Rack | Rare | Carry one more bomb, and take one now | II |
| Nanoshield | Rare | Your barrier rebuilds itself over time | II |
| Tractor Rig | Rare | Power-ups drift toward your ship | I |
| Targeting Optics | Epic | Boss core hits do +1 damage | II |
| Overdrive | Epic | Combo multiplier caps 2 steps higher | II |
| Escort Contract | Epic | Start every wave with wingmen | I |
| Twin Mount | Epic | Outboard cannons add two bolts to every shot | I |
| Overclock | Epic | At ×6 combo or better, fire 30% faster | I |
| Vengeance | Epic | Losing a ship sets off a smart bomb | I |

### Pacts

Pacts buy power with a real drawback. They sit in the same draw.

| Pact | Gain | Cost |
| --- | --- | --- |
| Blood Money | Kills are worth 60% more | Raiders fire 30% faster |
| Overheat | Fire 30% faster | Combo window is 40% shorter |
| Glass Hull | An extra refit pick right now | Lose a ship, permanently |
| Swarm Pact | Power-up drops are doubled | One more raider dives at a time |

## Hangar

Scrap is the only thing that survives a run — you bank it from score and how
far you reached, then spend it on perks that apply to every run afterwards.

| Perk | Effect | Max |
| --- | --- | --- |
| Reserve Bay | Start with an extra ship | III |
| Munitions Store | Start with a smart bomb in the rack | II |
| Requisition | Start with an extra refit reroll | II |
| Shakedown Run | Take one refit pick before wave 1 | I |
| Salvage Rights | Earn 25% more scrap per run | II |

Practice runs started with `?wave=N` bank no scrap and set no records.

## Power-ups

Weapons are exclusive — picking one up replaces the one you have. Everything
else stacks on top. Smart bombs are held rather than spent on pickup, and
they survive losing a ship; every other effect is lost with it.

| | Power-up | Effect |
| --- | --- | --- |
| `II` | Twin laser | Two parallel bolts |
| `W` | Spread laser | Three bolts in a fan; good against divers |
| `L` | Hyper laser | Fires slower, but each bolt runs clean through a column |
| `R` | Rapid fire | Roughly double the fire rate |
| `S` | Barrier | Absorbs one hit |
| `V` | Wingmen | Two drones fly your flanks and fire with you |
| `B` | Smart bomb | Stocks up to three. Tap the bomb button (or `B`) to clear every shot on screen and hit every raider at once |
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

Every boss carries an exposed core, seated in a dark housing and beating
faster as its armour fails. Hits on the core do double damage — it is a
small, constantly moving target, so aiming for it is the difference between
a long fight and a short one.

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
