#!/usr/bin/env bash
# Прогон регрессионной сети репозитория (experiments/*.test.js) — зависимостей нет, только node.
#
# Файлы, перечисленные в experiments/quarantine.txt, В ГЕЙТ НЕ ВХОДЯТ: это долг, а не норма.
# Они прогоняются отдельно, и если карантинный тест ПОЗЕЛЕНЕЛ — скрипт печатает его как
# кандидата на вывод из карантина (храповик: список только сокращается).
#
# Использование:
#   bash scripts/run-tests.sh          # гейт: зелёные обязаны остаться зелёными
#   bash scripts/run-tests.sh --all    # прогнать всё, включая карантин (для разбора долга)
set -uo pipefail
cd "$(dirname "$0")/.."

QUAR_FILE="experiments/quarantine.txt"
ALL=0
[[ "${1:-}" == "--all" ]] && ALL=1

# Те же файлы, что подхватывает `node --test experiments/`: *.test.js, *-test.js, *_test.js, test-*.js
mapfile -t tests < <(ls experiments/ 2>/dev/null | grep -E '(\.test\.js|-test\.js|_test\.js)$|^test-.*\.js$' | sed 's|^|experiments/|' | sort)
if [[ ${#tests[@]} -eq 0 ]]; then echo "нет тестов в experiments/"; exit 1; fi

declare -A quarantined=()
if [[ -f "$QUAR_FILE" ]]; then
  while IFS= read -r line; do
    line="${line%%#*}"; line="$(echo "$line" | xargs)"
    [[ -z "$line" ]] && continue
    quarantined["experiments/$line"]=1
  done < "$QUAR_FILE"
fi

gate=(); quar=()
for t in "${tests[@]}"; do
  if [[ $ALL -eq 0 && -n "${quarantined[$t]:-}" ]]; then quar+=("$t"); else gate+=("$t"); fi
done

echo "═══ гейт: ${#gate[@]} файлов (в карантине: ${#quar[@]}) ═══"
node --test "${gate[@]}"
rc=$?

if [[ ${#quar[@]} -gt 0 ]]; then
  echo
  echo "═══ карантин: ${#quar[@]} файлов (не влияют на результат) ═══"
  ready=()
  for t in "${quar[@]}"; do
    if node --test "$t" >/dev/null 2>&1; then ready+=("$t"); fi
  done
  if [[ ${#ready[@]} -gt 0 ]]; then
    echo "ПОЗЕЛЕНЕЛИ — убрать из $QUAR_FILE (${#ready[@]}):"
    printf '  %s\n' "${ready[@]#experiments/}"
  else
    echo "все карантинные всё ещё красные"
  fi
fi

exit $rc
