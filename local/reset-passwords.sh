#!/usr/bin/env bash
# Docker-установка: новые пароли пользователям базы (после переноса со старого Интеграма).
# Запускать из папки установки (где compose.yaml и .env.local), контейнеры должны быть запущены.
#
#   bash local/reset-passwords.sh r7ohr                  # всем пользователям базы
#   bash local/reset-passwords.sh r7ohr ivanov petrov    # только этим
#
# Пароли печатаются и сохраняются в passwords-<база>-<дата>.txt (доступ только владельцу).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
if docker compose version >/dev/null 2>&1; then compose=(docker compose); else compose=(docker-compose); fi
env_file=.env.local
[ -f "$env_file" ] || { echo "СТОП: нет $env_file — сначала установка (scripts/install-local-docker.sh)" >&2; exit 1; }
[ $# -ge 1 ] || { echo "СТОП: укажите базу: bash local/reset-passwords.sh <база> [логин …]" >&2; exit 1; }
dc() { "${compose[@]}" --env-file "$env_file" "$@"; }
[ -n "$(dc ps -q app)" ] || { echo "СТОП: контейнер app не запущен — docker compose --env-file $env_file up -d" >&2; exit 1; }

out="passwords-$1-$(date +%Y%m%d-%H%M%S).txt"
(umask 077; dc exec -T app php /var/www/html/scripts/reset-passwords.php "$@" > "$out") || { rm -f "$out"; exit 1; }
cat "$out"
echo
echo "Пароли сохранены в $out. Передайте их пользователям и удалите файл."
