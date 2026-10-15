import Phaser from 'phaser';
import { getPlayerDirectionVector, resolvePlayerFacing, type PlayerDirection } from '../systems/DirectionalSpriteSystem';
import { getPreyAnimationFrames, getPreyAnimationKey } from '../systems/PreyAnimationSystem';
import { PreyThreatSystem } from '../systems/PreyThreatSystem';
import {
  AnimalNeedsSystem,
  type AnimalActivity,
  type AnimalGoal,
} from '../systems/AnimalNeedsSystem';
import {
  AnimalAwarenessSystem,
  type AwarenessEnvironment,
  type AwarenessReading,
  type AwarenessThreat,
} from '../systems/AnimalAwarenessSystem';

export type PreySpecies = 'rabbit' | 'deer';
export type PreyState = 'roam' | 'alert' | 'flee' | 'dead';

export interface ThreatStimulus extends AwarenessThreat {}

export interface PreyHabitat {
  food: readonly { x: number; y: number }[];
  water: readonly { x: number; y: number }[];
  shelter: readonly { x: number; y: number }[];
  explore: readonly { x: number; y: number }[];
  findPath(start: { x: number; y: number }, destination: { x: number; y: number }): readonly { x: number; y: number }[];
}

const TRAITS: Record<PreySpecies, {
  roam: number;
  flee: number;
  sightRange: number;
  fieldOfViewDegrees: number;
  hearingRange: number;
  scentRange: number;
}> = {
  rabbit: { roam: 28, flee: 172, sightRange: 350, fieldOfViewDegrees: 280, hearingRange: 450, scentRange: 330 },
  deer: { roam: 35, flee: 205, sightRange: 520, fieldOfViewDegrees: 300, hearingRange: 560, scentRange: 430 },
};

export class Prey extends Phaser.Physics.Arcade.Sprite {
  readonly species: PreySpecies;
  private aiState: PreyState = 'roam';
  private health: number;
  private meat: number;
  private decisionAt = 0;
  private readonly target = new Phaser.Math.Vector2();
  private readonly destination = new Phaser.Math.Vector2();
  private route: Phaser.Math.Vector2[] = [];
  private readonly threatResponse = new PreyThreatSystem();
  private readonly awareness = new AnimalAwarenessSystem();
  private readonly needs: AnimalNeedsSystem;
  private goal: AnimalGoal = 'explore';
  private activity: AnimalActivity = 'idle';
  private lastNeedsAt = 0;
  private hasDestination = false;
  private habitat?: PreyHabitat;
  private animationDirection: PlayerDirection = 'south';
  private worldSize = 2200;

  constructor(
    scene: Phaser.Scene,
    species: PreySpecies,
    x: number,
    y: number,
    private readonly random: Phaser.Math.RandomDataGenerator,
  ) {
    super(scene, x, y, species, getPreyAnimationFrames('south', 'idle')[0]);
    this.species = species;
    this.health = species === 'rabbit' ? 1 : 3;
    this.meat = species === 'rabbit' ? 46 : 120;
    this.needs = new AnimalNeedsSystem(species, {
      hunger: random.integerInRange(24, 67),
      thirst: random.integerInRange(18, species === 'rabbit' ? 58 : 72),
      fatigue: random.integerInRange(12, 62),
    });
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setScale(species === 'rabbit' ? 0.36 : 0.68);
    this.setCollideWorldBounds(true);
    this.setBodySize(this.width * 0.52, this.height * 0.35);
    this.setOffset(this.width * 0.24, this.height * 0.56);
    this.target.set(x, y);
    this.destination.set(x, y);
  }

  updateBehavior(
    time: number,
    threats: readonly ThreatStimulus[],
    worldSize: number,
    herdMates: readonly Prey[] = [],
    environment: AwarenessEnvironment,
    habitat?: PreyHabitat,
    simulationMinutes = 12 * 60,
  ): PreyState {
    if (this.aiState === 'dead') return this.aiState;
    this.worldSize = worldSize;
    this.habitat = habitat;
    const deltaSeconds = this.lastNeedsAt === 0 ? 0 : Math.min((time - this.lastNeedsAt) / 1000, 0.25);
    this.lastNeedsAt = time;
    this.needs.update(deltaSeconds, this.activity);

    const sensedThreat = this.findStrongestThreat(threats, environment);
    const traits = TRAITS[this.species];
    const previousState = this.aiState;
    const directlySawThreat = this.species === 'deer' && (sensedThreat?.reading.sight ?? 0) > 0;
    const threatState = this.threatResponse.update(time, sensedThreat?.reading.level ?? 0, directlySawThreat);
    if (sensedThreat && threatState === 'flee') {
      this.aiState = 'flee';
      const away = new Phaser.Math.Vector2(this.x - sensedThreat.threat.x, this.y - sensedThreat.threat.y).normalize();
      const tangent = new Phaser.Math.Vector2(-away.y, away.x).scale(Math.sin(time / 380) * 0.18);
      away.add(tangent);
      if (this.species === 'deer' && herdMates.length > 1) {
        const center = this.herdCenter(herdMates);
        const cohesion = center.subtract(new Phaser.Math.Vector2(this.x, this.y)).normalize().scale(0.2);
        away.add(cohesion);
      }
      away.normalize();
      this.setVelocity(away.x * traits.flee, away.y * traits.flee);
      this.activity = 'moving';
    } else if (threatState === 'alert') {
      this.aiState = 'alert';
      this.setVelocity(0, 0);
      this.activity = 'idle';
      if (sensedThreat) {
        this.animationDirection = resolvePlayerFacing(
          sensedThreat.threat.x - this.x,
          sensedThreat.threat.y - this.y,
        ).animationDirection;
      }
    } else {
      this.aiState = 'roam';
      if (habitat && (previousState === 'flee' || previousState === 'alert') && this.hasDestination) this.planRoute(habitat);
      const reachedDestination = this.hasDestination
        && Phaser.Math.Distance.Between(this.x, this.y, this.destination.x, this.destination.y) < 52;
      if (reachedDestination && this.goal !== 'explore' && !this.needs.isSatisfied(this.goal)) {
        this.setVelocity(0, 0);
        this.activity = this.goalActivity();
        this.decisionAt = time + 500;
      } else {
        if (habitat && (!this.hasDestination || reachedDestination || time > this.decisionAt)) {
          const nextGoal = this.needs.chooseGoal(simulationMinutes, this.random.frac());
          if (!this.hasDestination || reachedDestination || nextGoal !== this.goal) this.chooseGoalTarget(nextGoal, habitat, time);
          else this.decisionAt = time + 3_500;
        }
        this.advanceRoute();
        const direction = this.target.clone().subtract(new Phaser.Math.Vector2(this.x, this.y));
        if (direction.lengthSq() > 1) direction.normalize();
        if (this.species === 'deer' && herdMates.length > 1) {
          const center = this.herdCenter(herdMates);
          const centerDistance = Phaser.Math.Distance.Between(this.x, this.y, center.x, center.y);
          if (centerDistance > 150) direction.add(center.subtract(new Phaser.Math.Vector2(this.x, this.y)).normalize().scale(0.55)).normalize();
        }
        this.setVelocity(direction.x * traits.roam, direction.y * traits.roam);
        this.activity = direction.lengthSq() > 0 ? 'moving' : 'idle';
      }
    }

    this.updateAnimation();
    this.setDepth(this.y + 20);
    return this.aiState;
  }

  attack(attacker: 'player' | 'pack' = 'player'): { killed: boolean; retaliation: number } {
    if (this.aiState === 'dead') return { killed: true, retaliation: 0 };
    this.health -= 1;
    const killed = this.health <= 0;
    if (killed) {
      this.aiState = 'dead';
      this.setVelocity(0, 0);
      this.anims.stop();
      this.setFrame(getPreyAnimationFrames(this.animationDirection, 'dead')[0]);
      this.clearTint().setAngle(0).setRotation(0).setAlpha(0.9);
      this.setDepth(this.y - 2);
      const body = this.body as Phaser.Physics.Arcade.Body;
      body.enable = false;
    } else {
      this.aiState = 'flee';
      this.threatResponse.triggerFlee(this.scene.time.now);
    }
    const retaliation = attacker === 'player' && !killed && this.species === 'deer' && this.random.frac() < 0.42
      ? this.random.integerInRange(5, 12)
      : 0;
    return { killed, retaliation };
  }

  consume(amount: number): number {
    if (!this.isDead() || this.meat <= 0) return 0;
    const consumed = Math.min(amount, this.meat);
    this.meat -= consumed;
    this.setAlpha(0.32 + (this.meat / (this.species === 'rabbit' ? 46 : 120)) * 0.56);
    if (this.meat <= 0) this.destroy();
    return consumed;
  }

  isDead(): boolean {
    return this.aiState === 'dead';
  }

  hasEdibleMeat(): boolean {
    return this.isDead() && this.meat > 0;
  }

  getState(): PreyState {
    return this.aiState;
  }

  handleTerrainCollision(): void {
    if (this.aiState === 'dead') return;
    if (this.habitat && this.hasDestination) this.planRoute(this.habitat);
    else this.decisionAt = 0;
  }

  private findStrongestThreat(
    threats: readonly ThreatStimulus[],
    environment: AwarenessEnvironment,
  ): { threat: ThreatStimulus; reading: AwarenessReading } | undefined {
    const traits = TRAITS[this.species];
    const [facingX, facingY] = getPlayerDirectionVector(this.animationDirection);
    let strongest: { threat: ThreatStimulus; reading: AwarenessReading } | undefined;
    for (const threat of threats) {
      const reading = this.awareness.evaluate({
        x: this.x,
        y: this.y,
        facingX,
        facingY,
        sightRange: traits.sightRange,
        fieldOfViewDegrees: traits.fieldOfViewDegrees,
        hearingRange: traits.hearingRange,
        scentRange: traits.scentRange,
      }, threat, environment);
      if (!strongest || reading.level > strongest.reading.level) strongest = { threat, reading };
    }
    return strongest;
  }

  private herdCenter(herdMates: readonly Prey[]): Phaser.Math.Vector2 {
    const living = herdMates.filter((animal) => animal.active && !animal.isDead());
    if (living.length === 0) return new Phaser.Math.Vector2(this.x, this.y);
    const sum = living.reduce((center, animal) => center.add(new Phaser.Math.Vector2(animal.x, animal.y)), new Phaser.Math.Vector2());
    return sum.scale(1 / living.length);
  }

  private chooseGoalTarget(goal: AnimalGoal, habitat: PreyHabitat, time: number): void {
    const candidates = habitat[goal].length > 0 ? habitat[goal] : habitat.explore;
    if (candidates.length === 0) {
      this.hasDestination = false;
      this.target.set(this.x, this.y);
      return;
    }
    const nearest = [...candidates]
      .sort((a, b) => Phaser.Math.Distance.Squared(this.x, this.y, a.x, a.y) - Phaser.Math.Distance.Squared(this.x, this.y, b.x, b.y))
      .slice(0, goal === 'explore' ? 10 : 6);
    const destination = nearest[this.random.integerInRange(0, nearest.length - 1)];
    this.goal = goal;
    this.destination.set(
      Phaser.Math.Clamp(destination.x, 0, this.worldSize),
      Phaser.Math.Clamp(destination.y, 0, this.worldSize),
    );
    this.hasDestination = true;
    this.planRoute(habitat);
    this.decisionAt = time + (goal === 'explore' ? 6_000 : 4_500);
  }

  private planRoute(habitat: PreyHabitat): void {
    this.route = habitat.findPath(this, this.destination).map((point) => new Phaser.Math.Vector2(point.x, point.y));
    this.target.copy(this.route[0] ?? this.destination);
  }

  private advanceRoute(): void {
    while (this.route.length > 0 && Phaser.Math.Distance.Between(this.x, this.y, this.route[0].x, this.route[0].y) < 34) this.route.shift();
    this.target.copy(this.route[0] ?? this.destination);
  }

  private goalActivity(): AnimalActivity {
    if (this.goal === 'food') return 'foraging';
    if (this.goal === 'water') return 'drinking';
    if (this.goal === 'shelter') return 'resting';
    return 'idle';
  }

  private updateAnimation(): void {
    const body = this.body as Phaser.Physics.Arcade.Body;
    if (body.velocity.lengthSq() < 4) {
      this.setRotation(0);
      this.anims.play(getPreyAnimationKey(this.species, this.animationDirection, 'idle'), true);
      return;
    }
    const facing = resolvePlayerFacing(body.velocity.x, body.velocity.y);
    this.animationDirection = facing.animationDirection;
    this.setRotation(0);
    this.anims.play(getPreyAnimationKey(this.species, this.animationDirection, this.aiState === 'flee' ? 'flee' : 'walk'), true);
  }
}
