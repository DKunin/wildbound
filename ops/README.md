# Production-статистика Wildbound

Приложение слушает только `127.0.0.1:4173`. Публичный Nginx-конфиг `ops/nginx/wildbound.kunini.ru.conf` оставляет игру и `POST /api/events` открытыми, но требует Kunini Auth для `/stats` и `/api/stats`. Даже после успешного `auth_request` сервер отдаёт статистику только пользователям, чей стабильный `X-Auth-User-Id` перечислен в `STATS_ALLOWED_USER_IDS`.

## Подготовка

```bash
npm ci --no-audit --no-fund
npm run build
install -d -m 0750 /var/lib/wildbound
export STATS_DB_PATH=/var/lib/wildbound/stats.sqlite
export STATS_ALLOWED_USER_IDS=<stable-auth-user-id>
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
```

Значение `STATS_ALLOWED_USER_IDS` берётся из `user.id`, который возвращает `auth.kunini.ru`; имя или email не подходят. Несколько ID разделяются запятыми. При пустом значении `/stats` намеренно отвечает отказом для всех.

Nginx-конфиг устанавливается отдельно с проверкой `nginx -t`, затем для `wildbound.kunini.ru` выпускается или подключается TLS-сертификат. Вход без сессии должен перенаправлять `/stats` на `https://auth.kunini.ru/login`, а `/api/stats` — отвечать `401`.

## Проверка

```bash
curl --fail http://127.0.0.1:4173/healthz
curl --fail https://wildbound.kunini.ru/healthz
curl --head https://wildbound.kunini.ru/stats
curl --fail -X POST https://wildbound.kunini.ru/api/events \
  -H 'Content-Type: application/json' \
  --data '{"sessionId":"smoke-session","visitorId":"smoke-visitor","type":"session_start"}'
```

Последняя команда создаёт реальное статистическое событие и предназначена только для осознанного smoke-теста. База SQLite находится вне Git; перед обновлением сервера её не удаляют и не перезаписывают.
