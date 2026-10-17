import Phaser from 'phaser';
import { PackWolf } from './entities/PackWolf';
import { Prey, type PreyHabitat, type PreySpecies, type PreyState, type ThreatStimulus } from './entities/Prey';
import { gameEvents, type HudState } from './events';
import { FEATURE_FLAGS } from './features';
import { DayNightSystem, type DayNightState } from './systems/DayNightSystem';
import { getPlayerDirectionVector, PLAYER_DIRECTIONS, resolvePlayerFacing } from './systems/DirectionalSpriteSystem';
import { FootprintSystem } from './systems/FootprintSystem';
import { NeedsSystem, type NeedsSnapshot } from './systems/NeedsSystem';
import { LivingShadow } from './systems/LivingShadow';
import {
  getPlayerAnimationKey,
  getPlayerAnimationSpeedScale,
  isPlayerGaitAnimationKey,
  PlayerAnimationSystem,
  type PlayerActionState,
  type PlayerAnimationState,
} from './systems/PlayerAnimationSystem';
import { PopulationSystem } from './systems/PopulationSystem';
import {
  ensurePreyAnimationReady,
  hasPreyRetaliationAnimation,
  type PreyAnimationDefinition,
  type PreyAnimationEnsurer,
  type PreyAnimationReadinessAdapter,
} from './systems/PreyAnimationSystem';
import { WORLD_HEIGHT, WORLD_SEED, WORLD_WIDTH } from './systems/ProceduralWorld';
import { RunControlSystem } from './systems/RunControlSystem';
import { SaveSystem, type SaveData } from './systems/SaveSystem';
import { EMPTY_SCENT_READING, ScentSystem, type ScentReading } from './systems/ScentSystem';
import { SoundSystem } from './systems/SoundSystem';
import type { AudibleSound } from './systems/SoundModel';
import { SenseHudModel, type SenseSourceSignal } from './systems/SenseHudSystem';
import { WindSystem, type WindState } from './systems/WindSystem';
import { WorldSystem } from './systems/WorldSystem';
import { getWolfMovementProfile } from './systems/WolfStealthSystem';
import { HuntLogSystem } from './systems/HuntLogSystem';
import { getCacheBurialPosition } from './systems/CachePlacementSystem';
import { getTerritoryMarkStrength, TERRITORY_MARK_SCENT_RADIUS, TerritoryMarkSystem } from './systems/TerritoryMarkSystem';
import { advanceSimulationTime, simulationTimeToWorldMilliseconds } from './systems/WorldTimeSystem';
import { AnimalTargetTracker, findClickedAnimal, isAnimalTargetAlive } from './systems/AnimalTargetingSystem';
import { SCENT_RENDER_RADIUS } from './systems/ScentDirectionSystem';
import {
  DEFAULT_DIFFICULTY,
  getBalanceProfile,
  isDifficultyMode,
  type BalanceProfile,
  type DifficultyMode,
} from './systems/BalanceConfig';
import { selectProtectedCaches, validateCachePlacement } from './systems/CacheRulesSystem';
import {
  getWoundLevel,
  getWoundTextureSuffix,
  WOUND_LEVELS,
  type WoundLevel,
} from './systems/HuntBalanceSystem';
import {
  getDayNumber,
  isLeanDay,
  isMigrationWindow,
  OVERHUNTED_RADIUS,
  RegionalHuntPressureSystem,
} from './systems/SurvivalPressureSystem';
import {
  PREY_WOUND_TEXTURE_BASE_KEYS,
  getPlayerWoundTextureSelection,
  getWoundManifestSheet,
  parseWoundManifest,
  PLAYER_WOUND_RUNTIME_TEXTURE_KEY,
  renderWoundTexture,
  stripWoundTextureSuffix,
  WOUND_DECAL_ASSET_PATH,
  WOUND_DECAL_FRAME_SIZE,
  WOUND_DECAL_TEXTURE_KEY,
  WOUND_MANIFEST_ASSET_PATH,
  WOUND_MANIFEST_CACHE_KEY,
  type WoundManifest,
} from './systems/WoundTextureSystem';

interface ControlKeys {
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
  run: Phaser.Input.Keyboard.Key;
  interact: Phaser.Input.Keyboard.Key;
  howl: Phaser.Input.Keyboard.Key;
  rest: Phaser.Input.Keyboard.Key;
}

interface PlayerActivity {
  moving: boolean;
  running: boolean;
  resting: boolean;
  sneaking: boolean;
  visualSignature: number;
  soundSignature: number;
  scentSignature: number;
}

const PREY_WOUND_SOURCES: ReadonlyArray<{ baseTextureKey: typeof PREY_WOUND_TEXTURE_BASE_KEYS[number]; source: string }> = [
  { baseTextureKey: 'deer', source: 'deer-atlas.png' },
  { baseTextureKey: 'deer-actions', source: 'deer-actions.png' },
  { baseTextureKey: 'deer-kick', source: 'deer-kick.png' },
  { baseTextureKey: 'elk', source: 'elk-atlas.png' },
  { baseTextureKey: 'elk-actions', source: 'elk-actions.png' },
  { baseTextureKey: 'boar', source: 'boar-atlas.png' },
  { baseTextureKey: 'boar-actions', source: 'boar-actions.png' },
  { baseTextureKey: 'boar-charge', source: 'boar-charge.png' },
];

const getPlayerRestMicroAnimationKey = (
  direction: typeof PLAYER_DIRECTIONS[number],
  carrying: boolean,
  micro: 'ear' | 'head',
  woundLevel: WoundLevel,
): string => `player-${direction}-${carrying ? 'carry-' : ''}rest-micro-${micro}${getWoundTextureSuffix(woundLevel)}`;

export class WildScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private playerShadow!: LivingShadow;
  private world!: WorldSystem;
  private prey: Prey[] = [];
  private carriedCarcass?: Prey;
  private preyHabitats!: Record<PreySpecies, PreyHabitat>;
  private pack: PackWolf[] = [];
  private needs = new NeedsSystem();
  private scent!: ScentSystem;
  private hearing!: SoundSystem;
  private footprints!: FootprintSystem;
  private population = new PopulationSystem();
  private difficulty: DifficultyMode = DEFAULT_DIFFICULTY;
  private balance: BalanceProfile = getBalanceProfile(DEFAULT_DIFFICULTY);
  private readonly huntPressure = new RegionalHuntPressureSystem();
  private currentDay = 1;
  private pendingBurial?: { carcass: Prey; x: number; y: number; completeAt: number };
  private readonly playerAnimation = new PlayerAnimationSystem();
  private readonly runControl = new RunControlSystem();
  private readonly dayNight = new DayNightSystem();
  private readonly wind = new WindSystem();
  private readonly saves = new SaveSystem();
  private readonly huntLog = new HuntLogSystem();
  private readonly territoryMarks = new TerritoryMarkSystem();
  private readonly targetTracker = new AnimalTargetTracker();
  private readonly senseHud = new SenseHudModel();
  private keys!: ControlKeys;
  private targetedPrey?: Prey;
  private targetMarker?: Phaser.GameObjects.Image;
  private snapshot: NeedsSnapshot = this.needs.snapshot();
  private simulationTime = 18 * 60 + 42;
  private dayState: DayNightState = this.dayNight.getState(this.simulationTime);
  private windState: WindState = this.wind.getState(this.simulationTime);
  private lastHudAt = 0;
  private lastAttackAt = 0;
  private lastEventAt = 0;
  private lastAutoSaveAt = 0;
  private rallyUntil = 0;
  private eventLine = 'Listen to the forest.';
  private soundSignals: AudibleSound[] = [];
  private scentReading: ScentReading = EMPTY_SCENT_READING;
  private saveStatus = '';
  private saveStatusUntil = 0;
  private paused = false;
  private pausedAt = 0;
  private dead = false;
  private loadingSave = false;
  private restSkipping = false;
  private sneaking = false;
  private logMode = false;
  private lungeUntil = 0;
  private nextRestMicroAt = 0;
  private playerNominalSpeed = 0;
  private woundManifest!: WoundManifest;
  private readonly preyAnimationReadiness: PreyAnimationReadinessAdapter = {
    textureExists: (textureKey) => this.textures.exists(textureKey),
    materializeWoundTexture: ({ baseTextureKey, targetTextureKey, level }) => {
      const source = PREY_WOUND_SOURCES.find((candidate) => candidate.baseTextureKey === baseTextureKey);
      if (!source) throw new Error(`No wound manifest source is registered for ${baseTextureKey}`);
      renderWoundTexture(this.textures, {
        targetTextureKey,
        baseTextureKey,
        sheet: getWoundManifestSheet(this.woundManifest, source.source),
        level,
      });
    },
    animationExists: (animationKey) => this.anims.exists(animationKey),
    registerAnimation: (definition: PreyAnimationDefinition) => {
      this.anims.create({
        key: definition.key,
        frames: [...definition.frames],
        frameRate: definition.frameRate,
        repeat: definition.repeat,
      });
    },
  };
  private readonly ensurePreyAnimation: PreyAnimationEnsurer = (species, direction, state, woundLevel) => {
    ensurePreyAnimationReady(this.preyAnimationReadiness, species, direction, state, woundLevel);
  };
  private readonly preyStates = new WeakMap<Prey, PreyState>();
  private random = new Phaser.Math.RandomDataGenerator([WORLD_SEED]);

  private readonly handleWindowKey = (event: KeyboardEvent): void => {
    if (event.key === 'F5') {
      event.preventDefault();
      void this.saveGame(true);
    } else if (event.key === 'F9') {
      event.preventDefault();
      void this.restoreLatestSave(true);
    } else if ((event.code === 'Escape' || event.code === 'Space') && !event.repeat && !this.dead && !this.loadingSave && !this.restSkipping) {
      event.preventDefault();
      this.setPaused(!this.paused);
    } else if (event.code === 'KeyQ' && !event.repeat && !this.paused && !this.dead && !this.loadingSave && !this.restSkipping) {
      const active = this.scent.toggle();
      this.setEvent(active ? 'You lift your muzzle into the wind.' : 'The forest returns to ordinary sight.');
    } else if (event.code === 'KeyT' && !event.repeat && !this.paused && !this.dead && !this.loadingSave && !this.restSkipping) {
      this.skipRestUntilHealed();
    } else if (event.code === 'KeyM' && !event.repeat && !this.paused && !this.dead && !this.loadingSave && !this.restSkipping) {
      this.markTerritory();
    } else if (event.code === 'KeyC' && !event.repeat && !this.paused && !this.dead && !this.loadingSave && !this.restSkipping) {
      this.sneaking = !this.sneaking;
      this.runControl.reset();
      this.setEvent(this.sneaking ? 'You lower your body and quiet your steps.' : 'You rise back to a normal gait.');
    }
  };

  constructor() {
    super('wild');
  }

  preload(): void {
    this.load.image('ground-base', 'assets/ground-base-v3.png');
    this.load.svg('predator-target', 'assets/predator-target.svg', { width: 64, height: 64 });
    this.load.spritesheet('terrain-overlays', 'assets/terrain-overlays-v3.png', { frameWidth: 313, frameHeight: 313 });
    this.load.spritesheet('obstacle-atlas', 'assets/obstacle-atlas-v3.png', { frameWidth: 313, frameHeight: 313 });
    this.load.spritesheet('terrain-features', 'assets/terrain-features-v4.png', { frameWidth: 313, frameHeight: 313 });
    this.load.spritesheet('water-tiles', 'assets/water-tiles-v3.png', { frameWidth: 313, frameHeight: 313 });
    for (const direction of PLAYER_DIRECTIONS) {
      this.load.atlas(`wolf-${direction}-motion`, `assets/player-wolf-v2/wolf-${direction}-motion.png`, 'assets/player-wolf-v2/wolf-grid-atlas.json');
      this.load.atlas(`wolf-${direction}-run`, `assets/player-wolf-v2/wolf-${direction}-run.png`, 'assets/player-wolf-v2/wolf-grid-atlas.json');
      this.load.atlas(`wolf-${direction}-rest`, `assets/player-wolf-v2/wolf-${direction}-rest.png`, 'assets/player-wolf-v2/wolf-grid-atlas.json');
      this.load.atlas(`wolf-${direction}-action`, `assets/player-wolf-v2/wolf-${direction}-action.png`, 'assets/player-wolf-v2/wolf-grid-atlas.json');
      this.load.atlas(`wolf-${direction}-bury`, `assets/player-wolf-v2/wolf-${direction}-bury.png`, 'assets/player-wolf-v2/wolf-grid-atlas.json');
      this.load.atlas(`wolf-${direction}-crouch`, `assets/player-wolf-v2/wolf-${direction}-crouch.png`, 'assets/player-wolf-v2/wolf-grid-atlas.json');
      for (const kind of ['motion', 'run', 'rest', 'crouch'] as const) {
        this.load.atlas(`wolf-${direction}-${kind}-carry`, `assets/player-wolf-v2/wolf-${direction}-${kind}-carry.png`, 'assets/player-wolf-v2/wolf-grid-atlas.json');
      }
    }
    this.load.spritesheet('niva', 'assets/niva-sheet.png', { frameWidth: 346, frameHeight: 284 });
    this.load.spritesheet('torr', 'assets/torr-sheet.png', { frameWidth: 346, frameHeight: 284 });
    this.load.spritesheet('rabbit', 'assets/prey-v2/rabbit-atlas.png', { frameWidth: 181, frameHeight: 181 });
    this.load.spritesheet('deer', 'assets/prey-v2/deer-atlas.png', { frameWidth: 181, frameHeight: 181 });
    this.load.spritesheet('rabbit-actions', 'assets/prey-v2/rabbit-actions.png', { frameWidth: 181, frameHeight: 181 });
    this.load.spritesheet('deer-actions', 'assets/prey-v2/deer-actions.png', { frameWidth: 181, frameHeight: 181 });
    this.load.spritesheet('elk', 'assets/prey-v3/elk-atlas.png', { frameWidth: 181, frameHeight: 181 });
    this.load.spritesheet('elk-actions', 'assets/prey-v3/elk-actions.png', { frameWidth: 181, frameHeight: 181 });
    this.load.spritesheet('boar', 'assets/prey-v4/boar-atlas.png', { frameWidth: 181, frameHeight: 181 });
    this.load.spritesheet('boar-actions', 'assets/prey-v4/boar-actions.png', { frameWidth: 181, frameHeight: 181 });
    this.load.spritesheet('boar-charge', 'assets/prey-v4/boar-charge.png', { frameWidth: 181, frameHeight: 181 });
    this.load.spritesheet('deer-kick', 'assets/balance-v1/deer-kick.png', { frameWidth: 181, frameHeight: 181 });
    this.load.spritesheet(WOUND_DECAL_TEXTURE_KEY, WOUND_DECAL_ASSET_PATH, {
      frameWidth: WOUND_DECAL_FRAME_SIZE,
      frameHeight: WOUND_DECAL_FRAME_SIZE,
    });
    this.load.json(WOUND_MANIFEST_CACHE_KEY, WOUND_MANIFEST_ASSET_PATH);
    this.load.image('cache-mound', 'assets/cache-mound-v1.png');
    this.load.spritesheet('tracks', 'assets/tracks-sheet.png', { frameWidth: 321, frameHeight: 305 });
  }

  create(): void {
    const requestedDifficulty = this.registry.get('difficulty');
    this.difficulty = isDifficultyMode(requestedDifficulty) ? requestedDifficulty : DEFAULT_DIFFICULTY;
    this.balance = getBalanceProfile(this.difficulty);
    this.needs = new NeedsSystem(this.balance.player);
    this.population = new PopulationSystem(this.balance);
    this.random = new Phaser.Math.RandomDataGenerator([WORLD_SEED]);
    this.snapshot = this.needs.snapshot();
    this.prey = [];
    this.carriedCarcass = undefined;
    this.pack = [];
    this.targetedPrey = undefined;
    this.targetMarker = undefined;
    this.targetTracker.reset();
    this.playerAnimation.reset();
    this.runControl.reset();
    this.simulationTime = 18 * 60 + 42;
    this.currentDay = getDayNumber(this.simulationTime);
    this.huntPressure.restore([], this.simulationTime);
    this.territoryMarks.restore([], this.simulationTime);
    this.pendingBurial = undefined;
    this.paused = false;
    this.dead = false;
    this.loadingSave = false;
    this.restSkipping = false;
    this.sneaking = false;
    this.logMode = this.registry.get('logMode') === true;
    this.huntLog.reset();
    this.lungeUntil = 0;
    this.nextRestMicroAt = 0;
    this.rallyUntil = 0;
    this.eventLine = 'Listen to the forest.';
    this.saveStatus = '';
    this.soundSignals = [];
    this.scentReading = EMPTY_SCENT_READING;
    this.senseHud.reset();

    this.world = new WorldSystem(this, WORLD_SEED);
    this.world.create();
    this.preyHabitats = {
      rabbit: this.createPreyHabitat('rabbit'),
      deer: this.createPreyHabitat('deer'),
      elk: this.createPreyHabitat('elk'),
      boar: this.createPreyHabitat('boar'),
    };
    this.addMorningMist();
    this.bakeWoundTextures();
    this.createAnimations();

    const spawn = this.world.getSpawnPoint();
    this.player = this.physics.add.sprite(spawn.x, spawn.y, 'wolf-south-motion', 'frame-8').setScale(0.42).setDepth(spawn.y + 30);
    this.playerShadow = new LivingShadow(this, { width: 92, height: 27, offsetY: 38, alpha: 0.24 });
    this.playerShadow.sync(this.player);
    this.player.setCollideWorldBounds(true);
    this.player.setBodySize(150, 82).setOffset(98, 160);
    this.player.on(Phaser.Animations.Events.ANIMATION_COMPLETE, this.handlePlayerAnimationComplete, this);
    this.syncPlayerAnimation(this.time.now);
    this.world.addCollider(this.player);

    this.spawnInitialPopulation();
    if (FEATURE_FLAGS.pack) this.spawnPack();
    this.scent = new ScentSystem(this, this.world.getWaterAreas());
    this.hearing = new SoundSystem(this);
    this.hearing.addAmbientAreas(this.world.getFlowingWaterAreas(), 'FLOWING WATER', 720, 0.68);
    this.footprints = new FootprintSystem(this);
    this.keys = this.createKeys();
    this.configureCamera();
    this.configureAnimalTargeting();
    this.configureEventRequests();
    window.addEventListener('keydown', this.handleWindowKey, { capture: true });
    this.lastAutoSaveAt = this.time.now;
    this.emitHud(true);
    void this.restoreLatestSave(false);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scent.destroy();
      this.hearing.destroy();
      this.footprints.destroy();
      this.player.off(Phaser.Animations.Events.ANIMATION_COMPLETE, this.handlePlayerAnimationComplete, this);
      window.removeEventListener('keydown', this.handleWindowKey, { capture: true });
      gameEvents.off('resume-request', this.resumeFromRequest, this);
      gameEvents.off('restart-request', this.restartFromRequest, this);
      gameEvents.off('load-request', this.loadFromRequest, this);
      gameEvents.off('log-mode-request', this.logModeFromRequest, this);
      gameEvents.off('skip-rest-request', this.skipRestFromRequest, this);
      gameEvents.off('mark-territory-request', this.markTerritoryFromRequest, this);
    });
  }

  update(time: number, delta: number): void {
    this.playerShadow.sync(this.player, !this.dead, this.playerAnimation.snapshot().state === 'resting');
    if (this.paused || this.dead || this.loadingSave || this.restSkipping) {
      this.player.setVelocity(0, 0);
      return;
    }
    this.completeBurialIfReady(time);
    if (FEATURE_FLAGS.pack && Phaser.Input.Keyboard.JustDown(this.keys.howl)) this.howl(time);

    const deltaSeconds = Math.min(delta / 1000, 0.05);
    const activity = this.updatePlayerMovement(time, delta);
    this.world.updateEnvironmentMotion(time, this.player);
    this.updateCarriedCarcass();
    this.snapshot = this.needs.update(deltaSeconds, activity);
    this.simulationTime = advanceSimulationTime(this.simulationTime, deltaSeconds);
    this.refreshWorldTimeState();
    this.handleDayChange();
    this.syncPlayerAnimation(time);

    this.updatePack(time, deltaSeconds);
    this.updatePrey(time, activity);
    this.updatePopulation(simulationTimeToWorldMilliseconds(this.simulationTime));
    this.syncTargetMarker(time);
    this.scent.record(time, this.prey, this.pack);
    this.scentReading = this.scent.render(
      time,
      this.player,
      this.territoryMarks.getActiveMarks(this.simulationTime),
      this.simulationTime,
      this.targetedPrey,
    );
    this.updateTargetTracking(time);
    this.footprints.record(time, this.player, this.prey, this.pack);
    this.soundSignals = this.hearing.render(time, this.player, 0.82 + this.dayState.visibility * 0.28);

    if (Phaser.Input.Keyboard.JustDown(this.keys.interact)) this.interact(time);
    if (!this.snapshot.alive) this.handleDeath();
    this.updateAmbientEvents(time);
    this.updateAutosave(time);
    if (time > this.saveStatusUntil) this.saveStatus = '';
    this.emitHud(time - this.lastHudAt > 100);
  }

  private bakeWoundTextures(): void {
    this.woundManifest = parseWoundManifest(this.cache.json.get(WOUND_MANIFEST_CACHE_KEY));
    renderWoundTexture(this.textures, {
      targetTextureKey: PLAYER_WOUND_RUNTIME_TEXTURE_KEY,
      baseTextureKey: 'wolf-south-motion',
      sheet: getWoundManifestSheet(this.woundManifest, 'wolf-south-motion.png'),
      level: 1,
    });
  }

  private createAnimations(): void {
    const directions = ['down-right', 'down-left', 'up-right', 'up-left'];
    for (const [row, direction] of directions.entries()) {
      for (const wolf of ['niva', 'torr'] as const) {
        const gaitKey = `${wolf}-${direction}-gait`;
        if (!this.anims.exists(gaitKey)) this.anims.create({
          key: gaitKey,
          frames: this.anims.generateFrameNumbers(wolf, { start: row * 4, end: row * 4 + 3 }),
          frameRate: 8,
          repeat: -1,
        });
        const restKey = `${wolf}-${direction}-rest`;
        const feedKey = `${wolf}-${direction}-feed`;
        if (!this.anims.exists(restKey)) this.anims.create({ key: restKey, frames: [{ key: wolf, frame: row * 4 }], frameRate: 1, repeat: -1 });
        if (!this.anims.exists(feedKey)) this.anims.create({
          key: feedKey,
          frames: [0, 1, 0, 2].map((offset) => ({ key: wolf, frame: row * 4 + offset })),
          frameRate: 3,
          repeat: -1,
        });
      }
    }
    for (const species of ['rabbit', 'deer', 'elk', 'boar'] as const) {
      for (const direction of PLAYER_DIRECTIONS) {
        for (const state of ['idle', 'walk', 'flee', 'foraging', 'drinking', 'resting', 'dead', 'retaliating'] as const) {
          if (state === 'retaliating' && !hasPreyRetaliationAnimation(species)) continue;
          this.ensurePreyAnimation(species, direction, state, 0);
        }
      }
    }
    for (const direction of PLAYER_DIRECTIONS) {
      const motionTexture = `wolf-${direction}-motion`;
      const runTexture = `wolf-${direction}-run`;
      const restTexture = `wolf-${direction}-rest`;
      const actionTexture = `wolf-${direction}-action`;
      const buryTexture = `wolf-${direction}-bury`;
      const crouchTexture = `wolf-${direction}-crouch`;
      const create = (key: string, frames: Phaser.Types.Animations.AnimationFrame[], frameRate: number, repeat: number): void => {
        if (!this.anims.exists(key)) this.anims.create({ key, frames, frameRate, repeat });
      };
      for (const woundLevel of WOUND_LEVELS) {
        const selectTexture = (healthyTexture: string): string => (
          woundLevel === 0 ? healthyTexture : PLAYER_WOUND_RUNTIME_TEXTURE_KEY
        );
        for (const carrying of [false, true]) {
          const textureSuffix = carrying ? '-carry' : '';
          const animationMotionTexture = selectTexture(`${motionTexture}${textureSuffix}`);
          const animationRunTexture = selectTexture(`${runTexture}${textureSuffix}`);
          const animationRestTexture = selectTexture(`${restTexture}${textureSuffix}`);
          const animationCrouchTexture = selectTexture(`${crouchTexture}${textureSuffix}`);
          create(getPlayerAnimationKey('walking', direction, carrying, woundLevel), this.anims.generateFrameNames(animationMotionTexture, { prefix: 'frame-', start: 0, end: 7 }), 8, -1);
          create(getPlayerAnimationKey('running', direction, carrying, woundLevel), this.anims.generateFrameNames(animationRunTexture, { prefix: 'frame-', start: 0, end: 15 }), 16, -1);
          create(getPlayerAnimationKey('idle', direction, carrying, woundLevel), this.anims.generateFrameNames(animationMotionTexture, { prefix: 'frame-', start: 8, end: 15 }), 3, -1);
          create(getPlayerAnimationKey('sneaking', direction, carrying, woundLevel), this.anims.generateFrameNames(animationCrouchTexture, { prefix: 'frame-', start: 0, end: 7 }), 8, -1);
          create(getPlayerAnimationKey('crouching', direction, carrying, woundLevel), this.anims.generateFrameNames(animationCrouchTexture, { prefix: 'frame-', start: 8, end: 15 }), 2.4, -1);
          create(getPlayerAnimationKey('laying-down', direction, carrying, woundLevel), this.anims.generateFrameNames(animationRestTexture, { prefix: 'frame-', start: 0, end: 5 }), 6, 0);
          create(getPlayerAnimationKey('resting', direction, carrying, woundLevel), this.anims.generateFrameNames(animationRestTexture, { prefix: 'frame-', start: 6, end: 7 }), 0.8, -1);
          create(getPlayerRestMicroAnimationKey(direction, carrying, 'ear', woundLevel), [6, 8, 6, 7].map((frame) => ({ key: animationRestTexture, frame: `frame-${frame}` })), 3, 0);
          create(getPlayerRestMicroAnimationKey(direction, carrying, 'head', woundLevel), [6, 9, 7, 6].map((frame) => ({ key: animationRestTexture, frame: `frame-${frame}` })), 2, 0);
          create(getPlayerAnimationKey('getting-up', direction, carrying, woundLevel), this.anims.generateFrameNames(animationRestTexture, { prefix: 'frame-', start: 10, end: 15 }), 6, 0);
        }
        const woundedActionTexture = selectTexture(actionTexture);
        const woundedBuryTexture = selectTexture(buryTexture);
        create(getPlayerAnimationKey('attacking', direction, false, woundLevel), this.anims.generateFrameNames(woundedActionTexture, { prefix: 'frame-', start: 0, end: 4 }), 10, 0);
        create(getPlayerAnimationKey('eating', direction, false, woundLevel), this.anims.generateFrameNames(woundedActionTexture, { prefix: 'frame-', start: 5, end: 9 }), 7, 0);
        create(getPlayerAnimationKey('drinking', direction, false, woundLevel), this.anims.generateFrameNames(woundedActionTexture, { prefix: 'frame-', start: 10, end: 15 }), 7, 0);
        create(
          getPlayerAnimationKey('burying', direction, false, woundLevel),
          this.anims.generateFrameNames(woundedBuryTexture, { prefix: 'frame-', start: 0, end: 7 }),
          8 / 3,
          0,
        );
      }
    }
  }

  private spawnInitialPopulation(): void {
    const desired = this.population.getDesired(isLeanDay(this.simulationTime));
    for (let index = 0; index < desired.rabbit; index += 1) {
      this.spawnPrey('rabbit', this.random.integerInRange(420, WORLD_WIDTH - 420), this.random.integerInRange(420, WORLD_HEIGHT - 420));
    }
    const herdCenter = new Phaser.Math.Vector2(WORLD_WIDTH * 0.73, WORLD_HEIGHT * 0.27);
    for (let index = 0; index < desired.deer; index += 1) {
      this.spawnPrey('deer', herdCenter.x + this.random.integerInRange(-620, 620), herdCenter.y + this.random.integerInRange(-480, 480));
    }
    const elkHerdCenter = new Phaser.Math.Vector2(WORLD_WIDTH * 0.84, WORLD_HEIGHT * 0.2);
    for (let index = 0; index < desired.elk; index += 1) {
      this.spawnPrey('elk', elkHerdCenter.x + this.random.integerInRange(-560, 560), elkHerdCenter.y + this.random.integerInRange(-420, 420));
    }
    const boarSounderCenter = new Phaser.Math.Vector2(WORLD_WIDTH * 0.32, WORLD_HEIGHT * 0.68);
    for (let index = 0; index < desired.boar; index += 1) {
      this.spawnPrey('boar', boarSounderCenter.x + this.random.integerInRange(-420, 420), boarSounderCenter.y + this.random.integerInRange(-360, 360));
    }
  }

  private spawnPack(): void {
    const spawn = this.world.getSpawnPoint();
    const nivaPosition = this.world.findOpenPositionNear({ x: spawn.x - 310, y: spawn.y + 120 });
    const torrPosition = this.world.findOpenPositionNear({ x: spawn.x + 330, y: spawn.y + 150 });
    const niva = new PackWolf(this, 'Niva', nivaPosition.x, nivaPosition.y);
    const torr = new PackWolf(this, 'Torr', torrPosition.x, torrPosition.y);
    this.pack.push(niva, torr);
    this.world.addCollider(niva, () => niva.handleTerrainCollision());
    this.world.addCollider(torr, () => torr.handleTerrainCollision());
  }

  private spawnPrey(species: PreySpecies, x?: number, y?: number): Prey {
    const requested = x === undefined || y === undefined
      ? this.findMigrationSpawn()
      : { x, y };
    const requestedCell = this.world.layout.getCellAt(requested);
    const position = requestedCell && !requestedCell.blocked && !requestedCell.water
      ? new Phaser.Math.Vector2(requested.x, requested.y)
      : this.world.findOpenPositionNear(requested);
    const animal = new Prey(
      this,
      species,
      position.x,
      position.y,
      this.random,
      this.balance,
      this.ensurePreyAnimation,
    );
    this.prey.push(animal);
    this.world.addCollider(animal, () => animal.handleTerrainCollision());
    return animal;
  }

  private findMigrationSpawn(): { x: number; y: number } {
    const recentKills = this.huntPressure.recent(this.simulationTime);
    let best = { x: WORLD_WIDTH - 420, y: WORLD_HEIGHT - 420 };
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const candidate = {
        x: this.random.integerInRange(380, WORLD_WIDTH - 380),
        y: this.random.integerInRange(380, WORLD_HEIGHT - 380),
      };
      const cell = this.world.layout.getCellAt(candidate);
      if (!cell || cell.blocked || cell.water) continue;
      const playerDistance = Phaser.Math.Distance.Between(candidate.x, candidate.y, this.player.x, this.player.y);
      const killDistance = recentKills.reduce((nearest, kill) => (
        Math.min(nearest, Phaser.Math.Distance.Between(candidate.x, candidate.y, kill.x, kill.y))
      ), OVERHUNTED_RADIUS * 2);
      const score = Math.min(playerDistance, 2_400) + Math.min(killDistance, 2_400);
      if (playerDistance >= 900 && !this.huntPressure.isOverhunted(candidate, this.simulationTime) && score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    return best;
  }

  private createPreyHabitat(species: PreySpecies): PreyHabitat {
    const resources = this.world.layout.getHabitatResources(species);
    return {
      ...resources,
      findPath: (start, destination) => this.world.layout.findPath(start, destination),
      findEscapePath: (start, threat, lateralBias) => this.world.layout.findEscapePath(start, threat, lateralBias),
    };
  }

  private createKeys(): ControlKeys {
    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error('Keyboard input is unavailable.');
    return {
      up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W), down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A), right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      run: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT), interact: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E),
      howl: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.H),
      rest: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R),
    };
  }

  private configureCamera(): void {
    const camera = this.cameras.main;
    camera.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT).startFollow(this.player, true, 0.085, 0.085).setZoom(0.82).fadeIn(700, 12, 20, 15);
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _objects: unknown[], _dx: number, dy: number) => camera.setZoom(Phaser.Math.Clamp(camera.zoom - dy * 0.00045, 0.62, 1.16)));
  }

  private configureAnimalTargeting(): void {
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.paused && !this.dead && pointer.leftButtonDown()) {
        const target = findClickedAnimal({ x: pointer.worldX, y: pointer.worldY }, this.prey);
        if (!target) {
          this.setEvent('Click directly on a living animal to mark its scent.');
          return;
        }
        this.targetedPrey = target;
        this.targetTracker.reset();
        this.scentReading = this.scent.render(
          this.time.now,
          this.player,
          this.territoryMarks.getActiveMarks(this.simulationTime),
          this.simulationTime,
          target,
        );
        this.setEvent(`You mark a ${target.species} trail to follow.`);
        this.syncTargetMarker(this.time.now);
        this.emitHud(true);
      }
    });
  }

  private configureEventRequests(): void {
    gameEvents.on('resume-request', this.resumeFromRequest, this);
    gameEvents.on('restart-request', this.restartFromRequest, this);
    gameEvents.on('load-request', this.loadFromRequest, this);
    gameEvents.on('log-mode-request', this.logModeFromRequest, this);
    gameEvents.on('skip-rest-request', this.skipRestFromRequest, this);
    gameEvents.on('mark-territory-request', this.markTerritoryFromRequest, this);
  }

  private resumeFromRequest(): void { this.setPaused(false); }
  private restartFromRequest(): void { void this.restartFresh(); }
  private loadFromRequest(): void { void this.restoreLatestSave(true); }
  private logModeFromRequest(enabled: boolean): void { this.logMode = enabled; }
  private skipRestFromRequest(): void { this.skipRestUntilHealed(); }
  private markTerritoryFromRequest(): void { this.markTerritory(); }

  private skipRestUntilHealed(): void {
    if (this.paused || this.dead || this.loadingSave
      || this.restSkipping
      || this.playerAnimation.snapshot().state !== 'resting'
      || !this.needs.canRecoverWhileResting()) return;

    this.restSkipping = true;
    this.player.setVelocity(0, 0);
    this.setEvent('You settle into deep sleep as the forest darkens.');
    gameEvents.emit('sleep-transition', { sleeping: true, durationMs: 900 });
    this.emitHud(true);
    this.time.delayedCall(1_050, () => {
      const recovery = this.needs.restUntilHealed();
      this.snapshot = recovery.snapshot;
      this.advanceWorldAfterRest(recovery.elapsedSeconds);
      this.playerAnimation.wakeUp();
      this.nextRestMicroAt = 0;
      this.syncPlayerAnimation(this.time.now);
      this.setEvent(recovery.fullyRecovered
        ? 'You wake fully recovered after a deep rest.'
        : 'Hunger or thirst wakes you before your wounds fully recover.');
      this.time.delayedCall(180, () => {
        gameEvents.emit('sleep-transition', { sleeping: false, durationMs: 1_150 });
        this.time.delayedCall(1_150, () => {
          this.restSkipping = false;
          this.emitHud(true);
        });
      });
    });
  }

  private advanceWorldAfterRest(elapsedSeconds: number): void {
    const previousSimulationTime = this.simulationTime;
    this.simulationTime = advanceSimulationTime(this.simulationTime, elapsedSeconds);
    for (const animal of this.prey) animal.advanceTime(elapsedSeconds, previousSimulationTime);
    this.prey = this.prey.filter((animal) => animal.active);
    if (this.carriedCarcass && !this.carriedCarcass.active) this.carriedCarcass = undefined;
    for (const wolf of this.pack) wolf.advanceTime(elapsedSeconds);
    this.updatePopulation(simulationTimeToWorldMilliseconds(this.simulationTime));
    this.scent.clearTransientTrails();
    this.footprints.clearTransientTracks();
    this.hearing.clearTransientSounds();
    this.soundSignals = [];
    this.refreshWorldTimeState();
    this.handleDayChange();
    this.syncPlayerAnimation(this.time.now);
    this.scentReading = this.scent.render(
      this.time.now,
      this.player,
      this.territoryMarks.getActiveMarks(this.simulationTime),
      this.simulationTime,
      this.targetedPrey,
    );
  }

  private refreshWorldTimeState(): void {
    this.dayState = this.dayNight.getState(this.simulationTime);
    this.windState = this.wind.getState(this.simulationTime);
    this.scent.setWind(this.windState.x, this.windState.y, this.windState.strength);
    this.territoryMarks.getActiveMarks(this.simulationTime);
  }

  private handleDayChange(): void {
    const nextDay = getDayNumber(this.simulationTime);
    if (nextDay <= this.currentDay) return;
    let totalScavenged = 0;
    while (this.currentDay < nextDay) {
      this.currentDay += 1;
      totalScavenged += this.applyDailyCachePressure();
    }
    if (this.difficulty === 'survival' && isLeanDay(this.simulationTime)) this.triggerLeanMigration();
    if (totalScavenged > 0) this.setEvent(`Scavengers found an unguarded cache and took ${Math.round(totalScavenged)} meat.`);
  }

  private applyDailyCachePressure(): number {
    if (this.difficulty !== 'survival') return 0;
    const caches = this.prey.filter((animal) => animal.active && animal.isBuried() && animal.hasEdibleMeat());
    const protectedCaches = selectProtectedCaches(
      caches,
      this.territoryMarks.getActiveMarks(this.simulationTime),
      this.balance.cache.maximumProtected,
      TERRITORY_MARK_SCENT_RADIUS,
    );
    let scavenged = 0;
    const loss = isLeanDay(this.simulationTime)
      ? this.balance.cache.leanDailyLoss
      : this.balance.cache.unprotectedDailyLoss;
    for (const cache of caches) {
      const protectedCache = protectedCaches.has(cache);
      cache.setCacheProtected(protectedCache);
      if (!protectedCache) scavenged += cache.scavenge(loss);
    }
    return scavenged;
  }

  private triggerLeanMigration(): void {
    const living = this.prey.filter((animal) => animal.active && !animal.isDead());
    const migrating = living.filter((_animal, index) => index % 2 === 0);
    for (const animal of migrating) {
      const destination = this.findDistantMigrationPoint(animal);
      animal.migrateTo(destination, this.preyHabitats[animal.species], this.time.now);
    }
    if (migrating.length > 0) this.setEvent('A lean season begins. Herds drift toward the distant forest edge.');
  }

  private findDistantMigrationPoint(from: { x: number; y: number }): Phaser.Math.Vector2 {
    const margin = 220;
    const candidates = [
      new Phaser.Math.Vector2(margin, this.random.integerInRange(margin, WORLD_HEIGHT - margin)),
      new Phaser.Math.Vector2(WORLD_WIDTH - margin, this.random.integerInRange(margin, WORLD_HEIGHT - margin)),
      new Phaser.Math.Vector2(this.random.integerInRange(margin, WORLD_WIDTH - margin), margin),
      new Phaser.Math.Vector2(this.random.integerInRange(margin, WORLD_WIDTH - margin), WORLD_HEIGHT - margin),
    ];
    const destination = candidates.sort((a, b) => (
      Phaser.Math.Distance.Squared(from.x, from.y, b.x, b.y) - Phaser.Math.Distance.Squared(from.x, from.y, a.x, a.y)
    ))[0];
    return this.world.findOpenPositionNear(destination);
  }

  private markTerritory(): void {
    if (!this.canAttemptTerritoryMark()) return;
    const result = this.territoryMarks.mark(this.player, this.simulationTime);
    if (!result.marked) {
      this.setEvent('Your scent here is still fresh. Range farther before marking again.');
      return;
    }
    const territory = this.world.getTerritoryName(this.player);
    this.setEvent(result.refreshed
      ? `You renew your boundary mark in ${territory}.`
      : `You leave a boundary mark in ${territory}.`);
    this.syncCacheProtection();
    this.scentReading = this.scent.render(
      this.time.now,
      this.player,
      this.territoryMarks.getActiveMarks(this.simulationTime),
      this.simulationTime,
      this.targetedPrey,
    );
    this.emitHud(true);
  }

  private canAttemptTerritoryMark(): boolean {
    const animation = this.playerAnimation.snapshot().state;
    return !this.paused && !this.dead && !this.loadingSave
      && animation !== 'laying-down' && animation !== 'resting' && animation !== 'getting-up'
      && animation !== 'attacking' && animation !== 'eating' && animation !== 'drinking' && animation !== 'burying';
  }

  private updatePlayerMovement(time: number, delta: number): PlayerActivity {
    const direction = new Phaser.Math.Vector2(Number(this.keys.right.isDown) - Number(this.keys.left.isDown), Number(this.keys.down.isDown) - Number(this.keys.up.isDown));
    if (direction.lengthSq() > 0) direction.normalize();
    const directionalFacing = direction.lengthSq() > 0 ? resolvePlayerFacing(direction.x, direction.y) : undefined;
    const lungeRequested = this.sneaking && Phaser.Input.Keyboard.JustDown(this.keys.run);
    if (lungeRequested) {
      this.sneaking = false;
      this.lungeUntil = time + 360;
      this.runControl.reset();
      this.setEvent(this.needs.canRun() ? 'You burst from cover into a lunge.' : 'You rise from cover, too exhausted to lunge.');
    }
    const lungeActive = time < this.lungeUntil;
    const requestedFacing = directionalFacing ?? (lungeActive
      ? { animationDirection: this.playerAnimation.snapshot().direction, rotation: 0 }
      : undefined);
    const running = this.runControl.update(!this.sneaking && (this.keys.run.isDown || lungeActive), this.needs.canRun()) && requestedFacing !== undefined;
    const decision = this.playerAnimation.update(delta, {
      direction: requestedFacing?.animationDirection,
      running,
      sneaking: this.sneaking,
      restRequested: this.keys.rest.isDown && requestedFacing === undefined,
    });
    const movement = directionalFacing
      ? direction
      : decision.movementAllowed ? new Phaser.Math.Vector2(...getPlayerDirectionVector(decision.direction)) : new Phaser.Math.Vector2();
    const moving = decision.movementAllowed && movement.lengthSq() > 0;
    const profile = getWolfMovementProfile({ moving, running: decision.running, sneaking: this.sneaking });
    this.playerNominalSpeed = profile.speed;
    const mobility = this.needs.getMobilityFactor();
    this.player.setVelocity(moving ? movement.x * profile.speed * mobility : 0, moving ? movement.y * profile.speed * mobility : 0).setDepth(this.player.y + 30).setRotation(0);
    this.syncPlayerAnimation(time);
    this.updateRestMicroAnimation(time);
    return {
      moving,
      running: moving && decision.running,
      resting: decision.state === 'resting',
      sneaking: this.sneaking,
      visualSignature: profile.visualSignature,
      soundSignature: profile.soundSignature,
      scentSignature: profile.scentSignature,
    };
  }

  private syncPlayerAnimation(time: number): void {
    const animation = this.playerAnimation.snapshot();
    const woundLevel = getWoundLevel(this.snapshot.health);
    const carrying = this.isCarryingCarcass();
    this.ensurePlayerWoundTexture(animation.state, animation.direction, carrying, woundLevel);
    const currentKey = this.player.anims.currentAnim?.key ?? '';
    if (animation.state === 'resting' && currentKey.includes('-rest-micro-') && this.player.anims.isPlaying) {
      const micro = currentKey.includes('-rest-micro-ear') ? 'ear' : 'head';
      const desiredMicroKey = getPlayerRestMicroAnimationKey(animation.direction, carrying, micro, woundLevel);
      if (currentKey === desiredMicroKey) return;
      const progress = this.player.anims.getProgress();
      this.player.anims.play(desiredMicroKey);
      this.player.anims.setProgress(progress);
      return;
    }
    const key = getPlayerAnimationKey(animation.state, animation.direction, carrying, woundLevel);
    if (currentKey !== key || !this.player.anims.isPlaying) {
      const currentAnimationIsPlaying = this.player.anims.isPlaying;
      const sameAnimationDifferentWound = currentAnimationIsPlaying && currentKey !== key
        && stripWoundTextureSuffix(currentKey) === stripWoundTextureSuffix(key);
      const preserveGaitPhase = currentAnimationIsPlaying && isPlayerGaitAnimationKey(currentKey);
      const preserveProgress = sameAnimationDifferentWound
        || preserveGaitPhase && (animation.state === 'walking' || animation.state === 'sneaking' || animation.state === 'running');
      const animationProgress = preserveProgress ? this.player.anims.getProgress() : 0;
      this.player.anims.play(key);
      if (preserveProgress) this.player.anims.setProgress(animationProgress);
    }
    const playerBody = this.player.body as Phaser.Physics.Arcade.Body;
    this.player.anims.timeScale = getPlayerAnimationSpeedScale(
      animation.state,
      playerBody.velocity.length(),
      this.playerNominalSpeed,
    );
    if (animation.state === 'resting') {
      if (this.nextRestMicroAt === 0) this.scheduleRestMicroAnimation(time);
    } else this.nextRestMicroAt = 0;
  }

  private ensurePlayerWoundTexture(
    state: PlayerAnimationState,
    direction: typeof PLAYER_DIRECTIONS[number],
    carrying: boolean,
    woundLevel: WoundLevel,
  ): void {
    if (woundLevel === 0) return;
    const selection = getPlayerWoundTextureSelection(state, direction, carrying);
    renderWoundTexture(this.textures, {
      targetTextureKey: PLAYER_WOUND_RUNTIME_TEXTURE_KEY,
      baseTextureKey: selection.baseTextureKey,
      sheet: getWoundManifestSheet(this.woundManifest, selection.manifestSource),
      level: woundLevel,
    });
  }

  private updateRestMicroAnimation(time: number): void {
    const animation = this.playerAnimation.snapshot();
    if (animation.state !== 'resting' || time < this.nextRestMicroAt) return;
    const micro = this.random.integerInRange(0, 1) === 0 ? 'ear' : 'head';
    this.nextRestMicroAt = 0;
    const carrying = this.isCarryingCarcass();
    const woundLevel = getWoundLevel(this.snapshot.health);
    this.ensurePlayerWoundTexture(animation.state, animation.direction, carrying, woundLevel);
    this.player.anims.play(getPlayerRestMicroAnimationKey(
      animation.direction,
      carrying,
      micro,
      woundLevel,
    ));
  }

  private scheduleRestMicroAnimation(time: number): void {
    this.nextRestMicroAt = time + this.random.integerInRange(4_500, 10_500);
  }

  private handlePlayerAnimationComplete(animation: Phaser.Animations.Animation): void {
    const state = this.playerAnimation.snapshot();
    if (animation.key === getPlayerAnimationKey(
      state.state,
      state.direction,
      this.isCarryingCarcass(),
      getWoundLevel(this.snapshot.health),
    )
      && (state.state === 'laying-down' || state.state === 'getting-up'
        || state.state === 'attacking' || state.state === 'eating' || state.state === 'drinking')) {
      this.playerAnimation.completeTransition();
    }
    if (animation.key.includes('-rest-micro-')) this.scheduleRestMicroAnimation(this.time.now);
    this.syncPlayerAnimation(this.time.now);
  }

  private updatePack(time: number, deltaSeconds: number): void {
    if (!FEATURE_FLAGS.pack) return;
    for (const [index, wolf] of this.pack.entries()) wolf.updateBehavior(time, deltaSeconds, this.player, this.prey, time < this.rallyUntil, index === 0 ? -1 : 1);
  }

  private updatePrey(time: number, activity: PlayerActivity): void {
    const threats: ThreatStimulus[] = [{
      x: this.player.x,
      y: this.player.y,
      visualSignature: activity.visualSignature,
      soundSignature: activity.soundSignature,
      scentSignature: activity.scentSignature,
    }, ...this.pack.map((wolf): ThreatStimulus => {
      const body = wolf.body as Phaser.Physics.Arcade.Body;
      return {
        x: wolf.x,
        y: wolf.y,
        visualSignature: 1,
        soundSignature: body.velocity.lengthSq() > 4 ? 0.55 : 0,
        scentSignature: 1,
      };
    }), ...this.territoryMarks.getActiveMarks(this.simulationTime).map((mark): ThreatStimulus => ({
      x: mark.x,
      y: mark.y,
      visualSignature: 0,
      soundSignature: 0,
      scentSignature: getTerritoryMarkStrength(this.simulationTime - mark.createdAt),
    }))];
    const awarenessEnvironment = {
      visibility: this.dayState.visibility,
      windX: this.windState.x,
      windY: this.windState.y,
      windStrength: this.windState.strength,
      hasLineOfSight: (observer: { x: number; y: number }, threat: { x: number; y: number }) => (
        this.world.hasLineOfSight(observer, threat)
      ),
    };
    const herds: Record<'deer' | 'elk' | 'boar', Prey[]> = {
      deer: this.prey.filter((animal) => animal.species === 'deer' && animal.active && !animal.isDead()),
      elk: this.prey.filter((animal) => animal.species === 'elk' && animal.active && !animal.isDead()),
      boar: this.prey.filter((animal) => animal.species === 'boar' && animal.active && !animal.isDead()),
    };
    for (const animal of this.prey) {
      if (!animal.active) continue;
      const previous = this.preyStates.get(animal) ?? animal.getState();
      const next = animal.updateBehavior(
        time,
        threats,
        WORLD_WIDTH,
        animal.species === 'rabbit' ? [] : herds[animal.species],
        awarenessEnvironment,
        this.preyHabitats[animal.species],
        this.simulationTime,
      );
      for (const event of this.huntLog.observe(animal, animal.species, next, animal.getAwarenessReading(), time)) {
        this.emitHuntLog(event.message);
      }
      if (next === 'flee') this.hearing.emitTracked(
        time,
        animal,
        animal.species === 'elk' ? 'HEAVY HOOVES' : animal.species === 'deer' ? 'DISTANT HOOVES' : animal.species === 'boar' ? 'ROOTING AND GRUNTS' : 'RUSTLING BRUSH',
        760,
        animal.species,
        this.scent.getSourceId(animal),
      );
      if (next === 'dead' && previous !== 'dead') {
        const naturalCause = animal.getDeathCause();
        let deathEvent = '';
        if (naturalCause === 'thirst') deathEvent = `A ${animal.species} collapses from thirst, leaving fresh carrion.`;
        else if (naturalCause === 'starvation') deathEvent = `A starving ${animal.species} falls, leaving fresh carrion.`;
        else if (naturalCause === 'exhaustion') deathEvent = `An exhausted ${animal.species} collapses, leaving fresh carrion.`;
        else if (FEATURE_FLAGS.pack) deathEvent = `The pack brings down a ${animal.species}.`;
        if (deathEvent) {
          this.setEvent(deathEvent);
          this.emitHuntLog(deathEvent);
        }
      }
      this.preyStates.set(animal, next);
    }
    this.prey = this.prey.filter((animal) => animal.active);
  }

  private updatePopulation(time: number): void {
    const living = {
      rabbit: this.prey.filter((animal) => animal.active && !animal.isDead() && animal.species === 'rabbit').length,
      deer: this.prey.filter((animal) => animal.active && !animal.isDead() && animal.species === 'deer').length,
      elk: this.prey.filter((animal) => animal.active && !animal.isDead() && animal.species === 'elk').length,
      boar: this.prey.filter((animal) => animal.active && !animal.isDead() && animal.species === 'boar').length,
    };
    const biomass = { ...living };
    for (const carcass of this.prey.filter((animal) => animal.active && animal.isDead() && animal.hasEdibleMeat())) {
      biomass[carcass.species] += carcass.getMeatAmount() / carcass.getMeatCapacity();
    }
    for (const species of this.population.update(time, living, {
      biomass,
      lean: isLeanDay(this.simulationTime),
      migrationOpen: this.difficulty === 'explorer' || isMigrationWindow(this.simulationTime),
    })) {
      this.spawnPrey(species);
      this.setEvent(species === 'elk'
        ? 'An elk herd enters the high meadow.'
        : species === 'deer'
          ? 'A deer rejoins the herd.'
          : species === 'boar' ? 'A boar sounder moves in from the wet woodland.' : 'Brush stirs at the forest edge.');
    }
  }

  private recordHuntAndDisplacePrey(animal: Prey): void {
    this.huntPressure.record({
      x: animal.x,
      y: animal.y,
      simulationMinutes: this.simulationTime,
      species: animal.species,
    });
    if (this.difficulty !== 'survival' || !this.huntPressure.isOverhunted(animal, this.simulationTime)) return;
    for (const nearby of this.prey) {
      if (!nearby.active || nearby.isDead() || nearby === animal) continue;
      if (Phaser.Math.Distance.Between(nearby.x, nearby.y, animal.x, animal.y) > OVERHUNTED_RADIUS) continue;
      nearby.migrateTo(this.findDistantMigrationPoint(animal), this.preyHabitats[nearby.species], this.time.now);
    }
  }

  private howl(time: number): void {
    if (!FEATURE_FLAGS.pack || this.pack.length < 2) return;
    this.rallyUntil = time + 13_000;
    this.hearing.emitTracked(time, this.pack[0], 'PACK HOWL', 1050, 'pack', this.scent.getSourceId(this.pack[0], 'pack'));
    this.hearing.emitTracked(time + 250, this.pack[1], 'PACK HOWL', 1050, 'pack', this.scent.getSourceId(this.pack[1], 'pack'));
    this.setEvent('Niva answers your call. The pack gathers.');
  }

  private interact(time: number): void {
    if (this.pendingBurial) return;
    if (this.carriedCarcass?.active && this.carriedCarcass.hasEdibleMeat()) {
      this.beginBurial(time, this.carriedCarcass);
      return;
    }
    this.carriedCarcass = undefined;

    const nearest = this.findNearestPrey();
    if (nearest && nearest.distance < 105) {
      const direction = resolvePlayerFacing(nearest.animal.x - this.player.x, nearest.animal.y - this.player.y).animationDirection;
      if (nearest.animal.isDead()) {
        if (!nearest.animal.hasEdibleMeat()) return;
        if (!this.needs.canEat()) {
          if (nearest.animal.isBuried()) nearest.animal.unbury();
          if (nearest.animal.pickUp()) {
            this.carriedCarcass = nearest.animal;
            this.updateCarriedCarcass();
            this.syncPlayerAnimation(this.time.now);
            this.setEvent(`You lift the ${nearest.animal.species} remains. Move away or press E again to bury them here.`);
          }
          return;
        }
        if (nearest.animal.isBuried()) {
          nearest.animal.unbury();
          this.setEvent(`You uncover the cached ${nearest.animal.species} meat.`);
        }
        if (!this.startPlayerAction('eating', direction)) return;
        const eaten = nearest.animal.consume(Math.min(24, this.needs.getFoodNeed() / 0.72));
        if (eaten > 0) {
          this.snapshot = this.needs.feed(eaten * 0.72);
          if (!this.needs.canEat() && nearest.animal.active && nearest.animal.hasEdibleMeat()) {
            this.setEvent(`You are full. The remaining ${nearest.animal.species} meat can be carried and cached.`);
          } else {
            this.setEvent(FEATURE_FLAGS.pack ? `You feed beside the pack on the ${nearest.animal.species}.` : `You feed on the ${nearest.animal.species}.`);
          }
        }
        return;
      }
      const attackCost = this.balance.player.attackStaminaCost;
      if (nearest.animal.isRetaliating(time)) {
        this.setEvent(nearest.animal.species === 'boar'
          ? 'The boar is still charging. Break contact.'
          : 'The deer is still kicking. Wait for an opening.');
        return;
      }
      if (time - this.lastAttackAt < 620 || !this.needs.canSpendStamina(attackCost)) {
        this.setEvent(!this.needs.canSpendStamina(attackCost) ? 'You are too exhausted to strike.' : 'Wait for an opening.');
        return;
      }
      if (!this.startPlayerAction('attacking', direction)) return;
      this.lastAttackAt = time;
      this.snapshot = this.needs.spendStamina(attackCost);
      const result = nearest.animal.attack('player', this.player);
      this.snapshot = this.needs.injure(result.retaliation);
      if (result.killed) {
        this.recordHuntAndDisplacePrey(nearest.animal);
        if (this.targetedPrey === nearest.animal) this.clearTargetedAnimal();
        this.setEvent(FEATURE_FLAGS.pack ? `The ${nearest.animal.species} falls. The pack closes in.` : `The ${nearest.animal.species} falls.`);
      } else if (result.retaliation > 0) {
        this.cameras.main.shake(180, 0.004);
        this.setEvent(nearest.animal.species === 'boar'
          ? 'The wounded boar wheels and drives forward with its tusks.'
          : 'The deer pivots and lands a hind-leg kick. Your wound slows you.');
      } else if (result.safeRearAttack) {
        this.setEvent('You strike from the blind rear angle before the deer can retaliate.');
      } else {
        this.setEvent(FEATURE_FLAGS.pack ? `The pack presses the ${nearest.animal.species}.` : `You press the ${nearest.animal.species}.`);
      }
      return;
    }
    if (this.distanceToWater() < 125) {
      const waterDirection = this.getWaterDirection();
      if (!this.startPlayerAction('drinking', waterDirection)) return;
      this.snapshot = this.needs.drink(34);
      this.setEvent('You drink from the cold water.');
      return;
    }
    const attackCost = this.balance.player.attackStaminaCost;
    if (time - this.lastAttackAt >= 620 && this.needs.canSpendStamina(attackCost)
      && this.startPlayerAction('attacking', this.playerAnimation.snapshot().direction)) {
      this.lastAttackAt = time;
      this.snapshot = this.needs.spendStamina(attackCost);
      this.setEvent('Your lunge meets empty air and costs precious stamina.');
    } else this.setEvent(this.needs.canSpendStamina(attackCost) ? 'Nothing here answers your reach.' : 'You are too exhausted to strike.');
  }

  private beginBurial(time: number, carcass: Prey): void {
    const direction = this.playerAnimation.snapshot().direction;
    const [directionX, directionY] = getPlayerDirectionVector(direction);
    const cachePosition = getCacheBurialPosition({
      x: this.player.x,
      y: this.player.y,
      directionX,
      directionY,
      clearance: carcass.species === 'elk' ? 185 : carcass.species === 'deer' ? 165 : 135,
      bounds: { width: WORLD_WIDTH, height: WORLD_HEIGHT, margin: 90 },
    });
    if (this.difficulty === 'survival') {
      const cell = this.world.layout.getCellAt(cachePosition);
      const placement = validateCachePlacement(
        cachePosition,
        cell?.ground,
        cell?.blocked ?? true,
        cell?.water ?? true,
        this.prey.filter((animal) => animal.active && animal.isBuried()),
        this.balance.cache.minimumSpacing,
      );
      if (!placement.allowed) {
        this.setEvent(placement.reason === 'too-close'
          ? 'This cache is too close to another. Carry it farther away.'
          : 'You need dry, soft forest or meadow ground to bury meat.');
        return;
      }
    }
    if (!this.needs.canSpendStamina(this.balance.player.burialStaminaCost)) {
      this.setEvent('You are too exhausted to dig a cache.');
      return;
    }
    if (!this.startPlayerAction('burying', direction)) return;
    this.snapshot = this.needs.spendStamina(this.balance.player.burialStaminaCost);
    this.pendingBurial = {
      carcass,
      x: cachePosition.x,
      y: cachePosition.y,
      completeAt: time + this.balance.cache.burialDurationMs,
    };
    this.setEvent('You scrape soil over the meat. Stay still until the cache is covered.');
    this.completeBurialIfReady(time);
  }

  private completeBurialIfReady(time: number): void {
    const pending = this.pendingBurial;
    if (!pending || time < pending.completeAt) return;
    this.pendingBurial = undefined;
    if (pending.carcass.active && pending.carcass === this.carriedCarcass
      && pending.carcass.buryAt(pending.x, pending.y)) {
      this.carriedCarcass = undefined;
      this.setEvent(`You finish burying the ${pending.carcass.species} remains.`);
      this.syncCacheProtection();
    }
    this.playerAnimation.completeTransition();
    this.syncPlayerAnimation(time);
  }

  private syncCacheProtection(): void {
    const caches = this.prey.filter((animal) => animal.active && animal.isBuried() && animal.hasEdibleMeat());
    const protectedCaches = selectProtectedCaches(
      caches,
      this.territoryMarks.getActiveMarks(this.simulationTime),
      this.balance.cache.maximumProtected,
      TERRITORY_MARK_SCENT_RADIUS,
    );
    for (const cache of caches) cache.setCacheProtected(protectedCaches.has(cache));
  }

  private startPlayerAction(action: PlayerActionState, direction: ReturnType<typeof resolvePlayerFacing>['animationDirection']): boolean {
    if (!this.playerAnimation.startAction(action, direction)) return false;
    this.player.setVelocity(0, 0);
    this.runControl.reset();
    this.syncPlayerAnimation(this.time.now);
    return true;
  }

  private updateCarriedCarcass(): void {
    const carcass = this.carriedCarcass;
    if (!carcass?.active || !carcass.isCarried() || !carcass.hasEdibleMeat()) {
      this.carriedCarcass = undefined;
      return;
    }
    carcass.setCarriedPosition(this.player.x, this.player.y);
  }

  private isCarryingCarcass(): boolean {
    return this.carriedCarcass?.active === true
      && this.carriedCarcass.isCarried()
      && this.carriedCarcass.hasEdibleMeat();
  }

  private syncTargetMarker(time: number): void {
    const target = this.targetedPrey;
    if (!isAnimalTargetAlive(target)) {
      this.clearTargetedAnimal();
      return;
    }
    if (!this.targetMarker) {
      this.targetMarker = this.add.image(0, 0, 'predator-target')
        .setOrigin(0.5, 1)
        .setTint(0xff6f68)
        .setAlpha(0.94)
        .setDepth(99_500);
    }
    const offset = target.species === 'elk' ? 82 : target.species === 'deer' ? 72 : 45;
    const pulse = 1 + Math.sin(time / 240) * 0.08;
    this.targetMarker
      .setPosition(target.x, target.y - offset)
      .setDisplaySize(38 * pulse, 38 * pulse)
      .setVisible(true);
  }

  private updateTargetTracking(time: number): void {
    const target = this.targetedPrey;
    if (!isAnimalTargetAlive(target)) return;
    const targetInRange = Phaser.Math.Distance.Between(this.player.x, this.player.y, target.x, target.y) <= SCENT_RENDER_RADIUS;
    const hasTrail = this.scent.hasTrackableTrail(time, this.player, target);
    if (this.targetTracker.update(time, targetInRange || hasTrail) !== 'lost') return;

    const species = target.species;
    this.clearTargetedAnimal();
    this.scentReading = this.scent.render(
      time,
      this.player,
      this.territoryMarks.getActiveMarks(this.simulationTime),
      this.simulationTime,
    );
    this.setEvent(`The marked ${species} trail has gone cold. You lose it.`);
    this.emitHud(true);
  }

  private clearTargetedAnimal(): void {
    this.targetedPrey = undefined;
    this.targetTracker.reset();
    this.targetMarker?.destroy();
    this.targetMarker = undefined;
  }

  private getWaterDirection(): ReturnType<typeof resolvePlayerFacing>['animationDirection'] {
    let nearest: { x: number; y: number; distance: number } | undefined;
    for (const area of this.world.getWaterAreas()) {
      const x = Phaser.Math.Clamp(this.player.x, area.x, area.x + area.width);
      const y = Phaser.Math.Clamp(this.player.y, area.y, area.y + area.height);
      const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, x, y);
      if (!nearest || distance < nearest.distance) nearest = { x, y, distance };
    }
    if (!nearest || nearest.distance === 0) return this.playerAnimation.snapshot().direction;
    return resolvePlayerFacing(nearest.x - this.player.x, nearest.y - this.player.y).animationDirection;
  }

  private findNearestPrey(): { animal: Prey; distance: number } | undefined {
    let result: { animal: Prey; distance: number } | undefined;
    for (const animal of this.prey) {
      if (!animal.active || animal.isCarried()) continue;
      const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, animal.x, animal.y);
      if (!result || distance < result.distance) result = { animal, distance };
    }
    return result;
  }

  private distanceToWater(): number { return this.world.distanceToWater(this.player); }

  private getContextAction(): string {
    if (this.pendingBurial) return 'BURYING...';
    if (this.carriedCarcass?.active && this.carriedCarcass.hasEdibleMeat()) return 'BURY CACHE';
    const nearest = this.findNearestPrey();
    if (nearest && nearest.distance < 105) {
      if (!nearest.animal.isDead()) return 'ATTACK';
      if (nearest.animal.isBuried()) return this.needs.canEat() ? 'DIG & EAT' : 'DIG & CARRY';
      return this.needs.canEat() ? 'EAT' : 'CARRY';
    }
    if (this.distanceToWater() < 125) return 'DRINK';
    return 'INTERACT';
  }

  private updateAmbientEvents(time: number): void {
    if (time - this.lastEventAt < 9000) return;
    this.lastEventAt = time;
    const fleeing = this.prey.find((animal) => animal.getState() === 'flee');
    if (fleeing) this.setEvent(`A ${fleeing.species} bolts through the undergrowth.`);
    else if (this.distanceToWater() < 300) this.setEvent('Running water covers the smaller sounds.');
    else this.setEvent(this.random.pick(FEATURE_FLAGS.pack
      ? ['Niva tests the wind ahead of you.', 'Torr watches the herd from cover.', 'The herd shifts beyond the trees.', 'Night gathers beneath the pines.']
      : ['The herd shifts beyond the trees.', 'Night gathers beneath the pines.', 'A lone call fades across the territory.']));
  }

  private updateAutosave(time: number): void {
    if (time - this.lastAutoSaveAt < 30_000) return;
    this.lastAutoSaveAt = time;
    void this.saveGame(false);
  }

  private setEvent(message: string): void { this.eventLine = message; this.lastEventAt = this.time.now; }

  private emitHuntLog(message: string): void {
    if (!this.logMode) return;
    gameEvents.emit('hunt-log', { time: this.getSimulationClock(), message });
  }

  private getSimulationClock(): string {
    const minutes = Math.floor(this.simulationTime) % 1440;
    return `${Math.floor(minutes / 60).toString().padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}`;
  }

  private emitHud(forceOrDue: boolean): void {
    if (!forceOrDue) return;
    this.lastHudAt = this.time.now;
    const caches = this.prey.filter((animal) => animal.active && animal.isBuried() && animal.hasEdibleMeat());
    const protectedCaches = selectProtectedCaches(
      caches,
      this.territoryMarks.getActiveMarks(this.simulationTime),
      this.balance.cache.maximumProtected,
      TERRITORY_MARK_SCENT_RADIUS,
    );
    const senseSources: SenseSourceSignal[] = [
      ...this.scentReading.signals.map((signal) => ({
        sourceId: signal.sourceId,
        kind: signal.kind,
        x: signal.x,
        y: signal.y,
        scentStrength: signal.strength,
        targeted: signal.targeted,
      })),
      ...this.soundSignals.map((signal) => ({
        sourceId: signal.sourceId,
        kind: signal.kind,
        x: signal.x,
        y: signal.y,
        hearingStrength: signal.strength,
      })),
    ];
    const worldView = this.cameras.main.worldView;
    const state: HudState = {
      ...this.snapshot,
      day: Math.floor(this.simulationTime / 1440) + 1,
      time: this.getSimulationClock(),
      timeIcon: this.dayState.icon,
      phaseLabel: this.dayState.phase,
      windArrow: this.windState.arrow,
      windLabel: this.windState.label,
      territoryLabel: (() => {
        const markCount = this.territoryMarks.getActiveMarks(this.simulationTime).length;
        return `${this.world.getTerritoryName(this.player)} · ${markCount} ${markCount === 1 ? 'MARK' : 'MARKS'}`;
      })(),
      contextAction: this.getContextAction(),
      willEatMeat: this.needs.canEat(),
      eventLine: this.eventLine,
      scentActive: this.scent.isActive(),
      senseCues: this.senseHud.update(this.player, {
        left: worldView.left,
        top: worldView.top,
        right: worldView.right,
        bottom: worldView.bottom,
      }, senseSources),
      sneaking: this.sneaking,
      canSkipRest: !this.restSkipping && this.playerAnimation.snapshot().state === 'resting' && this.needs.canRecoverWhileResting(),
      canMarkTerritory: this.canAttemptTerritoryMark() && this.territoryMarks.canMark(this.simulationTime),
      territoryMarkCount: this.territoryMarks.getActiveMarks(this.simulationTime).length,
      pack: this.pack.map((wolf) => ({ name: wolf.wolfName, status: wolf.getHudStatus() })),
      ambientColor: this.dayState.overlay,
      ambientOpacity: this.dayState.overlayOpacity,
      saveStatus: this.saveStatus,
      difficulty: this.difficulty,
      leanDay: isLeanDay(this.simulationTime),
      cacheCount: caches.length,
      protectedCacheCount: protectedCaches.size,
    };
    gameEvents.emit('hud', state);
  }

  private setPaused(paused: boolean): void {
    if (this.dead || this.restSkipping) return;
    this.paused = paused;
    if (paused) {
      this.pausedAt = this.time.now;
      this.player.setVelocity(0, 0);
      this.player.anims.pause();
      for (const animal of this.prey) animal.setVelocity(0, 0);
      for (const wolf of this.pack) wolf.setVelocity(0, 0);
    } else {
      if (this.pendingBurial && this.pausedAt > 0) {
        this.pendingBurial.completeAt += Math.max(0, this.time.now - this.pausedAt);
      }
      this.pausedAt = 0;
      this.player.anims.resume();
    }
    gameEvents.emit('pause', paused);
  }

  private handleDeath(): void {
    this.dead = true;
    this.player.setVelocity(0, 0).setTint(0x8e7d74).setAlpha(0.72).setAngle(8);
    this.playerShadow.sync(this.player, false);
    this.cameras.main.shake(250, 0.002);
    gameEvents.emit('death', this.snapshot.deathCause ?? 'Your strength failed.');
  }

  private async saveGame(manual: boolean): Promise<void> {
    if (this.dead || this.loadingSave || this.restSkipping) return;
    const data: SaveData = {
      version: 4,
      worldSeed: WORLD_SEED,
      savedAt: Date.now(),
      simulationTime: this.simulationTime,
      player: { x: this.player.x, y: this.player.y },
      needs: this.needs.snapshot(),
      difficulty: this.difficulty,
      huntPressure: this.huntPressure.recent(this.simulationTime),
      prey: this.prey
        .filter((animal) => animal.active && (!animal.isDead() || animal.hasEdibleMeat()))
        .map((animal) => ({
          species: animal.species,
          x: animal.x,
          y: animal.y,
          ...(!animal.isDead() ? { health: animal.getHealth() } : {}),
          ...(animal.isDead() ? {
            carcass: {
              meat: animal.getMeatAmount(),
              state: animal.isBuried() ? 'buried' as const : animal.isCarried() ? 'carried' as const : 'exposed' as const,
            },
          } : {}),
        })),
      pack: this.pack.map((wolf) => wolf.snapshot()),
      scentActive: this.scent.isActive(),
      territoryMarks: this.territoryMarks.snapshot(this.simulationTime),
    };
    try {
      await this.saves.save(data);
      this.saveStatus = 'SAVED';
      this.saveStatusUntil = this.time.now + 2600;
      if (manual) this.setEvent(FEATURE_FLAGS.pack ? 'The life of the pack is remembered.' : 'Your trail is remembered.');
    } catch {
      this.saveStatus = 'SAVE FAILED';
      this.saveStatusUntil = this.time.now + 5000;
      if (manual) this.setEvent('The forest could not be remembered.');
    }
  }

  private async restoreLatestSave(manual: boolean): Promise<void> {
    if (this.loadingSave || this.restSkipping) return;
    this.loadingSave = true;
    try {
      const data = await this.saves.load();
      if (!data) { if (manual) this.setEvent('No remembered life was found.'); return; }
      if (data.worldSeed !== WORLD_SEED) { if (manual) this.setEvent('That remembered trail belongs to another territory.'); return; }
      const selectedDifficulty = this.registry.get('difficulty');
      this.difficulty = data.difficulty ?? (isDifficultyMode(selectedDifficulty) ? selectedDifficulty : 'explorer');
      this.balance = getBalanceProfile(this.difficulty);
      this.registry.set('difficulty', this.difficulty);
      this.needs = new NeedsSystem(this.balance.player);
      this.population = new PopulationSystem(this.balance);
      this.simulationTime = data.simulationTime;
      this.currentDay = getDayNumber(this.simulationTime);
      this.huntPressure.restore(data.huntPressure ?? [], this.simulationTime);
      const safePlayerPosition = this.world.layout.findOpenPositionNear(data.player);
      this.player.setPosition(safePlayerPosition.x, safePlayerPosition.y).clearTint().setAlpha(1).setAngle(0);
      this.playerAnimation.reset(this.playerAnimation.snapshot().direction);
      this.runControl.reset();
      this.lungeUntil = 0;
      this.nextRestMicroAt = 0;
      this.syncPlayerAnimation(this.time.now);
      this.snapshot = this.needs.restore(data.needs);
      this.pendingBurial = undefined;
      this.clearTargetedAnimal();
      for (const animal of this.prey) animal.destroy();
      this.prey = [];
      this.carriedCarcass = undefined;
      for (const animal of data.prey) {
        const spawned = this.spawnPrey(animal.species, animal.x, animal.y);
        if (animal.carcass) {
          spawned.restoreCarcass(animal.carcass.meat, animal.carcass.state);
          if (animal.carcass.state === 'carried') this.carriedCarcass = spawned;
        } else if (animal.health !== undefined) spawned.restoreHealth(animal.health);
      }
      this.updateCarriedCarcass();
      this.syncPlayerAnimation(this.time.now);
      for (const wolf of this.pack) {
        const saved = data.pack.find((candidate) => candidate.name === wolf.wolfName);
        if (saved) wolf.restore(saved);
      }
      this.scent.setActive(data.scentActive);
      this.territoryMarks.restore(data.territoryMarks ?? [], this.simulationTime);
      this.syncCacheProtection();
      this.refreshWorldTimeState();
      this.syncPlayerAnimation(this.time.now);
      this.dead = false;
      this.setPaused(false);
      this.saveStatus = 'LOADED';
      this.saveStatusUntil = this.time.now + 2600;
      this.setEvent(FEATURE_FLAGS.pack ? 'The pack returns to a remembered trail.' : 'You return to a remembered trail.');
    } catch {
      this.saveStatus = 'LOAD FAILED';
      this.saveStatusUntil = this.time.now + 5000;
      if (manual) this.setEvent('The remembered trail could not be followed.');
    } finally { this.loadingSave = false; }
  }

  private async restartFresh(): Promise<void> {
    try { await this.saves.clear(); } finally { this.scene.restart(); }
  }

  private addMorningMist(): void {
    for (let index = 0; index < 44; index += 1) {
      const mist = this.add.ellipse(this.random.integerInRange(100, WORLD_WIDTH - 100), this.random.integerInRange(80, WORLD_HEIGHT - 80), this.random.integerInRange(90, 220), this.random.integerInRange(18, 40), 0xd9e4df, this.random.realInRange(0.025, 0.065)).setDepth(4);
      this.tweens.add({ targets: mist, x: mist.x + this.random.integerInRange(60, 150), alpha: { from: mist.alpha, to: mist.alpha * 0.35 }, duration: this.random.integerInRange(9000, 17000), yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    }
  }
}
