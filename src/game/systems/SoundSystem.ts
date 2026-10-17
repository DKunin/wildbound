import Phaser from 'phaser';
import {
  selectAudibleSounds,
  type AudibleSound,
  type AudibleSoundKind,
  type AmbientSoundArea,
  type SoundSource,
  type TimedSound,
} from './SoundModel';

export class SoundSystem {
  private readonly events: Array<TimedSound & { duplicateKey: string | SoundSource }> = [];
  private readonly ambients: AmbientSoundArea[] = [];

  constructor(_scene: Phaser.Scene) {}

  emit(time: number, x: number, y: number, label: string, reach = 760, kind: AudibleSoundKind = 'pack'): void {
    this.addEvent(time, { x, y }, label, reach, label, kind, `sound:${label}:${x}:${y}`);
  }

  emitTracked(time: number, source: SoundSource, label: string, reach = 760, kind: AudibleSoundKind = 'pack', sourceId = label): void {
    this.addEvent(time, source, label, reach, source, kind, sourceId);
  }

  addAmbientAreas(
    areas: readonly Omit<AmbientSoundArea, 'label' | 'reach' | 'intensity' | 'kind'>[],
    label: string,
    reach = 680,
    intensity = 0.62,
    kind: AudibleSoundKind = 'water',
  ): void {
    this.ambients.push(...areas.map((area) => ({ ...area, label, reach, intensity, kind })));
  }

  render(time: number, listener: Phaser.GameObjects.Components.Transform, hearing: number): AudibleSound[] {
    while (this.events[0] && time - this.events[0].createdAt > 6200) this.events.shift();
    return selectAudibleSounds(time, listener, hearing, this.events, this.ambients);
  }

  destroy(): void {
    this.events.length = 0;
    this.ambients.length = 0;
  }

  clearTransientSounds(): void {
    this.events.length = 0;
  }

  private addEvent(
    time: number,
    source: SoundSource,
    label: string,
    reach: number,
    duplicateKey: string | SoundSource,
    kind: AudibleSoundKind,
    sourceId: string,
  ): void {
    const duplicate = this.events.some((event) => event.duplicateKey === duplicateKey && time - event.createdAt < 2200);
    if (!duplicate) this.events.push({ source, sourceId, kind, label, createdAt: time, reach, duplicateKey });
  }
}
