import { describe, expect, it } from 'vitest';
import { SenseHudModel, type SenseKind, type SenseSourceSignal } from '../src/game/systems/SenseHudSystem';

const listener = { x: 0, y: 0 };
const viewport = { left: -50, top: -50, right: 50, bottom: 50 };

const source = (
  sourceId: string,
  kind: SenseKind,
  x: number,
  y: number,
  extra: Partial<SenseSourceSignal> = {},
): SenseSourceSignal => ({ sourceId, kind, x, y, scentStrength: 0.5, ...extra });

describe('directional wolf senses HUD', () => {
  it('shows only detectable sources outside the camera viewport', () => {
    const cues = new SenseHudModel().update(listener, viewport, [
      source('rabbit:visible', 'rabbit', 20, 10),
      source('deer:outside', 'deer', 120, 0),
      source('boar:too-faint', 'boar', -120, 0, { scentStrength: 0.01 }),
    ]);

    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({ kind: 'deer', direction: 'E' });
  });

  it('combines smell and hearing for one source and groups matching animals in one fixed slot', () => {
    const cues = new SenseHudModel().update(listener, viewport, [
      source('deer:1', 'deer', 120, 0, { scentStrength: 0.55 }),
      source('deer:1', 'deer', 122, 2, { scentStrength: 0, hearingStrength: 0.72 }),
      source('deer:2', 'deer', 150, 8, { scentStrength: 0.4 }),
    ]);

    expect(cues).toEqual([expect.objectContaining({
      kind: 'deer',
      direction: 'E',
      count: 2,
      scentStrength: 0.55,
      hearingStrength: 0.72,
      strength: 0.72,
    })]);
  });

  it('keeps a marked animal separate and includes every smellable source category', () => {
    const kinds: SenseKind[] = ['rabbit', 'deer', 'elk', 'boar', 'pack', 'carcass', 'cache', 'territory', 'water'];
    const signals = kinds.map((kind, index) => source(`${kind}:${index}`, kind, 100 + index, 0));
    signals.push(source('deer:marked', 'deer', 140, 0, { targeted: true, scentStrength: 0.8 }));

    const cues = new SenseHudModel().update(listener, viewport, signals);

    expect(new Set(cues.map((cue) => cue.kind))).toEqual(new Set(kinds));
    expect(cues.find((cue) => cue.targeted)).toMatchObject({ kind: 'deer', targeted: true, count: 1 });
    expect(cues.find((cue) => cue.kind === 'deer' && !cue.targeted)).toMatchObject({ count: 1 });
  });

  it('uses angular hysteresis so a moving source does not flicker between compass slots', () => {
    const model = new SenseHudModel();
    const atAngle = (degrees: number) => source(
      'rabbit:moving',
      'rabbit',
      Math.cos(degrees * Math.PI / 180) * 120,
      Math.sin(degrees * Math.PI / 180) * 120,
    );

    expect(model.update(listener, viewport, [atAngle(20)])[0].direction).toBe('E');
    expect(model.update(listener, viewport, [atAngle(25)])[0].direction).toBe('E');
    expect(model.update(listener, viewport, [atAngle(40)])[0].direction).toBe('SE');
  });
});
