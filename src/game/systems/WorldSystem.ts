import Phaser from 'phaser';
import {
  ProceduralWorld,
  WORLD_HEIGHT,
  WORLD_TILE_SIZE,
  WORLD_WIDTH,
  type ObstacleKind,
  type PathConnections,
  type ProceduralDecoration,
  type ProceduralTerrainFeature,
  type WaterArea,
  type WaterFlow,
  type WorldPoint,
} from './ProceduralWorld';
import { distanceToAreas } from './geometry';
import { getObstacleCollisionGeometry } from './ObstacleCollision';
import { getPathRenderPieces } from './PathRendering';
import { getDecorationDepth, getObstacleDepth, getTerrainFeatureDepth } from './WorldDepth';
import {
  ENVIRONMENT_MOTION_INTERVAL_MS,
  getEnvironmentMotionBucketKey,
  getEnvironmentMotionPhase,
  getEnvironmentMotionSample,
  getNearbyEnvironmentMotionBucketKeys,
  isEnvironmentMotionNearby,
  type EnvironmentMotionKind,
} from './EnvironmentMotion';

type EnvironmentMotionTarget = Phaser.GameObjects.Image | Phaser.Physics.Arcade.Image | Phaser.GameObjects.Graphics;

interface EnvironmentMotionActor {
  target: EnvironmentMotionTarget;
  kind: EnvironmentMotionKind;
  anchor: WorldPoint;
  flow: WorldPoint;
  phase: number;
  baseX: number;
  baseY: number;
  baseAngle: number;
  baseScaleX: number;
  baseScaleY: number;
  baseAlpha: number;
}

export class WorldSystem {
  readonly layout: ProceduralWorld;
  readonly obstacles: Phaser.Physics.Arcade.StaticGroup;
  private readonly environmentMotionByBucket = new Map<string, EnvironmentMotionActor[]>();
  private activeEnvironmentMotion = new Set<EnvironmentMotionActor>();
  private nextEnvironmentMotionAt = 0;

  constructor(private readonly scene: Phaser.Scene, seed: string) {
    this.layout = new ProceduralWorld(seed);
    this.obstacles = scene.physics.add.staticGroup();
  }

  create(): void {
    this.scene.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.scene.add.tileSprite(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, WORLD_WIDTH, WORLD_HEIGHT, 'ground-base')
      .setTileScale(0.72)
      .setDepth(-100);
    for (const cell of this.layout.cells) {
      const x = (cell.column + 0.5) * WORLD_TILE_SIZE;
      const y = (cell.row + 0.5) * WORLD_TILE_SIZE;
      if (cell.pathConnections) {
        this.createPath(x, y, cell.pathConnections);
      } else if (cell.groundFrame >= 0) {
        this.scene.add.image(x, y, 'terrain-overlays', cell.groundFrame)
          .setDisplaySize(WORLD_TILE_SIZE + 10, WORLD_TILE_SIZE + 10)
          .setDepth(-94);
      }
      if (cell.water) {
        const water = this.scene.add.image(x, y, 'terrain-overlays', cell.waterFrame)
          .setDisplaySize(cell.waterDisplayWidth, cell.waterDisplayHeight)
          .setAngle(cell.waterAngle)
          .setFlipX(cell.waterFlipX)
          .setDepth(-90);
        this.registerEnvironmentMotion(water, 'water', { x, y });
        if (cell.waterFlow) this.createWaterFlow(x, y, cell.waterFlow, cell.column, cell.row);
      }
      if (cell.feature) this.createTerrainFeature(x, y, cell.feature);
      for (const decoration of cell.decorations) this.createDecoration(x, y, decoration);
      if (cell.obstacle) this.createObstacle(x, y, cell.obstacle.kind, cell.obstacle.frame, cell.obstacle.scale, cell.obstacle.flipX);
    }
    for (const [index, puddle] of this.layout.getPuddleAreas().entries()) this.createPuddle(puddle, index);
  }

  private createTerrainFeature(x: number, y: number, feature: ProceduralTerrainFeature): void {
    if (!feature.blocked) {
      const sprite = this.scene.add.image(x, y, 'terrain-features', feature.frame)
        .setScale(feature.scale)
        .setFlipX(feature.flipX)
        .setDepth(feature.kind === 'wetland' ? -91 : getTerrainFeatureDepth(feature, y));
      if (feature.kind === 'berryThicket' || feature.kind === 'wetland') {
        this.registerEnvironmentMotion(sprite, 'bush', { x, y });
      }
      return;
    }
    const sprite = this.scene.physics.add.staticImage(x, y, 'terrain-features', feature.frame)
      .setScale(feature.scale)
      .setFlipX(feature.flipX)
      .setDepth(getTerrainFeatureDepth(feature, y));
    this.obstacles.add(sprite);
    sprite.refreshBody();
    const body = sprite.body as Phaser.Physics.Arcade.StaticBody;
    const width = (feature.kind === 'windfall' ? 224 : 188) * feature.scale;
    const height = (feature.kind === 'windfall' ? 78 : 104) * feature.scale;
    const displaySize = 313 * feature.scale;
    body.setSize(width, height, false);
    body.setOffset((displaySize - width) / 2, (displaySize - height) / 2 + 34 * feature.scale);
  }

  addCollider(creature: Phaser.Types.Physics.Arcade.ArcadeColliderType, onCollision?: () => void): Phaser.Physics.Arcade.Collider {
    return this.scene.physics.add.collider(creature, this.obstacles, onCollision);
  }

  findPath(start: WorldPoint, destination: WorldPoint): Phaser.Math.Vector2[] {
    return this.layout.findPath(start, destination).map((point) => new Phaser.Math.Vector2(point.x, point.y));
  }

  findOpenPositionNear(point: WorldPoint): Phaser.Math.Vector2 {
    const open = this.layout.findOpenPositionNear(point);
    return new Phaser.Math.Vector2(open.x, open.y);
  }

  getSpawnPoint(): Phaser.Math.Vector2 {
    const spawn = this.layout.getSpawnPoint();
    return new Phaser.Math.Vector2(spawn.x, spawn.y);
  }

  getWaterAreas(): readonly WaterArea[] {
    return this.layout.getWaterAreas();
  }

  getFlowingWaterAreas(): readonly WaterArea[] {
    return this.layout.getFlowingWaterAreas();
  }

  distanceToWater(point: WorldPoint): number {
    return distanceToAreas(point, this.getWaterAreas());
  }

  hasLineOfSight(start: WorldPoint, end: WorldPoint): boolean {
    return this.layout.hasLineOfSight(start, end);
  }

  getTerritoryName(point: WorldPoint): string {
    return this.layout.getTerritoryName(point);
  }

  getWidth(): number { return WORLD_WIDTH; }
  getHeight(): number { return WORLD_HEIGHT; }

  private createObstacle(x: number, y: number, kind: ObstacleKind, frame: number, scale: number, flipX: boolean): void {
    const sprite = this.scene.physics.add.staticImage(x, y, 'obstacle-atlas', frame)
      .setScale(scale)
      .setFlipX(flipX)
      .setDepth(getObstacleDepth(kind, y));
    if (kind === 'pine' || kind === 'birch') this.registerEnvironmentMotion(sprite, 'tree', { x, y });
    this.obstacles.add(sprite);
    sprite.refreshBody();
    const body = sprite.body as Phaser.Physics.Arcade.StaticBody;
    const geometry = getObstacleCollisionGeometry(kind, scale);
    body.setSize(geometry.width, geometry.height, false);
    body.setOffset(geometry.offsetX, geometry.offsetY);
  }

  private createPath(x: number, y: number, connections: PathConnections): void {
    const displaySize = WORLD_TILE_SIZE + 10;
    for (const piece of getPathRenderPieces(connections)) {
      this.scene.add.image(x, y, 'terrain-overlays', piece.frame)
        .setDisplaySize(displaySize, displaySize)
        .setCrop(piece.cropX, piece.cropY, piece.cropWidth, piece.cropHeight)
        .setDepth(-94);
    }
  }

  private createDecoration(x: number, y: number, decoration: ProceduralDecoration): void {
    const texture = decoration.atlas === 'obstacle' ? 'obstacle-atlas' : 'terrain-overlays';
    const decorationY = y + decoration.offsetY;
    const sprite = this.scene.add.image(x + decoration.offsetX, decorationY, texture, decoration.frame)
      .setScale(decoration.scale)
      .setFlipX(decoration.flipX)
      .setAlpha(decoration.alpha)
      .setDepth(getDecorationDepth(decoration, decorationY));
    if (decoration.kind === 'sapling') this.registerEnvironmentMotion(sprite, 'tree', { x: sprite.x, y: sprite.y });
    if (decoration.kind === 'brush') this.registerEnvironmentMotion(sprite, 'bush', { x: sprite.x, y: sprite.y });
  }

  private createWaterFlow(x: number, y: number, flow: WaterFlow, column: number, row: number): void {
    const length = Math.hypot(flow.x, flow.y) || 1;
    const directionX = flow.x / length;
    const directionY = flow.y / length;
    const normalX = -directionY;
    const normalY = directionX;
    const glints = this.scene.add.graphics({ x, y })
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(-89.5)
      .setAlpha(0.16);
    glints.lineStyle(1.4, 0xdaf6ff, 0.34);
    for (const offset of [-22, 1, 24]) {
      const start = -18 - ((column * 11 + row * 7 + offset) % 9);
      const end = start + 18 + ((column * 5 + row * 3 + offset) % 7);
      glints.beginPath();
      glints.moveTo(directionX * start + normalX * offset, directionY * start + normalY * offset);
      glints.lineTo(directionX * end + normalX * offset, directionY * end + normalY * offset);
      glints.strokePath();
    }
    this.registerEnvironmentMotion(glints, 'water-flow', { x, y }, flow, column * 41 + row * 67);
  }

  private createPuddle(area: WaterArea, index: number): void {
    const centerX = area.x + area.width / 2;
    const centerY = area.y + area.height / 2;
    const ground = this.layout.getCellAt({ x: centerX, y: centerY })?.ground;
    const groundFrame = ground === 'forest' ? index % 4 : 4 + (index % 4);
    const sizeScale = Phaser.Math.Clamp(area.width / 720, 0.16, 0.34);
    for (let edge = 0; edge < 2; edge += 1) {
      const angle = index * 1.31 + edge * Math.PI + 0.42;
      this.scene.add.image(
        centerX + Math.cos(angle) * area.width * 0.46,
        centerY + Math.sin(angle) * area.height * 0.43,
        'terrain-overlays',
        groundFrame,
      )
        .setScale(sizeScale * (edge === 0 ? 1 : 0.82))
        .setAngle((index * 37 + edge * 91) % 360)
        .setAlpha(0.82)
        .setDepth(-93.8);
    }

    const bank = this.scene.add.graphics().setPosition(centerX, centerY).setDepth(-93);
    bank.fillStyle(ground === 'forest' ? 0x4c5139 : 0x626642, 0.72);
    bank.fillPoints(this.puddleContour(area.width + 32, area.height + 24, index, 0), true);
    bank.fillStyle(ground === 'forest' ? 0x625a3e : 0x716845, 0.7);
    bank.fillPoints(this.puddleContour(area.width + 15, area.height + 11, index, 1), true);
    bank.fillStyle(0x294f57, 1);
    const waterContour = this.puddleContour(area.width, area.height, index, 2);
    bank.fillPoints(waterContour, true);

    const maskShape = this.scene.make.graphics({}, false).setPosition(centerX, centerY);
    maskShape.fillStyle(0xffffff, 1).fillPoints(waterContour, true);
    const waterFrames = [5, 6, 10, 11, 14, 15] as const;
    const water = this.scene.add.image(centerX, centerY, 'water-tiles', waterFrames[index % waterFrames.length])
      .setDisplaySize(area.width * 1.34, area.height * 1.42)
      .setAlpha(0.78)
      .setMask(maskShape.createGeometryMask())
      .setDepth(-92);
    this.registerEnvironmentMotion(water, 'water', { x: centerX, y: centerY }, undefined, index);

    const details = this.scene.add.graphics().setPosition(centerX, centerY).setDepth(-91);
    const detailCount = area.width < 130 ? 3 : area.width < 210 ? 5 : 8;
    for (let detail = 0; detail < detailCount; detail += 1) {
      const angle = index * 0.83 + detail * 2.399;
      const edgeX = Math.cos(angle) * area.width * (0.43 + (detail % 2) * 0.04);
      const edgeY = Math.sin(angle) * area.height * (0.42 + ((detail + 1) % 2) * 0.05);
      const radius = 2.4 + ((index + detail * 3) % 4);
      details.fillStyle(detail % 3 === 0 ? 0x87906c : 0x777660, 0.86);
      details.fillEllipse(edgeX, edgeY, radius * 1.8, radius);
    }

    details.lineStyle(Math.max(1, area.width / 150), 0xb7c7b5, 0.2);
    const reflectionWidth = area.width * 0.34;
    details.beginPath();
    details.moveTo(-reflectionWidth * 0.65, -area.height * 0.16);
    details.lineTo(reflectionWidth * 0.35, -area.height * 0.2);
    details.strokePath();
    if (area.width > 200) {
      details.fillStyle(0x667d45, 0.75);
      details.fillEllipse(area.width * 0.18, area.height * 0.12, 11, 5);
      details.fillEllipse(area.width * 0.25, area.height * 0.08, 8, 4);
    }
  }

  private puddleContour(width: number, height: number, index: number, layer: number): Phaser.Math.Vector2[] {
    const points: Phaser.Math.Vector2[] = [];
    const pointCount = 28;
    const phase = index * 1.17 + layer * 0.73;
    const rotation = ((index % 5) - 2) * 0.045;
    for (let point = 0; point < pointCount; point += 1) {
      const angle = point / pointCount * Math.PI * 2;
      const irregularity = 0.9
        + Math.sin(angle * 3 + phase) * 0.06
        + Math.sin(angle * 5 - phase * 0.7) * 0.04;
      const x = Math.cos(angle) * width * 0.5 * irregularity;
      const y = Math.sin(angle) * height * 0.5 * irregularity;
      points.push(new Phaser.Math.Vector2(
        x * Math.cos(rotation) - y * Math.sin(rotation),
        x * Math.sin(rotation) + y * Math.cos(rotation),
      ));
    }
    return points;
  }

  updateEnvironmentMotion(time: number, player: WorldPoint): void {
    if (time < this.nextEnvironmentMotionAt) return;
    this.nextEnvironmentMotionAt = time + ENVIRONMENT_MOTION_INTERVAL_MS;

    const nearby = new Set<EnvironmentMotionActor>();
    for (const key of getNearbyEnvironmentMotionBucketKeys(player)) {
      for (const actor of this.environmentMotionByBucket.get(key) ?? []) {
        if (!isEnvironmentMotionNearby(actor.anchor, player)) continue;
        nearby.add(actor);
        this.applyEnvironmentMotion(actor, time);
      }
    }
    for (const actor of this.activeEnvironmentMotion) {
      if (!nearby.has(actor)) this.resetEnvironmentMotion(actor);
    }
    this.activeEnvironmentMotion = nearby;
  }

  private registerEnvironmentMotion(
    target: EnvironmentMotionTarget,
    kind: EnvironmentMotionKind,
    anchor: WorldPoint,
    flow: WorldPoint = { x: 0, y: 0 },
    salt = 0,
  ): void {
    const actor: EnvironmentMotionActor = {
      target,
      kind,
      anchor,
      flow,
      phase: getEnvironmentMotionPhase(anchor, salt),
      baseX: target.x,
      baseY: target.y,
      baseAngle: target.angle,
      baseScaleX: target.scaleX,
      baseScaleY: target.scaleY,
      baseAlpha: target.alpha,
    };
    const key = getEnvironmentMotionBucketKey(anchor);
    const bucket = this.environmentMotionByBucket.get(key) ?? [];
    bucket.push(actor);
    this.environmentMotionByBucket.set(key, bucket);
  }

  private applyEnvironmentMotion(actor: EnvironmentMotionActor, time: number): void {
    const motion = getEnvironmentMotionSample(actor.kind, time, actor.phase, actor.flow);
    actor.target
      .setPosition(actor.baseX + motion.x, actor.baseY + motion.y)
      .setAngle(actor.baseAngle + motion.angle)
      .setScale(actor.baseScaleX * motion.scaleX, actor.baseScaleY * motion.scaleY)
      .setAlpha(actor.baseAlpha * motion.alpha);
  }

  private resetEnvironmentMotion(actor: EnvironmentMotionActor): void {
    actor.target
      .setPosition(actor.baseX, actor.baseY)
      .setAngle(actor.baseAngle)
      .setScale(actor.baseScaleX, actor.baseScaleY)
      .setAlpha(actor.baseAlpha);
  }
}
