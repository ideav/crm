#!/usr/bin/env bash
set -euo pipefail

: "${INTEGRAM_DB_HOST:=db}"
: "${INTEGRAM_DB_PORT:=3306}"
: "${INTEGRAM_DB_NAME:=ideav}"
: "${INTEGRAM_DB_USER:=ideav}"
: "${INTEGRAM_DB_PASSWORD:=ideav-local-password}"

cert_dir="/etc/integram/certs"
mkdir -p "$cert_dir"
if [[ ! -s "$cert_dir/local.crt" || ! -s "$cert_dir/local.key" ]]; then
    openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
        -subj "/CN=localhost" \
        -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
        -keyout "$cert_dir/local.key" \
        -out "$cert_dir/local.crt"
    chmod 600 "$cert_dir/local.key"
fi

for _ in $(seq 1 60); do
    if mysqladmin ping \
        --host="$INTEGRAM_DB_HOST" \
        --port="$INTEGRAM_DB_PORT" \
        --user="$INTEGRAM_DB_USER" \
        --password="$INTEGRAM_DB_PASSWORD" \
        --silent >/dev/null 2>&1; then
        break
    fi
    sleep 2
done

if ! mysqladmin ping \
    --host="$INTEGRAM_DB_HOST" \
    --port="$INTEGRAM_DB_PORT" \
    --user="$INTEGRAM_DB_USER" \
    --password="$INTEGRAM_DB_PASSWORD" \
    --silent >/dev/null 2>&1; then
    echo "Database is not reachable at $INTEGRAM_DB_HOST:$INTEGRAM_DB_PORT" >&2
    exit 1
fi

mysql \
    --host="$INTEGRAM_DB_HOST" \
    --port="$INTEGRAM_DB_PORT" \
    --user="$INTEGRAM_DB_USER" \
    --password="$INTEGRAM_DB_PASSWORD" \
    "$INTEGRAM_DB_NAME" \
    < /usr/local/share/integram/010-integram-bootstrap.sql

seed_dir_if_empty() {
    local source_dir="$1"
    local target_dir="$2"
    mkdir -p "$target_dir"
    if [[ -d "$source_dir" ]] && ! find "$target_dir" -mindepth 1 -maxdepth 1 | grep -q .; then
        cp -a "$source_dir"/. "$target_dir"/
    fi
}

seed_dir_if_empty /usr/local/share/integram/download-seed /var/www/html/download
seed_dir_if_empty /usr/local/share/integram/templates-custom-seed/my /var/www/html/templates/custom/my
seed_dir_if_empty /usr/local/share/integram/templates-custom-seed/ru /var/www/html/templates/custom/ru
seed_dir_if_empty /usr/local/share/integram/templates-custom-seed/en /var/www/html/templates/custom/en

mkdir -p /var/www/html/logs /var/www/html/download/ru /var/www/html/download/en
chown -R www-data:www-data /var/www/html/logs /var/www/html/download /var/www/html/templates/custom

exec "$@"
