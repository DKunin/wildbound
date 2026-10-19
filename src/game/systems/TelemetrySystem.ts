import type { DifficultyMode } from './BalanceConfig';

export type TelemetryEventType = 'session_start' | 'play_start' | 'heartbeat' | 'play_pause' | 'session_end' | 'death';

interface TelemetryPayload {
  sessionId: string;
  visitorId: string;
  type: TelemetryEventType;
  difficulty?: DifficultyMode;
}

interface TelemetryEnvironment {
  fetch: (input: string, init: RequestInit) => Promise<unknown>;
  sendBeacon: (url: string, data: Blob) => boolean;
  addWindowListener: (type: 'pagehide', listener: () => void) => void;
  addVisibilityListener: (listener: () => void) => void;
  isVisible: () => boolean;
  setInterval: (listener: () => void, intervalMs: number) => number;
  clearInterval: (intervalId: number) => void;
}

const VISITOR_KEY = 'wildbound-telemetry-visitor-v1';
const SESSION_KEY = 'wildbound-telemetry-session-v1';
const HEARTBEAT_INTERVAL_MS = 15_000;

export const getOrCreateAnonymousId = (
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  key: string,
  randomId: () => string,
): string => {
  try {
    const existing = storage.getItem(key);
    if (existing) return existing;
    const created = randomId();
    storage.setItem(key, created);
    return created;
  } catch {
    return randomId();
  }
};

export class TelemetrySystem {
  private playing = false;
  private difficulty: DifficultyMode | undefined;
  private heartbeatInterval: number | undefined;

  constructor(
    private readonly visitorId: string,
    private readonly sessionId: string,
    private readonly environment: TelemetryEnvironment,
    private readonly endpoint = '/api/events',
  ) {
    this.environment.addVisibilityListener(() => this.handleVisibilityChange());
    this.environment.addWindowListener('pagehide', () => this.endSession());
    this.send('session_start');
  }

  startPlay(difficulty: DifficultyMode): void {
    this.difficulty = difficulty;
    this.playing = true;
    if (!this.environment.isVisible()) return;
    this.send('play_start');
    this.startHeartbeat();
  }

  recordDeath(): void {
    this.send('death');
  }

  private handleVisibilityChange(): void {
    if (!this.playing) return;
    if (this.environment.isVisible()) {
      this.send('play_start');
      this.startHeartbeat();
    } else {
      this.stopHeartbeat();
      this.send('play_pause', true);
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatInterval = this.environment.setInterval(() => this.send('heartbeat'), HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval === undefined) return;
    this.environment.clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = undefined;
  }

  private endSession(): void {
    this.stopHeartbeat();
    this.send('session_end', true);
  }

  private send(type: TelemetryEventType, urgent = false): void {
    const payload: TelemetryPayload = {
      sessionId: this.sessionId,
      visitorId: this.visitorId,
      type,
      ...(this.difficulty ? { difficulty: this.difficulty } : {}),
    };
    const body = JSON.stringify(payload);
    if (urgent && this.environment.sendBeacon(this.endpoint, new Blob([body], { type: 'application/json' }))) return;
    void this.environment.fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: urgent,
      credentials: 'omit',
    }).catch(() => undefined);
  }
}

export const createBrowserTelemetry = (): TelemetrySystem => {
  const randomId = () => crypto.randomUUID();
  const visitorId = getOrCreateAnonymousId(localStorage, VISITOR_KEY, randomId);
  const sessionId = getOrCreateAnonymousId(sessionStorage, SESSION_KEY, randomId);
  return new TelemetrySystem(visitorId, sessionId, {
    fetch: (input, init) => fetch(input, init),
    sendBeacon: (url, data) => navigator.sendBeacon(url, data),
    addWindowListener: (type, listener) => window.addEventListener(type, listener),
    addVisibilityListener: (listener) => document.addEventListener('visibilitychange', listener),
    isVisible: () => document.visibilityState === 'visible',
    setInterval: (listener, intervalMs) => window.setInterval(listener, intervalMs),
    clearInterval: (intervalId) => window.clearInterval(intervalId),
  });
};
