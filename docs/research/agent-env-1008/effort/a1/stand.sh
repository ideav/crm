#!/usr/bin/env bash
# Стенд A′ замера python2node#1055: PostgreSQL 16 + PostgREST в Docker на песочнице.
# Свой проект compose, свой порт, свой каталог — стенд ядра #1008 (stand/stand.sh) не трогается.
#
#   bash a1/stand.sh up        # поднять; роли кластера создаются при первом запуске
#   bash a1/stand.sh status    # контейнеры и ответ PostgREST
#   bash a1/stand.sh psql      # psql суперпользователем в базу app
#   bash a1/stand.sh down      # остановить (том данных остаётся)
#
# Секреты (пароль authenticator, секрет JWT) — в $STAND/.env, права 600.
set -euo pipefail

STAND="${R1055_A1_STAND:-/root/crm1055a}"
PORT="${R1055_A1_PORT:-18690}"
PROJECT=crm1055a
PGRST_IMAGE=postgrest/postgrest:v12.2.3

compose() { docker compose -p "$PROJECT" --env-file "$STAND/.env" -f "$STAND/compose.yaml" "$@"; }
dbexec() { docker exec -i "$PROJECT-db" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }

up() {
    mkdir -p "$STAND"
    if [[ ! -s "$STAND/.env" ]]; then
        local pw; pw() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
        umask 077
        printf 'PG_PASSWORD=%s\nAUTH_PASSWORD=%s\nJWT_SECRET=%s\n' "$(pw 24)" "$(pw 24)" "$(pw 40)" > "$STAND/.env"
    fi
    cat > "$STAND/compose.yaml" <<EOF
services:
  db:
    image: postgres:16-alpine
    container_name: $PROJECT-db
    environment:
      POSTGRES_PASSWORD: \${PG_PASSWORD}
      POSTGRES_DB: app
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "postgres"]
      interval: 2s
      retries: 30
  rest:
    image: $PGRST_IMAGE
    container_name: $PROJECT-rest
    depends_on:
      db:
        condition: service_healthy
    environment:
      PGRST_DB_URI: postgres://authenticator:\${AUTH_PASSWORD}@db:5432/app
      PGRST_DB_SCHEMAS: api
      PGRST_DB_ANON_ROLE: anon
      PGRST_JWT_SECRET: \${JWT_SECRET}
    ports:
      - "127.0.0.1:$PORT:3000"
volumes:
  pgdata:
EOF
    compose up -d --wait db   # ждать healthcheck: при первом запуске initdb перезапускает сервер
    # Роли кластера: authenticator входит и переключается в роль из JWT
    local auth_pw; auth_pw=$(sed -n 's/^AUTH_PASSWORD=//p' "$STAND/.env")
    dbexec -d postgres <<SQL
DO \$\$
DECLARE r text;
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator') THEN
        CREATE ROLE authenticator LOGIN NOINHERIT;
    END IF;
    FOREACH r IN ARRAY ARRAY['anon', 'fund_admin', 'expert', 'applicant'] LOOP
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('CREATE ROLE %I NOLOGIN', r);
        END IF;
        EXECUTE format('GRANT %I TO authenticator', r);
    END LOOP;
END \$\$;
ALTER ROLE authenticator PASSWORD '$auth_pw';
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
    psql) shift; docker exec -it "$PROJECT-db" psql -U postgres -d app "$@" ;;
    down) compose down ;;
    *) echo "bash a1/stand.sh up|status|psql|down" >&2; exit 2 ;;
esac
