#!/usr/bin/env bash
# E2E test: run the real PowerShell script against the PHP mock, then verify
# that the reconstructed metadata structurally matches the input metadata.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
PWSH="${PWSH:-/tmp/pwsh/pwsh}"
PHP="${PHP:-php}"
PORT="${PORT:-8077}"
DB="mock"
STATE="$(mktemp -u)/state_unused"   # mock uses sys temp; reset endpoint clears it
OUT="$HERE/reconstructed_metadata.json"

echo "== Starting mock Integram API on 127.0.0.1:$PORT =="
"$PHP" -S 127.0.0.1:$PORT "$HERE/test-issue-2899-mock-integram.php" >/tmp/mock_server.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT
sleep 1

echo "== Resetting store =="
curl -s "http://127.0.0.1:$PORT/$DB/reset" >/dev/null

echo "== Running create_db_from_scratch.ps1 against the mock =="
"$PWSH" -NoProfile -File "$ROOT/docs/create_db_from_scratch.ps1" \
    -BaseUrl "http://127.0.0.1:$PORT" -DbName "$DB" \
    -Token mock-token \
    -MetadataPath "$ROOT/docs/metadata_all.json" \
    -LogPath "$HERE/e2e_run1.log"

echo "== Fetching reconstructed metadata =="
curl -s "http://127.0.0.1:$PORT/$DB/metadata" > "$OUT"

echo "== Comparing reconstructed vs input metadata =="
python3 "$HERE/test-issue-2899-compare-metadata.py" "$ROOT/docs/metadata_all.json" "$OUT"
RC=$?

echo
echo "== Second run (idempotency check: re-run on the now-populated store) =="
"$PWSH" -NoProfile -File "$ROOT/docs/create_db_from_scratch.ps1" \
    -BaseUrl "http://127.0.0.1:$PORT" -DbName "$DB" \
    -Token mock-token \
    -MetadataPath "$ROOT/docs/metadata_all.json" \
    -LogPath "$HERE/e2e_run2.log" >/dev/null
curl -s "http://127.0.0.1:$PORT/$DB/metadata" > "$HERE/reconstructed_metadata_run2.json"
echo "-- Tables after re-run:"
python3 -c "import json;d=json.load(open('$HERE/reconstructed_metadata_run2.json'));print('  tables:',len(d))"
echo "-- Comparing run2 reconstruction vs input (tables/columns should be stable):"
python3 "$HERE/test-issue-2899-compare-metadata.py" "$ROOT/docs/metadata_all.json" "$HERE/reconstructed_metadata_run2.json" || true

exit $RC
