export interface WindState {
  x: number;
  y: number;
  strength: number;
  arrow: string;
  label: 'CALM' | 'LIGHT WIND' | 'STEADY WIND' | 'STRONG WIND';
}

const ARROWS = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];

export class WindSystem {
  getState(totalMinutes: number): WindState {
    const angle = -0.52 + Math.sin(totalMinutes / 54) * 0.58 + Math.sin(totalMinutes / 17) * 0.12;
    const strength = Math.max(0.12, Math.min(0.94, 0.53 + Math.sin(totalMinutes / 37) * 0.24));
    const normalized = (angle + Math.PI * 2) % (Math.PI * 2);
    const arrow = ARROWS[Math.round(normalized / (Math.PI / 4)) % ARROWS.length];
    const label = strength < 0.24
      ? 'CALM'
      : strength < 0.48
        ? 'LIGHT WIND'
        : strength < 0.76
          ? 'STEADY WIND'
          : 'STRONG WIND';
    return { x: Math.cos(angle), y: Math.sin(angle), strength, arrow, label };
  }
}
