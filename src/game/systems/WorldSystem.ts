import Phaser from 'phaser';
import {
  ProceduralWorld,
  WORLD_HEIGHT,
  WORLD_TILE_SIZE,
  WORLD_WIDTH,
  type ObstacleKind,
  type WaterArea,
  type WorldPoint,
} from './ProceduralWorld';
import { distanceToAreas } from './geometry';

const ATLAS_FRAME_SIZE = 313;

const BODY_BY_KIND: Record<ObstacleKind, { width: number; height: number; offsetY: number }> = {
  tree: { width: 62, height: 40, offsetY: 232 },
  rock: { width: 185, height: 82, offsetY: 184 },
  log: { width: 230, height: 64, offsetY: 196 },
  mountain: { width: 232, height: 112, offsetY: 160 },
};

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
      if (cell.obstacle) this.createObstacle(x, y, cell.obstacle.kind, cell.obstacle.frame, cell.obstacle.scale);
    }
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
    const geometry = BODY_BY_KIND[kind];
    body.setSize(geometry.width, geometry.height);
    body.setOffset((ATLAS_FRAME_SIZE - geometry.width) / 2, geometry.offsetY);
  }
}
