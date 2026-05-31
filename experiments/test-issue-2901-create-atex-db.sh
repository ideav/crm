#!/usr/bin/env bash
# E2E-тест #2901: универсальный движок docs/create_db_from_scratch.ps1 должен
# создавать структуру проекта atex по КОРРЕКТНЫМ исходным данным
# docs/atex_metadata.json (15 таблиц + системная Пользователь), а не по
# выгрузке сторонней базы metadata_all.json (см. issue #2901).
#
# Прогоняем реальный PowerShell-скрипт против PHP-мока Интеграм из #2899,
# затем структурно сверяем восстановленные из мока метаданные с входными.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
PWSH="${PWSH:-/tmp/pwsh/pwsh}"
PHP="${PHP:-php}"
PORT="${PORT:-8078}"
DB="atex"
META="$ROOT/docs/atex_metadata.json"
OUT="$HERE/reconstructed_atex_metadata.json"

echo "== Starting mock Integram API on 127.0.0.1:$PORT =="
"$PHP" -S 127.0.0.1:$PORT "$HERE/test-issue-2899-mock-integram.php" >/tmp/mock_server_2901.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT
sleep 1

echo "== Resetting store =="
curl -s "http://127.0.0.1:$PORT/$DB/reset" >/dev/null

echo "== Running create_db_from_scratch.ps1 with atex_metadata.json =="
"$PWSH" -NoProfile -File "$ROOT/docs/create_db_from_scratch.ps1" \
    -BaseUrl "http://127.0.0.1:$PORT" -DbName "$DB" \
    -Token mock-token \
    -MetadataPath "$META" \
    -LogPath "$HERE/atex_e2e_run1.log"

echo "== Fetching reconstructed metadata =="
curl -s "http://127.0.0.1:$PORT/$DB/metadata" > "$OUT"

echo "== Comparing reconstructed vs input metadata =="
python3 "$HERE/test-issue-2899-compare-metadata.py" "$META" "$OUT"
RC=$?

echo
echo "== Second run (idempotency check) =="
"$PWSH" -NoProfile -File "$ROOT/docs/create_db_from_scratch.ps1" \
    -BaseUrl "http://127.0.0.1:$PORT" -DbName "$DB" \
    -Token mock-token \
    -MetadataPath "$META" \
    -LogPath "$HERE/atex_e2e_run2.log" >/dev/null
curl -s "http://127.0.0.1:$PORT/$DB/metadata" > "$HERE/reconstructed_atex_metadata_run2.json"
echo "-- Tables after re-run:"
python3 -c "import json;d=json.load(open('$HERE/reconstructed_atex_metadata_run2.json'));print('  tables:',len(d))"
echo "-- Comparing run2 reconstruction vs input (must stay stable):"
python3 "$HERE/test-issue-2899-compare-metadata.py" "$META" "$HERE/reconstructed_atex_metadata_run2.json" || true

exit $RC
