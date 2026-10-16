export interface TerritoryMark {
  x: number;
  y: number;
  createdAt: number;
  ownerId?: string;
  color?: number;
}

export interface TerritoryMarkOwner {
  id: string;
  color: number;
}

export type TerritoryMarkResult =
  | { marked: true; refreshed: boolean; count: number }
  | { marked: false; reason: 'cooldown'; count: number };

export const TERRITORY_MARK_LIFETIME_MINUTES = 24 * 60;
export const TERRITORY_MARK_COOLDOWN_MINUTES = 15;
export const TERRITORY_MARK_REFRESH_RADIUS = 180;
export const TERRITORY_MARK_SCENT_RADIUS = 1_500;
export const MAX_TERRITORY_MARKS = 12;
export const PLAYER_TERRITORY_MARK_OWNER: TerritoryMarkOwner = { id: 'player', color: 0x78d98b };

export const getTerritoryMarkColor = (mark: TerritoryMark): number => (
  Number.isInteger(mark.color) && (mark.color ?? -1) >= 0 && (mark.color ?? 0) <= 0xffffff
    ? mark.color as number
    : PLAYER_TERRITORY_MARK_OWNER.color
);

export const getTerritoryMarkStrength = (ageMinutes: number, distance = 0): number => {
  const ageStrength = 1 - Math.max(0, ageMinutes) / TERRITORY_MARK_LIFETIME_MINUTES;
  const distanceStrength = 1 - Math.max(0, distance) / TERRITORY_MARK_SCENT_RADIUS;
  return Math.max(0, Math.min(1, ageStrength * distanceStrength));
};

export class TerritoryMarkSystem {
  private marks: TerritoryMark[] = [];

  canMark(simulationMinutes: number, ownerId = PLAYER_TERRITORY_MARK_OWNER.id): boolean {
    this.prune(simulationMinutes);
    const newest = this.marks.slice().reverse()
      .find((mark) => (mark.ownerId ?? PLAYER_TERRITORY_MARK_OWNER.id) === ownerId);
    return newest === undefined || simulationMinutes - newest.createdAt >= TERRITORY_MARK_COOLDOWN_MINUTES;
  }

  mark(
    point: { x: number; y: number },
    simulationMinutes: number,
    owner: TerritoryMarkOwner = PLAYER_TERRITORY_MARK_OWNER,
  ): TerritoryMarkResult {
    this.prune(simulationMinutes);
    if (!this.canMark(simulationMinutes, owner.id)) return { marked: false, reason: 'cooldown', count: this.marks.length };

    const nearbyIndex = this.marks.findIndex((mark) => (
      (mark.ownerId ?? PLAYER_TERRITORY_MARK_OWNER.id) === owner.id
      &&
      Math.hypot(mark.x - point.x, mark.y - point.y) <= TERRITORY_MARK_REFRESH_RADIUS
    ));
    const refreshed = nearbyIndex >= 0;
    if (refreshed) this.marks.splice(nearbyIndex, 1);
    this.marks.push({
      x: point.x,
      y: point.y,
      createdAt: simulationMinutes,
      ownerId: owner.id,
      color: owner.color,
    });
    if (this.marks.length > MAX_TERRITORY_MARKS) this.marks.splice(0, this.marks.length - MAX_TERRITORY_MARKS);
    return { marked: true, refreshed, count: this.marks.length };
  }

  getActiveMarks(simulationMinutes: number): readonly TerritoryMark[] {
    this.prune(simulationMinutes);
    return this.marks;
  }

  snapshot(simulationMinutes: number): TerritoryMark[] {
    return this.getActiveMarks(simulationMinutes).map((mark) => ({ ...mark }));
  }

  restore(marks: readonly TerritoryMark[], simulationMinutes: number): void {
    this.marks = marks
      .filter((mark) => Number.isFinite(mark.x) && Number.isFinite(mark.y) && Number.isFinite(mark.createdAt))
      .map((mark) => ({
        ...mark,
        createdAt: Math.min(mark.createdAt, simulationMinutes),
        ownerId: mark.ownerId ?? PLAYER_TERRITORY_MARK_OWNER.id,
        color: getTerritoryMarkColor(mark),
      }))
      .sort((left, right) => left.createdAt - right.createdAt)
      .slice(-MAX_TERRITORY_MARKS);
    this.prune(simulationMinutes);
  }

  private prune(simulationMinutes: number): void {
    const cutoff = simulationMinutes - TERRITORY_MARK_LIFETIME_MINUTES;
    this.marks = this.marks.filter((mark) => mark.createdAt > cutoff);
  }
}
