#!/usr/bin/env bash
# Трассировка «правило ТЗ ↔ тест» для планирования (issue #5411).
#
# ЗАЧЕМ. Жёсткие правила §15 сверяются с кодом реестром (#4449) и матрицей (#4734). Мягкие правила
# §5–§14 — основной объём ТЗ — с тестами не связаны ничем: правку прозы §8.2/§12.1 не ловит ничто,
# а тест не говорит, какое правило он держит. Сторож связывает обе стороны.
#
# МЕТКИ. Правило ТЗ — якорь `{#R-<раздел>-<слово>}` в docs/atex_planning_tz.md, например
# `{#R-12.1-foil-end}`. Жёсткому правилу §15 метка = id инварианта из PP_INVARIANTS
# (05-invariants.js), дублировать его якорем не нужно.
#
# ТЕСТ ОБЪЯВЛЯЕТ, ЧТО ПРОВЕРЯЕТ. Строка в первых 40 строках файла:
#     // rules: R-12.1-foil-end, FROZEN_DAY
#     // rules: none (defect #4618)          ← тест на разовый дефект, правила нет
#
# ПРОВЕРКИ.
#   1. Ссылка на несуществующую метку — ошибка всегда (правило удалено или переименовано).
#   2. Новый тест планирования (atex-pp-*, atex-production-planning-*) без `rules:` — ошибка.
#   3. Храповик по счётчикам из scripts/rule-trace-baseline.txt: непокрытых меток и тестов
#      планирования без `rules:` не больше базиса. Если счётчик стал МЕНЬШЕ, базис опускается
#      тем же PR — иначе выигрыш тихо съест следующий PR. Поднять базис правкой файла (против
#      merge-base) — такое же ослабление, как рост счётчика.
# Проверки 2–3 снимаются строкой в теле PR или в сообщении коммита (как RATCHET-OK):
#     TRACE-OK: <почему>
#
# Использование:
#   bash scripts/check-rule-trace.sh [<base-ref>]     # по умолчанию origin/main
# В CI разрешающая строка берётся ещё и из переменной TRACE_DECLARATION (тело PR).
set -uo pipefail
cd "$(dirname "$0")/.."

BASE="${1:-origin/main}"
TZ_DOC=docs/atex_planning_tz.md
REGISTRY=download/atex/js/production-planning/05-invariants.js
BASELINE=scripts/rule-trace-baseline.txt
PLAN_RE='^experiments/(atex-pp-|atex-production-planning-)[^/]*\.test\.js$'
HEADER_LINES=40

# ── Метки ────────────────────────────────────────────────────────────────────────────────────
declare -A LABEL=()
while IFS= read -r l; do [[ -n "$l" ]] && LABEL["$l"]=1; done < <(
  { grep -oE '\{#R-[A-Za-z0-9._-]+\}' "$TZ_DOC" 2>/dev/null | sed -E 's/^\{#//; s/\}$//'
    grep -oE "(^|[^A-Za-z0-9_])id:[[:space:]]*['\"][A-Z][A-Z0-9_]*['\"]" "$REGISTRY" 2>/dev/null \
      | sed -E "s/.*['\"]([A-Z0-9_]+)['\"]/\1/"; } | tr -d '\r' | sort -u)

# ── Строки rules: в тестах ───────────────────────────────────────────────────────────────────
declare -A COVERED=() HAS_RULES=()
errors=()
mapfile -t TESTS < <(git ls-files -- 'experiments/*.test.js' | tr -d '\r')
# Один проход awk по всем файлам (через xargs: на Windows командная строка ограничена 32 КБ).
declare -A RULE_LINE=()
while IFS=$'\t' read -r f line; do RULE_LINE["$f"]="$line"; done < <(
  printf '%s\0' "${TESTS[@]}" | xargs -0 -r awk -v max="$HEADER_LINES" '
    FNR > max { nextfile }
    /^[ \t]*(\/\/|#|\*)[ \t]*rules:/ { sub(/\r$/, ""); print FILENAME "\t" $0; nextfile }')
for f in "${!RULE_LINE[@]}"; do
  line="${RULE_LINE[$f]}"
  value="$(sed -E 's/^[[:space:]]*(\/\/|#|\*)[[:space:]]*rules:[[:space:]]*//; s/[[:space:]]+$//' <<<"$line")"
  if [[ "$value" =~ ^none([[:space:]]|$) ]]; then
    if [[ "$value" =~ ^none[[:space:]]*\(defect[[:space:]]+#[0-9]+\)$ ]]; then
      HAS_RULES["$f"]=1
    else
      errors+=("$f: «rules: $value» — для теста без правила пишется «rules: none (defect #NNNN)»")
    fi
    continue
  fi
  ok=1
  IFS=',' read -ra ids <<<"$value"
  for id in "${ids[@]}"; do
    id="$(sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' <<<"$id")"
    [[ -z "$id" ]] && continue
    if [[ -n "${LABEL[$id]:-}" ]]; then
      COVERED["$id"]=1
    else
      ok=0
      errors+=("$f: метки «$id» нет ни в $TZ_DOC, ни в реестре PP_INVARIANTS")
    fi
  done
  [[ $ok -eq 1 && ${#ids[@]} -gt 0 ]] && HAS_RULES["$f"]=1
done

uncovered=()
for l in "${!LABEL[@]}"; do [[ -z "${COVERED[$l]:-}" ]] && uncovered+=("$l"); done
without=()
for f in "${TESTS[@]}"; do
  [[ "$f" =~ $PLAN_RE && -z "${HAS_RULES[$f]:-}" ]] && without+=("$f")
done

echo "трассировка правил: меток ${#LABEL[@]} (покрыто $(( ${#LABEL[@]} - ${#uncovered[@]} ))), тестов планирования без rules: ${#without[@]}"

# ── 1. Ссылки на несуществующие метки и кривые rules: — всегда ошибка ─────────────────────────
if [[ ${#errors[@]} -gt 0 ]]; then
  echo "═══ ТРАССИРОВКА ПРАВИЛ: неверные строки rules: ═══"
  printf '  %s\n' "${errors[@]}"
  echo
  echo "Метка удалена или переименована в ТЗ — поправьте строку rules: в тесте (или верните метку)."
  exit 1
fi

# ── 2–3. Новые тесты и храповик по счётчикам ─────────────────────────────────────────────────
fail=()
new_without=()
if git rev-parse --verify "$BASE" >/dev/null 2>&1; then
  MERGE_BASE="$(git merge-base "$BASE" HEAD 2>/dev/null || echo "$BASE")"
  while IFS= read -r f; do
    [[ "$f" =~ $PLAN_RE && -z "${HAS_RULES[$f]:-}" ]] && new_without+=("$f")
  done < <(git diff --diff-filter=A --name-only "$MERGE_BASE"...HEAD -- 'experiments/*' | tr -d '\r')
else
  echo "нет базовой ветки $BASE — проверка новых тестов пропущена"
fi
if [[ ${#new_without[@]} -gt 0 ]]; then
  fail+=("новые тесты планирования без строки rules: (${#new_without[@]}):")
  for f in "${new_without[@]}"; do fail+=("    $f"); done
fi

base_u="$(grep -E '^uncovered_labels=' "$BASELINE" 2>/dev/null | tr -d '\r' | cut -d= -f2)"
base_t="$(grep -E '^tests_without_rules=' "$BASELINE" 2>/dev/null | tr -d '\r' | cut -d= -f2)"
if ! [[ "$base_u" =~ ^[0-9]+$ && "$base_t" =~ ^[0-9]+$ ]]; then
  echo "нет или испорчен $BASELINE (ожидаются uncovered_labels=N и tests_without_rules=M)"
  exit 1
fi
cur_u=${#uncovered[@]}
cur_t=${#without[@]}
if [[ $cur_u -gt $base_u ]]; then
  fail+=("непокрытых меток $cur_u > базиса $base_u:")
  for l in $(printf '%s\n' "${uncovered[@]}" | sort); do fail+=("    $l"); done
fi
[[ $cur_t -gt $base_t ]] && fail+=("тестов планирования без rules: $cur_t > базиса $base_t")

# Поднятый правкой файла базис — то же ослабление, что и рост счётчика: иначе храповик снимается молча.
if [[ -n "${MERGE_BASE:-}" ]]; then
  old_bl="$(git show "$MERGE_BASE:$BASELINE" 2>/dev/null | tr -d '\r' || true)"
  old_u="$(grep -E '^uncovered_labels=' <<<"$old_bl" | cut -d= -f2)"
  old_t="$(grep -E '^tests_without_rules=' <<<"$old_bl" | cut -d= -f2)"
  [[ "$old_u" =~ ^[0-9]+$ && $base_u -gt $old_u ]] && fail+=("базис uncovered_labels поднят: $old_u → $base_u")
  [[ "$old_t" =~ ^[0-9]+$ && $base_t -gt $old_t ]] && fail+=("базис tests_without_rules поднят: $old_t → $base_t")
fi

lower=()
[[ $cur_u -lt $base_u ]] && lower+=("uncovered_labels=$cur_u")
[[ $cur_t -lt $base_t ]] && lower+=("tests_without_rules=$cur_t")

if [[ ${#fail[@]} -gt 0 ]]; then
  declaration="${TRACE_DECLARATION:-}"
  commits_msg=""
  [[ -n "${MERGE_BASE:-}" ]] && commits_msg="$(git log --format='%B' "$MERGE_BASE"..HEAD 2>/dev/null || true)"
  if grep -qE '^\s*TRACE-OK:\s*\S' <<<"$declaration"$'\n'"$commits_msg"; then
    echo "трассировка правил: отступление ЗАЯВЛЕНО (TRACE-OK) — пропускаю"
    printf '  %s\n' "${fail[@]}"
    exit 0
  fi
  echo "═══ ТРАССИРОВКА ПРАВИЛ: связь «правило ↔ тест» ослаблена ═══"
  printf '  %s\n' "${fail[@]}"
  cat <<'MSG'

Что делать:
  • новый тест        → строка в шапке «// rules: R-…, <ID инварианта>» или «// rules: none (defect #NNNN)»;
  • новая метка в ТЗ  → тест со ссылкой на неё в том же PR;
  • отступление законно → строка в теле PR: TRACE-OK: <почему>
MSG
  exit 1
fi

if [[ ${#lower[@]} -gt 0 ]]; then
  echo "═══ ТРАССИРОВКА ПРАВИЛ: счётчик уменьшился — опустите базис ═══"
  echo "  в $BASELINE поставьте: ${lower[*]}"
  echo "  (храповик защёлкивается: иначе выигрыш тихо съест следующий PR)"
  exit 1
fi
echo "трассировка правил: базис соблюдён"
exit 0
