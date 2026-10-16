import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

interface AnimationFrameRef {
  asset: string;
  woundAsset?: string;
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
  status: 'pass' | 'warn' | 'fail';
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
  };
  hardFailures: AuditIssue[];
  warnings: AuditIssue[];
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
    expect(inventory.coverage.baseAssets).toHaveLength(91);
    expect(inventory.coverage.woundAssets).toHaveLength(87);
    expect(inventory.coverage.woundManifestSources).toHaveLength(87);
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

  it('emits stable machine-readable failures for the same sprites and thresholds', () => {
    const first = lab.runAudit({ root: ROOT, families: ['boar'] });
    const second = lab.runAudit({ root: ROOT, families: ['boar'] });

    expect(second).toEqual(first);
    expect(first.schemaVersion).toBe(1);
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
});
