import { getPlayerDirectionVector, resolvePlayerFacing, type PlayerDirection } from './DirectionalSpriteSystem';

export const WOUND_LEVELS = [0, 1, 2, 3] as const;
export type WoundLevel = typeof WOUND_LEVELS[number];
export type WoundTextureSuffix = '' | '-wound-1' | '-wound-2' | '-wound-3';

export interface DeerRetaliationInput {
  deer: { x: number; y: number };
  attacker: { x: number; y: number };
  deerFacing: PlayerDirection;
}

export interface DeerRetaliationResult {
  safeRearAttack: boolean;
  damage: number;
  kickFacing: PlayerDirection;
}

export const isRetaliationActive = (time: number, retaliationUntil: number): boolean => (
  Number.isFinite(time) && Number.isFinite(retaliationUntil) && time < retaliationUntil
);

export const getDeerRetaliation = (input: DeerRetaliationInput): DeerRetaliationResult => {
  const [facingX, facingY] = getPlayerDirectionVector(input.deerFacing);
  const deltaX = input.attacker.x - input.deer.x;
  const deltaY = input.attacker.y - input.deer.y;
  const length = Math.hypot(deltaX, deltaY) || 1;
  const facingDot = facingX * deltaX / length + facingY * deltaY / length;
  const safeRearAttack = facingDot < -0.35;
  if (safeRearAttack) return { safeRearAttack: true, damage: 0, kickFacing: input.deerFacing };

  const awayX = -deltaX / length;
  const awayY = -deltaY / length;
  const kickFacing = resolvePlayerFacing(awayX, awayY).animationDirection;
  const damage = Math.round(12 + Math.max(0, facingDot) * 8);
  return { safeRearAttack: false, damage, kickFacing };
};

export const getInjuryMobilityFactor = (health: number): number => {
  if (health < 30) return 0.72;
  if (health < 60) return 0.84;
  if (health < 85) return 0.93;
  return 1;
};

export const getInjuryStaminaCapacity = (health: number): number => {
  if (health < 30) return 68;
  if (health < 60) return 82;
  if (health < 85) return 92;
  return 100;
};

export const getWoundLevel = (healthPercent: number): WoundLevel => {
  if (healthPercent >= 85) return 0;
  if (healthPercent >= 60) return 1;
  if (healthPercent >= 30) return 2;
  return 3;
};

export const getWoundTextureSuffix = (level: WoundLevel): WoundTextureSuffix => (
  level === 0 ? '' : `-wound-${level}`
);

export const getWoundStage = (healthPercent: number): -1 | 0 | 1 | 2 => {
  const level = getWoundLevel(healthPercent);
  return level === 0 ? -1 : (level - 1) as 0 | 1 | 2;
};
