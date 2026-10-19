import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const config = readFileSync(resolve('ops/nginx/wildbound.kunini.ru.conf'), 'utf8');
const location = (path) => {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return config.match(new RegExp(`location = ${escaped} \\{([\\s\\S]*?)\\n    \\}`, 'u'))?.[1] ?? '';
};

describe('Wildbound Kunini Auth boundary', () => {
  it('protects statistics and forwards only verified identity', () => {
    const statsPage = location('/stats');
    const statsApi = location('/api/stats');
    expect(statsPage).toContain('auth_request /_kunini_auth_verify;');
    expect(statsPage).toContain('error_page 401 = @kunini_login;');
    expect(statsPage).toContain('proxy_set_header X-Auth-User-Id $kunini_user_id;');
    expect(statsApi).toContain('auth_request /_kunini_auth_verify;');
    expect(statsApi).toContain('error_page 401 = @kunini_api_unauthorized;');
  });

  it('keeps event ingestion public while clearing spoofed identity and cookies', () => {
    const events = location('/api/events');
    expect(events).not.toContain('auth_request');
    expect(events).toContain('proxy_set_header Cookie "";');
    expect(events).toContain('proxy_set_header Authorization "";');
    expect(events).toContain('proxy_set_header X-Auth-User-Id "";');
  });
});
