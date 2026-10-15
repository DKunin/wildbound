import type { AwarenessReading, AwarenessSense } from './AnimalAwarenessSystem';

export type HuntLogState = 'roam' | 'alert' | 'flee' | 'dead';
export type HuntLogEventKind = AwarenessSense | 'alert' | 'flee' | 'relax';

export interface HuntLogEvent {
  kind: HuntLogEventKind;
  message: string;
}

interface Observation {
  state: HuntLogState;
  sight: boolean;
  sound: boolean;
  scent: boolean;
}

const REPEATED_EVENT_COOLDOWN_MS = 2_500;

export class HuntLogSystem {
  private observations = new WeakMap<object, Observation>();
  private readonly lastEventAt = new Map<string, number>();

  observe(
    subject: object,
    species: string,
    state: HuntLogState,
    reading: AwarenessReading | undefined,
    time: number,
  ): HuntLogEvent[] {
    const current: Observation = {
      state,
      sight: state !== 'dead' && (reading?.sight ?? 0) > 0,
      sound: state !== 'dead' && (reading?.sound ?? 0) > 0,
      scent: state !== 'dead' && (reading?.scent ?? 0) > 0,
    };
    const previous = this.observations.get(subject) ?? {
      state: 'roam',
      sight: false,
      sound: false,
      scent: false,
    };
    this.observations.set(subject, current);

    if (state === 'dead') return [];

    const animal = species.toLowerCase();
    const candidates: HuntLogEvent[] = [];
    if (!previous.sight && current.sight) candidates.push({ kind: 'sight', message: `A ${animal} saw the wolf.` });
    if (!previous.sound && current.sound) candidates.push({ kind: 'sound', message: `A ${animal} heard the wolf.` });
    if (!previous.scent && current.scent) candidates.push({ kind: 'scent', message: `A ${animal} smelled the wolf.` });

    if (previous.state !== state) {
      if (state === 'alert') candidates.push({ kind: 'alert', message: `A ${animal} is aware and alert.` });
      else if (state === 'flee') candidates.push({ kind: 'flee', message: `A ${animal} bolts away from the wolf.` });
      else if (state === 'roam' && (previous.state === 'alert' || previous.state === 'flee')) {
        candidates.push({ kind: 'relax', message: `A ${animal} is relaxed after losing the wolf.` });
      }
    }

    return candidates.filter((event) => this.allow(`${animal}:${event.kind}`, time));
  }

  reset(): void {
    this.observations = new WeakMap<object, Observation>();
    this.lastEventAt.clear();
  }

  private allow(key: string, time: number): boolean {
    const lastEventAt = this.lastEventAt.get(key);
    if (lastEventAt !== undefined && time - lastEventAt < REPEATED_EVENT_COOLDOWN_MS) return false;
    this.lastEventAt.set(key, time);
    return true;
  }
}
