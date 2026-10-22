#!/usr/bin/env bash
# Стенд исследования python2node#1008: ядро ideav.ru (ideav/crm, index.php) в Docker на песочнице.
# Отдельный от стенда eval ИИ-чата: свой проект compose, свой порт, свой каталог.
#
#   bash stand.sh up [<ref>]   # клон ideav/crm на ref (по умолчанию origin/main), сборка, запуск
#   bash stand.sh status       # контейнеры, ответ ядра, коммит
#   bash stand.sh down         # остановить (тома остаются)
#
# Коммит ядра записывается в $STAND/crm.commit — его кладут в каждый результат (results/*.json).
set -euo pipefail

STAND="${R1008_STAND:-/root/crm1008-stand}"
PORT="${R1008_PORT:-18681}"
PROJECT=crm1008
CRM="$STAND/crm"

compose() { docker compose -p "$PROJECT" --env-file "$CRM/.env.local" -f "$CRM/compose.yaml" -f "$STAND/compose.override.yaml" "$@"; }

up() {
    local ref="${1:-origin/main}"
    mkdir -p "$STAND/logs"
    if [[ -d "$CRM/.git" ]]; then
        git -C "$CRM" fetch -q origin
    else
        git clone -q https://github.com/ideav/crm "$CRM"
    fi
    git -C "$CRM" -c advice.detachedHead=false checkout -q --detach "$ref"
    git -C "$CRM" rev-parse HEAD > "$STAND/crm.commit"
    if [[ ! -s "$CRM/.env.local" ]]; then
        local pw; pw() { head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9'; }
        umask 077
        cat > "$CRM/.env.local" <<EOF
INTEGRAM_MASTER_PASSWORD=$(pw)
INTEGRAM_DB_PASSWORD=$(pw)
INTEGRAM_DB_ROOT_PASSWORD=$(pw)
INTEGRAM_SALT=$(pw)
EOF
    fi
    # Те же поправки, что у стенда eval ИИ-чата: клиент mariadb без TLS, display_errors как на ideav.ru.
    printf '[client]\nskip-ssl\n' > "$STAND/client.cnf"
    printf 'display_errors=Off\nlog_errors=On\n' > "$STAND/php.ini"
    cat > "$STAND/compose.override.yaml" <<EOF
services:
  db:
    image: mariadb:10.11
    container_name: $PROJECT-db
  app:
    container_name: $PROJECT-app
    ports: !override
      - "127.0.0.1:$PORT:80"
    volumes:
      - $STAND/client.cnf:/etc/mysql/conf.d/zz-r1008.cnf:ro
      - $STAND/php.ini:/usr/local/etc/php/conf.d/zz-r1008.ini:ro
      - $STAND/logs:/var/www/html/logs
EOF
    compose up -d --build
    chown -R 33:33 "$STAND/logs"
    for _ in $(seq 1 60); do
        curl -fs -o /dev/null "http://127.0.0.1:$PORT/my" && break
        sleep 2
    done
    status
}

status() {
    compose ps
    echo "ядро: $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/my") (http://127.0.0.1:$PORT)"
    echo "crm: $(git -C "$CRM" log --oneline -1)"
}

case "${1:-}" in
    up) up "${2:-}" ;;
    status) status ;;
    down) compose down ;;
    *) echo "bash stand.sh up [ref]|status|down" >&2; exit 2 ;;
esac
