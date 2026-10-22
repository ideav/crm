#!/usr/bin/env bash
# Стенд среды A″ (a3) замера python2node#1060: S2 «Реестр контрагентов» и среда запуска sync.py.
#
#   S2   — integ/a3/registry_odata.py (HTTP в стиле OData 1С), unit systemd crm1060r, 127.0.0.1:18692.
#          Слушает только loopback хоста: из контейнеров (в том числе из базы S1 crm1055a-db) недоступен.
#          Данные — $STAND/data/registry.json, снимки — $STAND/data/<имя>.json.
#   sync — образ docker crm1060-sync (python:3.12-slim + psycopg2-binary). sync.py агента запускается в
#          одноразовом контейнере с --network host: ему видны S2 на loopback и S1 по адресу контейнера базы.
#          Код синхронизации каждого снимка — $STAND/sync/<имя>/sync.py.
#
#   bash integ/a3/stand.sh up       # поставить или обновить; пароль S2 создаётся при первом запуске
#   bash integ/a3/stand.sh status
#   bash integ/a3/stand.sh down
#
# Секреты (логин и пароль S2) — в $STAND/.env, права 600.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
STAND="${R1060_A3_STAND:-/root/crm1060r}"
PORT="${R1060R_PORT:-18692}"
UNIT=crm1060r
IMAGE=crm1060-sync

up() {
    mkdir -p "$STAND/data" "$STAND/sync"
    if [[ ! -s "$STAND/.env" ]]; then
        umask 077
        printf 'R1060R_USER=odata_admin\nR1060R_PASSWORD=%s\n' \
            "$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)" > "$STAND/.env"
    fi
    install -m 644 "$HERE/registry_odata.py" "$STAND/registry_odata.py"
    cat > "/etc/systemd/system/$UNIT.service" <<EOF
[Unit]
Description=python2node#1060 A″ (a3): S2 «Реестр контрагентов», OData 1С
After=network.target

[Service]
EnvironmentFile=$STAND/.env
Environment=R1060R_DATA=$STAND/data
Environment=R1060R_PORT=$PORT
ExecStart=/usr/bin/python3 $STAND/registry_odata.py
Restart=always

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable "$UNIT" >/dev/null
    systemctl restart "$UNIT"
    if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
        local ctx; ctx=$(mktemp -d)
        printf 'FROM python:3.12-slim\nRUN pip install --no-cache-dir psycopg2-binary==2.9.10\nWORKDIR /work\n' \
            > "$ctx/Dockerfile"
        docker build -q -t "$IMAGE" "$ctx"
        rm -rf "$ctx"
    fi
    sleep 1
    status
}

status() {
    systemctl --no-pager --lines=0 status "$UNIT" | head -3
    echo "S2: $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/odata/standard.odata/") без пароля (ждём 401)"
    docker image inspect "$IMAGE" --format "образ $IMAGE: {{.Id}}" 2>/dev/null || echo "образа $IMAGE нет"
}

case "${1:-}" in
    up) up ;;
    status) status ;;
    down) systemctl stop "$UNIT" ;;
    *) echo "bash integ/a3/stand.sh up|status|down" >&2; exit 2 ;;
esac
