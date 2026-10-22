#!/usr/bin/env bash
# Стенд S2 «Реестр контрагентов» среды A″ замера python2node#1060: отдельные PostgreSQL 16 + PostgREST.
# Свой проект compose, порт и каталог. База S2 подключена ещё и к сети стенда A′ (crm1055a_default):
# из базы S1 (crm1055a-db) она доступна как crm1055c-db:5432 — для postgres_fdw / dblink. Сервис назван
# registry-db, а не db: имя сервиса — DNS-имя в общей сети, и «db» перехватило бы базу стенда A′.
#
#   bash integ/a2/stand.sh up        # поднять; роли кластера создаются при первом запуске
#   bash integ/a2/stand.sh status
#   bash integ/a2/stand.sh down      # остановить (том данных остаётся)
#
# Секреты (пароли authenticator и crm_reader, секрет JWT) — в $STAND/.env, права 600.
set -euo pipefail

STAND="${R1060_REG_STAND:-/root/crm1055c}"
PORT="${R1060_REG_PORT:-18691}"
PROJECT=crm1055c
NET_A1=crm1055a_default
PGRST_IMAGE=postgrest/postgrest:v12.2.3

compose() { docker compose -p "$PROJECT" --env-file "$STAND/.env" -f "$STAND/compose.yaml" "$@"; }
dbexec() { docker exec -i "$PROJECT-db" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }

up() {
    mkdir -p "$STAND"
    if [[ ! -s "$STAND/.env" ]]; then
        local pw; pw() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
        umask 077
        printf 'PG_PASSWORD=%s\nAUTH_PASSWORD=%s\nREADER_PASSWORD=%s\nJWT_SECRET=%s\n' \
            "$(pw 24)" "$(pw 24)" "$(pw 24)" "$(pw 40)" > "$STAND/.env"
    fi
    cat > "$STAND/compose.yaml" <<EOF
services:
  registry-db:
    image: postgres:16-alpine
    container_name: $PROJECT-db
    environment:
      POSTGRES_PASSWORD: \${PG_PASSWORD}
      POSTGRES_DB: registry
    volumes:
      - pgdata:/var/lib/postgresql/data
    networks: [default, a1]
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "postgres"]
      interval: 2s
      retries: 30
  rest:
    image: $PGRST_IMAGE
    container_name: $PROJECT-rest
    depends_on:
      registry-db:
        condition: service_healthy
    environment:
      PGRST_DB_URI: postgres://authenticator:\${AUTH_PASSWORD}@registry-db:5432/registry
      PGRST_DB_SCHEMAS: api
      PGRST_DB_ANON_ROLE: anon
      PGRST_JWT_SECRET: \${JWT_SECRET}
    ports:
      - "127.0.0.1:$PORT:3000"
networks:
  a1:
    external: true
    name: $NET_A1
volumes:
  pgdata:
EOF
    compose up -d --wait registry-db   # ждать healthcheck: при первом запуске initdb перезапускает сервер
    local auth_pw reader_pw
    auth_pw=$(sed -n 's/^AUTH_PASSWORD=//p' "$STAND/.env")
    reader_pw=$(sed -n 's/^READER_PASSWORD=//p' "$STAND/.env")
    dbexec -d postgres <<SQL
DO \$\$
DECLARE r text;
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator') THEN
        CREATE ROLE authenticator LOGIN NOINHERIT;
    END IF;
    FOREACH r IN ARRAY ARRAY['anon', 'registry_admin'] LOOP
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('CREATE ROLE %I NOLOGIN', r);
        END IF;
        EXECUTE format('GRANT %I TO authenticator', r);
    END LOOP;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'crm_reader') THEN
        CREATE ROLE crm_reader LOGIN;
    END IF;
END \$\$;
ALTER ROLE authenticator PASSWORD '$auth_pw';
ALTER ROLE crm_reader PASSWORD '$reader_pw';
SQL
    compose up -d rest
    status
}

status() {
    compose ps
    echo "postgrest: $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/") (http://127.0.0.1:$PORT)"
}

case "${1:-}" in
    up) up ;;
    status) status ;;
    down) compose down ;;
    *) echo "bash integ/a2/stand.sh up|status|down" >&2; exit 2 ;;
esac
