export const SNEAK_ANIMATION_TIME_SCALE = 0.58;

export interface WolfMovementProfileInput {
  moving: boolean;
  running: boolean;
  sneaking: boolean;
}

export interface WolfMovementProfile {
  speed: number;
  visualSignature: number;
  soundSignature: number;
  scentSignature: number;
}

export const getWolfMovementProfile = (input: WolfMovementProfileInput): WolfMovementProfile => {
  if (input.sneaking) {
    return {
      speed: input.moving ? 68 : 0,
      visualSignature: 0.55,
      soundSignature: input.moving ? 0.12 : 0,
      scentSignature: 0.82,
    };
  }
  if (input.running) {
    return { speed: 245, visualSignature: 1.18, soundSignature: 1, scentSignature: 1 };
  }
  if (input.moving) {
    return { speed: 126, visualSignature: 1, soundSignature: 0.5, scentSignature: 1 };
  }
  return { speed: 0, visualSignature: 0.82, soundSignature: 0, scentSignature: 1 };
};
