#!/usr/bin/env bash
# Перенос баз со старого Интеграма (on-premise) в эту установку нового:
# дамп MySQL старого сервера (+ архив папок баз) → таблицы баз, склейка хвостов, файлы, меню.
#
# Запуск — на сервере нового Интеграма, где есть mysql-клиент, node (18+), php и корень сайта.
# В Docker-установке его вызывает local/import-old-db.sh внутри контейнера app.
#
#   bash scripts/import-old-integram.sh --dump old.sql.gz                       # какие базы есть в дампе
#   bash scripts/import-old-integram.sh --dump old.sql.gz --db r7ohr,sales \
#        [--files old-files.tgz] [--webroot /var/www/html] [--url http://localhost] [--server-name localhost]
#
# Доступ к БД — из переменных INTEGRAM_DB_HOST/PORT/NAME/USER/PASSWORD (как у самого сайта;
# без Docker: `. /etc/apache2/envvars`). Мастер-пароль INTEGRAM_MASTER_PASSWORD нужен для шага меню.
#
# Таблицы дампа сначала загружаются под именами oldimp_<имя> и в конце удаляются: служебные
# таблицы новой установки (my, ru, en) дамп не перезаписывает. База, которая уже есть в новой
# установке, не трогается — повторный перенос делается командой transfer (tools/old-integram-migration).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
migrate="$here/tools/old-integram-migration/migrate.js"
dump="" dbs="" files="" webroot="$here" url="http://localhost" server_name="localhost"
while [ $# -gt 0 ]; do
    case "$1" in
        --dump) dump="$2"; shift 2 ;;
        --db) dbs="$2"; shift 2 ;;
        --files) files="$2"; shift 2 ;;
        --webroot) webroot="$2"; shift 2 ;;
        --url) url="${2%/}"; shift 2 ;;
        --server-name) server_name="$2"; shift 2 ;;
        *) echo "Неизвестный параметр: $1" >&2; exit 2 ;;
    esac
done
stop() { echo "СТОП: $*" >&2; exit 1; }
[ -n "$dump" ] || stop "не задан --dump <файл .sql или .sql.gz>"
[ -s "$dump" ] || stop "нет файла дампа $dump"
[ -z "$files" ] || [ -s "$files" ] || stop "нет архива файлов $files"
for c in mysql node php sed; do command -v "$c" >/dev/null || stop "не найдена команда $c"; done
[ -f "$migrate" ] || stop "нет $migrate"
: "${INTEGRAM_DB_NAME:?не задан INTEGRAM_DB_NAME (без Docker: . /etc/apache2/envvars)}"
: "${INTEGRAM_DB_USER:?не задан INTEGRAM_DB_USER}"

work="$(mktemp -d)"
cnf="$work/my.cnf"
cleanup_tables() { sql -N -e "SELECT CONCAT('DROP TABLE IF EXISTS \`', table_name, '\`;') FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE 'oldimp\\_%'" | sql; }
cleanup() { [ -s "$cnf" ] && cleanup_tables 2>/dev/null || true; rm -rf "$work"; }
trap cleanup EXIT
(umask 077; printf '[client]\nhost=%s\nport=%s\nuser=%s\npassword="%s"\ndatabase=%s\ndefault-character-set=utf8mb4\n' \
    "${INTEGRAM_DB_HOST:-127.0.0.1}" "${INTEGRAM_DB_PORT:-3306}" "$INTEGRAM_DB_USER" "${INTEGRAM_DB_PASSWORD:-}" "$INTEGRAM_DB_NAME" > "$cnf")
sql() { mysql --defaults-file="$cnf" "$@"; }
sql -e "SELECT 1" >/dev/null || stop "нет доступа к БД $INTEGRAM_DB_NAME"

# 1. Дамп → таблицы oldimp_<имя>. Строки DDL/DML начинаются с имени таблицы — переименовывается
#    только оно; данные внутри INSERT не трогаются. CREATE DATABASE/USE выбрасываются: всё идёт
#    в базу этой установки. Сортировка utf8mb4_0900_ai_ci (MySQL 8) есть не во всех MariaDB.
cat_dump() { case "$dump" in *.gz) gzip -dc "$dump" ;; *) cat "$dump" ;; esac; }
rewrite() {
    sed -E \
        -e '/^(\/\*![0-9]+ )?(CREATE DATABASE|USE )/d' \
        -e 's/^(DROP TABLE IF EXISTS|CREATE TABLE( IF NOT EXISTS)?|INSERT( IGNORE)? INTO|REPLACE INTO|LOCK TABLES|\/\*!40000 ALTER TABLE) `/\1 `oldimp_/' \
        -e '/^INSERT /!s/utf8mb4_0900_ai_ci/utf8mb4_unicode_ci/g' \
        -e 's/^\) TYPE=/) ENGINE=/'
}
echo "Проверка дампа…"
bad="$(cat_dump | rewrite | grep -E '^(/\*![0-9]+ )?(CREATE|DROP|ALTER|RENAME|TRUNCATE|INSERT|REPLACE|LOCK TABLES)' \
    | grep -vE '^(DROP TABLE IF EXISTS|CREATE TABLE( IF NOT EXISTS)?|INSERT( IGNORE)? INTO|REPLACE INTO|LOCK TABLES|/\*!40000 ALTER TABLE) `oldimp_' \
    | cut -c1-120 | head -5 || true)"
[ -z "$bad" ] || stop "в дампе есть команды не к таблицам (представления, триггеры, процедуры?) — снимите дамп только таблиц:
$bad"
n="$(cat_dump | rewrite | grep -c '^CREATE TABLE' || true)"
[ "$n" -gt 0 ] || stop "в дампе нет CREATE TABLE — снимите дамп без --no-create-info"
cleanup_tables
echo "Загрузка дампа: таблиц $n…"
cat_dump | rewrite | sql

# 2. Базы Интеграма в дампе: таблицы с колонками id, up, ord, t, val.
found="$(sql -N -e "SELECT SUBSTRING(table_name, 8) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name LIKE 'oldimp\\_%' AND column_name IN ('id','up','ord','t','val')
    GROUP BY table_name HAVING COUNT(*) = 5 ORDER BY 1")"
[ -n "$found" ] || stop "в дампе нет таблиц баз Интеграма (колонки id, up, ord, t, val)"
echo "Базы Интеграма в дампе (строк, пользователей; my/ru/en — служебные таблицы старой установки):"
for t in $found; do
    printf '  %-16s %s\n' "$t" "$(sql -N -e "SELECT CONCAT(COUNT(*), ' строк, ', SUM(t = 18 AND up = 1), ' польз.') FROM \`oldimp_$t\`")"
done
if [ -z "$dbs" ]; then
    echo
    echo "Укажите, какие базы переносить: --db имя1,имя2 (и --files архив, если есть папки баз)."
    exit 0
fi

# 3. Проверки до записи: все базы есть в дампе, в новой установке их ещё нет.
IFS=',' read -r -a list <<< "$dbs"
for db in "${list[@]}"; do
    [[ "$db" =~ ^[A-Za-z][A-Za-z0-9_]{0,14}$ ]] || stop "недопустимое имя базы «$db» (буква, затем буквы/цифры/_, до 15 символов)"
    grep -qx "$db" <<< "$found" || stop "базы $db нет в дампе"
    [ -z "$(sql -N -e "SHOW TABLES LIKE '$db'")" ] || stop "база $db уже есть в этой установке — повторный перенос: tools/old-integram-migration/README.md, раздел о transfer"
done

if [ -n "$files" ]; then
    mkdir -p "$work/files"
    tar -xzf "$files" -C "$work/files" || stop "архив $files не распакован (нужен .tar.gz)"
fi
token_for() {
    INTEGRAM_SERVER_NAME="$server_name" php -r '$z = $argv[1]; $h = getenv("INTEGRAM_ADMINHASH") ?: sha1(getenv("INTEGRAM_SERVER_NAME").$z.getenv("INTEGRAM_MASTER_PASSWORD")); echo hash("sha512", $h.$z);' "$1"
}

for db in "${list[@]}"; do
    echo
    echo "=== $db"
    # 4. Таблица базы и склейка 127-символьных хвостов старого ядра (migrate.js sql).
    sql -e "RENAME TABLE \`oldimp_$db\` TO \`$db\`"
    node "$migrate" sql --db "$db" | sql
    sql -N -e "SELECT CONCAT('таблица: ', COUNT(*), ' строк, хвостов ', SUM(t = 0)) FROM \`$db\`"

    # 5. Папки базы: templates/custom/<db>, download/<db>. Архив мог быть снят от любого каталога —
    #    корень ищется по templates/custom/<db> или download/<db>.
    if [ -n "$files" ]; then
        hit="$(find "$work/files" -type d \( -path "*/templates/custom/$db" -o -path "*/download/$db" \) | head -1)"
        if [ -z "$hit" ]; then
            echo "ВНИМАНИЕ: в архиве нет папок templates/custom/$db и download/$db — файлы базы не перенесены"
        else
            case "$hit" in */templates/custom/"$db") src="${hit%/templates/custom/$db}" ;; *) src="${hit%/download/$db}" ;; esac
            node "$migrate" files-dir --src "$src" --dst "$webroot" --db "$db" --apply | grep -v '^скопирован ' || true
            if [ "$(id -u)" = 0 ] && id www-data >/dev/null 2>&1; then
                for d in "$webroot/templates/custom/$db" "$webroot/download/$db"; do [ ! -d "$d" ] || chown -R www-data:www-data "$d"; done
            fi
        fi
    fi

    # 6. Меню в формате нового ядра (migrate.js menu) — через API этой установки мастер-токеном.
    if [ -z "${INTEGRAM_MASTER_PASSWORD:-}${INTEGRAM_ADMINHASH:-}" ]; then
        echo "ВНИМАНИЕ: не задан INTEGRAM_MASTER_PASSWORD — меню не переведено. Повторите шаг вручную:"
        echo "  node $migrate menu --new $url/$db --new-token <токен> --apply"
    else
        node "$migrate" menu --new "$url/$db" --new-token "$(token_for "$db")" --apply | sed 's/^сделано: /меню: /'
    fi
done

echo
echo "Готово. Вход: <адрес сервера>/<база>, логин admin, пароль — мастер-пароль установки."
echo "Пароли пользователей старого сервера новое ядро не принимает — задайте их заново"
echo "(Пользователи → пользователь → пароль). Токены API продолжают работать."
