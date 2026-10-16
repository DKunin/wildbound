import Phaser from 'phaser';
import type { Prey } from '../entities/Prey';
import type { PackWolf } from '../entities/PackWolf';

type TrackedCreature = Phaser.Physics.Arcade.Sprite | Prey | PackWolf;

export class FootprintSystem {
  private lastStamp = new WeakMap<TrackedCreature, number>();
  private readonly liveTracks = new Set<Phaser.GameObjects.Image>();

  constructor(private readonly scene: Phaser.Scene) {}

  record(time: number, player: Phaser.Physics.Arcade.Sprite, prey: readonly Prey[], pack: readonly PackWolf[]): void {
    this.stamp(time, player, 'wolf');
    for (const wolf of pack) this.stamp(time, wolf, 'wolf');
    for (const animal of prey) {
      if (!animal.isDead()) this.stamp(time, animal, animal.species);
    }
  }

  destroy(): void {
    this.clearTransientTracks();
  }

  clearTransientTracks(): void {
    for (const track of this.liveTracks) track.destroy();
    this.liveTracks.clear();
    this.lastStamp = new WeakMap<TrackedCreature, number>();
  }

  private stamp(time: number, creature: TrackedCreature, kind: 'wolf' | 'rabbit' | 'deer'): void {
    if (!creature.active) return;
    const body = creature.body as Phaser.Physics.Arcade.Body | null;
    if (!body || body.velocity.lengthSq() < 500) return;
    const previous = this.lastStamp.get(creature) ?? -Infinity;
    const interval = kind === 'rabbit' ? 680 : 920;
    if (time - previous < interval) return;
    this.lastStamp.set(creature, time);

    const angle = Math.atan2(body.velocity.y, body.velocity.x);
    const direction = ((Math.round(angle / (Math.PI / 2)) % 4) + 4) % 4;
    const row = kind === 'wolf' ? 0 : kind === 'deer' ? 1 : 2;
    const track = this.scene.add.image(creature.x, creature.y + 18, 'tracks', row * 4 + direction)
      .setScale(kind === 'rabbit' ? 0.075 : 0.09)
      .setAlpha(0.44)
      .setDepth(creature.y - 4)
      .setAngle(Phaser.Math.RadToDeg(angle));
    this.liveTracks.add(track);
    this.scene.tweens.add({
      targets: track,
      alpha: 0,
      duration: 26_000,
      ease: 'Quad.in',
      onComplete: () => {
        this.liveTracks.delete(track);
        track.destroy();
      },
    });
  }
}
