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
    const bankColor = index % 3 === 0 ? 0x706a48 : 0x625f42;
    this.scene.add.ellipse(centerX, centerY, area.width + 28, area.height + 22, bankColor, 0.86).setDepth(-93);
    this.scene.add.ellipse(centerX, centerY, area.width, area.height, 0x466f75, 0.94)
      .setStrokeStyle(3, 0x8c9c82, 0.58)
      .setDepth(-92);
    this.scene.add.ellipse(centerX - area.width * 0.12, centerY - area.height * 0.14, area.width * 0.58, area.height * 0.24, 0x9fc0b7, 0.16)
      .setDepth(-91);
  }
}
