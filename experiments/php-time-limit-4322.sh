#!/usr/bin/env bash
# Прогон experiments/php-time-limit-4322.test.php (issue #4322) в docker:
# поднимает MariaDB, запускает тест в PHP с mysqli, убирает за собой контейнеры.
set -euo pipefail

NET=time-limit-4322-net
DB=time-limit-4322-db
IMAGE_PHP=${IMAGE_PHP:-php:8.2-cli-mysqli-4322}
ROOT=$(cd "$(dirname "$0")/.." && pwd)

cleanup(){ docker rm -f "$DB" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

# Официальный php:8.2-cli без mysqli — собираем образ с расширением один раз.
if ! docker image inspect "$IMAGE_PHP" >/dev/null 2>&1; then
    echo "Собираю $IMAGE_PHP (php:8.2-cli + mysqli)..."
    printf 'FROM php:8.2-cli\nRUN docker-php-ext-install mysqli\n' | docker build -t "$IMAGE_PHP" -
fi

docker network create "$NET" >/dev/null
docker run -d --name "$DB" --network "$NET" \
    -e MARIADB_ROOT_PASSWORD=root4322 -e MARIADB_DATABASE=t4322 \
    -e MARIADB_USER=t4322 -e MARIADB_PASSWORD=t4322 mariadb:11.4 >/dev/null

printf 'Жду MariaDB'
for _ in $(seq 1 60); do
    if docker exec "$DB" mariadb-admin ping -h 127.0.0.1 -ut4322 -pt4322 --silent >/dev/null 2>&1; then
        echo " — готова"; break
    fi
    printf '.'; sleep 2
done

docker run --rm --network "$NET" -v "$ROOT":/app -w /app \
    -e TEST_DB_HOST="$DB" -e TEST_DB_USER=t4322 -e TEST_DB_PASSWORD=t4322 -e TEST_DB_NAME=t4322 \
    "$IMAGE_PHP" php experiments/php-time-limit-4322.test.php
