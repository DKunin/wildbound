import Phaser from 'phaser';
import {
  selectStrongestSound,
  type AmbientSoundArea,
  type SoundSource,
  type TimedSound,
} from './SoundModel';

export class SoundSystem {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly events: Array<TimedSound & { duplicateKey: string | SoundSource }> = [];
  private readonly ambients: AmbientSoundArea[] = [];

  constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics().setDepth(99_000).setBlendMode(Phaser.BlendModes.ADD);
  }

  emit(time: number, x: number, y: number, label: string, reach = 760): void {
    this.addEvent(time, { x, y }, label, reach, label);
  }

  emitTracked(time: number, source: SoundSource, label: string, reach = 760): void {
    this.addEvent(time, source, label, reach, source);
  }

  addAmbientAreas(areas: readonly Omit<AmbientSoundArea, 'label' | 'reach' | 'intensity'>[], label: string, reach = 680, intensity = 0.62): void {
    this.ambients.push(...areas.map((area) => ({ ...area, label, reach, intensity })));
  }

  render(time: number, listener: Phaser.GameObjects.Components.Transform, hearing: number): string {
    this.graphics.clear();
    while (this.events[0] && time - this.events[0].createdAt > 6200) this.events.shift();
    const strongest = selectStrongestSound(time, listener, hearing, this.events, this.ambients);
    if (!strongest) return '';

    const direction = new Phaser.Math.Vector2(
      strongest.x - listener.x,
      strongest.y - listener.y,
    ).normalize();
    const uncertainty = (1 - strongest.strength) * 0.38;
    direction.rotate(Math.sin(time / 540) * uncertainty);
    const centerX = listener.x + direction.x * 178;
    const centerY = listener.y + direction.y * 178;
    const baseAngle = Math.atan2(direction.y, direction.x);
    for (let index = 0; index < 3; index += 1) {
      const radius = 14 + index * 11;
      this.graphics.lineStyle(2, 0xe7b85b, 0.24 + strongest.strength * 0.32);
      this.graphics.beginPath();
      this.graphics.arc(centerX, centerY, radius, baseAngle - 0.58, baseAngle + 0.58, false);
      this.graphics.strokePath();
    }
    return strongest.label;
  }

  destroy(): void {
    this.graphics.destroy();
    this.events.length = 0;
    this.ambients.length = 0;
  }

  clearTransientSounds(): void {
    this.events.length = 0;
    this.graphics.clear();
  }

  private addEvent(time: number, source: SoundSource, label: string, reach: number, duplicateKey: string | SoundSource): void {
    const duplicate = this.events.some((event) => event.duplicateKey === duplicateKey && time - event.createdAt < 2200);
    if (!duplicate) this.events.push({ source, label, createdAt: time, reach, duplicateKey });
  }
}
