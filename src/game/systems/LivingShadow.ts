import Phaser from 'phaser';

interface LivingShadowOptions {
  width: number;
  height: number;
  offsetY: number;
  alpha?: number;
}

/** Soft, layered contact shadow that stays grounded independently of animation frames. */
export class LivingShadow {
  private readonly outer: Phaser.GameObjects.Ellipse;
  private readonly contact: Phaser.GameObjects.Ellipse;

  constructor(scene: Phaser.Scene, private readonly options: LivingShadowOptions) {
    const alpha = options.alpha ?? 0.2;
    this.outer = scene.add.ellipse(0, 0, options.width * 1.22, options.height * 1.38, 0x07100c, alpha * 0.42)
      .setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.contact = scene.add.ellipse(0, 0, options.width, options.height, 0x050a08, alpha)
      .setBlendMode(Phaser.BlendModes.MULTIPLY);
  }

  sync(subject: Phaser.GameObjects.Sprite, visible = true, resting = false): void {
    const y = subject.y + this.options.offsetY;
    const depth = subject.y + 1;
    const scaleX = resting ? 1.08 : 1;
    const scaleY = resting ? 0.9 : 1;
    this.outer.setPosition(subject.x, y).setDepth(depth).setScale(scaleX, scaleY).setVisible(visible && subject.visible);
    this.contact.setPosition(subject.x, y).setDepth(depth + 0.01).setScale(scaleX, scaleY).setVisible(visible && subject.visible);
  }

  destroy(): void {
    this.outer.destroy();
    this.contact.destroy();
  }
}
