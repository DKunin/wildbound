import Phaser from 'phaser';
import {
  ProceduralWorld,
  WORLD_HEIGHT,
  WORLD_TILE_SIZE,
  WORLD_WIDTH,
  type ObstacleKind,
  type ProceduralDecoration,
  type WaterArea,
  type WorldPoint,
} from './ProceduralWorld';
import { distanceToAreas } from './geometry';
import { getObstacleCollisionGeometry } from './ObstacleCollision';

export class WorldSystem {
  readonly layout: ProceduralWorld;
  readonly obstacles: Phaser.Physics.Arcade.StaticGroup;

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
      if (cell.groundFrame >= 0) {
        this.scene.add.image(x, y, 'terrain-overlays', cell.groundFrame)
          .setDisplaySize(WORLD_TILE_SIZE + 10, WORLD_TILE_SIZE + 10)
          .setDepth(-94);
      }
      if (cell.water) {
        this.scene.add.image(x, y, 'terrain-overlays', cell.waterFrame)
          .setDisplaySize(WORLD_TILE_SIZE + 10, WORLD_TILE_SIZE + 10)
          .setDepth(-90);
      }
      for (const decoration of cell.decorations) this.createDecoration(x, y, decoration);
      if (cell.obstacle) this.createObstacle(x, y, cell.obstacle.kind, cell.obstacle.frame, cell.obstacle.scale);
    }
    for (const [index, puddle] of this.layout.getPuddleAreas().entries()) this.createPuddle(puddle, index);
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

  private createObstacle(x: number, y: number, kind: ObstacleKind, frame: number, scale: number): void {
    const sprite = this.scene.physics.add.staticImage(x, y, 'obstacle-atlas', frame)
      .setScale(scale)
      .setDepth(y + 80);
    this.obstacles.add(sprite);
    sprite.refreshBody();
    const body = sprite.body as Phaser.Physics.Arcade.StaticBody;
    const geometry = getObstacleCollisionGeometry(kind, scale);
    body.setSize(geometry.width, geometry.height, false);
    body.setOffset(geometry.offsetX, geometry.offsetY);
  }

  private createDecoration(x: number, y: number, decoration: ProceduralDecoration): void {
    const texture = decoration.atlas === 'obstacle' ? 'obstacle-atlas' : 'terrain-overlays';
    const decorationY = y + decoration.offsetY;
    this.scene.add.image(x + decoration.offsetX, decorationY, texture, decoration.frame)
      .setScale(decoration.scale)
      .setFlipX(decoration.flipX)
      .setAlpha(decoration.alpha)
      .setDepth(decoration.atlas === 'terrain' ? -89 : decorationY + 12);
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
    this.scene.add.image(centerX, centerY, 'water-tiles', waterFrames[index % waterFrames.length])
      .setDisplaySize(area.width * 1.34, area.height * 1.42)
      .setAlpha(0.78)
      .setMask(maskShape.createGeometryMask())
      .setDepth(-92);

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
}
