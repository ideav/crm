#!/usr/bin/env bash
# E2E-тест #2992: скрипт docs/create_atex_menu.ps1 создаёт пункты меню
# для тестовых ролей проекта atex по docs/atex_menu.json.
#
# Сценарий:
#   1. Чистая база + системные таблицы 42/18/151 (reset?system=1).
#   2. create_roles_users.ps1 создаёт тестовые роли и пользователей.
#   3. create_atex_menu.ps1 создаёт пункты меню в системной таблице 151.
#   4. Сверка меню с исходным JSON.
#   5. Повторный прогон — идемпотентность (без дублей).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
PWSH="${PWSH:-/tmp/pwsh/pwsh}"
if [[ ! -x "$PWSH" ]]; then
    PWSH="$(command -v pwsh || true)"
fi
if [[ -z "$PWSH" || ! -x "$PWSH" ]]; then
    echo "PowerShell executable not found. Set PWSH=/path/to/pwsh." >&2
    exit 1
fi

PHP="${PHP:-php}"
PORT="${PORT:-8092}"
DB="atex"
ROLES_DATA="$ROOT/docs/atex_roles_users.json"
MENU_DATA="$ROOT/docs/atex_menu.json"

echo "== Starting mock Integram API on 127.0.0.1:$PORT =="
"$PHP" -S 127.0.0.1:"$PORT" "$HERE/test-issue-2899-mock-integram.php" >/tmp/mock_server_2992.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT
sleep 1

echo "== Resetting store (with system tables 42/18/151) =="
curl -s "http://127.0.0.1:$PORT/$DB/reset?system=1" >/dev/null

echo "== Creating roles and users =="
"$PWSH" -NoProfile -File "$ROOT/docs/create_roles_users.ps1" \
    -BaseUrl "http://127.0.0.1:$PORT" -DbName "$DB" \
    -Login tester -Password secret \
    -DataPath "$ROLES_DATA" \
    -LogPath "$HERE/atex_menu_roles_users.log" >/dev/null

echo "== Seeding one stale menu item to verify update path =="
curl -s "http://127.0.0.1:$PORT/$DB/object/42" > "$HERE/roles_42_2992_before.json"
MANAGER_ROLE_ID="$(
    python3 -c "import json; r=json.load(open('$HERE/roles_42_2992_before.json')); print(next(x['id'] for x in r['object'] if x['val']=='Менеджер'))"
)"
curl -s -X POST "http://127.0.0.1:$PORT/$DB/_m_new/151?JSON=1" \
    --data-urlencode "up=$MANAGER_ROLE_ID" \
    --data-urlencode "t151=Приём и ведение заказов" \
    --data-urlencode "t153=old-orders" \
    --data-urlencode "t391=<i class=\"pi pi-file\"></i>" >/dev/null

echo "== Creating atex menu =="
"$PWSH" -NoProfile -File "$ROOT/docs/create_atex_menu.ps1" \
    -BaseUrl "http://127.0.0.1:$PORT" -DbName "$DB" \
    -Login tester -Password secret \
    -DataPath "$MENU_DATA" \
    -LogPath "$HERE/atex_menu_run1.log"

echo
echo "== Fetching created roles (object/42) and menus (object/151) =="
curl -s "http://127.0.0.1:$PORT/$DB/object/42" > "$HERE/roles_42_2992.json"
curl -s "http://127.0.0.1:$PORT/$DB/object/151" > "$HERE/menus_151_2992.json"

echo
echo "== Verifying atex menu =="
python3 "$HERE/test-issue-2992-verify-atex-menu.py" \
    "$MENU_DATA" "$HERE/roles_42_2992.json" "$HERE/menus_151_2992.json"

echo
echo "== Second run (idempotency check) =="
"$PWSH" -NoProfile -File "$ROOT/docs/create_atex_menu.ps1" \
    -BaseUrl "http://127.0.0.1:$PORT" -DbName "$DB" \
    -Login tester -Password secret \
    -DataPath "$MENU_DATA" \
    -LogPath "$HERE/atex_menu_run2.log" >/dev/null
curl -s "http://127.0.0.1:$PORT/$DB/object/151" > "$HERE/menus_151_2992_run2.json"
python3 "$HERE/test-issue-2992-verify-atex-menu.py" \
    "$MENU_DATA" "$HERE/roles_42_2992.json" "$HERE/menus_151_2992_run2.json"
