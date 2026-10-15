import Phaser from 'phaser';

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
  scentDirectionArrow: string;
  scentDirectionLabel: string;
  soundSummary: string;
  sneaking: boolean;
  pack: Array<{ name: string; status: string }>;
  ambientColor: string;
  ambientOpacity: number;
  saveStatus: string;
}

export interface HuntLogEntry {
  time: string;
  message: string;
}

export const gameEvents = new Phaser.Events.EventEmitter();
