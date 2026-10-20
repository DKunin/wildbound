# Animal audio sources

All files are bundled locally. Freesound inputs are the publicly supplied HQ MP3
previews, not the original lossless uploads. Calls were converted to mono 22.05 kHz
PCM, band-limited, trimmed of leading silence, loudness-normalized and edge-faded.
The deer uses seconds 3–11, excluding an opening speech-like transient flagged
by the automated speech detector. Automated screening is not a listening guarantee.

| Output | Source / creator | License |
| --- | --- | --- |
| wolf-call.wav | [Wolf howl — NaturesTemper](https://freesound.org/people/NaturesTemper/sounds/398430/) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| deer-call.wav | [Bellowing deer — IchBinChrist](https://freesound.org/people/IchBinChrist/sounds/407631/) | CC0 1.0 |
| elk-call.wav | [Elk 7.wav — Hyperionn](https://freesound.org/people/Hyperionn/sounds/250191/) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| rabbit-call.wav | [Rabbit Thump on Soil — kessir](https://freesound.org/people/kessir/sounds/386007/) | CC0 1.0 |
| boar-call.wav | [Boar — fvcalderan](https://opengameart.org/content/boar-0) | CC0 1.0 |
| wolf-step-1/2/3.wav | [Dog Running Past — qubodup](https://freesound.org/people/qubodup/sounds/827320/), dog paws on a grass trail | CC0 1.0 |
| rabbit-step-1/2/3.wav | [Animal Footsteps — IENBA](https://freesound.org/people/IENBA/sounds/658429/), small-animal Foley performed on sand, dirt, dry grass and gravel | CC0 1.0 |
| deer/elk/boar-step-1/2/3.wav | [Horse steps on grass — Luisa_Sanchez](https://freesound.org/people/Luisa_Sanchez/sounds/813383/) | CC0 1.0 |

The wolf howl and boar grunt are performed/designed effects, not zoological field
recordings. The rabbit signal is a real alarm **thump**, not a vocal call; rabbits
do not make routine ambient vocal calls here. Elk bugling and deer bellowing are
stylized ambient gameplay cues, not a seasonal animal-behavior simulation.
The previous synthetic impacts have been removed. Steps now use isolated
recorded ground contacts with three excerpts per species. Dog paws stand in
for wolf paws; horse hooves stand in for deer, elk and boar; the rabbit uses
recorded small-animal Foley, **not a recording of a rabbit hopping**.
These substitutions are not presented as species-authentic field recordings.
The source ground texture is retained: high-pass at 100 Hz, gentle low-pass,
small playback-rate adjustments (0.9–1.12×), per-excerpt peak normalization,
5 ms leading and 25 ms trailing fades. Exact source offsets and processing are
in `scripts/build-animal-audio.mjs`. No synthesized oscillators or impacts are mixed in.

## Rebuild

Download these inputs under the names shown, then run
`node scripts/build-animal-audio.mjs <source-directory>`. SHA-256 checks in the
script reject different input revisions.

- `wolf.mp3`: https://cdn.freesound.org/previews/398/398430_3862281-hq.mp3
- `deer.mp3`: https://cdn.freesound.org/previews/407/407631_3216899-hq.mp3
- `elk.mp3`: https://cdn.freesound.org/previews/250/250191_4592890-hq.mp3
- `rabbit.mp3`: https://cdn.freesound.org/previews/386/386007_4521595-hq.mp3
- `boar.ogg`: https://opengameart.org/sites/default/files/boar_0.ogg
- `paws.mp3`: https://cdn.freesound.org/previews/827/827320_71257-hq.mp3
- `hooves.mp3`: https://cdn.freesound.org/previews/813/813383_17552599-hq.mp3
- `small-animal.mp3`: https://cdn.freesound.org/previews/658/658429_9616576-hq.mp3

No endorsement by the source creators is implied.
