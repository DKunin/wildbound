# Forest soundscape — CC0

All seven WAV assets are derivatives of freely reusable **CC0 1.0** audio.
Source pages and license declarations were checked on 2026-10-20.
License: https://creativecommons.org/publicdomain/zero/1.0/

| Game assets | Original / author | Source page |
| --- | --- | --- |
| forest.wav, gust.wav | wind1.wav — Luke.RUSTLTD | https://opengameart.org/content/wind1 |
| water.wav | park_ambience_river.wav — Thimras | https://opengameart.org/content/park-ambiences |
| bird-1.wav, bird-2.wav, bird-3.wav | birds-isaiah658_0.ogg — isaiah658 | https://opengameart.org/content/ambient-bird-sounds |
| foliage.wav | Soft Wind in the Trees - Leaves rustle — Borgory | https://freesound.org/people/Borgory/sounds/751473/ |

The wind was synthesized in PureData (the source credits Andy Farnell's tutorial).
It replaces the initial park wind recording after background conversation was reported;
neither the continuous forest bed nor the gust uses that recording.
The river was recorded in Adelaide, Australia and contains distant wildlife.
These assets are atmospheric, not a species-accurate reconstruction of the game's fictional forest.

Animal calls and movement sounds have separate [credits and licenses](animals/CREDITS.md)
(CC0 and CC BY 4.0). The CC0 descriptions above apply to the nature layers only.

## Rebuild

Download these originals into a temporary directory:

- https://opengameart.org/sites/default/files/wind1.wav
- https://opengameart.org/sites/default/files/park_ambience_river.wav
- https://opengameart.org/sites/default/files/birds-isaiah658_0.ogg
- https://cdn.freesound.org/previews/751/751473_801011-hq.mp3 (public high-quality preview)

Run `node scripts/build-forest-audio.mjs /path/to/originals` with FFmpeg installed.
The script verifies SHA-256 checksums, extracts segments, filters low rumble, normalizes
levels and converts to 22.05 kHz mono PCM WAV for cross-browser decoding without encoder
padding. Foliage uses a continuous 35–61 second excerpt of wind rustling through trees,
with a 450 Hz high-pass filter to separate the leaf texture from low wind rumble.
It replaces the initial dry-leaf foley montage, which sounded like footsteps.
The forest, water and foliage loops are 24 seconds with a two-second equal-power overlap;
five-millisecond edge fades prevent clicks when browsers resample the loop boundaries.
The randomized bird phrases and gust have soft attack/release fades. Originals are
not shipped. Assets are served locally; the game never streams from third-party sites.
