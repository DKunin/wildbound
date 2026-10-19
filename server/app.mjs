import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { createServer } from 'node:http';
import { EVENT_TYPES } from './stats-store.mjs';

const CONTENT_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
});
const BODY_LIMIT = 16 * 1024;
const ID_PATTERN = /^[a-zA-Z0-9_-]{8,80}$/;

const sendJson = (response, statusCode, value) => {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  response.end(body);
};

const readJsonBody = async (request) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw Object.assign(new Error('Request body is too large.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400 });
  }
};

const validateEvent = (value) => {
  if (!value || typeof value !== 'object') return undefined;
  const { sessionId, visitorId, type, difficulty } = value;
  if (!ID_PATTERN.test(sessionId) || !ID_PATTERN.test(visitorId)) return undefined;
  if (!EVENT_TYPES.includes(type)) return undefined;
  if (difficulty !== undefined && difficulty !== 'survival' && difficulty !== 'explorer') return undefined;
  return { sessionId, visitorId, type, difficulty };
};

const verifiedUserId = (request) => {
  const header = request.headers['x-auth-user-id'];
  return typeof header === 'string' ? header.trim() : '';
};

const authorizeStats = (request, allowedUserIds) => {
  const userId = verifiedUserId(request);
  if (!userId) return { allowed: false, statusCode: 401 };
  if (!allowedUserIds.has(userId)) return { allowed: false, statusCode: 403 };
  return { allowed: true, userId };
};

const resolveStaticPath = (distDirectory, pathname) => {
  const requested = pathname === '/' ? 'index.html' : pathname === '/stats' ? 'stats.html' : pathname.slice(1);
  const safe = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, '');
  const path = resolve(distDirectory, safe);
  return path.startsWith(`${resolve(distDirectory)}/`) || path === resolve(distDirectory) ? path : undefined;
};

const serveFile = (response, path, method) => {
  const stats = statSync(path);
  response.writeHead(200, {
    'Content-Type': CONTENT_TYPES[extname(path)] ?? 'application/octet-stream',
    'Content-Length': stats.size,
    'Cache-Control': extname(path) === '.html' ? 'no-cache' : 'public, max-age=3600',
  });
  if (method === 'HEAD') response.end();
  else createReadStream(path).pipe(response);
};

export const createWildboundServer = ({ statsStore, distDirectory, allowedUserIds = new Set() }) => createServer(async (request, response) => {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', 'http://localhost');
  try {
    if (url.pathname === '/healthz') {
      if (method !== 'GET' && method !== 'HEAD') return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
      return sendJson(response, 200, { status: 'ok' });
    }

    if (url.pathname === '/api/events') {
      if (method !== 'POST') return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
      if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
        return sendJson(response, 415, { error: 'UNSUPPORTED_MEDIA_TYPE' });
      }
      const event = validateEvent(await readJsonBody(request));
      if (!event) return sendJson(response, 400, { error: 'INVALID_EVENT' });
      statsStore.recordEvent(event);
      return sendJson(response, 202, { accepted: true });
    }

    if (url.pathname === '/api/stats') {
      if (method !== 'GET' && method !== 'HEAD') return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
      const auth = authorizeStats(request, allowedUserIds);
      if (!auth.allowed) return sendJson(response, auth.statusCode, { error: auth.statusCode === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN' });
      return sendJson(response, 200, statsStore.getSummary());
    }

    if (url.pathname === '/stats' || url.pathname === '/stats/' || url.pathname === '/stats.html') {
      if (method !== 'GET' && method !== 'HEAD') return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
      const auth = authorizeStats(request, allowedUserIds);
      if (!auth.allowed) {
        response.writeHead(auth.statusCode, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        return response.end(auth.statusCode === 401 ? 'Authentication required.' : 'This account cannot view Wildbound statistics.');
      }
      const page = join(distDirectory, 'stats.html');
      if (!existsSync(page)) return sendJson(response, 503, { error: 'STATS_PAGE_NOT_BUILT' });
      return serveFile(response, page, method);
    }

    if (method !== 'GET' && method !== 'HEAD') return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    const path = resolveStaticPath(distDirectory, url.pathname);
    if (!path || !existsSync(path) || !statSync(path).isFile()) return sendJson(response, 404, { error: 'NOT_FOUND' });
    return serveFile(response, path, method);
  } catch (error) {
    const statusCode = Number(error?.statusCode) || (error?.message?.includes('assigned to another visitor') ? 409 : 500);
    if (statusCode >= 500) console.error(error);
    return sendJson(response, statusCode, { error: statusCode >= 500 ? 'INTERNAL_ERROR' : error.message });
  }
});
