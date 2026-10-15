import type { PlayerDirection } from './DirectionalSpriteSystem';

export const PLAYER_REST_DELAY_MS = 20_000;

export type PlayerActionState = 'attacking' | 'eating' | 'drinking';
export type PlayerAnimationState = 'idle' | 'walking' | 'sneaking' | 'running' | 'laying-down' | 'resting' | 'getting-up' | PlayerActionState;

export const getPlayerAnimationKey = (state: PlayerAnimationState, direction: PlayerDirection): string => {
  if (state === 'walking') return `player-${direction}-walk`;
  if (state === 'sneaking') return `player-${direction}-walk`;
  if (state === 'running') return `player-${direction}-run`;
  if (state === 'laying-down') return `player-${direction}-lay`;
  if (state === 'resting') return `player-${direction}-rest-breathe`;
  if (state === 'getting-up') return `player-${direction}-get-up`;
  if (state === 'attacking') return `player-${direction}-attack`;
  if (state === 'eating') return `player-${direction}-eat`;
  if (state === 'drinking') return `player-${direction}-drink`;
  return `player-${direction}-idle`;
};

const isActionState = (state: PlayerAnimationState): state is PlayerActionState => (
  state === 'attacking' || state === 'eating' || state === 'drinking'
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
      this.state = 'idle';
      this.idleDurationMs = 0;
    } else {
      this.idleDurationMs += Math.max(0, deltaMs);
    }

    if (input.restRequested || this.idleDurationMs >= this.restDelayMs) this.state = 'laying-down';
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

  snapshot(): PlayerAnimationDecision {
    return this.decision(this.state === 'walking' || this.state === 'sneaking' || this.state === 'running');
  }

  private decision(movementAllowed: boolean): PlayerAnimationDecision {
    return {
      state: this.state,
      direction: this.direction,
      movementAllowed,
      running: this.state === 'running',
      sneaking: this.state === 'sneaking',
    };
  }
}
