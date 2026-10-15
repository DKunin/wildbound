export type DayPhase = 'DAWN' | 'DAY' | 'DUSK' | 'NIGHT';

export interface DayNightState {
  phase: DayPhase;
  icon: '✦' | '◐' | '☾';
  overlay: string;
  overlayOpacity: number;
  visibility: number;
}

const smoothstep = (start: number, end: number, value: number): number => {
  const amount = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return amount * amount * (3 - 2 * amount);
};

export class DayNightSystem {
  getState(totalMinutes: number): DayNightState {
    const hour = ((totalMinutes % 1440) + 1440) % 1440 / 60;
    if (hour >= 5 && hour < 7) {
      const light = smoothstep(5, 7, hour);
      return {
        phase: 'DAWN',
        icon: '◐',
        overlay: '#233246',
        overlayOpacity: 0.34 * (1 - light),
        visibility: 0.72 + light * 0.28,
      };
    }
    if (hour >= 7 && hour < 18) {
      return { phase: 'DAY', icon: '✦', overlay: '#20372d', overlayOpacity: 0, visibility: 1 };
    }
    if (hour >= 18 && hour < 20) {
      const dark = smoothstep(18, 20, hour);
      return {
        phase: 'DUSK',
        icon: '◐',
        overlay: '#182842',
        overlayOpacity: 0.08 + dark * 0.28,
        visibility: 0.94 - dark * 0.22,
      };
    }
    return { phase: 'NIGHT', icon: '☾', overlay: '#111d38', overlayOpacity: 0.4, visibility: 0.68 };
  }
}
