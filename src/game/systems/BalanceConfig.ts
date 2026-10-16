export type DifficultyMode = 'explorer' | 'survival';

export interface BalanceProfile {
  mode: DifficultyMode;
  population: {
    desired: { rabbit: number; deer: number; elk: number; boar: number };
    leanScale: number;
    respawnDelayMs: { rabbit: number; deer: number; elk: number; boar: number };
  };
  meat: { rabbit: number; deer: number; elk: number; boar: number };
  player: {
    attackStaminaCost: number;
    burialStaminaCost: number;
    healingPerSecond: number;
    healingNeedLimit: number;
    injuryPenalties: boolean;
  };
  cache: {
    exposedLifetimeSeconds: number;
    buriedLifetimeSeconds: number;
    minimumSpacing: number;
    maximumProtected: number;
    burialDurationMs: number;
    unprotectedDailyLoss: number;
    leanDailyLoss: number;
  };
}

export const DEFAULT_DIFFICULTY: DifficultyMode = 'survival';

export const BALANCE_PROFILES: Record<DifficultyMode, BalanceProfile> = {
  explorer: {
    mode: 'explorer',
    population: {
      desired: { rabbit: 20, deer: 22, elk: 10, boar: 8 },
      leanScale: 1,
      respawnDelayMs: { rabbit: 18_000, deer: 32_000, elk: 52_000, boar: 55_000 },
    },
    meat: { rabbit: 46, deer: 120, elk: 170, boar: 150 },
    player: {
      attackStaminaCost: 0,
      burialStaminaCost: 0,
      healingPerSecond: 0.65,
      healingNeedLimit: 82,
      injuryPenalties: false,
    },
    cache: {
      exposedLifetimeSeconds: 12 * 60,
      buriedLifetimeSeconds: 3 * 60 * 60,
      minimumSpacing: 0,
      maximumProtected: Number.POSITIVE_INFINITY,
      burialDurationMs: 0,
      unprotectedDailyLoss: 0,
      leanDailyLoss: 0,
    },
  },
  survival: {
    mode: 'survival',
    population: {
      desired: { rabbit: 14, deer: 10, elk: 5, boar: 4 },
      leanScale: 0.6,
      respawnDelayMs: { rabbit: 120_000, deer: 300_000, elk: 420_000, boar: 390_000 },
    },
    meat: { rabbit: 20, deer: 65, elk: 95, boar: 82 },
    player: {
      attackStaminaCost: 20,
      burialStaminaCost: 15,
      healingPerSecond: 0.15,
      healingNeedLimit: 60,
      injuryPenalties: true,
    },
    cache: {
      // At 1.8 simulation minutes per real second these are six game-hours
      // and two game-days respectively.
      exposedLifetimeSeconds: 200,
      buriedLifetimeSeconds: 1_600,
      minimumSpacing: 500,
      maximumProtected: 3,
      burialDurationMs: 3_000,
      unprotectedDailyLoss: 0.3,
      leanDailyLoss: 0.35,
    },
  },
};

export const getBalanceProfile = (mode: DifficultyMode): BalanceProfile => BALANCE_PROFILES[mode];

export const isDifficultyMode = (value: unknown): value is DifficultyMode => value === 'explorer' || value === 'survival';
