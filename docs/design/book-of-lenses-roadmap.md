# Wildbound: Book of Lenses Review and Roadmap

Status: proposed design direction, not an implementation commitment
Recorded: 2026-10-20
Framework: Jesse Schell, *The Art of Game Design: A Book of Lenses*

## Product decision

Wildbound already has enough simulation depth for its current vertical slice. The highest-value next work is to make one wolf's life understandable, audible, and memorable before adding more animals, biomes, or survival systems.

The one change most likely to improve the game is a legible first hunt. A new player should be able to say, within ten minutes:

> I read the wind, followed a scent, chose when to stalk or sprint, and understood why the hunt succeeded or failed.

## Lens assessment

| Lens | Assessment |
| --- | --- |
| Essential Experience | Strong. Wind, scent, stealth, hunger, wounds, prey behavior, and caching support the lone-wolf fantasy. |
| World and Atmosphere | Visually strong but audibly incomplete. “Listen to the forest” promises more than the current visual hearing signals provide. |
| Emergence and Story Machine | The simulation can produce strong stories, but the game rarely captures or explains them. |
| Goals and Flow | The weakest area. `EXPLORE THE WILD` and cache counts do not create a compelling first-ten-minute arc. |
| Feedback and Transparency | Contextual actions are useful, but players cannot easily infer why prey detected them or how scent strength and wind interact. |
| Meaningful Choices | The systems contain real tradeoffs, but some pivotal decisions, such as eating versus carrying meat, are resolved automatically. |
| Visible Progress and Endogenous Value | A life, hunt, wound, territory mark, or cache does not yet acquire lasting personal meaning. |
| Interest Curve | The opening is attractive but quiet and flat; excitement depends too heavily on an accidental prey encounter. |
| Playtesting | Existing telemetry measures sessions and deaths, not whether players learn or complete the core loop. |

## Proposed execution sequence

### 1. Build a diegetic First Trail

Teach the core loop through the existing objective and event line rather than a tutorial modal or conventional quest system.

Suggested sequence:

1. Notice a nearby scent or sound.
2. Read the wind direction.
3. Crouch and approach without exposing the wolf.
4. Mark a living animal.
5. Decide when to stalk, sprint, or abandon the chase.
6. Attack, eat, and decide what to do with the remains.
7. Find water, rest, and optionally cache surplus meat.

The guidance should be contextual, optional, and permanently disappear as concepts are learned. It should not guarantee success or reveal exact simulation values.

Acceptance criteria:

- Four of five first-time players reach prey or water without reading the README.
- Four of five can explain how wind affects detection.
- At least three attempt a hunt within ten minutes.
- Players can distinguish scent, sound, and a marked target.
- Experienced players can skip the guidance without friction.

### 2. Give the forest a voice

Add restrained spatial audio for:

- flowing water and wind through vegetation;
- surface-dependent wolf footsteps;
- distant wildlife and alarm calls;
- prey movement during a chase;
- deer kicks and boar countercharges;
- weather, night ambience, and later pack howls;
- sparse music only where it improves the interest curve.

Use attenuation, stereo direction, terrain occlusion, and wind or water masking. The directional senses HUD should remain an accessibility and interpretation layer, not a substitute for hearing.

Acceptance criteria:

- Players can find nearby flowing water primarily by sound.
- Sneaking, walking, and sprinting sound materially different.
- Dangerous animal reactions are audible before or during impact.
- Audio gives useful qualitative information without becoming an exact radar.

### 3. Expose causality and preserve uncertainty

Show qualitative cause and effect without exposing detection percentages or exact ranges.

Candidate feedback:

- prey alert postures before flight;
- concise messages such as “the wind carries your scent toward the herd”;
- visible or audible brush disturbance while sprinting;
- clearer transitions between weak, fresh, and fading scent;
- clearer labels for whether hunger and thirst bars show remaining reserve or growing need;
- distinct feedback when an animal sees, hears, or smells the wolf.

Keep `LOG MODE` as an advanced diagnostic surface. Ordinary play should communicate enough through animation, sound, and short event text.

### 4. Make pivotal choices explicit

Preserve the elegant contextual interaction system, but offer a brief choice when two actions are genuinely meaningful.

Important choice moments:

- eat now, carry meat, or leave it;
- continue following a fading trail or rest;
- hunt a safe rabbit or risk a higher-yield defensive animal;
- protect an existing cache or range into a new territory;
- continue an exhausting chase or disengage.

Avoid permanent action bars or inventory-heavy UI. A transient contextual choice is preferable.

### 5. Turn each life into a story

Add a compact life chronicle to pause and death screens. It should preserve meaning without introducing XP, unlock trees, or power metaprogression.

Possible entries:

- days and real playtime survived;
- animals tracked, hunts attempted, and successful kills;
- longest pursuit and closest escape;
- wounds suffered and recovered from;
- caches created, protected, scavenged, or lost;
- territory marks and regions visited;
- lean days survived;
- final cause of death.

The desired memory is “the wolf that survived three lean days and lost its cache,” not “the run where a meter reached zero.”

### 6. Enable the pack as a relationship

Do not enable Niva and Torr as additional damage output alone. Give them distinct behavior, needs, trust, separation, rescue, feeding pressure, and possible loss.

The pack should create new choices:

- share meat or preserve the player's recovery;
- help an injured companion or continue a hunt;
- coordinate a difficult attack or avoid the risk;
- defend a shared cache or abandon territory.

Only enable the existing pack feature after its save, collision, failure, and relationship behavior is stable.

### 7. Add human hunters as a later climax

Human hunters should invert the predator fantasy and create a punctuated high-risk event after players understand the existing wilderness.

They should be:

- avoidable and telegraphed by sound, scent, tracks, and prey reactions;
- dangerous without being omniscient;
- compatible with concealment, escape, and territory decisions;
- rare enough to remain an interest-curve peak rather than constant harassment.

Do not add hunters before the first-hunt learning loop and feedback model have been validated.

## Measurement plan

Extend privacy-preserving telemetry with anonymous milestone events:

- first scent activation;
- first directional cue followed;
- first living animal marked;
- first prey alert and first prey escape;
- first attack, kill, meal, carried carcass, and buried cache;
- first drink, rest, and territory mark;
- time, difficulty, and cause of death.

Suggested funnel metrics:

- time to first scent activation;
- time to first prey or water contact;
- percentage of sessions reaching a marked target;
- percentage attempting and completing a hunt;
- death rate before first meal;
- first-life and returning-player session duration;
- Explorer-to-Survival progression.

Do not collect save contents, precise movement histories, or personal identifiers.

## Explicit non-goals for the next milestone

- more prey species or biomes;
- crafting, equipment, loot, or skill trees;
- a conventional quest log;
- a minimap or exact scent radar;
- large lore dumps or dialogue-heavy narrative;
- enabling the pack feature flag without relationship and failure design;
- human hunters before the current loop is learnable.

## Evidence reviewed

- Fresh local Explorer-mode playthrough covering scent, stealth, directional cues, targeting feedback, and pause/help.
- No browser console warnings or errors during the review.
- Current objective, contextual interaction, sense HUD, balance, telemetry, pack feature flag, and save behavior in the repository at revision `5deeca6`.
- Prior design intent: simulation-first lone-wolf survival, imperfect information, compact HUD, original assets, and no RPG-heavy framing.

## Reference material

- [The Art of Game Design](https://schellgames.com/art-of-game-design/)
- [Official Deck of Lenses web app](https://deck.artofgamedesign.com/)
- [`README.md`](../../README.md)
- [`src/main.ts`](../../src/main.ts)
- [`src/game/WildScene.ts`](../../src/game/WildScene.ts)
- [`src/game/systems/TelemetrySystem.ts`](../../src/game/systems/TelemetrySystem.ts)
- [`src/game/features.ts`](../../src/game/features.ts)
