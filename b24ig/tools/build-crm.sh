#!/usr/bin/env bash
# Собирает коннектор в раскладке репозитория ideav/crm:
#   b24ig.php              → корень сайта (точка входа: CLI и URL)
#   include/b24ig/*.php    → код
#   docs/b24ig/            → документация, пример конфига и secrets.json, строки для update.conf
# Использование: tools/build-crm.sh [каталог назначения, по умолчанию dist/crm]
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$here/dist/crm}"

rm -rf "$out"
mkdir -p "$out/include/b24ig" "$out/docs/b24ig"
cp "$here/b24ig.php" "$out/"
cp "$here"/src/*.php "$out/include/b24ig/"
cp "$here/README.md" "$here/CONFIG.md" "$out/docs/b24ig/"
cp "$here/config/sportzania-spz.json" "$out/docs/b24ig/example-config.json"

cat > "$out/docs/b24ig/secrets.example.json" <<'EOF'
{
  "INTEGRAM_TOKEN": "токен учётки с правами WRITE+EXPORT на целевые таблицы",
  "B24_WEBHOOK": "https://портал/rest/<пользователь>/<код>/"
}
EOF

cat > "$out/docs/b24ig/update.conf.snippet" <<'EOF'
# Коннектор b24ig (Битрикс24 / 1С → Интеграм)
b24ig.php : /var/www/www-root/data/www/ideav.ru/
include/b24ig/* : /var/www/www-root/data/www/ideav.ru/include/b24ig/
EOF

(cd "$out" && find . -type f | sort)
