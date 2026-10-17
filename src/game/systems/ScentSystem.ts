import Phaser from 'phaser';
import type { Prey } from '../entities/Prey';
import type { PackWolf } from '../entities/PackWolf';
import { distanceToArea, distanceToAreas, type AxisAlignedArea, type PointLike } from './geometry';
import {
  CACHED_MEAT_SCENT_RADIUS,
  getCachedMeatScentStrength,
  getScentDirection,
  getScentTrailStrength,
  isScentTrailTrackable,
  SCENT_RENDER_RADIUS,
  SCENT_TRAIL_LIFETIME_MS,
  type ScentDirection,
} from './ScentDirectionSystem';
import { getAnimalScentSpecies, type ScentSpecies } from './ScentSpeciesSystem';
import {
  getScentParticleAppearance,
  getScentParticlePosition,
  getStablePulse,
  getStableScentPhase,
} from './ScentMotionSystem';
import { getTerritoryMarkColor, getTerritoryMarkStrength, type TerritoryMark } from './TerritoryMarkSystem';
import type { SenseKind } from './SenseHudSystem';

interface ScentMark extends PointLike {
  createdAt: number;
  species: ScentSpecies;
  source?: Prey | PackWolf;
  sourceId: string;
  readonly phase: number;
}

export interface ScentClue {
  text: string;
  targeted: boolean;
}

export interface ScentReading extends ScentDirection {
  summary: string;
  clues: ScentClue[];
  trackingTarget: boolean;
  signals: ScentSignal[];
}

export interface ScentSignal extends PointLike {
  sourceId: string;
  kind: SenseKind;
  strength: number;
  targeted: boolean;
}

export const EMPTY_SCENT_READING: ScentReading = {
  arrow: '•',
  label: 'HERE',
  summary: '',
  clues: [],
  trackingTarget: false,
  signals: [],
};

export class ScentSystem {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly marks: ScentMark[] = [];
  private cachedFood: Prey[] = [];
  private readonly sourceIds = new WeakMap<object, string>();
  private nextSourceId = 1;
  private lastMarkAt = 0;
  private active = false;

  constructor(
    scene: Phaser.Scene,
    private readonly waterAreas: readonly AxisAlignedArea[],
    private readonly wind = new Phaser.Math.Vector2(0.78, 0.36),
  ) {
    this.graphics = scene.add.graphics().setDepth(9).setBlendMode(Phaser.BlendModes.ADD);
  }

  toggle(): boolean {
    this.active = !this.active;
    if (!this.active) this.graphics.clear();
    return this.active;
  }

  isActive(): boolean {
    return this.active;
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) this.graphics.clear();
  }

  setWind(x: number, y: number, strength: number): void {
    this.wind.set(x, y).normalize().scale(0.55 + strength * 0.7);
  }

  getSourceId(source: object, prefix = 'animal'): string {
    const existing = this.sourceIds.get(source);
    if (existing) return existing;
    const sourceId = `${prefix}:${this.nextSourceId}`;
    this.nextSourceId += 1;
    this.sourceIds.set(source, sourceId);
    return sourceId;
  }

  record(time: number, prey: readonly Prey[], pack: readonly PackWolf[] = []): void {
    if (time - this.lastMarkAt < 580) return;
    this.lastMarkAt = time;
    this.cachedFood = prey.filter((animal) => animal.active && animal.isBuried() && animal.hasEdibleMeat());
    for (const animal of prey) {
      if (animal.isBuried() || animal.isCarried()) continue;
      const species = getAnimalScentSpecies(animal.species, animal.isDead(), animal.hasEdibleMeat());
      if (species) this.marks.push({
        x: animal.x,
        y: animal.y,
        createdAt: time,
        species,
        source: animal,
        sourceId: this.getSourceId(animal),
        phase: getStableScentPhase(animal.x, animal.y, time, species.length),
      });
    }
    for (const wolf of pack) {
      this.marks.push({
        x: wolf.x,
        y: wolf.y,
        createdAt: time,
        species: 'pack',
        source: wolf,
        sourceId: this.getSourceId(wolf, 'pack'),
        phase: getStableScentPhase(wolf.x, wolf.y, time, wolf.wolfName === 'Niva' ? 1 : 2),
      });
    }
    const cutoff = time - SCENT_TRAIL_LIFETIME_MS;
    while (this.marks[0]?.createdAt < cutoff) this.marks.shift();
  }

  hasTrackableTrail(
    time: number,
    player: Phaser.GameObjects.Components.Transform,
    target: Prey,
  ): boolean {
    return this.marks.some((mark) => mark.source === target && isScentTrailTrackable(
      Math.max(0, time - mark.createdAt),
      Phaser.Math.Distance.Between(player.x, player.y, mark.x, mark.y),
    ));
  }

  render(
    time: number,
    player: Phaser.GameObjects.Components.Transform,
    territoryMarks: readonly TerritoryMark[] = [],
    simulationMinutes = 0,
    targetedPrey?: Prey,
  ): ScentReading {
    this.graphics.clear();
    if (!this.active) return EMPTY_SCENT_READING;

    const strongestBySpecies = new Map<ScentMark['species'], { strength: number; x: number; y: number }>();
    const signalsById = new Map<string, ScentSignal>();
    let strongest: { strength: number; x: number; y: number } | undefined;
    let strongestTarget: { strength: number; x: number; y: number } | undefined;
    for (const mark of this.marks) {
      const distance = Phaser.Math.Distance.Between(player.x, player.y, mark.x, mark.y);
      if (distance > SCENT_RENDER_RADIUS) continue;
      const ageMs = Math.max(0, time - mark.createdAt);
      if (!isScentTrailTrackable(ageMs, distance)) continue;
      const age = ageMs / SCENT_TRAIL_LIFETIME_MS;
      const strength = getScentTrailStrength(ageMs, distance);

      const { x, y } = getScentParticlePosition({
        x: mark.x,
        y: mark.y,
        windX: this.wind.x,
        windY: this.wind.y,
        ageProgress: age,
        timeMs: time,
        phase: mark.phase,
      });
      const targeted = mark.source === targetedPrey;
      const signalKey = `${mark.sourceId}:${mark.species}`;
      const scentSignal = signalsById.get(signalKey);
      if (!scentSignal || strength > scentSignal.strength) {
        signalsById.set(signalKey, {
          sourceId: mark.sourceId,
          kind: mark.species,
          x,
          y,
          strength,
          targeted,
        });
      } else if (targeted) {
        scentSignal.targeted = true;
      }
      const speciesReading = strongestBySpecies.get(mark.species);
      if (!targeted && (!speciesReading || strength > speciesReading.strength)) {
        strongestBySpecies.set(mark.species, { strength, x, y });
      }
      if (targeted && (!strongestTarget || strength > strongestTarget.strength)) strongestTarget = { strength, x, y };
      if (!strongest || strength > strongest.strength) strongest = { strength, x, y };
      const color = targeted
        ? 0xe85a54
        : mark.species === 'rabbit'
        ? 0x65d6c8
        : mark.species === 'deer' ? 0xd2bd64 : mark.species === 'elk' ? 0xb99b72 : mark.species === 'boar' ? 0x9b7357 : mark.species === 'carcass' ? 0xd78366 : 0xa9c9a4;
      const appearance = getScentParticleAppearance(strength, targeted);
      this.graphics.fillStyle(color, appearance.fillAlpha);
      this.graphics.fillCircle(x, y, appearance.radius);
      this.graphics.lineStyle(appearance.ringWidth, color, appearance.ringAlpha);
      this.graphics.strokeCircle(x, y, appearance.ringRadius);
    }

    let strongestTerritory: { strength: number; x: number; y: number } | undefined;
    for (const mark of territoryMarks) {
      const distance = Phaser.Math.Distance.Between(player.x, player.y, mark.x, mark.y);
      const strength = getTerritoryMarkStrength(simulationMinutes - mark.createdAt, distance);
      if (strength <= 0.025) continue;
      if (!strongestTerritory || strength > strongestTerritory.strength) {
        strongestTerritory = { strength, x: mark.x, y: mark.y };
      }
      signalsById.set(`territory:${mark.ownerId ?? 'player'}:${mark.createdAt}:${mark.x}:${mark.y}`, {
        sourceId: `territory:${mark.ownerId ?? 'player'}:${mark.createdAt}:${mark.x}:${mark.y}`,
        kind: 'territory',
        x: mark.x,
        y: mark.y,
        strength,
        targeted: false,
      });
      if (!strongest || strength > strongest.strength) strongest = { strength, x: mark.x, y: mark.y };
      const color = getTerritoryMarkColor(mark);
      const pulse = getStablePulse(
        time,
        getStableScentPhase(mark.x, mark.y, mark.createdAt, 11),
        520,
        1,
        0.06,
      );
      const size = (16 + strength * 7) * pulse;
      const alpha = Phaser.Math.Clamp(strength * 0.58, 0.1, 0.58);
      this.graphics.fillStyle(color, alpha * 0.78);
      this.graphics.fillEllipse(mark.x, mark.y + size * 0.24, size * 1.05, size * 0.86);
      this.graphics.fillStyle(color, alpha);
      this.graphics.fillCircle(mark.x - size * 0.47, mark.y - size * 0.2, size * 0.22);
      this.graphics.fillCircle(mark.x - size * 0.17, mark.y - size * 0.46, size * 0.24);
      this.graphics.fillCircle(mark.x + size * 0.17, mark.y - size * 0.46, size * 0.24);
      this.graphics.fillCircle(mark.x + size * 0.47, mark.y - size * 0.2, size * 0.22);
    }

    let strongestCache: { strength: number; x: number; y: number } | undefined;
    for (const cache of this.cachedFood) {
      if (!cache.active || !cache.isBuried() || !cache.hasEdibleMeat()) continue;
      const distance = Phaser.Math.Distance.Between(player.x, player.y, cache.x, cache.y);
      if (distance > CACHED_MEAT_SCENT_RADIUS) continue;
      const strength = getCachedMeatScentStrength(distance);
      if (!strongestCache || strength > strongestCache.strength) strongestCache = { strength, x: cache.x, y: cache.y };
      if (!strongest || strength > strongest.strength) strongest = { strength, x: cache.x, y: cache.y };
      const sourceId = this.getSourceId(cache);
      signalsById.set(`${sourceId}:cache`, {
        sourceId,
        kind: 'cache',
        x: cache.x,
        y: cache.y,
        strength,
        targeted: false,
      });
      if (distance <= SCENT_RENDER_RADIUS) {
        const pulse = getStablePulse(
          time,
          getStableScentPhase(cache.x, cache.y, 0, 23),
          420,
          4,
          1.4,
        );
        this.graphics.fillStyle(0xdf9a68, Phaser.Math.Clamp(strength * 0.42, 0.08, 0.38));
        this.graphics.fillCircle(cache.x, cache.y, pulse + strength * 5);
        this.graphics.lineStyle(2, 0xdf9a68, strength * 0.34);
        this.graphics.strokeCircle(cache.x, cache.y, 16 + strength * 18);
      }
    }

    const waterDistance = distanceToAreas(player, this.waterAreas);
    let nearestWaterPoint: PointLike | undefined;
    let nearestWaterDistance = Number.POSITIVE_INFINITY;
    for (const [index, area] of this.waterAreas.entries()) {
      const distance = distanceToArea(player, area);
      if (distance >= 520) continue;
      const point = {
        x: Phaser.Math.Clamp(player.x, area.x, area.x + area.width),
        y: Phaser.Math.Clamp(player.y, area.y, area.y + area.height),
      };
      const strength = (1 - distance / 520) * 0.72;
      signalsById.set(`water:${area.x}:${area.y}:${area.width}:${area.height}:${index}`, {
        sourceId: `water:${area.x}:${area.y}:${area.width}:${area.height}:${index}`,
        kind: 'water',
        ...point,
        strength,
        targeted: false,
      });
      if (distance < nearestWaterDistance) {
        nearestWaterDistance = distance;
        nearestWaterPoint = point;
      }
    }
    if (waterDistance < 520) {
      for (let index = 0; index < 9; index += 1) {
        const angle = index * 0.71 + time / 2600;
        const radius = 55 + index * 18;
        this.graphics.fillStyle(0x75c5d5, 0.11 + (index % 3) * 0.04);
        this.graphics.fillCircle(
          player.x + Math.cos(angle) * radius - this.wind.x * waterDistance * 0.12,
          player.y + Math.sin(angle) * radius - this.wind.y * waterDistance * 0.12,
          3 + (index % 2),
        );
      }
      const waterStrength = (1 - waterDistance / 520) * 0.72;
      if (!strongest || waterStrength > strongest.strength) {
        strongest = {
          strength: waterStrength,
          x: nearestWaterPoint?.x ?? player.x - this.wind.x * 120,
          y: nearestWaterPoint?.y ?? player.y - this.wind.y * 120,
        };
      }
    }

    const clues: ScentClue[] = [];
    if (strongestTarget && targetedPrey) {
      const targetDirection = getScentDirection(strongestTarget.x - player.x, strongestTarget.y - player.y);
      clues.push({ text: `${targetDirection.arrow} ${targetDirection.label} marked ${targetedPrey.species} trail`, targeted: true });
    } else if (targetedPrey) {
      clues.push({ text: `Marked ${targetedPrey.species} scent is out of range`, targeted: true });
    }
    const addClue = (species: ScentMark['species'], description: string): void => {
      const reading = strongestBySpecies.get(species);
      if (!reading) return;
      const direction = getScentDirection(reading.x - player.x, reading.y - player.y);
      clues.push({ text: `${direction.arrow} ${direction.label} ${description}`, targeted: false });
    };
    addClue('rabbit', 'fresh rabbit spoor');
    addClue('deer', 'faint deer musk');
    addClue('elk', 'heavy elk musk');
    addClue('boar', 'earthy boar musk');
    addClue('carcass', 'carrion nearby');
    addClue('pack', 'pack nearby');
    if (strongestCache) {
      const cacheDirection = getScentDirection(strongestCache.x - player.x, strongestCache.y - player.y);
      clues.push({ text: `${cacheDirection.arrow} ${cacheDirection.label} buried meat cache`, targeted: false });
    }
    if (strongestTerritory) {
      const markDirection = getScentDirection(strongestTerritory.x - player.x, strongestTerritory.y - player.y);
      clues.push({ text: `${markDirection.arrow} ${markDirection.label} your territory mark`, targeted: false });
    }
    if (waterDistance < 520) clues.push({ text: 'cold water upwind', targeted: false });
    if (clues.length === 0) clues.push({ text: 'The wind carries no clear trail.', targeted: false });
    const directionalScent = targetedPrey ? strongestTarget : strongest;
    const direction = directionalScent
      ? getScentDirection(directionalScent.x - player.x, directionalScent.y - player.y)
      : EMPTY_SCENT_READING;
    return {
      arrow: direction.arrow,
      label: direction.label,
      summary: clues.map((clue) => clue.text).join(' · '),
      clues,
      trackingTarget: targetedPrey !== undefined,
      signals: [...signalsById.values()],
    };
  }

  clearTransientTrails(): void {
    this.marks.length = 0;
    this.cachedFood.length = 0;
    this.lastMarkAt = 0;
    this.graphics.clear();
  }

  destroy(): void {
    this.graphics.destroy();
    this.marks.length = 0;
    this.cachedFood.length = 0;
  }
}
