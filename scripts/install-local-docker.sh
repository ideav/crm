#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

if docker compose version >/dev/null 2>&1; then
    compose=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
    compose=(docker-compose)
else
    echo "Docker Compose is required." >&2
    exit 1
fi

env_file=".env.local"
if [[ -f "$env_file" ]]; then
    read -r -p "$env_file already exists. Recreate it? [y/N] " recreate
    if [[ ! "$recreate" =~ ^[Yy]$ ]]; then
        "${compose[@]}" --env-file "$env_file" up -d --build
        exit 0
    fi
fi

# A new .env.local gets new DB passwords, but MariaDB applies MARIADB_PASSWORD
# only when it initialises an empty volume. An old integram-db volume would keep
# the previous password and the app would restart forever with ERROR 1045.
project="${COMPOSE_PROJECT_NAME:-integram-local}"
db_volume="$(docker volume ls -q \
    --filter "label=com.docker.compose.project=$project" \
    --filter "label=com.docker.compose.volume=integram-db")"
if [[ -n "$db_volume" ]]; then
    if [[ "${INTEGRAM_RESET_DB:-}" == "1" ]]; then
        echo "INTEGRAM_RESET_DB=1: removing containers of $project and volume $db_volume…"
        containers="$(docker ps -aq --filter "label=com.docker.compose.project=$project")"
        if [[ -n "$containers" ]]; then
            # shellcheck disable=SC2086
            docker rm -f $containers >/dev/null
        fi
        docker volume rm "$db_volume" >/dev/null
    else
        cat >&2 <<MSG
STOP: Docker volume $db_volume already exists.

It holds a database created with the passwords of a previous installation.
A new $env_file would get new passwords, the database would reject them
and the app container would restart forever (ERROR 1045 Access denied).

Choose one:
  - keep the data: put the previous $env_file back and run this script again,
    answering N to "Recreate it?";
  - drop the old database (ALL its data is lost):
      INTEGRAM_RESET_DB=1 $0
MSG
        exit 1
    fi
fi

read -rs -p "Enter Integram master password: " master_password
echo
read -rs -p "Repeat Integram master password: " master_password_repeat
echo

if [[ "$master_password" != "$master_password_repeat" ]]; then
    echo "Passwords do not match." >&2
    exit 1
fi

if [[ ${#master_password} -lt 8 ]]; then
    echo "Use at least 8 characters for the master password." >&2
    exit 1
fi

dotenv_quote() {
    local value="$1"
    value="${value//\'/\\\'}"
    printf "'%s'" "$value"
}

db_password="$(openssl rand -base64 24 | tr -d '\n')"
db_root_password="$(openssl rand -base64 24 | tr -d '\n')"
salt="$(openssl rand -hex 24)"

cat > "$env_file" <<ENV
INTEGRAM_MASTER_PASSWORD=$(dotenv_quote "$master_password")
INTEGRAM_DB_NAME=ideav
INTEGRAM_DB_USER=ideav
INTEGRAM_DB_PASSWORD=$(dotenv_quote "$db_password")
INTEGRAM_DB_ROOT_PASSWORD=$(dotenv_quote "$db_root_password")
INTEGRAM_HTTP_PORT=8080
INTEGRAM_HTTPS_PORT=8443
INTEGRAM_ADMIN_EMAIL=admin@example.local
INTEGRAM_SALT=$(dotenv_quote "$salt")
ENV

mkdir -p docker/certs
if [[ ! -s docker/certs/local.crt || ! -s docker/certs/local.key ]]; then
    openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
        -subj "/CN=localhost" \
        -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
        -keyout docker/certs/local.key \
        -out docker/certs/local.crt
    chmod 600 docker/certs/local.key
fi

"${compose[@]}" --env-file "$env_file" up -d --build

cat <<'MSG'

Integram is starting locally.

URL: https://localhost:8443
Database: my
Login: admin
Password: the master password entered during installation

The default certificate is self-signed. Import docker/certs/local.crt into the
client trust store or replace local.crt/local.key with the customer's certificate.
MSG
