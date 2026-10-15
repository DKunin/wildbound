import Phaser from 'phaser';
import type { Prey } from './Prey';
import { resolveDirectionalFacing } from '../systems/DirectionalSpriteSystem';

export type PackWolfName = 'Niva' | 'Torr';
export type PackWolfState = 'near' | 'returning' | 'flanking' | 'feeding' | 'resting';

export interface PackWolfSnapshot {
  name: PackWolfName;
  x: number;
  y: number;
  hunger: number;
}

export class PackWolf extends Phaser.Physics.Arcade.Sprite {
  readonly wolfName: PackWolfName;
  private packState: PackWolfState = 'near';
  private hunger: number;
  private lastAttackAt = 0;
  private lastFedAt = 0;
  private avoidanceUntil = 0;
  private readonly avoidanceDirection = new Phaser.Math.Vector2();

  constructor(
    scene: Phaser.Scene,
    name: PackWolfName,
    x: number,
    y: number,
    hunger = name === 'Niva' ? 38 : 45,
  ) {
    const texture = name.toLowerCase();
    super(scene, x, y, texture, 0);
    this.wolfName = name;
    this.hunger = hunger;
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setScale(name === 'Niva' ? 0.34 : 0.39);
    this.setCollideWorldBounds(true);
    this.setBodySize(150, 82).setOffset(98, 160);
  }

  updateBehavior(
    time: number,
    deltaSeconds: number,
    player: Phaser.Physics.Arcade.Sprite,
    prey: readonly Prey[],
    rallied: boolean,
    flankSide: -1 | 1,
  ): PackWolfState {
    this.hunger = Phaser.Math.Clamp(this.hunger + deltaSeconds * 0.035, 0, 100);
    if (time < this.avoidanceUntil) {
      this.setVelocity(this.avoidanceDirection.x * 138, this.avoidanceDirection.y * 138);
      this.updateAnimation(8);
      return this.packState;
    }
    const carcass = this.findNearest(prey, true);
    if (carcass && carcass.distance < 105 && this.hunger > 30) {
      this.packState = 'feeding';
      this.moveToward(carcass.animal, carcass.distance > 58 ? 82 : 0);
      if (carcass.distance <= 65 && time - this.lastFedAt > 1200) {
        this.lastFedAt = time;
        const eaten = carcass.animal.consume(7);
        this.hunger = Phaser.Math.Clamp(this.hunger - eaten * 0.8, 0, 100);
      }
      this.updateAnimation(6);
      return this.packState;
    }

    const target = this.chooseHuntTarget(prey, player, rallied);
    if (target) {
      this.packState = 'flanking';
      const playerToTarget = new Phaser.Math.Vector2(target.x - player.x, target.y - player.y).normalize();
      const perpendicular = new Phaser.Math.Vector2(-playerToTarget.y, playerToTarget.x).scale(flankSide * 92);
      const flankPoint = new Phaser.Math.Vector2(target.x, target.y).add(perpendicular);
      const distance = Phaser.Math.Distance.Between(this.x, this.y, target.x, target.y);
      if (distance < 82 && time - this.lastAttackAt > 980) {
        this.lastAttackAt = time;
        target.attack('pack');
      }
      this.moveToward(flankPoint, distance > 82 ? 202 : 94);
      this.updateAnimation(distance > 160 ? 11 : 8);
      return this.packState;
    }

    const playerDistance = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
    const preferred = this.wolfName === 'Niva' ? 135 : 185;
    if (playerDistance > preferred + 85) {
      this.packState = 'returning';
      const offset = this.wolfName === 'Niva' ? new Phaser.Math.Vector2(-90, 75) : new Phaser.Math.Vector2(105, 92);
      this.moveToward(new Phaser.Math.Vector2(player.x, player.y).add(offset), 152);
      this.updateAnimation(8);
    } else if (playerDistance < preferred - 45) {
      this.packState = 'near';
      const away = new Phaser.Math.Vector2(this.x - player.x, this.y - player.y).normalize();
      this.setVelocity(away.x * 48, away.y * 48);
      this.updateAnimation(6);
    } else {
      this.packState = 'resting';
      this.setVelocity(0, 0);
      this.stop();
    }
    this.setDepth(this.y + 24);
    return this.packState;
  }

  getPackState(): PackWolfState {
    return this.packState;
  }

  getHudStatus(): string {
    switch (this.packState) {
      case 'flanking': return 'FLANKING';
      case 'returning': return 'RETURNING';
      case 'feeding': return 'FEEDING';
      case 'resting': return 'RESTING';
      default: return 'NEAR';
    }
  }

  snapshot(): PackWolfSnapshot {
    return { name: this.wolfName, x: this.x, y: this.y, hunger: this.hunger };
  }

  restore(snapshot: PackWolfSnapshot): void {
    this.setPosition(snapshot.x, snapshot.y);
    this.hunger = Phaser.Math.Clamp(snapshot.hunger, 0, 100);
    this.packState = 'near';
  }

  handleTerrainCollision(): void {
    const body = this.body as Phaser.Physics.Arcade.Body;
    this.avoidanceDirection.set(-body.velocity.y, body.velocity.x);
    if (this.avoidanceDirection.lengthSq() < 1) this.avoidanceDirection.set(1, 0);
    this.avoidanceDirection.normalize();
    if (this.wolfName === 'Torr') this.avoidanceDirection.scale(-1);
    this.avoidanceUntil = this.scene.time.now + 520;
  }

  private chooseHuntTarget(prey: readonly Prey[], player: Phaser.Physics.Arcade.Sprite, rallied: boolean): Prey | undefined {
    const candidates = prey.filter((animal) => animal.active && !animal.isDead());
    let nearest: { animal: Prey; score: number } | undefined;
    for (const animal of candidates) {
      const packDistance = Phaser.Math.Distance.Between(this.x, this.y, animal.x, animal.y);
      const playerDistance = Phaser.Math.Distance.Between(player.x, player.y, animal.x, animal.y);
      const allowed = rallied ? packDistance < 720 : this.hunger > 48 ? packDistance < 390 : playerDistance < 300;
      if (!allowed) continue;
      const speciesBias = animal.species === 'deer' ? -60 : 0;
      const score = packDistance + speciesBias;
      if (!nearest || score < nearest.score) nearest = { animal, score };
    }
    return nearest?.animal;
  }

  private findNearest(prey: readonly Prey[], dead: boolean): { animal: Prey; distance: number } | undefined {
    let nearest: { animal: Prey; distance: number } | undefined;
    for (const animal of prey) {
      if (!animal.active || animal.isDead() !== dead) continue;
      const distance = Phaser.Math.Distance.Between(this.x, this.y, animal.x, animal.y);
      if (!nearest || distance < nearest.distance) nearest = { animal, distance };
    }
    return nearest;
  }

  private moveToward(target: { x: number; y: number }, speed: number): void {
    if (speed === 0) {
      this.setVelocity(0, 0);
      return;
    }
    const direction = new Phaser.Math.Vector2(target.x - this.x, target.y - this.y);
    if (direction.lengthSq() > 1) direction.normalize();
    this.setVelocity(direction.x * speed, direction.y * speed);
    this.setDepth(this.y + 24);
  }

  private updateAnimation(rate: number): void {
    const body = this.body as Phaser.Physics.Arcade.Body;
    if (body.velocity.lengthSq() < 4) {
      this.stop();
      return;
    }
    const facing = resolveDirectionalFacing(body.velocity.x, body.velocity.y);
    this.setRotation(facing.rotation);
    this.anims.play(`${this.wolfName.toLowerCase()}-${facing.animationDirection}-${rate}`, true);
  }
}
