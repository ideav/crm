#!/usr/bin/env bash
# Собирает ЧИСТЫЙ архив Интеграм для отправки заказчику по почте.
#
# Что делает:
#   * кладёт в архив только то, что нужно для локальной установки
#     (приложение + Docker-обвязка + инструкции из local/);
#   * ВЫРЕЗАЕТ данные других заказчиков (atex/sportzania/xcom/ball),
#     сертификаты, .env с секретами и dev-мусор;
#   * проверяет, что данные других заказчиков не попали в архив, и
#     останавливается с ошибкой, если что-то просочилось.
#
# Использование (из корня репозитория или откуда угодно):
#   bash local/make-archive.sh                # → ../integram-local-ГГГГММДД.tar.gz
#   bash local/make-archive.sh /путь/out.tar.gz
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

out="${1:-$root/../integram-local-$(date +%Y%m%d).tar.gz}"

# Что кладём (только генерик-приложение + установка).
include=(
    index.php start.html
    include js css i crm templates download assets
    Dockerfile compose.yaml .dockerignore .env.docker.example
    docker
    scripts/install-local-docker.sh
    build.sh
    local
)

# Что режем. Кодовые имена заказчиков (atex/sportzania/xcom) — как glob по всему
# пути: ловят и templates/<заказчик>/, и download/<заказчик>/, и одиночные файлы
# вроде js/xcom-match.js. 'ball' — только каталогом (частая англ. подстрока).
exclude=(
    --exclude='*atex*'
    --exclude='*sportzania*'
    --exclude='*xcom*'
    --exclude=download/ball
    --exclude=docker/certs
    --exclude=.env
    --exclude=.env.local
    --exclude='*.log'
    --exclude='**/.DS_Store'
    --exclude='**/.git'
)

echo "Корень репозитория: $root"
echo "Файл архива:        $out"
echo

# 1) Сформировать список файлов и проверить на утечку чужих данных.
listing="$(tar "${exclude[@]}" -cf - "${include[@]}" | tar -tf -)"
if leak="$(printf '%s\n' "$listing" | grep -Ei 'atex|sportzania|xcom|(^|/)ball(/|$)' || true)"; [ -n "$leak" ]; then
    echo "ОШИБКА: в архив попали данные другого заказчика:" >&2
    printf '%s\n' "$leak" >&2
    exit 1
fi

# 2) Собрать сам архив.
tar "${exclude[@]}" -czf "$out" "${include[@]}"

# 3) Отчёт.
count="$(printf '%s\n' "$listing" | grep -c . || true)"
size="$(du -h "$out" | cut -f1)"
echo "Готово."
echo "  файлов в архиве: $count"
echo "  размер:          $size"
echo
echo "Проверка (данных других заказчиков быть не должно):"
tar -tzf "$out" | grep -Ei 'atex|sportzania|xcom|(^|/)ball(/|$)' && echo "  ВНИМАНИЕ: найдено!" || echo "  чисто ✓"
echo
echo "Отправляйте заказчику: $out"
echo "Внутри — local/README.md, с него начинать установку."
