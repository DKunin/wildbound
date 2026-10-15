export interface SoundSource {
  x: number;
  y: number;
}

export interface TimedSound {
  source: SoundSource;
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
}

export interface AudibleSound {
  x: number;
  y: number;
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

export const selectStrongestSound = (
  time: number,
  listener: SoundSource,
  hearing: number,
  events: readonly TimedSound[],
  ambients: readonly AmbientSoundArea[],
): AudibleSound | undefined => {
  let strongest: AudibleSound | undefined;
  const consider = (source: SoundSource, label: string, reach: number, intensity: number): void => {
    const strength = scoreSound(listener, source, reach, hearing, intensity);
    if (strength > 0 && (!strongest || strength > strongest.strength)) strongest = { ...source, label, strength };
  };
  for (const event of events) {
    const age = Math.max(0, time - event.createdAt);
    const duration = event.duration ?? 6200;
    if (age > duration) continue;
    consider(event.source, event.label, event.reach, 1 - age / duration);
  }
  for (const ambient of ambients) {
    consider(nearestPointInArea(listener, ambient), ambient.label, ambient.reach, ambient.intensity ?? 0.62);
  }
  return strongest;
};
