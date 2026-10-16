import { describe, expect, it } from 'vitest';
import { getPlayerAnimationKey, PLAYER_REST_DELAY_MS, PlayerAnimationSystem } from '../src/game/systems/PlayerAnimationSystem';

const still = { running: false, sneaking: false, restRequested: false } as const;

describe('player animation state machine', () => {
  it('keeps the last direction when movement changes to idle', () => {
    const animation = new PlayerAnimationSystem();

    expect(animation.update(16, { direction: 'northwest', running: false, sneaking: false, restRequested: false })).toMatchObject({
      state: 'walking', direction: 'northwest', movementAllowed: true,
    });
    expect(animation.update(16, still)).toMatchObject({
      state: 'idle', direction: 'northwest', movementAllowed: false,
    });
  });

  it('uses a dedicated run animation and returns to the walk cycle when Shift is released', () => {
    const animation = new PlayerAnimationSystem();

    const running = animation.update(16, { direction: 'east', running: true, sneaking: false, restRequested: false });
    expect(running).toMatchObject({ state: 'running', movementAllowed: true, running: true });
    expect(getPlayerAnimationKey(running.state, running.direction)).toBe('player-east-run');

    const walking = animation.update(16, { direction: 'east', running: false, sneaking: false, restRequested: false });
    expect(walking).toMatchObject({ state: 'walking', movementAllowed: true, running: false });
    expect(getPlayerAnimationKey(walking.state, walking.direction)).toBe('player-east-walk');
  });

  it('uses dedicated crawl artwork while moving in stealth', () => {
    const animation = new PlayerAnimationSystem();
    const sneaking = animation.update(16, { direction: 'west', running: false, sneaking: true, restRequested: false });

    expect(sneaking).toMatchObject({ state: 'sneaking', movementAllowed: true, sneaking: true, running: false });
    expect(getPlayerAnimationKey(sneaking.state, sneaking.direction)).toBe('player-west-crawl');
  });

  it('keeps a visible crouch while stealth is active but the wolf is still', () => {
    const animation = new PlayerAnimationSystem();

    const crouching = animation.update(16, { ...still, sneaking: true });
    expect(crouching).toMatchObject({ state: 'crouching', movementAllowed: false, sneaking: true });
    expect(getPlayerAnimationKey(crouching.state, crouching.direction)).toBe('player-south-crouch-idle');
  });

  it('selects complete carrying variants without changing action animations', () => {
    const expected = {
      idle: 'idle',
      walking: 'walk',
      crouching: 'crouch-idle',
      sneaking: 'crawl',
      running: 'run',
      'laying-down': 'lay',
      resting: 'rest-breathe',
      'getting-up': 'get-up',
    } as const;

    for (const [state, suffix] of Object.entries(expected)) {
      expect(getPlayerAnimationKey(state as keyof typeof expected, 'northwest', true))
        .toBe(`player-northwest-carry-${suffix}`);
    }
    expect(getPlayerAnimationKey('attacking', 'northwest', true)).toBe('player-northwest-attack');
    expect(getPlayerAnimationKey('eating', 'northwest', true)).toBe('player-northwest-eat');
    expect(getPlayerAnimationKey('drinking', 'northwest', true)).toBe('player-northwest-drink');
  });

  it('switches directly from a crawl to running when stealth is released for a lunge', () => {
    const animation = new PlayerAnimationSystem();
    animation.update(16, { direction: 'east', running: false, sneaking: true, restRequested: false });

    expect(animation.update(16, { direction: 'east', running: true, sneaking: false, restRequested: false })).toMatchObject({
      state: 'running', direction: 'east', movementAllowed: true, running: true, sneaking: false,
    });
  });

  it('lies down after twenty seconds of uninterrupted inactivity', () => {
    const animation = new PlayerAnimationSystem();

    expect(animation.update(PLAYER_REST_DELAY_MS - 1, still).state).toBe('idle');
    expect(animation.update(1, still).state).toBe('laying-down');
    expect(animation.completeTransition().state).toBe('resting');
  });

  it('queues movement until the get-up transition has finished', () => {
    const animation = new PlayerAnimationSystem();

    expect(animation.update(0, { ...still, restRequested: true }).state).toBe('laying-down');
    expect(animation.update(16, { direction: 'east', running: true, sneaking: false, restRequested: false }).state).toBe('laying-down');
    expect(animation.completeTransition().state).toBe('getting-up');
    expect(animation.completeTransition().state).toBe('running');
    expect(animation.update(16, still)).toMatchObject({
      state: 'running', direction: 'east', movementAllowed: true, running: true,
    });
  });

  it('starts getting up before allowing movement from rest', () => {
    const animation = new PlayerAnimationSystem();
    animation.update(0, { ...still, restRequested: true });
    animation.completeTransition();

    expect(animation.update(16, { direction: 'south', running: false, sneaking: false, restRequested: false })).toMatchObject({
      state: 'getting-up', movementAllowed: false,
    });
  });

  it('wakes from rest after recovery is skipped', () => {
    const animation = new PlayerAnimationSystem();
    animation.update(0, { ...still, restRequested: true });
    animation.completeTransition();

    expect(animation.wakeUp()).toBe(true);
    expect(animation.snapshot().state).toBe('getting-up');
    expect(animation.completeTransition().state).toBe('idle');
    expect(animation.wakeUp()).toBe(false);
  });

  it('locks movement for one-shot attack, eating, and drinking animations', () => {
    for (const state of ['attacking', 'eating', 'drinking'] as const) {
      const animation = new PlayerAnimationSystem();
      expect(animation.startAction(state, 'northeast')).toBe(true);
      expect(animation.update(16, { direction: 'east', running: false, sneaking: false, restRequested: false })).toMatchObject({
        state, direction: 'northeast', movementAllowed: false,
      });
      expect(getPlayerAnimationKey(state, 'northeast')).toBe(`player-northeast-${state === 'attacking' ? 'attack' : state === 'eating' ? 'eat' : 'drink'}`);
      expect(animation.completeTransition()).toMatchObject({ state: 'walking', direction: 'east' });
    }
  });
});
