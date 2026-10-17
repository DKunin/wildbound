import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import preyAnimationContract from '../src/game/data/prey-animation-contract.json';

interface AnimationFrameRef {
  asset: string;
  frame: number;
  woundAsset?: string;
  woundLevel?: number;
}

interface InventoryAnimation {
  id: string;
  family: string;
  subject: string;
  state: string;
  direction: string;
  carrying: boolean;
  woundLevel: number;
  frames: AnimationFrameRef[];
}

interface AnimationInventory {
  animations: InventoryAnimation[];
  coverage: {
    animations: number;
    baseAssets: string[];
    woundAssets: string[];
    woundManifestSources: string[];
    directions: string[];
    woundLevels: number[];
    countsByFamily: Record<string, number>;
    countsBySubject: Record<string, number>;
  };
}

interface AuditIssue {
  animationId: string;
  severity: 'fail' | 'warn';
  metric: string;
  value: number;
  threshold: number;
}

interface AuditAnimation {
  id: string;
  family: string;
  subject: string;
  state: string;
  status: 'pass' | 'warn' | 'fail';
  metrics: {
    idleTransitionGroundDeltaPx?: number;
    idleTransitionComparisons?: number;
  };
  issues: Array<Omit<AuditIssue, 'animationId'>>;
}

interface AnimationAudit {
  schemaVersion: number;
  summary: {
    animations: number;
    passing: number;
    warnings: number;
    failing: number;
    hardFailureMetrics: number;
    warningMetrics: number;
    stateTransitions: number;
    stateTransitionPassing: number;
    stateTransitionWarnings: number;
    stateTransitionFailing: number;
  };
  hardFailures: AuditIssue[];
  warnings: AuditIssue[];
  stateTransitionHardFailures: Array<Omit<AuditIssue, 'animationId'> & { transitionId: string }>;
  stateTransitionWarnings: Array<Omit<AuditIssue, 'animationId'> & { transitionId: string }>;
  stateTransitions: Array<{
    id: string;
    family: string;
    subject: string;
    fromState: string;
    toState: string;
    direction: string;
    carrying: boolean;
    woundLevel: number;
    scaleSensitive: boolean;
    status: 'pass' | 'warn' | 'fail';
    metrics: {
      linearScaleRatio: number;
      visibleAreaRatio: number;
    };
    sequenceStates: string[];
    frames: AnimationFrameRef[];
  }>;
  animations: AuditAnimation[];
}

interface AnimationLabModule {
  DIRECTIONS: string[];
  buildInventory: (root?: string) => AnimationInventory;
  runAudit: (options?: { root?: string; families?: string[] }) => AnimationAudit;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LAB_URL = pathToFileURL(resolve(ROOT, 'scripts/audit-animal-animations.mjs')).href;
let lab: AnimationLabModule;
let completeAudit: AnimationAudit | undefined;

const getCompleteAudit = (): AnimationAudit => {
  completeAudit ??= lab.runAudit({ root: ROOT });
  return completeAudit;
};

beforeAll(async () => {
  lab = await import(/* @vite-ignore */ LAB_URL) as AnimationLabModule;
});

describe('animal animation visual lab', () => {
  it('covers every runtime animal, direction, state, carry mode, and supported wound tier', () => {
    const inventory = lab.buildInventory(ROOT);

    expect(inventory.coverage.animations).toBe(1_600);
    expect(inventory.coverage.countsByFamily).toEqual({
      'pack-wolf': 40,
      'player-wolf': 768,
      prey: 792,
    });
    expect(inventory.coverage.countsBySubject).toEqual({
      boar: 256,
      deer: 256,
      elk: 224,
      niva: 20,
      player: 768,
      rabbit: 56,
      torr: 20,
    });
    expect(inventory.coverage.directions).toEqual(lab.DIRECTIONS);
    expect(inventory.coverage.woundLevels).toEqual([0, 1, 2, 3]);
    expect(inventory.coverage.baseAssets).toHaveLength(92);
    expect(inventory.coverage.woundAssets).toHaveLength(88);
    expect(inventory.coverage.woundManifestSources).toHaveLength(88);
    expect(new Set(inventory.animations.map(({ id }) => id)).size).toBe(inventory.animations.length);

    const playerStates = new Set(inventory.animations
      .filter(({ subject }) => subject === 'player')
      .map(({ state }) => state));
    expect(playerStates).toEqual(new Set([
      'attacking', 'burying', 'crouching', 'drinking', 'eating', 'getting-up',
      'idle', 'laying-down', 'rest-micro-ear', 'rest-micro-head', 'resting',
      'running', 'sneaking', 'walking',
    ]));
    for (const direction of lab.DIRECTIONS) {
      for (const woundLevel of [0, 1, 2, 3]) {
        const variants = inventory.animations.filter((animation) => (
          animation.subject === 'player'
          && animation.direction === direction
          && animation.woundLevel === woundLevel
        ));
        expect(variants, `${direction} wound ${woundLevel}`).toHaveLength(24);
        expect(variants.some(({ carrying }) => carrying), `${direction} carry wound ${woundLevel}`).toBe(true);
      }
    }

    for (const species of ['rabbit', 'deer', 'elk', 'boar']) {
      const directions = new Set(inventory.animations
        .filter(({ subject }) => subject === species)
        .map(({ direction }) => direction));
      expect(directions, species).toEqual(new Set(lab.DIRECTIONS));
    }
    expect(inventory.animations.filter(({ subject, woundLevel }) => subject === 'deer' && woundLevel > 0)).toHaveLength(192);
    expect(inventory.animations.filter(({ subject, woundLevel }) => subject === 'elk' && woundLevel > 0)).toHaveLength(168);
    expect(inventory.animations.filter(({ subject, woundLevel }) => subject === 'boar' && woundLevel > 0)).toHaveLength(192);
    expect(inventory.animations.filter(({ subject, woundLevel }) => subject === 'rabbit' && woundLevel > 0)).toEqual([]);
    expect(inventory.animations.filter(({ subject, woundLevel }) => (
      subject === 'niva' || subject === 'torr'
    ) && woundLevel > 0)).toEqual([]);
    expect(inventory.animations.every(({ frames }) => frames.length > 0)).toBe(true);
  });

  it('uses every authored action phase in exact direction and wound order', () => {
    const inventory = lab.buildInventory(ROOT);
    const directionColumns = new Map(lab.DIRECTIONS.map((direction, index) => [direction, index]));
    const actionRows = {
      resting: [0, 1, 2, 3],
      foraging: [4, 5, 6, 7],
      drinking: [8, 9, 10, 11],
    } as const;

    for (const species of ['rabbit', 'deer', 'elk', 'boar']) {
      const woundLevels = species === 'rabbit' ? [0] : [0, 1, 2, 3];
      for (const direction of lab.DIRECTIONS) {
        const directionColumn = directionColumns.get(direction);
        expect(directionColumn, direction).toBeDefined();
        for (const [state, rows] of Object.entries(actionRows)) {
          const expectedFrames = rows.map((row) => row * 8 + directionColumn!);
          for (const woundLevel of woundLevels) {
            const animation = inventory.animations.find((candidate) => (
              candidate.subject === species
              && candidate.state === state
              && candidate.direction === direction
              && candidate.woundLevel === woundLevel
            ));
            expect(animation, `${species}/${state}/${direction}/wound-${woundLevel}`).toBeDefined();
            expect(animation?.frames.map(({ frame }) => frame)).toEqual(expectedFrames);
            expect(animation?.frames.every(({ woundAsset }) => woundLevel === 0 ? !woundAsset : Boolean(woundAsset))).toBe(true);
            expect(animation?.frames.every((frame) => woundLevel === 0
              ? frame.woundLevel === undefined
              : frame.woundLevel === woundLevel
                && frame.woundAsset?.endsWith(`/${species}-actions-wounds.png`))).toBe(true);
          }
        }
      }
    }
  });

  it('audits dedicated directional retaliation poses and every wound tier in frame order', () => {
    const inventory = lab.buildInventory(ROOT);
    for (const species of ['deer', 'boar']) {
      for (const [directionIndex, direction] of lab.DIRECTIONS.entries()) {
        const expectedFrames = [0, 1, 2, 3].map((phase) => directionIndex * 4 + phase);
        for (const woundLevel of [0, 1, 2, 3]) {
          const animation = inventory.animations.find((candidate) => (
            candidate.subject === species
            && candidate.state === 'retaliating'
            && candidate.direction === direction
            && candidate.woundLevel === woundLevel
          ));
          expect(animation, `${species}/retaliating/${direction}/wound-${woundLevel}`).toBeDefined();
          expect(animation?.frames.map(({ frame }) => frame)).toEqual(expectedFrames);
          expect(animation?.frames.every(({ asset }) => asset.endsWith(
            species === 'boar' ? '/boar-charge.png' : '/deer-kick.png',
          ))).toBe(true);
          expect(animation?.frames.every(({ woundAsset }) => woundLevel === 0 ? !woundAsset : Boolean(woundAsset))).toBe(true);
          const woundFile = species === 'boar' ? 'boar-charge-wounds.png' : 'deer-kick-wounds.png';
          expect(animation?.frames.every((frame) => woundLevel === 0
            ? frame.woundLevel === undefined
            : frame.woundLevel === woundLevel && frame.woundAsset?.endsWith(`/${woundFile}`))).toBe(true);
        }
      }
    }
  });

  it('emits stable machine-readable failures for the same sprites and thresholds', () => {
    const first = lab.runAudit({ root: ROOT, families: ['boar'] });
    const second = lab.runAudit({ root: ROOT, families: ['boar'] });

    expect(second).toEqual(first);
    expect(first.schemaVersion).toBe(2);
    expect(first.summary.animations).toBe(256);
    expect(first.summary.passing + first.summary.warnings + first.summary.failing).toBe(first.summary.animations);
    expect(first.summary.hardFailureMetrics).toBe(first.hardFailures.length);
    expect(first.summary.warningMetrics).toBe(first.warnings.length);
    expect(first.hardFailures).toEqual([...first.hardFailures].sort((left, right) => (
      `${left.animationId}/${left.metric}`.localeCompare(`${right.animationId}/${right.metric}`)
    )));

    const animations = new Map(first.animations.map((animation) => [animation.id, animation]));
    for (const failure of first.hardFailures) {
      const animation = animations.get(failure.animationId);
      expect(animation, failure.animationId).toBeDefined();
      expect(animation?.status).toBe('fail');
      expect(animation?.issues).toContainEqual({
        severity: failure.severity,
        metric: failure.metric,
        value: failure.value,
        threshold: failure.threshold,
        message: expect.any(String),
      });
    }
  });

  it('has no hard visual failures in the complete runtime inventory', () => {
    const audit = getCompleteAudit();

    expect(audit.hardFailures).toEqual([]);
    expect(audit.summary.hardFailureMetrics).toBe(0);
    expect(audit.summary.failing).toBe(0);
  }, 60_000);

  it('alternates every animal state against the matching baseline and rejects scale jumps', () => {
    const audit = getCompleteAudit();

    expect(audit.summary.stateTransitions).toBe(1_424);
    expect(audit.summary.stateTransitionPassing).toBe(1_424);
    expect(audit.summary.stateTransitionWarnings).toBe(0);
    expect(audit.summary.stateTransitionFailing).toBe(0);
    expect(audit.stateTransitionHardFailures).toEqual([]);
    expect(audit.stateTransitionWarnings).toEqual([]);
    expect(new Set(audit.stateTransitions.map(({ id }) => id)).size).toBe(audit.stateTransitions.length);
    expect(audit.stateTransitions.filter(({ scaleSensitive }) => scaleSensitive)).toHaveLength(424);

    for (const transition of audit.stateTransitions) {
      expect(transition.frames, transition.id).toHaveLength(4);
      expect(transition.sequenceStates, transition.id).toEqual([
        transition.fromState,
        transition.toState,
        transition.fromState,
        transition.toState,
      ]);
      if (transition.scaleSensitive) {
        expect(transition.metrics.linearScaleRatio, transition.id).toBeLessThanOrEqual(1.06);
      }
    }

    const southDrink = audit.stateTransitions.find(({ id }) => (
      id === 'state-transition/player-wolf/player/idle-to-drinking/south/plain/wound-0'
    ));
    expect(southDrink?.metrics.linearScaleRatio).toBeLessThanOrEqual(1.01);
  }, 60_000);

  it('keeps every authored prey action visually readable between phases', () => {
    const authoredStates = new Set(['resting', 'foraging', 'drinking', 'retaliating']);
    const weakMotion = getCompleteAudit().animations.flatMap((animation) => (
      animation.family === 'prey' && authoredStates.has(animation.state)
        ? animation.issues
          .filter(({ metric }) => metric === 'semanticMotionScore')
          .map((entry) => `${animation.id}: ${entry.value} < ${entry.threshold}`)
        : []
    ));

    expect(weakMotion).toEqual([]);
  }, 60_000);

  it('keeps every prey action transition on the same-direction idle ground line', () => {
    const transitionLimit = preyAnimationContract.transitionLimits.groundContactY;
    const actionStates = new Set(['resting', 'foraging', 'drinking', 'retaliating']);
    const animations = getCompleteAudit().animations.filter((animation) => (
      animation.family === 'prey' && actionStates.has(animation.state)
    ));

    expect(animations).toHaveLength(376);
    for (const animation of animations) {
      expect(animation.metrics.idleTransitionGroundDeltaPx, animation.id).toBeDefined();
      expect(animation.metrics.idleTransitionGroundDeltaPx, animation.id).toBeLessThanOrEqual(transitionLimit);
      expect(animation.metrics.idleTransitionComparisons, animation.id)
        .toBe(animation.state === 'retaliating' ? 4 : 8);
      expect(animation.issues.some(({ metric }) => metric === 'idleTransitionGroundDeltaPx'), animation.id).toBe(false);
    }
  }, 60_000);
});
