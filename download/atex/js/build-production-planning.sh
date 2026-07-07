#!/bin/bash
# Собирает download/atex/js/production-planning.js из модулей в
# download/atex/js/production-planning/. По образцу корневого build.sh
# (js/integram-table). Запускать из корня проекта: bash download/atex/js/build-production-planning.sh
set -e
DIR="download/atex/js"
OUT="$DIR/production-planning.js"
echo "// AUTO-GENERATED — DO NOT EDIT. Правьте модули в $DIR/production-planning/ и запускайте: bash $DIR/build-production-planning.sh" > "$OUT"
cat "$DIR"/production-planning/*.js >> "$OUT"
echo "Built $OUT ($(wc -l < "$OUT") lines)"
