#!/usr/bin/env bash
# Docker-установка: перенос баз со старого Интеграма. Запускать из папки установки
# (где compose.yaml и .env.local), контейнеры должны быть запущены.
#
#   bash local/import-old-db.sh --dump old.sql.gz                                  # какие базы есть в дампе
#   bash local/import-old-db.sh --dump old.sql.gz --db r7ohr [--files old-files.tgz]
#
# Дамп и архив копируются в контейнер app, там работает scripts/import-old-integram.sh.
# Подробно — local/ПЕРЕНОС-СО-СТАРОГО.md.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
if docker compose version >/dev/null 2>&1; then compose=(docker compose); else compose=(docker-compose); fi
env_file=.env.local
[ -f "$env_file" ] || { echo "СТОП: нет $env_file — сначала установка (scripts/install-local-docker.sh)" >&2; exit 1; }
dc() { "${compose[@]}" --env-file "$env_file" "$@"; }

args=() dump="" files=""
while [ $# -gt 0 ]; do
    case "$1" in
        --dump) dump="$2"; shift 2 ;;
        --files) files="$2"; shift 2 ;;
        *) args+=("$1"); shift ;;
    esac
done
[ -n "$dump" ] && [ -s "$dump" ] || { echo "СТОП: укажите --dump <файл .sql или .sql.gz>" >&2; exit 1; }
[ -z "$files" ] || [ -s "$files" ] || { echo "СТОП: нет архива $files" >&2; exit 1; }
[ -n "$(dc ps -q app)" ] || { echo "СТОП: контейнер app не запущен — docker compose --env-file $env_file up -d" >&2; exit 1; }

in=/tmp/integram-import
dc exec -T app rm -rf "$in"
dc exec -T app mkdir -p "$in"
trap 'dc exec -T app rm -rf "$in" >/dev/null 2>&1 || true' EXIT
case "$dump" in *.gz) d="$in/dump.sql.gz" ;; *) d="$in/dump.sql" ;; esac
echo "Копирование дампа в контейнер…"
dc cp "$dump" "app:$d"
args+=(--dump "$d")
if [ -n "$files" ]; then
    dc cp "$files" "app:$in/files.tgz"
    args+=(--files "$in/files.tgz")
fi
dc exec -T app bash /var/www/html/scripts/import-old-integram.sh --webroot /var/www/html "${args[@]}"
