# Production-статистика Wildbound

Приложение слушает только `127.0.0.1:4173`. Публичный Nginx-конфиг `ops/nginx/wildbound.kunini.ru.conf` оставляет игру и `POST /api/events` открытыми, но требует Kunini Auth для `/stats` и `/api/stats`. Даже после успешного `auth_request` сервер отдаёт статистику только пользователям, чей стабильный `X-Auth-User-Id` перечислен в `STATS_ALLOWED_USER_IDS`.

## Первый запуск на сервере

```bash
git clone git@github.com:DKunin/wildbound.git /var/apps/wildbound
cd /var/apps/wildbound
cat >.env.production <<'EOF'
STATS_DB_PATH=/var/apps/wildbound/data/wildbound-stats.sqlite
STATS_ALLOWED_USER_IDS=
STATS_TIME_ZONE=Europe/Moscow
EOF
./ops/deploy.sh
./ops/setup-nginx.sh
```

Значение `STATS_ALLOWED_USER_IDS` берётся из `user.id`, который возвращает `auth.kunini.ru`; имя или email не подходят. Несколько ID разделяются запятыми. При пустом значении `/stats` намеренно отвечает отказом для всех.

`ops/setup-nginx.sh` сначала устанавливает временный HTTP-конфиг и проверяет публичный ACME challenge, затем выпускает сертификат, включает HTTPS-конфиг через ограниченный helper с `nginx -t`, добавляет ежедневное продление в crontab и выполняет dry-run. Вход без сессии перенаправляется с `/stats` на `https://auth.kunini.ru/login`, а `/api/stats` отвечает `401`.

## Обновление

```bash
ssh dekunin@192.168.28.3 /var/apps/wildbound/ops/deploy.sh
```

Скрипт принимает только чистую ветку `main`, выполняет fast-forward, устанавливает зафиксированные зависимости, запускает тесты и сборку, перезагружает только PM2-процесс `wildbound` и ждёт, пока `/healthz` вернёт точную ревизию Git. SQLite хранится в игнорируемом каталоге `data/` и при обновлении не удаляется.

## Проверка

```bash
curl --fail http://127.0.0.1:4173/healthz # status + Git revision
curl --fail https://wildbound.kunini.ru/healthz
curl --head http://wildbound.kunini.ru/ # 301 на HTTPS
curl --head https://wildbound.kunini.ru/stats
curl --fail -X POST https://wildbound.kunini.ru/api/events \
  -H 'Content-Type: application/json' \
  --data '{"sessionId":"smoke-session","visitorId":"smoke-visitor","type":"session_start"}'
```

Последняя команда создаёт реальное статистическое событие и предназначена только для осознанного smoke-теста. База SQLite находится вне Git; перед обновлением сервера её не удаляют и не перезаписывают. Повторная настройка Nginx не нужна для обычных релизов.
