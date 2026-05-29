#!/usr/bin/env bash
# E2E-тест #2904: скрипт docs/create_roles_users.ps1 создаёт роли и
# пользователей проекта atex по docs/atex_roles_users.json (продолжение #2902,
# шаги 10-11 дизайн-спеки atex).
#
# Сценарий, повторяющий реальный путь:
#   1. Чистая база + системные таблицы 42/18/151 (reset?system=1).
#   2. Движок create_db_from_scratch.ps1 строит схему atex (15 таблиц);
#      «Пользователь» дедуплицируется на системную таблицу 18.
#   3. create_roles_users.ps1 создаёт 6 ролей (таблица 42) и 6 пользователей
#      (таблица 18) со ссылкой на роль (t115).
#   4. Сверка восстановленных записей с исходными данными.
#   5. Повторный прогон create_roles_users.ps1 — идемпотентность (без дублей).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
PWSH="${PWSH:-/tmp/pwsh/pwsh}"
PHP="${PHP:-php}"
PORT="${PORT:-8079}"
DB="atex"
META="$ROOT/docs/atex_metadata.json"
DATA="$ROOT/docs/atex_roles_users.json"

echo "== Starting mock Integram API on 127.0.0.1:$PORT =="
"$PHP" -S 127.0.0.1:$PORT "$HERE/test-issue-2899-mock-integram.php" >/tmp/mock_server_2904.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT
sleep 1

echo "== Resetting store (with system tables 42/18/151) =="
curl -s "http://127.0.0.1:$PORT/$DB/reset?system=1" >/dev/null

echo "== Building atex schema (create_db_from_scratch.ps1) =="
"$PWSH" -NoProfile -File "$ROOT/docs/create_db_from_scratch.ps1" \
    -BaseUrl "http://127.0.0.1:$PORT" -DbName "$DB" \
    -Login tester -Password secret \
    -MetadataPath "$META" \
    -LogPath "$HERE/roles_users_e2e_schema.log" >/dev/null

echo "== Creating roles and users (create_roles_users.ps1) =="
"$PWSH" -NoProfile -File "$ROOT/docs/create_roles_users.ps1" \
    -BaseUrl "http://127.0.0.1:$PORT" -DbName "$DB" \
    -Login tester -Password secret \
    -DataPath "$DATA" \
    -LogPath "$HERE/roles_users_e2e_run1.log"

echo
echo "== Fetching created roles (object/42) and users (object/18) =="
curl -s "http://127.0.0.1:$PORT/$DB/object/42" > "$HERE/roles_42.json"
curl -s "http://127.0.0.1:$PORT/$DB/object/18" > "$HERE/users_18.json"

echo
echo "== Verifying roles and users =="
python3 "$HERE/test-issue-2904-verify-roles-users.py" "$DATA" "$HERE/roles_42.json" "$HERE/users_18.json"
RC=$?

echo
echo "== Second run (idempotency check) =="
"$PWSH" -NoProfile -File "$ROOT/docs/create_roles_users.ps1" \
    -BaseUrl "http://127.0.0.1:$PORT" -DbName "$DB" \
    -Login tester -Password secret \
    -DataPath "$DATA" \
    -LogPath "$HERE/roles_users_e2e_run2.log" >/dev/null
curl -s "http://127.0.0.1:$PORT/$DB/object/42" > "$HERE/roles_42_run2.json"
curl -s "http://127.0.0.1:$PORT/$DB/object/18" > "$HERE/users_18_run2.json"
echo "-- Records after re-run (must stay 6 roles / 6 users):"
python3 -c "import json;r=json.load(open('$HERE/roles_42_run2.json'));u=json.load(open('$HERE/users_18_run2.json'));print('  roles:',len(r['object']),' users:',len(u['object']))"
echo "-- Verifying run2 (must stay stable, no duplicates):"
python3 "$HERE/test-issue-2904-verify-roles-users.py" "$DATA" "$HERE/roles_42_run2.json" "$HERE/users_18_run2.json"

exit $RC
