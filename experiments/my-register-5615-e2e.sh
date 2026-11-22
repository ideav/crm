#!/usr/bin/env bash
# Сквозная проверка #5615: регистрация /my/register не падает фаталом на main.
#
# Регрессия #5396: обработчик /my/register (index.php:366) пишет пользователя
# в журнал (newUser → Insert → logChange → Ws_collect) ДО require include/ws_push.php
# (index.php:729) — Call to undefined function Ws_collect(), HTTP 500.
# Фикс: require ws_push.php перенесён выше диспетчера, к include connection.php (#294).
#
# Проверяет: 1) POST /my/register отвечает не-500 и создаёт пользователя в my;
#            2) confirm-ссылка создаёт базу пользователя (CREATE TABLE ... LIKE ru).
#
# Запуск (нужен docker): bash experiments/my-register-5615-e2e.sh
set -euo pipefail

NET=my-register-5615-net
DB=my-register-5615-db
APP=my-register-5615-app
IMAGE_APP=${IMAGE_APP:-integram-5615-app}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
EMAIL=agent5615@example.local
PWD=Agent5615pwd

cleanup(){
    docker rm -f "$APP" "$DB" >/dev/null 2>&1 || true
    docker network rm "$NET" >/dev/null 2>&1 || true
}
# KEEP=1 — оставить контейнеры после прогона для разбора (снести: KEEP= bash ...).
trap '[[ -n "${KEEP:-}" ]] || cleanup' EXIT
cleanup

docker build -q -t "$IMAGE_APP" "$ROOT" >/dev/null
docker network create "$NET" >/dev/null
docker run -d --name "$DB" --network "$NET" \
    -e MARIADB_ROOT_PASSWORD=root5615 -e MARIADB_DATABASE=ideav \
    -e MARIADB_USER=ideav -e MARIADB_PASSWORD=ideav5615 mariadb:11.4 >/dev/null

printf 'Жду MariaDB'
for _ in $(seq 1 60); do
    docker exec "$DB" mariadb-admin ping -h 127.0.0.1 -uideav -pideav5615 --silent >/dev/null 2>&1 && break
    printf '.'; sleep 2
done
echo " — готова"

docker run -d --name "$APP" --network "$NET" \
    -e INTEGRAM_DB_HOST="$DB" -e INTEGRAM_DB_NAME=ideav \
    -e INTEGRAM_DB_USER=ideav -e INTEGRAM_DB_PASSWORD=ideav5615 \
    -e INTEGRAM_MASTER_PASSWORD=master5615 -e INTEGRAM_SALT=salt5615 \
    "$IMAGE_APP" >/dev/null

printf 'Жду приложение'
for _ in $(seq 1 60); do
    docker exec "$APP" curl -fsS -o /dev/null http://localhost/my/ >/dev/null 2>&1 && break
    printf '.'; sleep 2
done
echo " — отвечает"

failed=0
ok(){ echo "  ok   $1"; }
fail(){ echo "  FAIL $1"; failed=$((failed + 1)); }

# 1. POST /my/register — создание пользователя кабинета (без капчи: локальный сервер)
CODE=$(docker exec "$APP" curl -s -o /tmp/b -w '%{http_code}' -X POST http://localhost/my/register \
    -d "email=$EMAIL&regpwd=$PWD&regpwd1=$PWD&agree=1")
echo "POST /my/register → HTTP $CODE"
[[ "$CODE" != "500" ]] || fail "регистрация — 500 (Ws_collect undefined до подключения ws_push.php)"
if [[ "$CODE" == "500" ]]; then
    echo "       $(docker exec "$APP" tail -2 /var/www/html/logs/php-error.log | head -1 | cut -c1-200)"
fi
[[ "$CODE" == "200" ]] && ok "POST /my/register не 500"

# 2. Пользователь появился в my (строки пользователя: t=18, up=1)
ROWS=$(docker exec "$DB" mariadb -uideav -pideav5615 ideav -N -e \
    "SELECT COUNT(*) FROM my WHERE t=18 AND up=1")
echo "пользователей в my (t=18): $ROWS"
[[ "${ROWS:-0}" -ge 1 ]] && ok "пользователь my создан"

# 3. Confirm-код и создание базы: письмо падает в журнал (SMTP локально не настроен);
#    код подтверждения — строка t=20 (PASSWORD), её up = id пользователя.
REGUID=$(docker exec "$DB" mariadb -uideav -pideav5615 ideav -N -e \
    "SELECT up FROM my WHERE t=20 LIMIT 1")
CONF=$(docker exec "$DB" mariadb -uideav -pideav5615 ideav -N -e \
    "SELECT val FROM my WHERE t=20 AND up=$REGUID LIMIT 1")
echo "confirm=$CONF uid=$REGUID"
CODE=$(docker exec "$APP" curl -s -o /tmp/b2 -w '%{http_code}' "http://localhost/my/register?u=$REGUID&c=$CONF")
echo "GET /my/register?u&c → HTTP $CODE"
[[ "$CODE" != "500" ]] || fail "подтверждение — 500"
[[ "$CODE" == "200" || "$CODE" == "302" ]] && ok "подтверждение не 500"

# 4. База создана: EAV-база — это ТАБЛИЦА в общем MySQL (CREATE TABLE ... LIKE ru);
#    имя из префикса email: agent5615@example.local → таблица agent5615
DBNAME=$(echo "$EMAIL" | cut -d@ -f1)
EXISTS=$(docker exec "$DB" mariadb -uideav -pideav5615 -N -e \
    "SELECT table_name FROM information_schema.tables WHERE table_schema='ideav' AND table_name='$DBNAME'" | head -1)
[[ "$EXISTS" == "$DBNAME" ]] && ok "база-таблица $DBNAME создана" || fail "база-таблица $DBNAME не создана"

if [[ "$failed" -eq 0 ]]; then
    echo "ИТОГ: зелёный"
else
    echo "ИТОГ: $failed проверок красные"
    exit 1
fi
