# Wildbound

Wildbound is an original browser survival game about living as a lone wolf, inspired by the original DOS wolf game from the 1990s. Explore a hand-crafted procedural forest, read the wind, track prey, manage needs, hunt, rest, and decide when to eat or preserve scarce meat.

## Play

[Play Wildbound in your browser](https://wildbound.kunini.ru/)

![Wildbound gameplay: a wolf by a forest stream](Screenshot%202026-10-17%20at%2010.20.34.png)

1. Open the game, choose a difficulty, and press `START`.
2. Explore quietly, use wind and scent to find prey, and only sprint when the moment is right.
3. Eat what you need, cache the rest, and rest before exhaustion catches up with you.

## The world

The 1.024 × 1.024 km forest contains clearings, paths, rivers, streams, pools, wetlands, berry patches, windfall, rocks, and dense cover. Day, night, wind, water, obstacles, animal needs, and populations continue to evolve whether the wolf is moving or resting.

You share the territory with rabbits, deer, elk, and boar. Each species has distinct movement, feeding, drinking, resting, escape, tracks, scent, endurance, and carcass behaviour. Prey can see, hear, and smell the wolf; trees, rocks, logs, and terrain block sight, while wind carries scent downwind.

## Tracking, hunting, and survival

- **Scent and sound:** press `Q` to read scent. The off-screen senses HUD keeps signals in eight fixed directions: blue lines are scent, amber arcs are sound, and a longer line beneath either icon means a stronger signal. Wind stretches airborne scent downwind, so approaching from the right direction matters.
- **Stealth and pursuit:** sneak to reduce sound and visual movement. Sprinting is powerful but spends endurance and builds recovery debt; exhausted prey slows over a long chase, but can escape a careless wolf.
- **Hunting:** mark a living target with a left-click, use `E` to attack when close, and account for wounds and defensive behaviour. Deer can kick, while boar may countercharge at close range.
- **Food and caches:** `E` eats, carries, or buries meat according to context. Buried caches last much longer than exposed carrion, while territory marks can help protect nearby stores.
- **Rest and recovery:** hunger, thirst, stamina, injuries, and time of day shape every decision. Use `R` to rest, or `T REST UNTIL HEALED` when it becomes available.

## Difficulty

`SURVIVAL` is the intended default: prey and meat are scarcer, every third day is lean, and disturbed areas take time to recover. `EXPLORER` provides a more forgiving population, recovery, and caching experience. `FULL RESET` starts a fresh life from the main menu.

## Controls

| Input | Action |
| --- | --- |
| `WASD` | Move |
| Left-click a living animal | Mark it and highlight its scent trail |
| `Shift` | Sprint; burst out of stealth when sneaking |
| `C` | Toggle sneaking |
| `E` | Attack, eat, drink, carry, or bury meat contextually |
| `Q` | Scent mode |
| `M` | Leave a territory mark |
| `N` | Toggle forest audio (also available in the pause menu) |
| `R` | Lie down to rest |
| `F5` / `F9` | Save / load |
| Mouse wheel | Zoom the camera |
| `Space` / `Esc` | Pause |

`LOG MODE`, available from the main menu or pause menu, records significant prey awareness and hunt events without interrupting play. The game autosaves every 30 seconds; saves remain in the browser.

The forest has a continuous wind soundscape, occasional birds during daylight, and changing gusts. Flowing water grows louder near rivers and streams and fades with distance. Audio pauses with gameplay or when the tab is hidden; your mute preference is saved in the browser. Browsers may require a click or keypress to enable sound. The synthesized wind and nature recordings are freely reusable under CC0; see [audio credits](public/assets/audio/CREDITS.md).

Wind strength controls its volume, playback speed, gust frequency, and the speed and amount of tree movement. A separate leaf-rustling layer fades in within 40 m of trees and becomes stronger in wind. Try the [forest sound testground](audio.html) to compare calm and strong wind, change your distance from a grove, isolate each sound layer, or follow the game's wind cycle. The testground uses the gameplay systems without reading or writing your save or sound preferences.

Wildlife audio includes wolf paws/howls, rabbit paired hops/alarm thumps, deer light
hooves/bellows, elk heavy hooves/bugles, and boar short heavy steps/grunts. Footstep
cadence follows actual movement speed, not animation or accelerated world time.
Stationary and dead animals do not step; calls occur occasionally while stationary
(rabbit thumps only on an alarm transition). Player howls follow the existing
pack howl action, which remains feature-gated. All sounds use distance attenuation,
stereo positioning, the same N mute/pause/hidden-tab controls, and a bounded
16-voice mixer with at most two simultaneous calls. This does not alter the
gameplay hearing/scent HUD or AI detection ranges.

The [audio field lab](audio.html) adds species, behavior, speed, distance, bearing,
automatic pass-by, an eight-animal crowd test, isolated movement/call toggles,
manual call/step audition and actual voice diagnostics. Press Play, then Solo
wildlife to compare animals without ambient layers. Movement runs in place at
the chosen speed; pass-by tests moving sound placement separately.
Animal sounds combine CC0 assets, an attributed CC BY 4.0 elk recording and
recorded movement: dog paws and horse hooves on grass, plus small-animal ground
Foley. These are adapted stand-ins rather than field recordings of every species;
see [animal credits and rebuild instructions](public/assets/audio/animals/CREDITS.md).

## Release history

See [CHANGELOG.md](CHANGELOG.md) for feature, balance, technical, and release history.
