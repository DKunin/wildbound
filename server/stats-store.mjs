import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const EVENT_TYPES = Object.freeze([
  'session_start',
  'play_start',
  'heartbeat',
  'play_pause',
  'session_end',
  'death',
]);

const MAX_ACCRUAL_SECONDS = 30;
const ONLINE_WINDOW_MS = 90_000;
const PLAYING_WINDOW_MS = 45_000;
const DAY_MS = 86_400_000;

const median = (values) => {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
};

const round = (value, places = 1) => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

const createDateFormatter = (timeZone) => new Intl.DateTimeFormat('en-CA', {
  timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const toDateKey = (formatter, timestamp) => {
  const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp))
    .filter(({ type }) => type !== 'literal')
    .map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const currentPlaytime = (row, now) => {
  const stored = Number(row.playtime_seconds ?? 0);
  if (!row.playing || row.play_updated_at === null) return stored;
  return stored + Math.min(MAX_ACCRUAL_SECONDS, Math.max(0, now - Number(row.play_updated_at)) / 1000);
};

export class StatsStore {
  constructor({ databasePath, timeZone = 'Europe/Moscow' }) {
    if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.dateFormatter = createDateFormatter(timeZone);
    this.timeZone = timeZone;
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        visitor_id TEXT NOT NULL,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        started_play_at INTEGER,
        play_updated_at INTEGER,
        playtime_seconds REAL NOT NULL DEFAULT 0,
        playing INTEGER NOT NULL DEFAULT 0 CHECK (playing IN (0, 1)),
        ended_at INTEGER,
        difficulty TEXT CHECK (difficulty IN ('survival', 'explorer'))
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        occurred_at INTEGER NOT NULL,
        difficulty TEXT CHECK (difficulty IN ('survival', 'explorer'))
      );
      CREATE INDEX IF NOT EXISTS sessions_last_seen_idx ON sessions(last_seen_at);
      CREATE INDEX IF NOT EXISTS sessions_first_seen_idx ON sessions(first_seen_at);
      CREATE INDEX IF NOT EXISTS events_occurred_at_idx ON events(occurred_at);
      CREATE INDEX IF NOT EXISTS events_type_idx ON events(event_type);
    `);
    this.findSession = this.database.prepare('SELECT * FROM sessions WHERE session_id = ?');
    this.insertSession = this.database.prepare(`
      INSERT INTO sessions (session_id, visitor_id, first_seen_at, last_seen_at, difficulty)
      VALUES (?, ?, ?, ?, ?)
    `);
    this.updateSession = this.database.prepare(`
      UPDATE sessions SET
        last_seen_at = ?,
        started_play_at = ?,
        play_updated_at = ?,
        playtime_seconds = ?,
        playing = ?,
        ended_at = ?,
        difficulty = ?
      WHERE session_id = ?
    `);
    this.insertEvent = this.database.prepare(`
      INSERT INTO events (session_id, event_type, occurred_at, difficulty)
      VALUES (?, ?, ?, ?)
    `);
  }

  recordEvent({ sessionId, visitorId, type, difficulty }, now = Date.now()) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      let session = this.findSession.get(sessionId);
      if (!session) {
        this.insertSession.run(sessionId, visitorId, now, now, difficulty ?? null);
        session = this.findSession.get(sessionId);
      } else if (session.visitor_id !== visitorId) {
        throw new Error('Session identifier is already assigned to another visitor.');
      }

      let playtime = currentPlaytime(session, now);
      let playing = Boolean(session.playing);
      let startedPlayAt = session.started_play_at === null ? null : Number(session.started_play_at);
      let playUpdatedAt = session.play_updated_at === null ? null : Number(session.play_updated_at);
      let endedAt = session.ended_at === null ? null : Number(session.ended_at);

      if (type === 'play_start') {
        playing = true;
        startedPlayAt ??= now;
        playUpdatedAt = now;
        endedAt = null;
      } else if (type === 'heartbeat') {
        if (playing) playUpdatedAt = now;
        endedAt = null;
      } else if (type === 'play_pause') {
        playing = false;
        playUpdatedAt = null;
        endedAt = null;
      } else if (type === 'session_end') {
        playing = false;
        playUpdatedAt = null;
        endedAt = now;
      } else if (type === 'death') {
        if (playing) playUpdatedAt = now;
        endedAt = null;
      } else if (type === 'session_start') {
        playing = false;
        playUpdatedAt = null;
        endedAt = null;
      }

      this.updateSession.run(
        now,
        startedPlayAt,
        playUpdatedAt,
        round(playtime, 3),
        playing ? 1 : 0,
        endedAt,
        difficulty ?? session.difficulty ?? null,
        sessionId,
      );
      this.insertEvent.run(sessionId, type, now, difficulty ?? session.difficulty ?? null);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  getSummary(now = Date.now()) {
    const sessions = this.database.prepare('SELECT * FROM sessions ORDER BY first_seen_at DESC').all();
    const recentEvents = this.database.prepare(`
      SELECT event_type, occurred_at FROM events WHERE occurred_at >= ? ORDER BY occurred_at DESC
    `).all(now - 14 * DAY_MS);
    const liveSessions = sessions.filter((session) => session.ended_at === null
      && Number(session.last_seen_at) >= now - ONLINE_WINDOW_MS);
    const playingSessions = liveSessions.filter((session) => session.playing
      && Number(session.last_seen_at) >= now - PLAYING_WINDOW_MS);
    const playedSessions = sessions.filter((session) => session.started_play_at !== null);
    const playtimes = playedSessions.map((session) => currentPlaytime(session, now));
    const todayKey = toDateKey(this.dateFormatter, now);
    const todaySessions = sessions.filter((session) => toDateKey(this.dateFormatter, Number(session.first_seen_at)) === todayKey);
    const todayEvents = recentEvents.filter((event) => toDateKey(this.dateFormatter, Number(event.occurred_at)) === todayKey);
    const todayPlayedSessions = playedSessions.filter((session) => (
      toDateKey(this.dateFormatter, Number(session.started_play_at)) === todayKey
    ));

    const dailyByDate = new Map();
    for (let offset = 13; offset >= 0; offset -= 1) {
      const date = toDateKey(this.dateFormatter, now - offset * DAY_MS);
      dailyByDate.set(date, { date, visitors: new Set(), sessions: 0, playStarts: 0, deaths: 0 });
    }
    for (const session of sessions) {
      const date = toDateKey(this.dateFormatter, Number(session.first_seen_at));
      const day = dailyByDate.get(date);
      if (!day) continue;
      day.sessions += 1;
      day.visitors.add(session.visitor_id);
      if (session.started_play_at !== null
          && toDateKey(this.dateFormatter, Number(session.started_play_at)) === date) day.playStarts += 1;
    }
    for (const event of recentEvents) {
      const date = toDateKey(this.dateFormatter, Number(event.occurred_at));
      const day = dailyByDate.get(date);
      if (!day) continue;
      if (event.event_type === 'death') day.deaths += 1;
    }

    return {
      generatedAt: now,
      timeZone: this.timeZone,
      live: {
        online: new Set(liveSessions.map((session) => session.visitor_id)).size,
        playing: new Set(playingSessions.map((session) => session.visitor_id)).size,
      },
      today: {
        visitors: new Set(todaySessions.map((session) => session.visitor_id)).size,
        sessions: todaySessions.length,
        playStarts: todayPlayedSessions.length,
        deaths: todayEvents.filter(({ event_type }) => event_type === 'death').length,
      },
      totals: {
        visitors: new Set(sessions.map((session) => session.visitor_id)).size,
        sessions: sessions.length,
        playedSessions: playedSessions.length,
        medianPlaytimeSeconds: round(median(playtimes)),
        totalPlaytimeSeconds: round(playtimes.reduce((sum, value) => sum + value, 0)),
        deaths: Number(this.database.prepare("SELECT COUNT(*) AS count FROM events WHERE event_type = 'death'").get().count),
      },
      daily: [...dailyByDate.values()].map(({ visitors, ...day }) => ({
        ...day,
        visitors: visitors.size,
      })),
      recentSessions: sessions.slice(0, 20).map((session) => ({
        session: String(session.session_id).slice(0, 8),
        visitor: String(session.visitor_id).slice(0, 8),
        firstSeenAt: Number(session.first_seen_at),
        lastSeenAt: Number(session.last_seen_at),
        playtimeSeconds: round(currentPlaytime(session, now)),
        playing: Boolean(session.playing) && Number(session.last_seen_at) >= now - PLAYING_WINDOW_MS,
        difficulty: session.difficulty,
      })),
    };
  }

  close() {
    this.database.close();
  }
}
