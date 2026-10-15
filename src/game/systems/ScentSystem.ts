import Phaser from 'phaser';
import type { Prey } from '../entities/Prey';
import type { PackWolf } from '../entities/PackWolf';
import { distanceToAreas, type AxisAlignedArea, type PointLike } from './geometry';
import {
  getScentDirection,
  getScentTrailStrength,
  SCENT_RENDER_RADIUS,
  SCENT_TRAIL_LIFETIME_MS,
  type ScentDirection,
} from './ScentDirectionSystem';
import { getAnimalScentSpecies, type ScentSpecies } from './ScentSpeciesSystem';

interface ScentMark extends PointLike {
  createdAt: number;
  species: ScentSpecies;
}

export interface ScentReading extends ScentDirection {
  summary: string;
}

export const EMPTY_SCENT_READING: ScentReading = {
  arrow: '•',
  label: 'HERE',
  summary: '',
};

export class ScentSystem {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly marks: ScentMark[] = [];
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

  record(time: number, prey: readonly Prey[], pack: readonly PackWolf[] = []): void {
    if (time - this.lastMarkAt < 580) return;
    this.lastMarkAt = time;
    for (const animal of prey) {
      const species = getAnimalScentSpecies(animal.species, animal.isDead(), animal.hasEdibleMeat());
      if (species) this.marks.push({ x: animal.x, y: animal.y, createdAt: time, species });
    }
    for (const wolf of pack) {
      this.marks.push({ x: wolf.x, y: wolf.y, createdAt: time, species: 'pack' });
    }
    const cutoff = time - SCENT_TRAIL_LIFETIME_MS;
    while (this.marks[0]?.createdAt < cutoff) this.marks.shift();
  }

  render(time: number, player: Phaser.GameObjects.Components.Transform): ScentReading {
    this.graphics.clear();
    if (!this.active) return EMPTY_SCENT_READING;

    const strongestBySpecies = new Map<ScentMark['species'], { strength: number; x: number; y: number }>();
    let strongest: { strength: number; x: number; y: number } | undefined;
    for (const [index, mark] of this.marks.entries()) {
      const distance = Phaser.Math.Distance.Between(player.x, player.y, mark.x, mark.y);
      if (distance > SCENT_RENDER_RADIUS) continue;
      const ageMs = Math.max(0, time - mark.createdAt);
      const age = ageMs / SCENT_TRAIL_LIFETIME_MS;
      const strength = getScentTrailStrength(ageMs, distance);
      if (strength <= 0.05) continue;

      const drift = age * 52;
      const wobble = Math.sin(index * 2.23 + time / 700) * 9;
      const x = mark.x + this.wind.x * drift - this.wind.y * wobble;
      const y = mark.y + this.wind.y * drift + this.wind.x * wobble;
      const speciesReading = strongestBySpecies.get(mark.species);
      if (!speciesReading || strength > speciesReading.strength) strongestBySpecies.set(mark.species, { strength, x, y });
      if (!strongest || strength > strongest.strength) strongest = { strength, x, y };
      const color = mark.species === 'rabbit'
        ? 0x65d6c8
        : mark.species === 'deer' ? 0xd2bd64 : mark.species === 'carcass' ? 0xd78366 : 0xa9c9a4;
      this.graphics.fillStyle(color, Phaser.Math.Clamp(strength * 0.82, 0.11, 0.58));
      this.graphics.fillCircle(x, y, 3.5 + strength * 5);
      this.graphics.lineStyle(1.5, color, strength * 0.28);
      this.graphics.strokeCircle(x, y, 9 + strength * 10);
    }

    const waterDistance = distanceToAreas(player, this.waterAreas);
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
        strongest = { strength: waterStrength, x: player.x - this.wind.x * 120, y: player.y - this.wind.y * 120 };
      }
    }

    const clues: string[] = [];
    const addClue = (species: ScentMark['species'], description: string): void => {
      const reading = strongestBySpecies.get(species);
      if (!reading) return;
      const direction = getScentDirection(reading.x - player.x, reading.y - player.y);
      clues.push(`${direction.arrow} ${direction.label} ${description}`);
    };
    addClue('rabbit', 'fresh rabbit spoor');
    addClue('deer', 'faint deer musk');
    addClue('carcass', 'carrion nearby');
    addClue('pack', 'pack nearby');
    if (waterDistance < 520) clues.push('cold water upwind');
    const direction = strongest
      ? getScentDirection(strongest.x - player.x, strongest.y - player.y)
      : EMPTY_SCENT_READING;
    return {
      arrow: direction.arrow,
      label: direction.label,
      summary: clues.length > 0 ? clues.join(' · ') : 'The wind carries no clear trail.',
    };
  }

  destroy(): void {
    this.graphics.destroy();
    this.marks.length = 0;
  }
}
