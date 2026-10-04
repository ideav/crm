#!/usr/bin/env bash
# Сквозная проверка #5067 на реальном стеке Apache + mod_php + MariaDB:
#   - колонка, скрытая грантом BARRED, сообщается заголовком X-Denied-Columns и ключом
#     denied_columns ({ord, columnId, name}) в ответе-объекте ?JSON, значения её не отдаются;
#   - без BARRED форма ответа прежняя (нет ни заголовка, ни ключа);
#   - несуществующая таблица (object/999999) и отчёт (report/999999, report/<нет такого имени>) — 404;
#   - регрессия: существующие таблица и отчёт отдают 200 с данными.
#
# Модель (experiments/denied-columns-5067-seed.sql): таблица T=5100 «Склад», реквизиты 5120 «Цена»
# и R=5121 «Секрет». Роль viewer5067 — READ на T, BARRED на R; роль plain5067 — READ на T;
# e5067 — суперпользователь (имя совпадает с именем базы). Отчёт 6000 «stock5067».
#
# Запуск (нужен docker): bash experiments/denied-columns-5067-e2e.sh
set -euo pipefail

NET=denied-columns-5067-e2e-net
DB=denied-columns-5067-e2e-db
APP=denied-columns-5067-e2e-app
IMAGE_APP=${IMAGE_APP:-integram-5067-app}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
BASE=e5067
T=5100
R=5121
R_NAME='Секрет'
TOK_VIEWER=tokviewer5067
TOK_PLAIN=tokplain5067
TOK_SUPER=toksuper5067

cleanup(){
    docker rm -f "$APP" "$DB" >/dev/null 2>&1 || true
    docker network rm "$NET" >/dev/null 2>&1 || true
}
# KEEP=1 — оставить контейнеры после прогона для разбора (снести: KEEP= bash ... или docker rm -f).
trap '[[ -n "${KEEP:-}" ]] || cleanup' EXIT
cleanup

docker build -q -t "$IMAGE_APP" "$ROOT" >/dev/null
docker network create "$NET" >/dev/null
docker run -d --name "$DB" --network "$NET" \
    -e MARIADB_ROOT_PASSWORD=root5067 -e MARIADB_DATABASE=ideav \
    -e MARIADB_USER=ideav -e MARIADB_PASSWORD=ideav5067 mariadb:11.4 >/dev/null

printf 'Жду MariaDB'
for _ in $(seq 1 60); do
    docker exec "$DB" mariadb-admin ping -h 127.0.0.1 -uideav -pideav5067 --silent >/dev/null 2>&1 && break
    printf '.'; sleep 2
done
echo " — готова"

docker run -d --name "$APP" --network "$NET" \
    -e INTEGRAM_DB_HOST="$DB" -e INTEGRAM_DB_NAME=ideav \
    -e INTEGRAM_DB_USER=ideav -e INTEGRAM_DB_PASSWORD=ideav5067 \
    -e INTEGRAM_MASTER_PASSWORD=master5067 -e INTEGRAM_SALT=salt5067 \
    "$IMAGE_APP" >/dev/null

printf 'Жду приложение'
for _ in $(seq 1 60); do
    docker exec "$APP" curl -fsS -o /dev/null http://localhost/my/ >/dev/null 2>&1 && break
    printf '.'; sleep 2
done
echo " — отвечает"

docker exec -i "$DB" mariadb -uideav -pideav5067 ideav < "$ROOT/experiments/denied-columns-5067-seed.sql"
# Каталог базы: ядро пишет в него журнал (при создании базы через UI он появляется сам).
docker exec "$APP" sh -c "mkdir -p /var/www/html/templates/custom/$BASE/logs && chown -R www-data:www-data /var/www/html/templates/custom/$BASE"

failed=0
CODE=""; HDRS=""; BODY=""
# fetch <токен> <путь> — заполняет CODE, HDRS (заголовки), BODY; тело остаётся в /tmp/b контейнера
fetch(){
    CODE=$(docker exec "$APP" curl -s -D /tmp/h -o /tmp/b -w '%{http_code}' \
        -H "X-Authorization: $1" "http://localhost/$BASE/$2")
    HDRS=$(docker exec "$APP" cat /tmp/h | tr -d '\r')
    BODY=$(docker exec "$APP" cat /tmp/b)
}
ok(){ echo "  ok   $1"; }
fail(){
    echo "  FAIL $1"
    echo "       HTTP $CODE; X-Denied-Columns: «$(denied_hdr)»; тело: ${BODY:0:300}"
    failed=$((failed + 1))
}
expect(){ # expect <условие-команда...> -- <название>
    local name=${*: -1}
    if "${@:1:$#-1}"; then ok "$name"; else fail "$name"; fi
}
denied_hdr(){ printf '%s\n' "$HDRS" | sed -n 's/^[Xx]-[Dd]enied-[Cc]olumns: *//p' | tail -1; }
code_is(){ [[ "$CODE" == "$1" ]]; }
body_has(){ [[ "$BODY" == *"$1"* ]]; }
body_lacks(){ [[ "$BODY" != *"$1"* ]]; }
hdr_lists(){ [[ ",$(denied_hdr)," == *",$1,"* ]]; }
hdr_absent(){ [[ -z "$(denied_hdr)" ]]; }
expose_hdr(){ printf '%s\n' "$HDRS" | grep -qi '^Access-Control-Expose-Headers:.*X-Denied-Columns'; }
# Образ собран без php.ini, display_errors=On: предупреждения ядра (не #5067, например
# «Undefined global variable $ARR_typs» в edit_obj) печатаются HTML-ом перед JSON. Разбираем JSON после них.
PHP_HELPERS='function strip_php_warnings($s){ return preg_replace("~^(\s*<br />\s*<b>(Warning|Notice|Deprecated)</b>:.*?<br />)+\s*~s", "", $s); }'
# Тело — JSON [{"error": ...}]
json_error(){
    docker exec "$APP" php -r "$PHP_HELPERS"'$j=json_decode(strip_php_warnings(file_get_contents("/tmp/b")),true);
        exit(is_array($j) && isset($j[0]["error"]) && strlen($j[0]["error"]) ? 0 : 1);'
}
# denied_columns содержит {columnId:$1, name:$2, ord>0}
json_denied(){
    docker exec "$APP" php -r "$PHP_HELPERS"'$j=json_decode(strip_php_warnings(file_get_contents("/tmp/b")),true);
        foreach(($j["denied_columns"] ?? []) as $c)
            if(($c["columnId"] ?? null) === (int)$argv[1] && ($c["name"] ?? null) === $argv[2] && (int)($c["ord"] ?? 0) > 0)
                exit(0);
        exit(1);' -- "$1" "$2"
}
# Тело — JSON-объект без ключа denied_columns
json_no_denied(){
    docker exec "$APP" php -r "$PHP_HELPERS"'$j=json_decode(strip_php_warnings(file_get_contents("/tmp/b")),true);
        exit(is_array($j) && !array_key_exists("denied_columns", $j) ? 0 : 1);'
}

echo
echo "1. Роль viewer5067: READ на «Склад», BARRED на «Секрет» ($R)"
fetch "$TOK_VIEWER" "object/$T?JSON_OBJ"
expect code_is 200                       "object/$T?JSON_OBJ: HTTP 200"
expect hdr_lists "$R"                    "object/$T?JSON_OBJ: X-Denied-Columns содержит $R"
expect expose_hdr                        "object/$T?JSON_OBJ: Access-Control-Expose-Headers: X-Denied-Columns"
expect body_has item-A                   "object/$T?JSON_OBJ: записи на месте (item-A)"
expect body_lacks TOPSECRET              "object/$T?JSON_OBJ: значений «Секрета» нет"
fetch "$TOK_VIEWER" "object/$T?JSON"
expect code_is 200                       "object/$T?JSON: HTTP 200"
expect json_denied "$R" "$R_NAME"        "object/$T?JSON: denied_columns = {columnId:$R, name:«$R_NAME», ord>0}"
expect hdr_lists "$R"                    "object/$T?JSON: X-Denied-Columns содержит $R"
expect body_lacks TOPSECRET              "object/$T?JSON: значений «Секрета» нет"
fetch "$TOK_VIEWER" "edit_obj/5200?JSON"
expect code_is 200                       "edit_obj/5200?JSON: HTTP 200"
expect json_denied "$R" "$R_NAME"        "edit_obj/5200?JSON: denied_columns = {columnId:$R, name:«$R_NAME»}"
expect body_lacks TOPSECRET              "edit_obj/5200?JSON: значения «Секрета» нет"

echo "2. Роль plain5067: без BARRED — форма ответа прежняя"
fetch "$TOK_PLAIN" "object/$T?JSON_OBJ"
expect code_is 200                       "object/$T?JSON_OBJ: HTTP 200"
expect hdr_absent                        "object/$T?JSON_OBJ: заголовка X-Denied-Columns нет"
expect body_has TOPSECRET-A              "object/$T?JSON_OBJ: «Секрет» виден"
fetch "$TOK_PLAIN" "object/$T?JSON"
expect code_is 200                       "object/$T?JSON: HTTP 200"
expect json_no_denied                    "object/$T?JSON: ключа denied_columns нет"
expect hdr_absent                        "object/$T?JSON: заголовка X-Denied-Columns нет"

echo "3. Несуществующая таблица — 404 с JSON-ошибкой"
for tok in "$TOK_VIEWER" "$TOK_SUPER"; do
    fetch "$tok" "object/999999?JSON_OBJ"
    expect code_is 404                   "object/999999?JSON_OBJ ($tok): HTTP 404"
    expect json_error                    "object/999999?JSON_OBJ ($tok): тело [{\"error\":...}]"
done

echo "4. Несуществующий отчёт — 404 (и для роли, и для суперпользователя)"
for tok in "$TOK_VIEWER" "$TOK_PLAIN" "$TOK_SUPER"; do
    fetch "$tok" "report/999999?JSON_KV"
    expect code_is 404                   "report/999999?JSON_KV ($tok): HTTP 404"
    expect json_error                    "report/999999?JSON_KV ($tok): тело [{\"error\":...}]"
    fetch "$tok" "report/nosuchname?JSON_KV"
    expect code_is 404                   "report/nosuchname?JSON_KV ($tok): HTTP 404"
done

echo "5. Регрессия: существующие таблица и отчёт — 200 с данными"
fetch "$TOK_SUPER" "object/$T?JSON_OBJ"
expect code_is 200                       "object/$T?JSON_OBJ (super): HTTP 200"
expect body_has TOPSECRET-B              "object/$T?JSON_OBJ (super): данные на месте"
expect hdr_absent                        "object/$T?JSON_OBJ (super): заголовка X-Denied-Columns нет"
for tok in "$TOK_SUPER" "$TOK_PLAIN"; do
    fetch "$tok" "report/6000?JSON_KV"
    expect code_is 200                   "report/6000?JSON_KV ($tok): HTTP 200"
    expect body_has '"item":"item-A"'    "report/6000?JSON_KV ($tok): строка item-A"
    expect body_has '"item":"item-B"'    "report/6000?JSON_KV ($tok): строка item-B"
done
fetch "$TOK_SUPER" "report/stock5067?JSON_KV"
expect code_is 200                       "report/stock5067?JSON_KV (super): HTTP 200 по имени"
expect body_has '"item":"item-A"'        "report/stock5067?JSON_KV (super): строка item-A"

echo
if (( failed )); then echo "FAILED: $failed"; exit 1; fi
echo "ALL OK"
