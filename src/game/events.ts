import Phaser from 'phaser';
import type { ScentClue } from './systems/ScentSystem';
import type { DifficultyMode } from './systems/BalanceConfig';

export interface HudState {
  health: number;
  hunger: number;
  thirst: number;
  stamina: number;
  day: number;
  time: string;
  timeIcon: string;
  phaseLabel: string;
  windArrow: string;
  windLabel: string;
  territoryLabel: string;
  contextAction: string;
  willEatMeat: boolean;
  eventLine: string;
  scentActive: boolean;
  scentSummary: string;
  scentClues: ScentClue[];
  trackingTarget: boolean;
  scentDirectionArrow: string;
  scentDirectionLabel: string;
  soundSummary: string;
  sneaking: boolean;
  canSkipRest: boolean;
  canMarkTerritory: boolean;
  territoryMarkCount: number;
  pack: Array<{ name: string; status: string }>;
  ambientColor: string;
  ambientOpacity: number;
  saveStatus: string;
  difficulty: DifficultyMode;
  leanDay: boolean;
  cacheCount: number;
  protectedCacheCount: number;
}

export interface HuntLogEntry {
  time: string;
  message: string;
}

export interface SleepTransition {
  sleeping: boolean;
  durationMs: number;
}

export const gameEvents = new Phaser.Events.EventEmitter();
