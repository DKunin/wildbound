import { getPlayerDirectionVector, resolvePlayerFacing, type PlayerDirection } from './DirectionalSpriteSystem';
import { PREY_RETALIATION_DURATION_MS } from './PreyAnimationSystem';

export interface BoarDefenseInput {
  boar: { x: number; y: number };
  attacker: { x: number; y: number };
  boarFacing: PlayerDirection;
  healthFraction: number;
  sounderSize: number;
  survivalMode: boolean;
}

export interface BoarDefenseResult {
  charges: boolean;
  damage: number;
  chargeFacing: PlayerDirection;
  durationMs: number;
}

export const getBoarDefense = ({
  boar,
  attacker,
  boarFacing,
  healthFraction,
  sounderSize,
  survivalMode,
}: BoarDefenseInput): BoarDefenseResult => {
  const offsetX = attacker.x - boar.x;
  const offsetY = attacker.y - boar.y;
  const distance = Math.hypot(offsetX, offsetY);
  const [facingX, facingY] = getPlayerDirectionVector(boarFacing);
  const inverseDistance = distance > 0 ? 1 / distance : 0;
  const threatAlignment = facingX * offsetX * inverseDistance + facingY * offsetY * inverseDistance;
  const wounded = healthFraction <= 0.75;
  const protectedBySounder = sounderSize >= 3;
  const charges = distance <= 118 && (threatAlignment > -0.45 || wounded || protectedBySounder);
  const injuryPressure = Math.round((1 - Math.max(0, Math.min(1, healthFraction))) * 7);
  const sounderPressure = Math.min(4, Math.max(0, sounderSize - 1));

  return {
    charges,
    damage: charges ? (survivalMode ? 9 : 4) + injuryPressure + sounderPressure : 0,
    chargeFacing: resolvePlayerFacing(offsetX, offsetY).animationDirection,
    durationMs: charges ? PREY_RETALIATION_DURATION_MS : 0,
  };
};
