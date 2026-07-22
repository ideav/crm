#!/usr/bin/env bash
# Сквозная проверка предела времени запроса (issue #4322) на реальном стеке
# Apache + mod_php + MariaDB: страница отдаётся как обычно, а запрос, заблокированный
# на стороне БД, обрывается по пределу, а не висит.
set -euo pipefail

NET=time-limit-4322-e2e-net
DB=time-limit-4322-e2e-db
APP=time-limit-4322-e2e-app
IMAGE_APP=${IMAGE_APP:-integram-4322-app}
ROOT=$(cd "$(dirname "$0")/.." && pwd)

cleanup(){
    docker rm -f "$APP" "$DB" >/dev/null 2>&1 || true
    docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

docker build -q -t "$IMAGE_APP" "$ROOT" >/dev/null
docker network create "$NET" >/dev/null
docker run -d --name "$DB" --network "$NET" \
    -e MARIADB_ROOT_PASSWORD=root4322 -e MARIADB_DATABASE=ideav \
    -e MARIADB_USER=ideav -e MARIADB_PASSWORD=ideav4322 mariadb:11.4 >/dev/null

printf 'Жду MariaDB'
for _ in $(seq 1 60); do
    docker exec "$DB" mariadb-admin ping -h 127.0.0.1 -uideav -pideav4322 --silent >/dev/null 2>&1 && break
    printf '.'; sleep 2
done
echo " — готова"

docker run -d --name "$APP" --network "$NET" \
    -e INTEGRAM_DB_HOST="$DB" -e INTEGRAM_DB_NAME=ideav \
    -e INTEGRAM_DB_USER=ideav -e INTEGRAM_DB_PASSWORD=ideav4322 \
    -e INTEGRAM_MASTER_PASSWORD=master4322 -e INTEGRAM_SALT=salt4322 \
    "$IMAGE_APP" >/dev/null

printf 'Жду приложение'
for _ in $(seq 1 60); do
    docker exec "$APP" curl -fsS -o /dev/null http://localhost/my/ >/dev/null 2>&1 && break
    printf '.'; sleep 2
done
echo " — отвечает"

echo
echo "1. Обычный запрос"
docker exec "$APP" curl -s -o /dev/null -w '   HTTP %{http_code}, %{time_total} c\n' http://localhost/my/

echo "2. Запрос при заблокированной таблице, TIME=5 (ожидание: обрыв, а не зависание)"
docker exec -d "$DB" mariadb -uroot -proot4322 ideav \
    -e "LOCK TABLES my WRITE; SELECT SLEEP(400);"
sleep 2
docker exec "$APP" curl -s -m 90 -w '\n   HTTP %{http_code}, %{time_total} c\n' 'http://localhost/my/?TIME=5' | tail -3

echo "3. Запрос при заблокированной таблице без TIME (предел по умолчанию 30 c)"
docker exec "$APP" curl -s -m 90 -o /dev/null -w '   HTTP %{http_code}, %{time_total} c\n' 'http://localhost/my/'

# Apache со значением Timeout по умолчанию (60 c) не должен рубить запрос раньше его
# собственного предела: с LONG=1 проверяем предел, заведомо больший Timeout.
if [[ "${LONG:-0}" == "1" ]]; then
    echo "4. TIME=90 — предел больше Apache Timeout (60 c), ждём обрыв на 90-й секунде"
    docker exec "$APP" curl -s -m 180 -o /dev/null -w '   HTTP %{http_code}, %{time_total} c\n' 'http://localhost/my/?TIME=90'
fi

echo
echo "Хвост лога PHP:"
docker exec "$APP" sh -c 'tail -5 /var/www/html/logs/*_log.txt 2>/dev/null || true'
