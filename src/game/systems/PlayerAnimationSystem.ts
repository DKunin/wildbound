import type { PlayerDirection } from './DirectionalSpriteSystem';
import { getWoundTextureSuffix, type WoundLevel } from './HuntBalanceSystem';
import { SNEAK_ANIMATION_TIME_SCALE } from './WolfStealthSystem';

export const PLAYER_REST_DELAY_MS = 20_000;

export type PlayerActionState = 'attacking' | 'eating' | 'drinking' | 'burying';
export type PlayerAnimationState = 'idle' | 'walking' | 'crouching' | 'sneaking' | 'running' | 'laying-down' | 'resting' | 'getting-up' | PlayerActionState;

export const getPlayerAnimationKey = (
  state: PlayerAnimationState,
  direction: PlayerDirection,
  carrying = false,
  woundLevel: WoundLevel = 0,
): string => {
  const woundSuffix = getWoundTextureSuffix(woundLevel);
  const prefix = `player-${direction}-${carrying ? 'carry-' : ''}`;
  if (state === 'walking') return `${prefix}walk${woundSuffix}`;
  if (state === 'crouching') return `${prefix}crouch-idle${woundSuffix}`;
  if (state === 'sneaking') return `${prefix}crawl${woundSuffix}`;
  if (state === 'running') return `${prefix}run${woundSuffix}`;
  if (state === 'laying-down') return `${prefix}lay${woundSuffix}`;
  if (state === 'resting') return `${prefix}rest-breathe${woundSuffix}`;
  if (state === 'getting-up') return `${prefix}get-up${woundSuffix}`;
  if (state === 'attacking') return `player-${direction}-attack${woundSuffix}`;
  if (state === 'eating') return `player-${direction}-eat${woundSuffix}`;
  if (state === 'drinking') return `player-${direction}-drink${woundSuffix}`;
  if (state === 'burying') return `player-${direction}-bury${woundSuffix}`;
  return `${prefix}idle${woundSuffix}`;
};

const isActionState = (state: PlayerAnimationState): state is PlayerActionState => (
  state === 'attacking' || state === 'eating' || state === 'drinking' || state === 'burying'
);

export interface PlayerAnimationInput {
  direction?: PlayerDirection;
  running: boolean;
  sneaking: boolean;
  restRequested: boolean;
}

export interface PlayerAnimationDecision {
  state: PlayerAnimationState;
  direction: PlayerDirection;
  movementAllowed: boolean;
  running: boolean;
  sneaking: boolean;
}

export const getPlayerAnimationSpeedScale = (
  state: PlayerAnimationState,
  actualSpeed: number,
  expectedSpeed: number,
): number => {
  if (state !== 'walking' && state !== 'running' && state !== 'sneaking') return 1;
  const injuryScale = Math.max(0.52, Math.min(1, expectedSpeed > 0 ? actualSpeed / expectedSpeed : 1));
  return (state === 'sneaking' ? SNEAK_ANIMATION_TIME_SCALE : 1) * injuryScale;
};

export const isPlayerGaitAnimationKey = (key: string): boolean => (
  /^player-(?:east|northeast|north|northwest|west|southwest|south|southeast)-(?:carry-)?(?:walk|crawl|run)(?:-wound-[123])?$/.test(key)
);

interface PendingMovement {
  direction: PlayerDirection;
  running: boolean;
  sneaking: boolean;
}

export class PlayerAnimationSystem {
  private state: PlayerAnimationState = 'idle';
  private direction: PlayerDirection = 'south';
  private idleDurationMs = 0;
  private pendingMovement?: PendingMovement;

  constructor(private readonly restDelayMs = PLAYER_REST_DELAY_MS) {}

  reset(direction: PlayerDirection = 'south'): void {
    this.state = 'idle';
    this.direction = direction;
    this.idleDurationMs = 0;
    this.pendingMovement = undefined;
  }

  update(deltaMs: number, input: PlayerAnimationInput): PlayerAnimationDecision {
    const requestedMovement = input.direction
      ? { direction: input.direction, running: input.running, sneaking: input.sneaking }
      : undefined;
    if (requestedMovement && !isActionState(this.state)) {
      this.direction = requestedMovement.direction;
      this.idleDurationMs = 0;
    }

    if (this.state === 'laying-down' || this.state === 'getting-up' || isActionState(this.state)) {
      if (requestedMovement) this.pendingMovement = requestedMovement;
      return this.decision(false);
    }

    if (this.state === 'resting') {
      if (requestedMovement) {
        this.pendingMovement = requestedMovement;
        this.state = 'getting-up';
      }
      return this.decision(false);
    }

    const movement = requestedMovement ?? this.pendingMovement;
    if (movement) {
      this.direction = movement.direction;
      this.state = movement.running ? 'running' : movement.sneaking ? 'sneaking' : 'walking';
      this.pendingMovement = undefined;
      return this.decision(true);
    }

    if (this.state === 'walking' || this.state === 'sneaking' || this.state === 'running') {
      this.state = input.sneaking ? 'crouching' : 'idle';
      this.idleDurationMs = 0;
    } else {
      this.idleDurationMs += Math.max(0, deltaMs);
    }

    if (this.state === 'crouching') {
      this.idleDurationMs = 0;
      if (!input.sneaking) this.state = 'idle';
    } else if (this.state === 'idle' && input.sneaking) {
      this.state = 'crouching';
      this.idleDurationMs = 0;
    } else if (this.state === 'idle' && (input.restRequested || this.idleDurationMs >= this.restDelayMs)) {
      this.state = 'laying-down';
    }
    return this.decision(false);
  }

  completeTransition(): PlayerAnimationDecision {
    if (this.state === 'laying-down') this.state = this.pendingMovement ? 'getting-up' : 'resting';
    else if (this.state === 'getting-up') {
      if (this.pendingMovement) this.direction = this.pendingMovement.direction;
      this.state = this.pendingMovement?.running ? 'running' : this.pendingMovement?.sneaking ? 'sneaking' : this.pendingMovement ? 'walking' : 'idle';
    } else if (isActionState(this.state)) {
      if (this.pendingMovement) this.direction = this.pendingMovement.direction;
      this.state = this.pendingMovement?.running ? 'running' : this.pendingMovement?.sneaking ? 'sneaking' : this.pendingMovement ? 'walking' : 'idle';
    }
    return this.decision(false);
  }

  startAction(action: PlayerActionState, direction = this.direction): boolean {
    if (this.state === 'laying-down' || this.state === 'resting' || this.state === 'getting-up' || isActionState(this.state)) return false;
    this.state = action;
    this.direction = direction;
    this.idleDurationMs = 0;
    this.pendingMovement = undefined;
    return true;
  }

  wakeUp(): boolean {
    if (this.state !== 'resting') return false;
    this.state = 'getting-up';
    this.idleDurationMs = 0;
    this.pendingMovement = undefined;
    return true;
  }

  snapshot(): PlayerAnimationDecision {
    return this.decision(this.state === 'walking' || this.state === 'sneaking' || this.state === 'running');
  }

  private decision(movementAllowed: boolean): PlayerAnimationDecision {
    return {
      state: this.state,
      direction: this.direction,
      movementAllowed,
      running: this.state === 'running',
      sneaking: this.state === 'crouching' || this.state === 'sneaking',
    };
  }
}
