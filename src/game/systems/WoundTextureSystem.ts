import type Phaser from 'phaser';
import {
  getWoundLevel,
  getWoundTextureSuffix,
  WOUND_LEVELS,
  type WoundLevel,
} from './HuntBalanceSystem';
import type { PlayerDirection } from './DirectionalSpriteSystem';
import type { PlayerAnimationState } from './PlayerAnimationSystem';

type WoundablePreySpecies = 'rabbit' | 'deer' | 'elk' | 'boar';
export type WoundedLevel = Exclude<WoundLevel, 0>;

export const WOUND_DECAL_TEXTURE_KEY = 'wound-decals';
export const WOUND_DECAL_ASSET_PATH = 'assets/balance-v1/wound-decals.png';
export const WOUND_DECAL_FRAME_SIZE = 96;
export const WOUND_MANIFEST_CACHE_KEY = 'wound-manifest';
export const WOUND_MANIFEST_ASSET_PATH = 'assets/wounds-v1/manifest.json';
export const PLAYER_WOUND_RUNTIME_TEXTURE_KEY = 'wolf-wound-runtime';
export const PREY_WOUND_TEXTURE_BASE_KEYS = [
  'deer', 'deer-actions', 'deer-kick',
  'elk', 'elk-actions',
  'boar', 'boar-actions', 'boar-charge',
] as const;

export interface WoundPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  mirror: boolean;
  clip: readonly [x: number, y: number, width: number, height: number];
}

export interface WoundManifestSheet {
  file: string;
  source: string;
  width: number;
  sourceHeight: number;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  placementsByLevel: readonly [
    readonly WoundPlacement[],
    readonly WoundPlacement[],
    readonly WoundPlacement[],
  ];
}

export interface WoundManifest {
  version: 1;
  levels: 3;
  spritesheets: readonly WoundManifestSheet[];
}

export interface WoundCompositionOperation {
  destination: readonly [x: number, y: number, width: number, height: number];
  clip: readonly [x: number, y: number, width: number, height: number];
  decalSource: readonly [x: number, y: number, width: number, height: number];
  baseAlphaSource: readonly [x: number, y: number, width: number, height: number];
  mirror: boolean;
}

export interface PlayerWoundTextureSelection {
  baseTextureKey: string;
  manifestSource: string;
}

interface CanvasRenderState {
  signature: string;
  scratch: HTMLCanvasElement;
}

const canvasRenderStates = new WeakMap<Phaser.Textures.CanvasTexture, CanvasRenderState>();

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const readNumber = (record: Record<string, unknown>, key: string): number => {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid wound manifest field: ${key}`);
  return value;
};

const readPositiveInteger = (record: Record<string, unknown>, key: string): number => {
  const value = readNumber(record, key);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Invalid wound manifest field: ${key}`);
  return value;
};

const readString = (record: Record<string, unknown>, key: string): string => {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid wound manifest field: ${key}`);
  return value;
};

const parsePlacement = (value: unknown, sheetWidth: number, sheetHeight: number): WoundPlacement => {
  if (!isRecord(value)) throw new Error('Invalid wound manifest placement');
  const x = readNumber(value, 'x');
  const y = readNumber(value, 'y');
  const width = readPositiveInteger(value, 'width');
  const height = readPositiveInteger(value, 'height');
  const mirror = value.mirror;
  const clip = value.clip;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x + width > sheetWidth || y + height > sheetHeight) {
    throw new Error('Wound placement falls outside its source sheet');
  }
  if (typeof mirror !== 'boolean') throw new Error('Invalid wound manifest field: mirror');
  if (!Array.isArray(clip) || clip.length !== 4 || clip.some((part) => typeof part !== 'number' || !Number.isInteger(part))) {
    throw new Error('Invalid wound manifest field: clip');
  }
  const [clipX, clipY, clipWidth, clipHeight] = clip;
  if (clipX < 0 || clipY < 0 || clipWidth <= 0 || clipHeight <= 0
    || clipX + clipWidth > sheetWidth || clipY + clipHeight > sheetHeight) {
    throw new Error('Wound placement clip falls outside its source sheet');
  }
  return {
    x,
    y,
    width,
    height,
    mirror,
    clip: [clipX, clipY, clipWidth, clipHeight],
  };
};

const parseSheet = (value: unknown): WoundManifestSheet => {
  if (!isRecord(value)) throw new Error('Invalid wound manifest spritesheet');
  const width = readPositiveInteger(value, 'width');
  const sourceHeight = readPositiveInteger(value, 'sourceHeight');
  const rawPlacements = value.placementsByLevel;
  if (!Array.isArray(rawPlacements) || rawPlacements.length !== 3 || rawPlacements.some((level) => !Array.isArray(level))) {
    throw new Error('Wound manifest must contain exactly three placement levels');
  }
  const placementsByLevel = rawPlacements.map((level) => (
    (level as unknown[]).map((placement) => parsePlacement(placement, width, sourceHeight))
  )) as unknown as WoundManifestSheet['placementsByLevel'];
  return {
    file: readString(value, 'file'),
    source: readString(value, 'source'),
    width,
    sourceHeight,
    frameWidth: readPositiveInteger(value, 'frameWidth'),
    frameHeight: readPositiveInteger(value, 'frameHeight'),
    columns: readPositiveInteger(value, 'columns'),
    rows: readPositiveInteger(value, 'rows'),
    placementsByLevel,
  };
};

export const parseWoundManifest = (value: unknown): WoundManifest => {
  if (!isRecord(value) || value.version !== 1 || value.levels !== 3 || !Array.isArray(value.spritesheets)) {
    throw new Error('Unsupported wound manifest');
  }
  return {
    version: 1,
    levels: 3,
    spritesheets: value.spritesheets.map(parseSheet),
  };
};

export const getWoundManifestSheet = (manifest: WoundManifest, source: string): WoundManifestSheet => {
  const sheet = manifest.spritesheets.find((candidate) => candidate.source === source);
  if (!sheet) throw new Error(`Wound manifest is missing ${source}`);
  return sheet;
};

export const getPlayerWoundTextureSelection = (
  state: PlayerAnimationState,
  direction: PlayerDirection,
  carrying: boolean,
): PlayerWoundTextureSelection => {
  let kind: 'motion' | 'run' | 'rest' | 'action' | 'crouch' | 'bury' = 'motion';
  if (state === 'running') kind = 'run';
  else if (state === 'laying-down' || state === 'resting' || state === 'getting-up') kind = 'rest';
  else if (state === 'burying') kind = 'bury';
  else if (state === 'attacking' || state === 'eating' || state === 'drinking') kind = 'action';
  else if (state === 'crouching' || state === 'sneaking') kind = 'crouch';
  const supportsCarry = kind !== 'action' && kind !== 'bury';
  const baseTextureKey = `wolf-${direction}-${kind}${carrying && supportsCarry ? '-carry' : ''}`;
  return { baseTextureKey, manifestSource: `${baseTextureKey}.png` };
};

export const getWoundTierTextureKey = (baseTextureKey: string, level: WoundLevel): string => (
  `${baseTextureKey}${getWoundTextureSuffix(level)}`
);

export const stripWoundTextureSuffix = (textureKey: string): string => textureKey.replace(/-wound-[123]$/, '');

export const getPreyMaxHealth = (species: WoundablePreySpecies): number => (
  species === 'elk' ? 5 : species === 'boar' ? 5 : species === 'deer' ? 4 : 1
);

export const getPreyWoundLevel = (species: WoundablePreySpecies, health: number): WoundLevel => (
  species === 'rabbit' ? 0 : getWoundLevel(health / getPreyMaxHealth(species) * 100)
);

export const getWoundCompositionPlan = (
  sheet: WoundManifestSheet,
  level: WoundedLevel,
): readonly WoundCompositionOperation[] => sheet.placementsByLevel[level - 1].map((placement) => ({
  destination: [placement.x, placement.y, placement.width, placement.height],
  clip: placement.clip,
  decalSource: [(level - 1) * WOUND_DECAL_FRAME_SIZE, 0, WOUND_DECAL_FRAME_SIZE, WOUND_DECAL_FRAME_SIZE],
  baseAlphaSource: [placement.x, placement.y, placement.width, placement.height],
  mirror: placement.mirror,
}));

export const getWoundRenderSignature = (
  baseTextureKey: string,
  sheet: WoundManifestSheet,
  level: WoundedLevel,
): string => `${baseTextureKey}:${sheet.source}:${level}`;

export const getRuntimeWoundTextureKeys = (): readonly string[] => [
  PLAYER_WOUND_RUNTIME_TEXTURE_KEY,
  ...PREY_WOUND_TEXTURE_BASE_KEYS.flatMap((baseTextureKey) => WOUND_LEVELS.slice(1).map((level) => (
    getWoundTierTextureKey(baseTextureKey, level)
  ))),
];

const copyFrames = (source: Phaser.Textures.Texture, target: Phaser.Textures.Texture): void => {
  for (const sourceFrame of source.getFramesFromTextureSource(0)) {
    const targetFrame = target.add(
      sourceFrame.name,
      0,
      sourceFrame.cutX,
      sourceFrame.cutY,
      sourceFrame.cutWidth,
      sourceFrame.cutHeight,
    );
    if (!targetFrame) throw new Error(`Could not copy frame ${String(sourceFrame.name)} into ${target.key}`);
    if (sourceFrame.trimmed) {
      targetFrame.setTrim(
        sourceFrame.realWidth,
        sourceFrame.realHeight,
        sourceFrame.x,
        sourceFrame.y,
        sourceFrame.width,
        sourceFrame.height,
      );
    }
    targetFrame.customPivot = sourceFrame.customPivot;
    targetFrame.pivotX = sourceFrame.pivotX;
    targetFrame.pivotY = sourceFrame.pivotY;
    targetFrame.autoRound = sourceFrame.autoRound;
    targetFrame.customData = { ...sourceFrame.customData };
    if (sourceFrame.rotated) {
      targetFrame.rotated = true;
      targetFrame.updateUVsInverted();
    }
  }
};

const isCanvasTexture = (texture: Phaser.Textures.Texture): texture is Phaser.Textures.CanvasTexture => {
  const candidate = texture as Partial<Phaser.Textures.CanvasTexture>;
  return candidate.canvas instanceof HTMLCanvasElement
    && candidate.context instanceof CanvasRenderingContext2D
    && typeof candidate.refresh === 'function';
};

const verifyCompatibleFrames = (source: Phaser.Textures.Texture, target: Phaser.Textures.Texture): void => {
  const sourceFrames = source.getFramesFromTextureSource(0);
  const targetFrames = target.getFramesFromTextureSource(0);
  if (sourceFrames.length !== targetFrames.length) throw new Error(`${source.key} is not frame-compatible with ${target.key}`);
  const targetByName = new Map(targetFrames.map((frame) => [String(frame.name), frame]));
  for (const sourceFrame of sourceFrames) {
    const targetFrame = targetByName.get(String(sourceFrame.name));
    if (!targetFrame || sourceFrame.cutX !== targetFrame.cutX || sourceFrame.cutY !== targetFrame.cutY
      || sourceFrame.cutWidth !== targetFrame.cutWidth || sourceFrame.cutHeight !== targetFrame.cutHeight) {
      throw new Error(`${source.key} is not frame-compatible with ${target.key}`);
    }
  }
};

const getOrCreateCanvasTexture = (
  textures: Phaser.Textures.TextureManager,
  targetTextureKey: string,
  baseTexture: Phaser.Textures.Texture,
  width: number,
  height: number,
): Phaser.Textures.CanvasTexture => {
  if (textures.exists(targetTextureKey)) {
    const existing = textures.get(targetTextureKey);
    if (!isCanvasTexture(existing) || existing.width !== width || existing.height !== height) {
      throw new Error(`${targetTextureKey} is not a ${width}x${height} canvas texture`);
    }
    verifyCompatibleFrames(baseTexture, existing);
    return existing;
  }
  const created = textures.createCanvas(targetTextureKey, width, height);
  if (!created) throw new Error(`Could not register wound texture ${targetTextureKey}`);
  copyFrames(baseTexture, created);
  return created;
};

export interface RenderWoundTextureOptions {
  targetTextureKey: string;
  baseTextureKey: string;
  sheet: WoundManifestSheet;
  level: WoundedLevel;
  decalTextureKey?: string;
}

export const renderWoundTexture = (
  textures: Phaser.Textures.TextureManager,
  options: RenderWoundTextureOptions,
): boolean => {
  const signature = getWoundRenderSignature(options.baseTextureKey, options.sheet, options.level);
  if (textures.exists(options.targetTextureKey)) {
    const existing = textures.get(options.targetTextureKey);
    if (isCanvasTexture(existing) && canvasRenderStates.get(existing)?.signature === signature) return false;
  }
  const decalTextureKey = options.decalTextureKey ?? WOUND_DECAL_TEXTURE_KEY;
  const baseTexture = textures.get(options.baseTextureKey);
  const baseImage = baseTexture.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  if (baseImage.width !== options.sheet.width || baseImage.height !== options.sheet.sourceHeight) {
    throw new Error(`${options.sheet.source} must be ${options.sheet.width}x${options.sheet.sourceHeight}, received ${baseImage.width}x${baseImage.height}`);
  }
  const target = getOrCreateCanvasTexture(
    textures,
    options.targetTextureKey,
    baseTexture,
    options.sheet.width,
    options.sheet.sourceHeight,
  );
  const previousState = canvasRenderStates.get(target);

  const decalImage = textures.get(decalTextureKey).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  if (decalImage.width < WOUND_DECAL_FRAME_SIZE * 3 || decalImage.height < WOUND_DECAL_FRAME_SIZE) {
    throw new Error(`${decalTextureKey} must contain three ${WOUND_DECAL_FRAME_SIZE}x${WOUND_DECAL_FRAME_SIZE} decals`);
  }

  const plan = getWoundCompositionPlan(options.sheet, options.level);
  const scratch = previousState?.scratch ?? document.createElement('canvas');
  scratch.width = Math.max(1, ...plan.map((operation) => operation.destination[2]));
  scratch.height = Math.max(1, ...plan.map((operation) => operation.destination[3]));
  const scratchContext = scratch.getContext('2d');
  if (!scratchContext) throw new Error(`Could not create a wound compositor for ${options.targetTextureKey}`);

  target.context.clearRect(0, 0, target.width, target.height);
  target.context.drawImage(baseImage, 0, 0);
  for (const operation of plan) {
    const [x, y, width, height] = operation.destination;
    const [decalX, decalY, decalWidth, decalHeight] = operation.decalSource;
    const [baseX, baseY, baseWidth, baseHeight] = operation.baseAlphaSource;
    const [clipX, clipY, clipWidth, clipHeight] = operation.clip;
    scratchContext.clearRect(0, 0, scratch.width, scratch.height);
    scratchContext.save();
    if (operation.mirror) {
      scratchContext.translate(width, 0);
      scratchContext.scale(-1, 1);
    }
    scratchContext.drawImage(decalImage, decalX, decalY, decalWidth, decalHeight, 0, 0, width, height);
    scratchContext.restore();
    scratchContext.globalCompositeOperation = 'destination-in';
    scratchContext.drawImage(baseImage, baseX, baseY, baseWidth, baseHeight, 0, 0, width, height);
    scratchContext.globalCompositeOperation = 'source-over';

    target.context.save();
    target.context.beginPath();
    target.context.rect(clipX, clipY, clipWidth, clipHeight);
    target.context.clip();
    target.context.drawImage(scratch, 0, 0, width, height, x, y, width, height);
    target.context.restore();
  }
  target.refresh();
  canvasRenderStates.set(target, { signature, scratch });
  return true;
};
