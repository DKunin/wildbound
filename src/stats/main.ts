import './stats.css';

interface StatsSummary {
  generatedAt: number;
  timeZone: string;
  live: { online: number; playing: number };
  today: { visitors: number; sessions: number; playStarts: number; deaths: number };
  totals: {
    visitors: number;
    sessions: number;
    playedSessions: number;
    medianPlaytimeSeconds: number;
    totalPlaytimeSeconds: number;
    deaths: number;
  };
  daily: Array<{ date: string; visitors: number; sessions: number; playStarts: number; deaths: number }>;
  recentSessions: Array<{
    session: string;
    visitor: string;
    firstSeenAt: number;
    lastSeenAt: number;
    playtimeSeconds: number;
    playing: boolean;
    difficulty: 'survival' | 'explorer' | null;
  }>;
}

const number = new Intl.NumberFormat('en-US');
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

const setText = (id: string, value: string | number) => {
  const element = document.querySelector<HTMLElement>(`#${id}`);
  if (element) element.textContent = String(value);
};

const formatDuration = (seconds: number): string => {
  const rounded = Math.max(0, Math.round(seconds));
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  if (minutes < 60) return `${minutes}m ${rounded % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
};

const renderChart = (daily: StatsSummary['daily']) => {
  const chart = document.querySelector<HTMLElement>('#activity-chart');
  if (!chart) return;
  const maximum = Math.max(1, ...daily.map(({ visitors }) => visitors));
  const fragment = document.createDocumentFragment();
  for (const day of daily) {
    const column = document.createElement('div');
    const value = document.createElement('strong');
    const barTrack = document.createElement('span');
    const bar = document.createElement('i');
    const label = document.createElement('time');
    column.className = 'chart-day';
    column.title = `${day.date}: ${day.visitors} visitors, ${day.sessions} sessions, ${day.playStarts} play starts`;
    value.textContent = number.format(day.visitors);
    bar.style.height = `${Math.max(day.visitors > 0 ? 8 : 2, day.visitors / maximum * 100)}%`;
    barTrack.append(bar);
    label.dateTime = day.date;
    label.textContent = shortDate.format(new Date(`${day.date}T12:00:00`));
    column.append(value, barTrack, label);
    fragment.append(column);
  }
  chart.replaceChildren(fragment);
};

const renderSessions = (sessions: StatsSummary['recentSessions']) => {
  const body = document.querySelector<HTMLTableSectionElement>('#recent-sessions');
  if (!body) return;
  const fragment = document.createDocumentFragment();
  for (const session of sessions) {
    const row = document.createElement('tr');
    const status = document.createElement('td');
    const dot = document.createElement('span');
    dot.className = `session-state${session.playing ? ' playing' : ''}`;
    dot.textContent = session.playing ? 'Playing' : 'Offline';
    status.append(dot);
    const cells = [
      status,
      Object.assign(document.createElement('td'), { textContent: session.visitor }),
      Object.assign(document.createElement('td'), { textContent: dateTime.format(new Date(session.firstSeenAt)) }),
      Object.assign(document.createElement('td'), { textContent: formatDuration(session.playtimeSeconds) }),
      Object.assign(document.createElement('td'), { textContent: session.difficulty ?? 'Not started' }),
    ];
    row.append(...cells);
    fragment.append(row);
  }
  body.replaceChildren(fragment);
};

const render = (stats: StatsSummary) => {
  setText('online-now', number.format(stats.live.online));
  setText('playing-now', number.format(stats.live.playing));
  setText('median-playtime', formatDuration(stats.totals.medianPlaytimeSeconds));
  setText('players-today', number.format(stats.today.visitors));
  setText('sessions-today', number.format(stats.today.sessions));
  setText('starts-today', number.format(stats.today.playStarts));
  setText('deaths-today', number.format(stats.today.deaths));
  setText('total-visitors', number.format(stats.totals.visitors));
  setText('total-sessions', number.format(stats.totals.sessions));
  setText('played-sessions', number.format(stats.totals.playedSessions));
  setText('total-playtime', formatDuration(stats.totals.totalPlaytimeSeconds));
  setText('total-deaths', number.format(stats.totals.deaths));
  setText('activity-timezone', `Daily boundaries: ${stats.timeZone}`);
  setText('updated-at', `Updated ${dateTime.format(new Date(stats.generatedAt))}`);
  renderChart(stats.daily);
  renderSessions(stats.recentSessions);
};

const load = async () => {
  const error = document.querySelector<HTMLElement>('#stats-error');
  try {
    const response = await fetch('/api/stats', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error(response.status === 403 ? 'This Kunini account is not allowed to view statistics.' : 'Statistics are unavailable.');
    render(await response.json() as StatsSummary);
    if (error) error.hidden = true;
  } catch (cause) {
    if (error) {
      error.textContent = cause instanceof Error ? cause.message : 'Statistics are unavailable.';
      error.hidden = false;
    }
  }
};

void load();
window.setInterval(() => { void load(); }, 15_000);
