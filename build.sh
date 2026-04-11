#!/bin/bash
# Собирает js/integram-table.js из модулей в js/integram-table/
# Запускать из корня проекта: bash build.sh
set -e
echo "// AUTO-GENERATED — DO NOT EDIT. Edit files in js/integram-table/ and run: bash build.sh" > js/integram-table.js
cat js/integram-table/*.js >> js/integram-table.js
echo "Built js/integram-table.js ($(wc -l < js/integram-table.js) lines)"
