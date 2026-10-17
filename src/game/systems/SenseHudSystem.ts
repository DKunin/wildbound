export const SENSE_DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

export type SenseDirection = typeof SENSE_DIRECTIONS[number];
export type SenseKind = 'rabbit' | 'deer' | 'elk' | 'boar' | 'pack' | 'carcass' | 'cache' | 'territory' | 'water';

export interface SenseSourceSignal {
  sourceId: string;
  kind: SenseKind;
  x: number;
  y: number;
  scentStrength?: number;
  hearingStrength?: number;
  targeted?: boolean;
}

export interface SenseViewport {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SenseHudCue {
  id: string;
  direction: SenseDirection;
  kind: SenseKind;
  strength: number;
  scentStrength: number;
  hearingStrength: number;
  targeted: boolean;
  count: number;
}

interface MergedSource extends Required<Omit<SenseSourceSignal, 'targeted'>> {
  targeted: boolean;
  strength: number;
}

const MIN_SIGNAL_STRENGTH = 0.025;
const DIRECTION_STEP = Math.PI / 4;
const DIRECTION_HYSTERESIS = 8 * Math.PI / 180;
const DIRECTION_BY_ANGLE: readonly SenseDirection[] = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
const DIRECTION_ANGLE: Record<SenseDirection, number> = {
  E: 0,
  SE: Math.PI / 4,
  S: Math.PI / 2,
  SW: 3 * Math.PI / 4,
  W: Math.PI,
  NW: 5 * Math.PI / 4,
  N: 3 * Math.PI / 2,
  NE: 7 * Math.PI / 4,
};

const clamp01 = (value = 0): number => Math.max(0, Math.min(1, value));

const angularDistance = (left: number, right: number): number => {
  const difference = Math.abs(left - right) % (Math.PI * 2);
  return Math.min(difference, Math.PI * 2 - difference);
};

const isInsideViewport = (source: SenseSourceSignal, viewport: SenseViewport): boolean => (
  source.x >= viewport.left
  && source.x <= viewport.right
  && source.y >= viewport.top
  && source.y <= viewport.bottom
);

const directionForAngle = (angle: number): SenseDirection => (
  DIRECTION_BY_ANGLE[Math.round(angle / DIRECTION_STEP) % DIRECTION_BY_ANGLE.length]
);

export class SenseHudModel {
  private readonly previousDirections = new Map<string, SenseDirection>();

  update(
    listener: { x: number; y: number },
    viewport: SenseViewport,
    sources: readonly SenseSourceSignal[],
  ): SenseHudCue[] {
    const mergedSources = new Map<string, MergedSource>();
    for (const source of sources) {
      if (isInsideViewport(source, viewport)) continue;
      const scentStrength = clamp01(source.scentStrength);
      const hearingStrength = clamp01(source.hearingStrength);
      const strength = Math.max(scentStrength, hearingStrength);
      if (strength < MIN_SIGNAL_STRENGTH) continue;

      const key = `${source.sourceId}:${source.kind}`;
      const previous = mergedSources.get(key);
      if (!previous) {
        mergedSources.set(key, {
          ...source,
          scentStrength,
          hearingStrength,
          targeted: source.targeted === true,
          strength,
        });
        continue;
      }

      previous.scentStrength = Math.max(previous.scentStrength, scentStrength);
      previous.hearingStrength = Math.max(previous.hearingStrength, hearingStrength);
      previous.targeted ||= source.targeted === true;
      if (strength > previous.strength) {
        previous.x = source.x;
        previous.y = source.y;
      }
      previous.strength = Math.max(previous.strength, strength);
    }

    const activeSourceKeys = new Set(mergedSources.keys());
    for (const key of this.previousDirections.keys()) {
      if (!activeSourceKeys.has(key)) this.previousDirections.delete(key);
    }

    const aggregated = new Map<string, SenseHudCue>();
    for (const [sourceKey, source] of mergedSources) {
      const angle = (Math.atan2(source.y - listener.y, source.x - listener.x) + Math.PI * 2) % (Math.PI * 2);
      const previousDirection = this.previousDirections.get(sourceKey);
      const direction = previousDirection
        && angularDistance(angle, DIRECTION_ANGLE[previousDirection]) <= DIRECTION_STEP / 2 + DIRECTION_HYSTERESIS
        ? previousDirection
        : directionForAngle(angle);
      this.previousDirections.set(sourceKey, direction);

      const cueKey = `${direction}:${source.kind}:${source.targeted ? 'targeted' : 'ordinary'}`;
      const cue = aggregated.get(cueKey);
      if (cue) {
        cue.strength = Math.max(cue.strength, source.strength);
        cue.scentStrength = Math.max(cue.scentStrength, source.scentStrength);
        cue.hearingStrength = Math.max(cue.hearingStrength, source.hearingStrength);
        cue.count += 1;
      } else {
        aggregated.set(cueKey, {
          id: cueKey,
          direction,
          kind: source.kind,
          strength: source.strength,
          scentStrength: source.scentStrength,
          hearingStrength: source.hearingStrength,
          targeted: source.targeted,
          count: 1,
        });
      }
    }

    return [...aggregated.values()].sort((left, right) => (
      SENSE_DIRECTIONS.indexOf(left.direction) - SENSE_DIRECTIONS.indexOf(right.direction)
      || Number(right.targeted) - Number(left.targeted)
      || right.strength - left.strength
      || left.kind.localeCompare(right.kind)
    ));
  }

  reset(): void {
    this.previousDirections.clear();
  }
}
