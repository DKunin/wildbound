export interface SoundSource {
  x: number;
  y: number;
}

export interface TimedSound {
  source: SoundSource;
  sourceId?: string;
  kind?: AudibleSoundKind;
  label: string;
  createdAt: number;
  reach: number;
  duration?: number;
}

export interface AmbientSoundArea {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  reach: number;
  intensity?: number;
  kind?: AudibleSoundKind;
}

export type AudibleSoundKind = 'rabbit' | 'deer' | 'elk' | 'boar' | 'pack' | 'water';

export interface AudibleSound {
  x: number;
  y: number;
  sourceId: string;
  kind: AudibleSoundKind;
  label: string;
  strength: number;
}

const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value));

const nearestPointInArea = (listener: SoundSource, area: AmbientSoundArea): SoundSource => ({
  x: clamp(listener.x, area.x, area.x + area.width),
  y: clamp(listener.y, area.y, area.y + area.height),
});

const scoreSound = (listener: SoundSource, source: SoundSource, reach: number, hearing: number, intensity: number): number => {
  const distance = Math.hypot(listener.x - source.x, listener.y - source.y);
  return Math.max(0, intensity * (1 - distance / (reach * hearing)));
};

export const selectAudibleSounds = (
  time: number,
  listener: SoundSource,
  hearing: number,
  events: readonly TimedSound[],
  ambients: readonly AmbientSoundArea[],
): AudibleSound[] => {
  const audible = new Map<string, AudibleSound>();
  const consider = (
    source: SoundSource,
    sourceId: string,
    kind: AudibleSoundKind,
    label: string,
    reach: number,
    intensity: number,
  ): void => {
    const strength = scoreSound(listener, source, reach, hearing, intensity);
    const previous = audible.get(sourceId);
    if (strength > 0 && (!previous || strength > previous.strength)) {
      audible.set(sourceId, { ...source, sourceId, kind, label, strength });
    }
  };
  for (const event of events) {
    const age = Math.max(0, time - event.createdAt);
    const duration = event.duration ?? 6200;
    if (age > duration) continue;
    consider(event.source, event.sourceId ?? `sound:${event.label}`, event.kind ?? 'pack', event.label, event.reach, 1 - age / duration);
  }
  for (const [index, ambient] of ambients.entries()) {
    consider(
      nearestPointInArea(listener, ambient),
      `${ambient.kind ?? 'water'}:${ambient.x}:${ambient.y}:${ambient.width}:${ambient.height}:${index}`,
      ambient.kind ?? 'water',
      ambient.label,
      ambient.reach,
      ambient.intensity ?? 0.62,
    );
  }
  return [...audible.values()].sort((left, right) => right.strength - left.strength);
};

export const selectStrongestSound = (
  time: number,
  listener: SoundSource,
  hearing: number,
  events: readonly TimedSound[],
  ambients: readonly AmbientSoundArea[],
): AudibleSound | undefined => selectAudibleSounds(time, listener, hearing, events, ambients)[0];
