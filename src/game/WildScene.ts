import Phaser from 'phaser';
import { PackWolf } from './entities/PackWolf';
import { Prey, type PreyHabitat, type PreySpecies, type PreyState, type ThreatStimulus } from './entities/Prey';
import { gameEvents, type HudState } from './events';
import { FEATURE_FLAGS } from './features';
import { DayNightSystem, type DayNightState } from './systems/DayNightSystem';
import { getPlayerDirectionVector, PLAYER_DIRECTIONS, resolvePlayerFacing } from './systems/DirectionalSpriteSystem';
import { FootprintSystem } from './systems/FootprintSystem';
import { NeedsSystem, type NeedsSnapshot } from './systems/NeedsSystem';
import { getPlayerAnimationKey, PlayerAnimationSystem, type PlayerActionState } from './systems/PlayerAnimationSystem';
import { PopulationSystem } from './systems/PopulationSystem';
import { getPreyAnimationFrames, getPreyAnimationKey, type PreyAnimationState } from './systems/PreyAnimationSystem';
import { WORLD_HEIGHT, WORLD_SEED, WORLD_WIDTH } from './systems/ProceduralWorld';
import { RunControlSystem } from './systems/RunControlSystem';
import { SaveSystem, type SaveData } from './systems/SaveSystem';
import { EMPTY_SCENT_READING, ScentSystem, type ScentReading } from './systems/ScentSystem';
import { SoundSystem } from './systems/SoundSystem';
import { WindSystem, type WindState } from './systems/WindSystem';
import { WorldSystem } from './systems/WorldSystem';
import { getWolfMovementProfile, SNEAK_ANIMATION_TIME_SCALE } from './systems/WolfStealthSystem';

interface ControlKeys {
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
  run: Phaser.Input.Keyboard.Key;
  interact: Phaser.Input.Keyboard.Key;
  howl: Phaser.Input.Keyboard.Key;
  rest: Phaser.Input.Keyboard.Key;
  pause: Phaser.Input.Keyboard.Key;
  escape: Phaser.Input.Keyboard.Key;
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

export class WildScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private world!: WorldSystem;
  private prey: Prey[] = [];
  private preyHabitats!: Record<PreySpecies, PreyHabitat>;
  private pack: PackWolf[] = [];
  private needs = new NeedsSystem();
  private scent!: ScentSystem;
  private hearing!: SoundSystem;
  private footprints!: FootprintSystem;
  private population = new PopulationSystem();
  private readonly playerAnimation = new PlayerAnimationSystem();
  private readonly runControl = new RunControlSystem();
  private readonly dayNight = new DayNightSystem();
  private readonly wind = new WindSystem();
  private readonly saves = new SaveSystem();
  private keys!: ControlKeys;
  private route: Phaser.Math.Vector2[] = [];
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
  private soundSummary = '';
  private scentReading: ScentReading = EMPTY_SCENT_READING;
  private saveStatus = '';
  private saveStatusUntil = 0;
  private paused = false;
  private dead = false;
  private loadingSave = false;
  private sneaking = false;
  private nextRestMicroAt = 0;
  private readonly preyStates = new WeakMap<Prey, PreyState>();
  private random = new Phaser.Math.RandomDataGenerator([WORLD_SEED]);

  private readonly handleWindowKey = (event: KeyboardEvent): void => {
    if (event.key === 'F5') {
      event.preventDefault();
      void this.saveGame(true);
    } else if (event.key === 'F9') {
      event.preventDefault();
      void this.restoreLatestSave(true);
    } else if (event.code === 'KeyQ' && !event.repeat && !this.paused && !this.dead && !this.loadingSave) {
      const active = this.scent.toggle();
      this.setEvent(active ? 'You lift your muzzle into the wind.' : 'The forest returns to ordinary sight.');
    } else if (event.code === 'KeyC' && !event.repeat && !this.paused && !this.dead && !this.loadingSave) {
      this.sneaking = !this.sneaking;
      this.runControl.reset();
      this.setEvent(this.sneaking ? 'You lower your body and quiet your steps.' : 'You rise back to a normal gait.');
    }
  };

  constructor() {
    super('wild');
  }

  preload(): void {
    this.load.image('ground-base', 'assets/ground-base-v2.png');
    this.load.spritesheet('terrain-overlays', 'assets/terrain-overlays-v2.png', { frameWidth: 313, frameHeight: 313 });
    this.load.spritesheet('obstacle-atlas', 'assets/obstacle-atlas-v2.png', { frameWidth: 313, frameHeight: 313 });
    for (const direction of PLAYER_DIRECTIONS) {
      this.load.atlas(`wolf-${direction}-motion`, `assets/player-wolf-v2/wolf-${direction}-motion.png`, 'assets/player-wolf-v2/wolf-grid-atlas.json');
      this.load.atlas(`wolf-${direction}-run`, `assets/player-wolf-v2/wolf-${direction}-run.png`, 'assets/player-wolf-v2/wolf-grid-atlas.json');
      this.load.atlas(`wolf-${direction}-rest`, `assets/player-wolf-v2/wolf-${direction}-rest.png`, 'assets/player-wolf-v2/wolf-grid-atlas.json');
      this.load.atlas(`wolf-${direction}-action`, `assets/player-wolf-v2/wolf-${direction}-action.png`, 'assets/player-wolf-v2/wolf-grid-atlas.json');
    }
    this.load.spritesheet('niva', 'assets/niva-sheet.png', { frameWidth: 346, frameHeight: 284 });
    this.load.spritesheet('torr', 'assets/torr-sheet.png', { frameWidth: 346, frameHeight: 284 });
    this.load.spritesheet('rabbit', 'assets/prey-v2/rabbit-atlas.png', { frameWidth: 181, frameHeight: 181 });
    this.load.spritesheet('deer', 'assets/prey-v2/deer-atlas.png', { frameWidth: 181, frameHeight: 181 });
    this.load.spritesheet('tracks', 'assets/tracks-sheet.png', { frameWidth: 321, frameHeight: 305 });
  }

  create(): void {
    this.needs = new NeedsSystem();
    this.population = new PopulationSystem();
    this.random = new Phaser.Math.RandomDataGenerator([WORLD_SEED]);
    this.snapshot = this.needs.snapshot();
    this.prey = [];
    this.pack = [];
    this.route = [];
    this.playerAnimation.reset();
    this.runControl.reset();
    this.simulationTime = 18 * 60 + 42;
    this.paused = false;
    this.dead = false;
    this.loadingSave = false;
    this.sneaking = false;
    this.nextRestMicroAt = 0;
    this.rallyUntil = 0;
    this.eventLine = 'Listen to the forest.';
    this.saveStatus = '';
    this.soundSummary = '';
    this.scentReading = EMPTY_SCENT_READING;

    this.world = new WorldSystem(this, WORLD_SEED);
    this.world.create();
    this.preyHabitats = {
      rabbit: this.createPreyHabitat('rabbit'),
      deer: this.createPreyHabitat('deer'),
    };
    this.addMorningMist();
    this.createAnimations();

    const spawn = this.world.getSpawnPoint();
    this.player = this.physics.add.sprite(spawn.x, spawn.y, 'wolf-south-motion', 'frame-8').setScale(0.42).setDepth(spawn.y + 30);
    this.player.setCollideWorldBounds(true);
    this.player.setBodySize(150, 82).setOffset(98, 160);
    this.player.on(Phaser.Animations.Events.ANIMATION_COMPLETE, this.handlePlayerAnimationComplete, this);
    this.syncPlayerAnimation(this.time.now);
    this.world.addCollider(this.player, () => { this.route = []; });

    this.spawnInitialPopulation();
    if (FEATURE_FLAGS.pack) this.spawnPack();
    this.scent = new ScentSystem(this, this.world.getWaterAreas());
    this.hearing = new SoundSystem(this);
    this.hearing.addAmbientAreas(this.world.getWaterAreas(), 'FLOWING WATER', 720, 0.68);
    this.footprints = new FootprintSystem(this);
    this.keys = this.createKeys();
    this.configureCamera();
    this.configurePointerMovement();
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
    });
  }

  update(time: number, delta: number): void {
    if (Phaser.Input.Keyboard.JustDown(this.keys.pause) || Phaser.Input.Keyboard.JustDown(this.keys.escape)) this.setPaused(!this.paused);
    if (this.paused || this.dead || this.loadingSave) {
      this.player.setVelocity(0, 0);
      return;
    }
    if (FEATURE_FLAGS.pack && Phaser.Input.Keyboard.JustDown(this.keys.howl)) this.howl(time);

    const deltaSeconds = Math.min(delta / 1000, 0.05);
    const activity = this.updatePlayerMovement(time, delta);
    this.snapshot = this.needs.update(deltaSeconds, activity);
    this.simulationTime += deltaSeconds * 1.8;
    this.dayState = this.dayNight.getState(this.simulationTime);
    this.windState = this.wind.getState(this.simulationTime);
    this.scent.setWind(this.windState.x, this.windState.y, this.windState.strength);

    this.updatePack(time, deltaSeconds);
    this.updatePrey(time, activity);
    this.updatePopulation(time);
    this.scent.record(time, this.prey, this.pack);
    this.scentReading = this.scent.render(time, this.player);
    this.footprints.record(time, this.player, this.prey, this.pack);
    this.soundSummary = this.hearing.render(time, this.player, 0.82 + this.dayState.visibility * 0.28);

    if (Phaser.Input.Keyboard.JustDown(this.keys.interact)) this.interact(time);
    if (!this.snapshot.alive) this.handleDeath();
    this.updateAmbientEvents(time);
    this.updateAutosave(time);
    if (time > this.saveStatusUntil) this.saveStatus = '';
    this.emitHud(time - this.lastHudAt > 100);
  }

  private createAnimations(): void {
    const directions = ['down-right', 'down-left', 'up-right', 'up-left'];
    for (const [row, direction] of directions.entries()) {
      for (const wolf of ['niva', 'torr'] as const) {
        for (const rate of [6, 8, 11]) {
          const key = `${wolf}-${direction}-${rate}`;
          if (!this.anims.exists(key)) this.anims.create({ key, frames: this.anims.generateFrameNumbers(wolf, { start: row * 4, end: row * 4 + 3 }), frameRate: rate, repeat: -1 });
        }
      }
    }
    const preyAnimationSettings: Record<PreyAnimationState, { frameRate: number; repeat: number }> = {
      idle: { frameRate: 0.8, repeat: -1 },
      walk: { frameRate: 6, repeat: -1 },
      flee: { frameRate: 11, repeat: -1 },
      dead: { frameRate: 1, repeat: 0 },
    };
    for (const species of ['rabbit', 'deer'] as const) {
      for (const direction of PLAYER_DIRECTIONS) {
        for (const state of ['idle', 'walk', 'flee', 'dead'] as const) {
          const key = getPreyAnimationKey(species, direction, state);
          if (!this.anims.exists(key)) {
            const settings = preyAnimationSettings[state];
            this.anims.create({
              key,
              frames: getPreyAnimationFrames(direction, state).map((frame) => ({ key: species, frame })),
              frameRate: settings.frameRate,
              repeat: settings.repeat,
            });
          }
        }
      }
    }
    for (const direction of PLAYER_DIRECTIONS) {
      const motionTexture = `wolf-${direction}-motion`;
      const runTexture = `wolf-${direction}-run`;
      const restTexture = `wolf-${direction}-rest`;
      const actionTexture = `wolf-${direction}-action`;
      const create = (key: string, frames: Phaser.Types.Animations.AnimationFrame[], frameRate: number, repeat: number): void => {
        if (!this.anims.exists(key)) this.anims.create({ key, frames, frameRate, repeat });
      };
      create(`player-${direction}-walk`, this.anims.generateFrameNames(motionTexture, { prefix: 'frame-', start: 0, end: 7 }), 8, -1);
      create(`player-${direction}-run`, this.anims.generateFrameNames(runTexture, { prefix: 'frame-', start: 0, end: 15 }), 16, -1);
      create(`player-${direction}-idle`, this.anims.generateFrameNames(motionTexture, { prefix: 'frame-', start: 8, end: 15 }), 3, -1);
      create(`player-${direction}-lay`, this.anims.generateFrameNames(restTexture, { prefix: 'frame-', start: 0, end: 5 }), 6, 0);
      create(`player-${direction}-rest-breathe`, this.anims.generateFrameNames(restTexture, { prefix: 'frame-', start: 6, end: 7 }), 0.8, -1);
      create(`player-${direction}-rest-micro-ear`, [6, 8, 6, 7].map((frame) => ({ key: restTexture, frame: `frame-${frame}` })), 3, 0);
      create(`player-${direction}-rest-micro-head`, [6, 9, 7, 6].map((frame) => ({ key: restTexture, frame: `frame-${frame}` })), 2, 0);
      create(`player-${direction}-get-up`, this.anims.generateFrameNames(restTexture, { prefix: 'frame-', start: 10, end: 15 }), 6, 0);
      create(`player-${direction}-attack`, this.anims.generateFrameNames(actionTexture, { prefix: 'frame-', start: 0, end: 4 }), 10, 0);
      create(`player-${direction}-eat`, this.anims.generateFrameNames(actionTexture, { prefix: 'frame-', start: 5, end: 9 }), 7, 0);
      create(`player-${direction}-drink`, this.anims.generateFrameNames(actionTexture, { prefix: 'frame-', start: 10, end: 15 }), 7, 0);
    }
  }

  private spawnInitialPopulation(): void {
    for (let index = 0; index < 12; index += 1) {
      this.spawnPrey('rabbit', this.random.integerInRange(420, WORLD_WIDTH - 420), this.random.integerInRange(420, WORLD_HEIGHT - 420));
    }
    const herdCenter = new Phaser.Math.Vector2(WORLD_WIDTH * 0.73, WORLD_HEIGHT * 0.27);
    for (let index = 0; index < 14; index += 1) {
      this.spawnPrey('deer', herdCenter.x + this.random.integerInRange(-620, 620), herdCenter.y + this.random.integerInRange(-480, 480));
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
    const requested = {
      x: x ?? this.random.integerInRange(380, WORLD_WIDTH - 380),
      y: y ?? this.random.integerInRange(380, WORLD_HEIGHT - 380),
    };
    const requestedCell = this.world.layout.getCellAt(requested);
    const position = requestedCell && !requestedCell.blocked && !requestedCell.water
      ? new Phaser.Math.Vector2(requested.x, requested.y)
      : this.world.findOpenPositionNear(requested);
    const animal = new Prey(this, species, position.x, position.y, this.random);
    this.prey.push(animal);
    this.world.addCollider(animal, () => animal.handleTerrainCollision());
    return animal;
  }

  private createPreyHabitat(species: PreySpecies): PreyHabitat {
    const resources = this.world.layout.getHabitatResources(species);
    return {
      ...resources,
      findPath: (start, destination) => this.world.layout.findPath(start, destination),
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
      rest: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R), pause: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      escape: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC),
    };
  }

  private configureCamera(): void {
    const camera = this.cameras.main;
    camera.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT).startFollow(this.player, true, 0.085, 0.085).setZoom(0.82).fadeIn(700, 12, 20, 15);
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _objects: unknown[], _dx: number, dy: number) => camera.setZoom(Phaser.Math.Clamp(camera.zoom - dy * 0.00045, 0.62, 1.16)));
  }

  private configurePointerMovement(): void {
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.paused && !this.dead && pointer.leftButtonDown()) {
        this.route = this.world.findPath(this.player, { x: pointer.worldX, y: pointer.worldY });
        if (this.route.length > 0) this.setEvent('You pick a route through the trees.');
        else this.setEvent('No safe route opens through that terrain.');
      }
    });
  }

  private configureEventRequests(): void {
    gameEvents.on('resume-request', this.resumeFromRequest, this);
    gameEvents.on('restart-request', this.restartFromRequest, this);
    gameEvents.on('load-request', this.loadFromRequest, this);
  }

  private resumeFromRequest(): void { this.setPaused(false); }
  private restartFromRequest(): void { void this.restartFresh(); }
  private loadFromRequest(): void { void this.restoreLatestSave(true); }

  private updatePlayerMovement(time: number, delta: number): PlayerActivity {
    const direction = new Phaser.Math.Vector2(Number(this.keys.right.isDown) - Number(this.keys.left.isDown), Number(this.keys.down.isDown) - Number(this.keys.up.isDown));
    if (direction.lengthSq() > 0) {
      direction.normalize();
      this.route = [];
    } else if (this.route.length > 0) {
      direction.copy(this.route[0]).subtract(new Phaser.Math.Vector2(this.player.x, this.player.y));
      if (direction.length() < 30) {
        this.route.shift();
        if (this.route.length > 0) direction.copy(this.route[0]).subtract(new Phaser.Math.Vector2(this.player.x, this.player.y));
        else direction.set(0, 0);
      }
      if (direction.lengthSq() > 0) direction.normalize();
    }
    const requestedFacing = direction.lengthSq() > 0 ? resolvePlayerFacing(direction.x, direction.y) : undefined;
    const running = this.runControl.update(!this.sneaking && this.keys.run.isDown, this.needs.canRun()) && requestedFacing !== undefined;
    const decision = this.playerAnimation.update(delta, {
      direction: requestedFacing?.animationDirection,
      running,
      sneaking: this.sneaking,
      restRequested: this.keys.rest.isDown && requestedFacing === undefined,
    });
    const movement = requestedFacing
      ? direction
      : decision.movementAllowed ? new Phaser.Math.Vector2(...getPlayerDirectionVector(decision.direction)) : new Phaser.Math.Vector2();
    const moving = decision.movementAllowed && movement.lengthSq() > 0;
    const profile = getWolfMovementProfile({ moving, running: decision.running, sneaking: this.sneaking });
    this.player.setVelocity(moving ? movement.x * profile.speed : 0, moving ? movement.y * profile.speed : 0).setDepth(this.player.y + 30).setRotation(0);
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
    const currentKey = this.player.anims.currentAnim?.key ?? '';
    if (animation.state === 'resting' && currentKey.includes('-rest-micro-') && this.player.anims.isPlaying) return;
    const key = getPlayerAnimationKey(animation.state, animation.direction);
    if (currentKey !== key || !this.player.anims.isPlaying) {
      const preserveGaitPhase = currentKey === `player-${animation.direction}-walk` || currentKey === `player-${animation.direction}-run`;
      const gaitProgress = preserveGaitPhase ? this.player.anims.getProgress() : 0;
      this.player.anims.play(key);
      if (preserveGaitPhase && (animation.state === 'walking' || animation.state === 'sneaking' || animation.state === 'running')) {
        this.player.anims.setProgress(gaitProgress);
      }
    }
    this.player.anims.timeScale = animation.state === 'sneaking' ? SNEAK_ANIMATION_TIME_SCALE : 1;
    if (animation.state === 'resting') {
      if (this.nextRestMicroAt === 0) this.scheduleRestMicroAnimation(time);
    } else this.nextRestMicroAt = 0;
  }

  private updateRestMicroAnimation(time: number): void {
    const animation = this.playerAnimation.snapshot();
    if (animation.state !== 'resting' || time < this.nextRestMicroAt) return;
    const micro = this.random.integerInRange(0, 1) === 0 ? 'ear' : 'head';
    this.nextRestMicroAt = 0;
    this.player.anims.play(`player-${animation.direction}-rest-micro-${micro}`);
  }

  private scheduleRestMicroAnimation(time: number): void {
    this.nextRestMicroAt = time + this.random.integerInRange(4_500, 10_500);
  }

  private handlePlayerAnimationComplete(animation: Phaser.Animations.Animation): void {
    const state = this.playerAnimation.snapshot();
    if (animation.key === getPlayerAnimationKey(state.state, state.direction)
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
    })];
    const awarenessEnvironment = {
      visibility: this.dayState.visibility,
      windX: this.windState.x,
      windY: this.windState.y,
      windStrength: this.windState.strength,
      hasLineOfSight: (observer: { x: number; y: number }, threat: { x: number; y: number }) => (
        this.world.hasLineOfSight(observer, threat)
      ),
    };
    const deer = this.prey.filter((animal) => animal.species === 'deer' && animal.active && !animal.isDead());
    for (const animal of this.prey) {
      if (!animal.active) continue;
      const previous = this.preyStates.get(animal) ?? animal.getState();
      const next = animal.updateBehavior(
        time,
        threats,
        WORLD_WIDTH,
        animal.species === 'deer' ? deer : [],
        awarenessEnvironment,
        this.preyHabitats[animal.species],
        this.simulationTime,
      );
      if (next === 'flee') this.hearing.emitTracked(time, animal, animal.species === 'deer' ? 'DISTANT HOOVES' : 'RUSTLING BRUSH');
      if (FEATURE_FLAGS.pack && next === 'dead' && previous !== 'dead') this.setEvent(`The pack brings down a ${animal.species}.`);
      this.preyStates.set(animal, next);
    }
    this.prey = this.prey.filter((animal) => animal.active);
  }

  private updatePopulation(time: number): void {
    const living = {
      rabbit: this.prey.filter((animal) => animal.active && !animal.isDead() && animal.species === 'rabbit').length,
      deer: this.prey.filter((animal) => animal.active && !animal.isDead() && animal.species === 'deer').length,
    };
    for (const species of this.population.update(time, living)) {
      this.spawnPrey(species);
      this.setEvent(species === 'deer' ? 'A deer rejoins the herd.' : 'Brush stirs at the forest edge.');
    }
  }

  private howl(time: number): void {
    if (!FEATURE_FLAGS.pack || this.pack.length < 2) return;
    this.rallyUntil = time + 13_000;
    this.hearing.emit(time, this.pack[0].x, this.pack[0].y, 'PACK HOWL', 1050);
    this.hearing.emit(time + 250, this.pack[1].x, this.pack[1].y, 'PACK HOWL', 1050);
    this.setEvent('Niva answers your call. The pack gathers.');
  }

  private interact(time: number): void {
    const nearest = this.findNearestPrey();
    if (nearest && nearest.distance < 105) {
      const direction = resolvePlayerFacing(nearest.animal.x - this.player.x, nearest.animal.y - this.player.y).animationDirection;
      if (nearest.animal.isDead()) {
        if (!this.startPlayerAction('eating', direction)) return;
        const eaten = nearest.animal.consume(24);
        if (eaten > 0) {
          this.snapshot = this.needs.feed(eaten * 0.72);
          this.setEvent(FEATURE_FLAGS.pack ? `You feed beside the pack on the ${nearest.animal.species}.` : `You feed on the ${nearest.animal.species}.`);
        }
        return;
      }
      if (time - this.lastAttackAt < 620 || this.snapshot.stamina < 8) {
        this.setEvent(this.snapshot.stamina < 8 ? 'You are too exhausted to strike.' : 'Wait for an opening.');
        return;
      }
      if (!this.startPlayerAction('attacking', direction)) return;
      this.lastAttackAt = time;
      const result = nearest.animal.attack('player');
      this.snapshot = this.needs.injure(result.retaliation);
      if (result.killed) {
        this.setEvent(FEATURE_FLAGS.pack ? `The ${nearest.animal.species} falls. The pack closes in.` : `The ${nearest.animal.species} falls.`);
      } else if (result.retaliation > 0) {
        this.setEvent('The deer kicks as it breaks away.');
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
    this.setEvent('Nothing here answers your reach.');
  }

  private startPlayerAction(action: PlayerActionState, direction: ReturnType<typeof resolvePlayerFacing>['animationDirection']): boolean {
    if (!this.playerAnimation.startAction(action, direction)) return false;
    this.route = [];
    this.player.setVelocity(0, 0);
    this.runControl.reset();
    this.syncPlayerAnimation(this.time.now);
    return true;
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
      if (!animal.active) continue;
      const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, animal.x, animal.y);
      if (!result || distance < result.distance) result = { animal, distance };
    }
    return result;
  }

  private distanceToWater(): number { return this.world.distanceToWater(this.player); }

  private getContextAction(): string {
    const nearest = this.findNearestPrey();
    if (nearest && nearest.distance < 105) return nearest.animal.isDead() ? 'EAT' : 'ATTACK';
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

  private emitHud(forceOrDue: boolean): void {
    if (!forceOrDue) return;
    this.lastHudAt = this.time.now;
    const minutes = Math.floor(this.simulationTime) % 1440;
    const state: HudState = {
      ...this.snapshot,
      day: Math.floor(this.simulationTime / 1440) + 1,
      time: `${Math.floor(minutes / 60).toString().padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}`,
      timeIcon: this.dayState.icon,
      phaseLabel: this.dayState.phase,
      windArrow: this.windState.arrow,
      windLabel: this.windState.label,
      territoryLabel: this.world.getTerritoryName(this.player),
      contextAction: this.getContextAction(),
      eventLine: this.eventLine,
      scentActive: this.scent.isActive(),
      scentSummary: this.scentReading.summary,
      scentDirectionArrow: this.scentReading.arrow,
      scentDirectionLabel: this.scentReading.label,
      soundSummary: this.soundSummary,
      sneaking: this.sneaking,
      pack: this.pack.map((wolf) => ({ name: wolf.wolfName, status: wolf.getHudStatus() })),
      ambientColor: this.dayState.overlay,
      ambientOpacity: this.dayState.overlayOpacity,
      saveStatus: this.saveStatus,
    };
    gameEvents.emit('hud', state);
  }

  private setPaused(paused: boolean): void {
    if (this.dead) return;
    this.paused = paused;
    if (paused) {
      this.player.setVelocity(0, 0);
      this.player.anims.pause();
      for (const animal of this.prey) animal.setVelocity(0, 0);
      for (const wolf of this.pack) wolf.setVelocity(0, 0);
    } else this.player.anims.resume();
    gameEvents.emit('pause', paused);
  }

  private handleDeath(): void {
    this.dead = true;
    this.player.setVelocity(0, 0).setTint(0x8e7d74).setAlpha(0.72).setAngle(8);
    this.cameras.main.shake(250, 0.002);
    gameEvents.emit('death', this.snapshot.deathCause ?? 'Your strength failed.');
  }

  private async saveGame(manual: boolean): Promise<void> {
    if (this.dead || this.loadingSave) return;
    const data: SaveData = {
      version: 3,
      worldSeed: WORLD_SEED,
      savedAt: Date.now(),
      simulationTime: this.simulationTime,
      player: { x: this.player.x, y: this.player.y },
      needs: this.needs.snapshot(),
      prey: this.prey.filter((animal) => animal.active && !animal.isDead()).map((animal) => ({ species: animal.species, x: animal.x, y: animal.y })),
      pack: this.pack.map((wolf) => wolf.snapshot()),
      scentActive: this.scent.isActive(),
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
    if (this.loadingSave) return;
    this.loadingSave = true;
    try {
      const data = await this.saves.load();
      if (!data) { if (manual) this.setEvent('No remembered life was found.'); return; }
      if (data.worldSeed !== WORLD_SEED) { if (manual) this.setEvent('That remembered trail belongs to another territory.'); return; }
      this.simulationTime = data.simulationTime;
      this.player.setPosition(data.player.x, data.player.y).clearTint().setAlpha(1).setAngle(0);
      this.playerAnimation.reset(this.playerAnimation.snapshot().direction);
      this.runControl.reset();
      this.nextRestMicroAt = 0;
      this.syncPlayerAnimation(this.time.now);
      this.snapshot = this.needs.restore(data.needs);
      for (const animal of this.prey) animal.destroy();
      this.prey = [];
      for (const animal of data.prey) this.spawnPrey(animal.species, animal.x, animal.y);
      for (const wolf of this.pack) {
        const saved = data.pack.find((candidate) => candidate.name === wolf.wolfName);
        if (saved) wolf.restore(saved);
      }
      this.scent.setActive(data.scentActive);
      this.dayState = this.dayNight.getState(this.simulationTime);
      this.windState = this.wind.getState(this.simulationTime);
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
