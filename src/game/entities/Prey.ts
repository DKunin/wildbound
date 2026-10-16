import Phaser from 'phaser';
import { getPlayerDirectionVector, resolvePlayerFacing, type PlayerDirection } from '../systems/DirectionalSpriteSystem';
import {
  getPreyAnimationFrames,
  getPreyAnimationKey,
  getPreyAnimationSpeedScale,
  getPreyAnimationTextureKey,
  PREY_RETALIATION_DURATION_MS,
  getPreyDeathWoundLevel,
  shouldPreservePreyGaitProgress,
  type PreyAnimationState,
} from '../systems/PreyAnimationSystem';
import { LivingShadow } from '../systems/LivingShadow';
import { PreyThreatSystem } from '../systems/PreyThreatSystem';
import {
  AnimalNeedsSystem,
  type AnimalActivity,
  type AnimalDeathCause,
  type AnimalGoal,
} from '../systems/AnimalNeedsSystem';
import {
  AnimalAwarenessSystem,
  type AwarenessEnvironment,
  type AwarenessReading,
  type AwarenessThreat,
} from '../systems/AnimalAwarenessSystem';
import { decayCarrionMeat } from '../systems/CarrionDecaySystem';
import { constrainEscapeHeading } from '../systems/PreyEscapeSystem';
import { BALANCE_PROFILES, type BalanceProfile } from '../systems/BalanceConfig';
import { applyScavengerLoss } from '../systems/CacheRulesSystem';
import { getDeerRetaliation, isRetaliationActive } from '../systems/HuntBalanceSystem';
import { getBoarDefense } from '../systems/BoarBehaviorSystem';
import {
  getPreyMaxHealth,
  getPreyWoundLevel,
  stripWoundTextureSuffix,
} from '../systems/WoundTextureSystem';

export type PreySpecies = 'rabbit' | 'deer' | 'elk' | 'boar';
export type PreyState = 'roam' | 'alert' | 'flee' | 'dead';

export interface ThreatStimulus extends AwarenessThreat {}

export interface AttackResult {
  killed: boolean;
  retaliation: number;
  retaliated: boolean;
  safeRearAttack: boolean;
}

export interface PreyHabitat {
  food: readonly { x: number; y: number }[];
  water: readonly { x: number; y: number }[];
  shelter: readonly { x: number; y: number }[];
  explore: readonly { x: number; y: number }[];
  findPath(start: { x: number; y: number }, destination: { x: number; y: number }): readonly { x: number; y: number }[];
  findEscapePath(start: { x: number; y: number }, threat: { x: number; y: number }, lateralBias?: number): readonly { x: number; y: number }[];
}

const TRAITS: Record<PreySpecies, {
  roam: number;
  flee: number;
  sightRange: number;
  fieldOfViewDegrees: number;
  hearingRange: number;
  scentRange: number;
  minimumEscapeDistance: number;
}> = {
  rabbit: { roam: 28, flee: 172, sightRange: 350, fieldOfViewDegrees: 280, hearingRange: 450, scentRange: 330, minimumEscapeDistance: 900 },
  deer: { roam: 35, flee: 205, sightRange: 520, fieldOfViewDegrees: 300, hearingRange: 560, scentRange: 430, minimumEscapeDistance: 1_600 },
  elk: { roam: 32, flee: 190, sightRange: 560, fieldOfViewDegrees: 300, hearingRange: 610, scentRange: 470, minimumEscapeDistance: 1_800 },
  boar: { roam: 31, flee: 178, sightRange: 330, fieldOfViewDegrees: 250, hearingRange: 510, scentRange: 540, minimumEscapeDistance: 1_250 },
};

const GOAL_REACH_DISTANCE: Record<AnimalGoal, number> = {
  food: 128,
  water: 110,
  shelter: 120,
  explore: 52,
};

const getCircadianOffsetMinutes = (species: PreySpecies, x: number, y: number): number => {
  const speciesSeed = species === 'rabbit' ? 11 : species === 'deer' ? 23 : species === 'elk' ? 37 : 53;
  const positionSeed = Math.abs(Math.round(x) * 31 + Math.round(y) * 17 + speciesSeed);
  return positionSeed % 61 - 30;
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
  private fleeRoute: Phaser.Math.Vector2[] = [];
  private fleePlanAt = 0;
  private readonly lastFleeThreat = new Phaser.Math.Vector2(Number.NaN, Number.NaN);
  private readonly escapeLateralBias: number;
  private readonly escapePhase: number;
  private readonly threatResponse = new PreyThreatSystem();
  private readonly awareness = new AnimalAwarenessSystem();
  private awarenessReading?: AwarenessReading;
  private readonly needs: AnimalNeedsSystem;
  private goal: AnimalGoal = 'explore';
  private activity: AnimalActivity = 'idle';
  private lastNeedsAt = 0;
  private hasDestination = false;
  private habitat?: PreyHabitat;
  private animationDirection: PlayerDirection = 'south';
  private animationState?: PreyAnimationState;
  private worldSize = 2200;
  private readonly baseScale: number;
  private readonly shadow: LivingShadow;
  private deathCause?: AnimalDeathCause;
  private carried = false;
  private buried = false;
  private cacheMound?: Phaser.GameObjects.Image;
  private retaliationUntil = 0;
  private readonly retaliationTarget = new Phaser.Math.Vector2(Number.NaN, Number.NaN);
  private sounderSize = 1;

  constructor(
    scene: Phaser.Scene,
    species: PreySpecies,
    x: number,
    y: number,
    private readonly random: Phaser.Math.RandomDataGenerator,
    private readonly balance: BalanceProfile = BALANCE_PROFILES.explorer,
  ) {
    super(scene, x, y, species, getPreyAnimationFrames('south', 'idle')[0]);
    this.species = species;
    this.health = getPreyMaxHealth(species);
    this.meat = balance.meat[species];
    this.baseScale = species === 'rabbit' ? 0.36 : species === 'elk' ? 0.74 : species === 'boar' ? 0.64 : 0.68;
    const escapeSide = random.frac() < 0.5 ? -1 : 1;
    this.escapeLateralBias = escapeSide * random.realInRange(0.35, 1);
    this.escapePhase = random.realInRange(0, Math.PI * 2);
    this.needs = new AnimalNeedsSystem(species, {
      hunger: random.integerInRange(24, 67),
      thirst: random.integerInRange(18, species === 'rabbit' ? 58 : species === 'elk' ? 78 : 72),
      fatigue: random.integerInRange(12, 62),
    }, getCircadianOffsetMinutes(species, x, y));
    this.shadow = new LivingShadow(scene, species === 'rabbit'
      ? { width: 42, height: 13, offsetY: 22, alpha: 0.2 }
      : species === 'elk'
        ? { width: 92, height: 25, offsetY: 47, alpha: 0.23 }
        : species === 'boar'
          ? { width: 82, height: 24, offsetY: 43, alpha: 0.23 }
        : { width: 78, height: 22, offsetY: 44, alpha: 0.22 });
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setScale(this.baseScale);
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
    const deltaSeconds = this.lastNeedsAt === 0 ? 0 : Math.min((time - this.lastNeedsAt) / 1000, 0.25);
    this.lastNeedsAt = time;
    if (this.aiState === 'dead') {
      this.decayCarrion(deltaSeconds);
      return this.aiState;
    }
    this.worldSize = worldSize;
    this.habitat = habitat;
    this.sounderSize = Math.max(1, herdMates.filter((animal) => animal.active && !animal.isDead()).length);
    this.needs.update(deltaSeconds, this.activity);
    if (!this.needs.isAlive()) {
      this.die(this.needs.getDeathCause());
      return this.aiState;
    }

    if (this.isRetaliating(time)) {
      this.aiState = 'alert';
      if (this.species === 'boar' && Number.isFinite(this.retaliationTarget.x)) {
        const charge = this.retaliationTarget.clone().subtract(new Phaser.Math.Vector2(this.x, this.y));
        if (charge.lengthSq() > 1) charge.normalize();
        this.setVelocity(charge.x * TRAITS.boar.flee * 1.18, charge.y * TRAITS.boar.flee * 1.18);
        this.activity = 'fleeing';
      } else {
        this.setVelocity(0, 0);
        this.activity = 'idle';
      }
      this.updateAnimation();
      this.setDepth(this.y + 20);
      this.shadow.sync(this, true);
      return this.aiState;
    }

    const sensedThreat = this.findStrongestThreat(threats, environment);
    this.awarenessReading = sensedThreat?.reading;
    const traits = TRAITS[this.species];
    const previousState = this.aiState;
    const directlySawThreat = this.species !== 'rabbit' && (sensedThreat?.reading.sight ?? 0) > 0;
    const threatDistance = sensedThreat
      ? Phaser.Math.Distance.Between(this.x, this.y, sensedThreat.threat.x, sensedThreat.threat.y)
      : Number.POSITIVE_INFINITY;
    const threatState = this.threatResponse.update(
      time,
      sensedThreat?.reading.level ?? 0,
      directlySawThreat,
      threatDistance,
      traits.minimumEscapeDistance,
    );
    if (sensedThreat && threatState === 'flee') {
      this.aiState = 'flee';
      const away = this.getEscapeDirection(time, sensedThreat.threat, habitat, herdMates);
      const fleeSpeed = traits.flee * this.needs.getSprintSpeedFactor();
      this.setVelocity(away.x * fleeSpeed, away.y * fleeSpeed);
      this.activity = 'fleeing';
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
      this.fleeRoute = [];
      this.fleePlanAt = 0;
      if (habitat && (previousState === 'flee' || previousState === 'alert') && this.hasDestination) this.planRoute(habitat);
      const reachedDestination = this.hasDestination
        && Phaser.Math.Distance.Between(this.x, this.y, this.destination.x, this.destination.y) < GOAL_REACH_DISTANCE[this.goal];
      if (reachedDestination && this.goal !== 'explore' && !this.needs.isSatisfied(this.goal, simulationMinutes)) {
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
        if (this.species !== 'rabbit' && herdMates.length > 1) {
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
    this.shadow.sync(this, true, this.activity === 'resting');
    return this.aiState;
  }

  advanceTime(elapsedSeconds: number, startSimulationMinutes = 12 * 60): void {
    if (this.aiState === 'dead') {
      this.decayCarrion(elapsedSeconds);
      return;
    }
    this.needs.advanceTimeFollowingSchedule(elapsedSeconds, startSimulationMinutes, this.activity);
    if (!this.needs.isAlive()) this.die(this.needs.getDeathCause());
  }

  attack(attacker: 'player' | 'pack' = 'player', attackerPosition?: { x: number; y: number }): AttackResult {
    if (this.aiState === 'dead') return { killed: true, retaliation: 0, retaliated: false, safeRearAttack: false };
    if (this.isRetaliating()) return { killed: false, retaliation: 0, retaliated: false, safeRearAttack: false };
    this.health -= 1;
    const killed = this.health <= 0;
    if (killed) {
      this.die();
    } else {
      this.aiState = 'flee';
      this.threatResponse.triggerFlee(this.scene.time.now);
    }
    let retaliation = 0;
    let safeRearAttack = false;
    if (attacker === 'player' && !killed && this.species === 'deer') {
      if (this.balance.mode === 'survival' && attackerPosition) {
        const result = getDeerRetaliation({ deer: this, attacker: attackerPosition, deerFacing: this.animationDirection });
        retaliation = result.damage;
        safeRearAttack = result.safeRearAttack;
        if (retaliation > 0) this.beginRetaliation(result.kickFacing);
      } else if (this.random.frac() < 0.42) {
        retaliation = this.random.integerInRange(5, 12);
        this.beginRetaliation(resolvePlayerFacing(this.x - (attackerPosition?.x ?? this.x - 1), this.y - (attackerPosition?.y ?? this.y)).animationDirection);
      }
    } else if (attacker === 'player' && !killed && this.species === 'boar' && attackerPosition) {
      const result = getBoarDefense({
        boar: this,
        attacker: attackerPosition,
        boarFacing: this.animationDirection,
        healthFraction: this.getHealthFraction(),
        sounderSize: this.sounderSize,
        survivalMode: this.balance.mode === 'survival',
      });
      retaliation = result.damage;
      if (result.charges) this.beginRetaliation(result.chargeFacing, attackerPosition, result.durationMs);
    }
    if (!killed) this.updateAnimation();
    return { killed, retaliation, retaliated: retaliation > 0, safeRearAttack };
  }

  consume(amount: number): number {
    if (!this.isDead() || this.meat <= 0 || this.carried || this.buried) return 0;
    const consumed = Math.min(amount, this.meat);
    this.meat -= consumed;
    this.updateCarcassAlpha();
    if (this.meat <= 0) this.destroy();
    return consumed;
  }

  isDead(): boolean {
    return this.aiState === 'dead';
  }

  isRetaliating(time = this.scene.time.now): boolean {
    return (this.species === 'deer' || this.species === 'boar') && isRetaliationActive(time, this.retaliationUntil);
  }

  hasEdibleMeat(): boolean {
    return this.isDead() && this.meat > 0;
  }

  getMeatAmount(): number {
    return this.meat;
  }

  getMeatCapacity(): number {
    return this.balance.meat[this.species];
  }

  getHealthFraction(): number {
    return this.health / getPreyMaxHealth(this.species);
  }

  getHealth(): number {
    return this.health;
  }

  getNeedsSnapshot(): ReturnType<AnimalNeedsSystem['snapshot']> {
    return this.needs.snapshot();
  }

  restoreHealth(health: number): void {
    if (this.isDead()) return;
    this.health = Phaser.Math.Clamp(health, 1, getPreyMaxHealth(this.species));
    this.updateAnimation();
  }

  scavenge(lossFraction: number): number {
    if (!this.isBuried() || !this.hasEdibleMeat()) return 0;
    const before = this.meat;
    this.meat = applyScavengerLoss(this.meat, lossFraction);
    if (this.meat <= 0.1) this.destroy();
    else this.updateCarcassAlpha();
    return before - this.meat;
  }

  migrateTo(destination: { x: number; y: number }, habitat: PreyHabitat, time: number): void {
    if (this.isDead()) return;
    this.goal = 'explore';
    this.destination.set(destination.x, destination.y);
    this.hasDestination = true;
    this.habitat = habitat;
    this.planRoute(habitat);
    this.decisionAt = time + 120_000;
  }

  isCarried(): boolean {
    return this.carried;
  }

  isBuried(): boolean {
    return this.buried;
  }

  setCacheProtected(protectedCache: boolean): void {
    this.cacheMound?.setTint(protectedCache ? 0x8eb58c : 0xc29a72);
  }

  pickUp(): boolean {
    if (!this.hasEdibleMeat()) return false;
    this.carried = true;
    this.buried = false;
    this.destroyCacheMound();
    this.setVisible(false).setScale(this.baseScale).setRotation(0);
    this.updateCarcassAlpha();
    this.shadow.sync(this, false);
    return true;
  }

  setCarriedPosition(x: number, y: number): void {
    if (!this.carried) return;
    this.setPosition(x, y);
  }

  buryAt(x: number, y: number): boolean {
    if (!this.hasEdibleMeat()) return false;
    this.carried = false;
    this.buried = true;
    this.setPosition(x, y).setVisible(false);
    this.shadow.sync(this, false);
    this.drawCacheMound();
    return true;
  }

  unbury(): boolean {
    if (!this.buried || !this.hasEdibleMeat()) return false;
    this.buried = false;
    this.destroyCacheMound();
    this.setVisible(true).setScale(this.baseScale).setRotation(0).setDepth(this.y - 2);
    this.updateCarcassAlpha();
    return true;
  }

  restoreCarcass(meat: number, state: 'exposed' | 'buried' | 'carried'): void {
    this.meat = Phaser.Math.Clamp(meat, 0.1, this.balance.meat[this.species]);
    this.die();
    if (state === 'buried') this.buryAt(this.x, this.y);
    else if (state === 'carried') this.pickUp();
  }

  getState(): PreyState {
    return this.aiState;
  }

  getAwarenessReading(): AwarenessReading | undefined {
    return this.awarenessReading;
  }

  getDeathCause(): AnimalDeathCause | undefined {
    return this.deathCause;
  }

  override destroy(fromScene?: boolean): void {
    this.destroyCacheMound();
    this.shadow.destroy();
    super.destroy(fromScene);
  }

  handleTerrainCollision(): void {
    if (this.aiState === 'dead') return;
    if (this.aiState === 'flee') {
      this.fleeRoute = [];
      this.fleePlanAt = 0;
      return;
    }
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

  private die(cause?: AnimalDeathCause): void {
    if (this.aiState === 'dead') return;
    this.deathCause = cause;
    this.aiState = 'dead';
    this.setVelocity(0, 0);
    this.anims.stop();
    this.setScale(this.baseScale);
    const woundLevel = getPreyDeathWoundLevel(this.species);
    this.setTexture(
      getPreyAnimationTextureKey(this.species, 'dead', woundLevel),
      getPreyAnimationFrames(this.animationDirection, 'dead')[0],
    );
    this.clearTint().setAngle(0).setRotation(0).setAlpha(0.9);
    this.setDepth(this.y - 2);
    this.shadow.sync(this, false);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.enable = false;
  }

  private updateCarcassAlpha(): void {
    const originalMeat = this.balance.meat[this.species];
    this.setAlpha(0.32 + (this.meat / originalMeat) * 0.56);
    this.cacheMound?.setAlpha(0.42 + (this.meat / originalMeat) * 0.5);
  }

  private decayCarrion(deltaSeconds: number): void {
    if (!this.hasEdibleMeat()) return;
    const originalMeat = this.balance.meat[this.species];
    this.meat = decayCarrionMeat(
      this.meat,
      originalMeat,
      deltaSeconds,
      this.buried ? 'buried' : this.carried ? 'carried' : 'exposed',
      {
        exposed: this.balance.cache.exposedLifetimeSeconds,
        buried: this.balance.cache.buriedLifetimeSeconds,
      },
    );
    if (this.meat <= 0) {
      this.destroy();
      return;
    }
    this.updateCarcassAlpha();
  }

  private drawCacheMound(): void {
    this.destroyCacheMound();
    const width = this.species === 'rabbit' ? 76 : this.species === 'elk' ? 142 : this.species === 'boar' ? 126 : 118;
    const mound = this.scene.add.image(this.x, this.y, 'cache-mound')
      .setDisplaySize(width, width * (341 / 512))
      .setRotation((((Math.floor(this.x) + Math.floor(this.y)) % 9) - 4) * 0.035)
      .setAlpha(0.92)
      .setDepth(this.y - 1);
    this.cacheMound = mound;
  }

  private destroyCacheMound(): void {
    this.cacheMound?.destroy();
    this.cacheMound = undefined;
  }

  private herdCenter(herdMates: readonly Prey[]): Phaser.Math.Vector2 {
    const living = herdMates.filter((animal) => animal.active && !animal.isDead());
    if (living.length === 0) return new Phaser.Math.Vector2(this.x, this.y);
    const sum = living.reduce((center, animal) => center.add(new Phaser.Math.Vector2(animal.x, animal.y)), new Phaser.Math.Vector2());
    return sum.scale(1 / living.length);
  }

  private getEscapeDirection(
    time: number,
    threat: ThreatStimulus,
    habitat: PreyHabitat | undefined,
    herdMates: readonly Prey[],
  ): Phaser.Math.Vector2 {
    const threatMoved = !Number.isFinite(this.lastFleeThreat.x)
      || Phaser.Math.Distance.Between(threat.x, threat.y, this.lastFleeThreat.x, this.lastFleeThreat.y) > 180;
    if (habitat && (this.fleeRoute.length === 0 || time >= this.fleePlanAt || threatMoved)) {
      this.fleeRoute = habitat.findEscapePath(this, threat, this.escapeLateralBias)
        .map((point) => new Phaser.Math.Vector2(point.x, point.y));
      this.fleePlanAt = time + 900;
      this.lastFleeThreat.set(threat.x, threat.y);
    }
    while (this.fleeRoute.length > 0
      && Phaser.Math.Distance.Between(this.x, this.y, this.fleeRoute[0].x, this.fleeRoute[0].y) < 42) this.fleeRoute.shift();
    const position = new Phaser.Math.Vector2(this.x, this.y);
    const away = position.clone().subtract(new Phaser.Math.Vector2(threat.x, threat.y)).normalize();
    const direction = this.fleeRoute.length > 0
      ? this.fleeRoute[0].clone().subtract(position).normalize()
      : away.clone();
    const lateral = new Phaser.Math.Vector2(-away.y, away.x);
    direction.add(lateral.scale(
      this.escapeLateralBias * 0.12 + Math.sin(time / 430 + this.escapePhase) * 0.08,
    ));
    if (this.species !== 'rabbit') direction.add(this.herdSeparation(herdMates).scale(0.55));

    const constrained = constrainEscapeHeading(this, threat, direction, 0.2);
    return new Phaser.Math.Vector2(constrained.x, constrained.y);
  }

  private herdSeparation(herdMates: readonly Prey[]): Phaser.Math.Vector2 {
    const separation = new Phaser.Math.Vector2();
    for (const animal of herdMates) {
      if (animal === this || !animal.active || animal.isDead()) continue;
      const offset = new Phaser.Math.Vector2(this.x - animal.x, this.y - animal.y);
      const distance = offset.length();
      if (distance === 0 || distance >= 170) continue;
      separation.add(offset.scale((170 - distance) / (170 * distance)));
    }
    return separation.lengthSq() > 1 ? separation.normalize() : separation;
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
    if (this.isRetaliating()) {
      this.setScale(this.baseScale);
      this.setRotation(0);
      this.anims.timeScale = 1;
      this.playAnimation('retaliating');
      return;
    }
    const body = this.body as Phaser.Physics.Arcade.Body;
    if (body.velocity.lengthSq() < 4) {
      const state: PreyAnimationState = this.activity === 'foraging'
        ? 'foraging'
        : this.activity === 'drinking'
          ? 'drinking'
          : this.activity === 'resting'
            ? 'resting'
            : 'idle';
      this.setScale(this.baseScale);
      this.setRotation(0);
      this.anims.timeScale = 1;
      this.playAnimation(state);
      return;
    }
    this.setScale(this.baseScale);
    const facing = resolvePlayerFacing(body.velocity.x, body.velocity.y);
    this.animationDirection = facing.animationDirection;
    this.setRotation(0);
    const state = this.aiState === 'flee' ? 'flee' : 'walk';
    this.playAnimation(state);
    const expectedSpeed = state === 'flee' ? TRAITS[this.species].flee : TRAITS[this.species].roam;
    this.anims.timeScale = getPreyAnimationSpeedScale(state, body.velocity.length(), expectedSpeed);
  }

  private beginRetaliation(
    direction: PlayerDirection,
    target?: { x: number; y: number },
    durationMs = PREY_RETALIATION_DURATION_MS,
  ): void {
    this.animationDirection = direction;
    this.retaliationUntil = this.scene.time.now + durationMs;
    if (target) this.retaliationTarget.set(target.x, target.y);
    else this.retaliationTarget.set(Number.NaN, Number.NaN);
    this.aiState = 'alert';
    this.setVelocity(0, 0);
    this.activity = 'idle';
    this.playAnimation('retaliating');
  }

  private playAnimation(state: PreyAnimationState): void {
    const woundLevel = getPreyWoundLevel(this.species, this.health);
    const key = getPreyAnimationKey(this.species, this.animationDirection, state, woundLevel);
    const currentKey = this.anims.currentAnim?.key ?? '';
    if (currentKey === key) {
      this.animationState = state;
      if (state !== 'retaliating' || this.anims.isPlaying) this.anims.play(key, true);
      return;
    }
    const preserveProgress = this.anims.isPlaying
      && (stripWoundTextureSuffix(currentKey) === stripWoundTextureSuffix(key)
        || shouldPreservePreyGaitProgress(this.animationState, state));
    const progress = preserveProgress ? this.anims.getProgress() : 0;
    this.anims.play(key);
    if (preserveProgress) this.anims.setProgress(progress);
    this.animationState = state;
  }
}
