#!/usr/bin/env bash
# Сквозная проверка выбора якоря ссылки в отчёте (issue #5058) на реальном стеке
# Apache + mod_php + MariaDB: Compile_Report() строит SQL, отчёт выполняется, сверяем ВЫВОД.
#
# Модель (id как в проде ateh): на втулку 8188 ссылаются и позиция заказа (1076.8194),
# и партия сырья (1074.52653). Втулки у позиции и у партии в данных нарочно разные.
#   1500 — колонки как в cut_planning 8384: в отчёте cut_sleeve = 1076.8194, значит «Дюймы»
#          (8188.66225) идут от втулки позиции: 8001→3, 8002→6, 8003→1.
#   1600 — колонок партии нет, неоднозначности нет: то же 3 / 6 / 1.
#   1700 — в отчёте втулка партии 1074.52653: «Дюймы» от партии: 8001→1, 8002→пусто, 8003→1.
# Красный до правки: 1500 даёт 1 / пусто / 1 (втулка партии сырья).
#
# Запуск (нужен docker): bash experiments/report-ref-anchor-5058-e2e.sh
set -euo pipefail

NET=ref-anchor-5058-e2e-net
DB=ref-anchor-5058-e2e-db
APP=ref-anchor-5058-e2e-app
IMAGE_APP=${IMAGE_APP:-integram-5058-app}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TOKEN=e2e5058tok

cleanup(){
    docker rm -f "$APP" "$DB" >/dev/null 2>&1 || true
    docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

docker build -q -t "$IMAGE_APP" "$ROOT" >/dev/null
docker network create "$NET" >/dev/null
docker run -d --name "$DB" --network "$NET" \
    -e MARIADB_ROOT_PASSWORD=root5058 -e MARIADB_DATABASE=ideav \
    -e MARIADB_USER=ideav -e MARIADB_PASSWORD=ideav5058 mariadb:11.4 >/dev/null

printf 'Жду MariaDB'
for _ in $(seq 1 60); do
    docker exec "$DB" mariadb-admin ping -h 127.0.0.1 -uideav -pideav5058 --silent >/dev/null 2>&1 && break
    printf '.'; sleep 2
done
echo " — готова"

docker run -d --name "$APP" --network "$NET" \
    -e INTEGRAM_DB_HOST="$DB" -e INTEGRAM_DB_NAME=ideav \
    -e INTEGRAM_DB_USER=ideav -e INTEGRAM_DB_PASSWORD=ideav5058 \
    -e INTEGRAM_MASTER_PASSWORD=master5058 -e INTEGRAM_SALT=salt5058 \
    "$IMAGE_APP" >/dev/null

printf 'Жду приложение'
for _ in $(seq 1 60); do
    docker exec "$APP" curl -fsS -o /dev/null http://localhost/my/ >/dev/null 2>&1 && break
    printf '.'; sleep 2
done
echo " — отвечает"

docker exec -i "$DB" mariadb -uideav -pideav5058 ideav < "$ROOT/experiments/report-ref-anchor-5058-seed.sql"

failed=0
# check <отчёт> <доп. параметры> <ожидание "задание=дюймы ..."> <название>
check(){
    local got
    got=$(docker exec "$APP" curl -s -H "X-Authorization: $TOKEN" "http://localhost/ateh/report/$1?JSON_KV$2" \
        | parse_inches)
    if [[ "$got" == "$3" ]]; then
        echo "  ok   $4: $got"
    else
        echo "  FAIL $4: ждали «$3», получили «$got»"
        failed=$((failed + 1))
    fi
}
# Ответ JSON_KV — массив строк; печатаем «cut_id=inches» через пробел (inches без «.00»).
parse_inches(){
    tr '}' '\n' | sed -n 's/.*"cut_id":"\([0-9]*\)".*"inches":"\([^"]*\)".*/\1=\2/p' \
        | sed 's/\.0*$//' | paste -sd' ' -
}

echo
echo "1. cut_planning: «Дюймы» — от втулки позиции (её ссылка стоит в отчёте)"
check 1500 "" "8001=3 8002=6 8003=1" "отчёт 1500"
check 1500 "&FR_inches=3" "8001=3" "отчёт 1500, фильтр FR_inches=3"
echo "2. Без неоднозначности — как было"
check 1600 "" "8001=3 8002=6 8003=1" "отчёт 1600"
echo "3. В отчёте втулка партии — «Дюймы» от партии"
check 1700 "" "8001=1 8002= 8003=1" "отчёт 1700"

echo
if (( failed )); then echo "FAILED: $failed"; exit 1; fi
echo "ALL OK"
